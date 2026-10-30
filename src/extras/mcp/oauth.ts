import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { oauthRedirectPort, oauthRedirectUri, type OAuthSettings } from "./config.ts";

export const MCP_OAUTH_CLIENT_NAME = "tiny-crow";

export function oauthDataDir(): string {
  const override = process.env["TINY_CROW_DATA_DIR"];
  if (override) return join(override, "mcp-oauth");
  const xdg = process.env["XDG_DATA_HOME"];
  const base = xdg ?? join(process.env["HOME"] ?? "~", ".local", "share");
  return join(base, "tiny-crow", "mcp-oauth");
}

export function tokenFilename(serverName: string): string {
  const sanitized = [...serverName]
    .map((c) => (/[A-Za-z0-9_-]/.test(c) ? c : "_"))
    .join("");
  return `${sanitized}.json`;
}

export function tokenPath(serverName: string): string {
  return join(oauthDataDir(), tokenFilename(serverName));
}

export interface StoredCredentials {
  accessToken: string;
  refreshToken?: string | null;
  tokenType?: string | null;
  expiresAt?: number | null;
  clientId?: string | null;
  clientSecret?: string | null;
  scopes?: string[];
  tokenEndpoint?: string | null;
  authorizationEndpoint?: string | null;
  registrationEndpoint?: string | null;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export class FileCredentialStore {
  readonly path: string;

  constructor(serverName: string) {
    this.path = tokenPath(serverName);
  }

  async load(): Promise<StoredCredentials | null> {
    let bytes: Buffer;
    try {
      bytes = await readFile(this.path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new AuthError(`read token file: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      return JSON.parse(bytes.toString("utf8")) as StoredCredentials;
    } catch (e) {
      throw new AuthError(`parse token file: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async save(credentials: StoredCredentials): Promise<void> {
    const dir = this.path.split("/").slice(0, -1).join("/") || ".";
    try {
      await mkdir(dir, { recursive: true });
    } catch (e) {
      throw new AuthError(`create token dir: ${e instanceof Error ? e.message : String(e)}`);
    }
    const tmp = `${this.path}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(credentials, null, 2), "utf8");
      await chmod(tmp, 0o600).catch(() => undefined);
      await rename(tmp, this.path);
    } catch (e) {
      throw new AuthError(`persist token file: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async clear(): Promise<void> {
    try {
      await rm(this.path, { force: true });
    } catch (e) {
      throw new AuthError(`remove token file: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

export async function logout(serverName: string): Promise<boolean> {
  const path = tokenPath(serverName);
  try {
    await readFile(path);
  } catch {
    return false;
  }
  await rm(path, { force: true });
  return true;
}

export interface OAuthMetadata {
  issuer?: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string | null;
  scopesSupported?: string[];
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new AuthError(`metadata fetch ${url}: HTTP ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

function metadataFromJson(json: Record<string, unknown>): OAuthMetadata | null {
  if (typeof json["authorization_endpoint"] !== "string" || typeof json["token_endpoint"] !== "string") {
    return null;
  }
  return {
    issuer: typeof json["issuer"] === "string" ? json["issuer"] : undefined,
    authorizationEndpoint: json["authorization_endpoint"],
    tokenEndpoint: json["token_endpoint"],
    registrationEndpoint: typeof json["registration_endpoint"] === "string" ? json["registration_endpoint"] : null,
    scopesSupported: Array.isArray(json["scopes_supported"]) ? (json["scopes_supported"] as unknown[]).map(String) : undefined,
  };
}

export async function discoverMetadata(serverUrl: string): Promise<OAuthMetadata> {
  const origin = new URL(serverUrl).origin;
  let authServerUrl: string | null = null;
  try {
    const prm = await fetchJson(`${origin}/.well-known/oauth-protected-resource`);
    if (typeof prm["authorization_servers"] === "object" && Array.isArray(prm["authorization_servers"])) {
      const first = (prm["authorization_servers"] as unknown[])[0];
      if (typeof first === "string") authServerUrl = first;
    }
  } catch {

  }
  const candidates = [
    ...(authServerUrl ? [`${authServerUrl.replace(/\/$/, "")}/.well-known/oauth-authorization-server`] : []),
    `${origin}/.well-known/oauth-authorization-server`,
  ];
  for (const url of candidates) {
    try {
      const meta = metadataFromJson(await fetchJson(url));
      if (meta) return meta;
    } catch {

    }
  }
  throw new AuthError("OAuth metadata discovery failed: no authorization server document found");
}

function base64Url(bytes: Buffer): string {
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function registerClient(
  metadata: OAuthMetadata,
  redirectUri: string,
): Promise<{ clientId: string; clientSecret?: string }> {
  if (!metadata.registrationEndpoint) throw new AuthError("server does not support dynamic client registration");
  const response = await fetch(metadata.registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_name: MCP_OAUTH_CLIENT_NAME, redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new AuthError(`dynamic client registration failed: HTTP ${response.status}`);
  const data = (await response.json()) as Record<string, unknown>;
  if (typeof data["client_id"] !== "string") throw new AuthError("dynamic client registration returned no client_id");
  return { clientId: data["client_id"], clientSecret: typeof data["client_secret"] === "string" ? data["client_secret"] : undefined };
}

async function exchangeCode(
  metadata: OAuthMetadata,
  clientId: string,
  clientSecret: string | undefined,
  code: string,
  redirectUri: string,
  verifier: string,
): Promise<StoredCredentials> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  });
  if (clientSecret) params.set("client_secret", clientSecret);
  const response = await fetch(metadata.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: params.toString(),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new AuthError(`token exchange failed: HTTP ${response.status}`);
  const data = (await response.json()) as Record<string, unknown>;
  if (typeof data["access_token"] !== "string") throw new AuthError("token exchange returned no access_token");
  return {
    accessToken: data["access_token"],
    refreshToken: typeof data["refresh_token"] === "string" ? data["refresh_token"] : null,
    tokenType: typeof data["token_type"] === "string" ? data["token_type"] : null,
    expiresAt: typeof data["expires_in"] === "number" ? Date.now() + data["expires_in"] * 1000 : null,
    clientId,
    clientSecret: clientSecret ?? null,
    tokenEndpoint: metadata.tokenEndpoint,
    authorizationEndpoint: metadata.authorizationEndpoint,
    registrationEndpoint: metadata.registrationEndpoint ?? null,
  };
}

async function refreshAccessToken(creds: StoredCredentials): Promise<StoredCredentials> {
  if (!creds.refreshToken || !creds.tokenEndpoint || !creds.clientId) {
    throw new AuthError("no refresh token available");
  }
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: creds.refreshToken,
    client_id: creds.clientId,
  });
  if (creds.clientSecret) params.set("client_secret", creds.clientSecret);
  const response = await fetch(creds.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: params.toString(),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new AuthError(`token refresh failed: HTTP ${response.status}`);
  const data = (await response.json()) as Record<string, unknown>;
  if (typeof data["access_token"] !== "string") throw new AuthError("token refresh returned no access_token");
  return {
    ...creds,
    accessToken: data["access_token"],
    refreshToken: typeof data["refresh_token"] === "string" ? data["refresh_token"] : creds.refreshToken,
    expiresAt: typeof data["expires_in"] === "number" ? Date.now() + data["expires_in"] * 1000 : creds.expiresAt ?? null,
  };
}

export class AuthHttpClient {
  readonly serverName: string;
  readonly store: FileCredentialStore;
  private credentials: StoredCredentials | null = null;

  constructor(serverName: string, credentials: StoredCredentials) {
    this.serverName = serverName;
    this.store = new FileCredentialStore(serverName);
    this.credentials = credentials;
  }

  async accessToken(): Promise<string> {
    if (!this.credentials) throw new AuthError("no OAuth token stored");
    if (this.credentials.expiresAt && this.credentials.expiresAt - 60_000 < Date.now()) {
      const refreshed = await refreshAccessToken(this.credentials);
      this.credentials = refreshed;
      await this.store.save(refreshed);
    }
    return this.credentials.accessToken;
  }

  async fetch(input: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${await this.accessToken()}`);
    let response = await fetch(input, { ...init, headers });
    if (response.status === 401 && this.credentials?.refreshToken) {
      const refreshed = await refreshAccessToken(this.credentials);
      this.credentials = refreshed;
      await this.store.save(refreshed);
      headers.set("Authorization", `Bearer ${refreshed.accessToken}`);
      response = await fetch(input, { ...init, headers });
    }
    return response;
  }
}

export async function buildAuthClient(
  serverName: string,
  _url: string,
  _settings: OAuthSettings,
): Promise<AuthHttpClient> {
  const store = new FileCredentialStore(serverName);
  let creds: StoredCredentials | null;
  try {
    creds = await store.load();
  } catch (e) {
    throw new Error(`OAuth restore failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!creds) throw new Error(`no OAuth token stored; run \`/mcp login ${serverName}\``);
  if (creds.expiresAt && creds.expiresAt < Date.now() && creds.refreshToken) {
    try {
      creds = await refreshAccessToken(creds);
      await store.save(creds);
    } catch (e) {
      throw new Error(`OAuth restore failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return new AuthHttpClient(serverName, creds);
}

export interface CapturedCode {
  code: string;
  state: string;
}

export function parseCallback(requestLine: string): CapturedCode {
  const parts = requestLine.split(/\s+/);
  if (parts.length < 2) throw new Error("malformed redirect request line");
  const target = parts[1];
  const query = target.includes("?") ? target.split("?", 2)[1] : "";
  let code: string | null = null;
  let state: string | null = null;
  let error: string | null = null;
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const k = pair.slice(0, eq);
    const v = percentDecode(pair.slice(eq + 1));
    if (k === "code") code = v;
    else if (k === "state") state = v;
    else if (k === "error") error = v;
  }
  if (error) throw new Error(`authorization server returned an error: ${error}`);
  if (!code || !state) throw new Error("redirect missing code or state");
  return { code, state };
}

export function percentDecode(s: string): string {
  const bytes = Buffer.from(s, "utf8");
  const out: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    if (bytes[i] === 0x25 && i + 2 < bytes.length) {
      const hex = bytes.subarray(i + 1, i + 3).toString("ascii");
      const n = Number.parseInt(hex, 16);
      if (!Number.isNaN(n)) {
        out.push(n);
        i += 3;
        continue;
      }
      out.push(bytes[i]);
      i++;
    } else if (bytes[i] === 0x2b) {
      out.push(0x20);
      i++;
    } else {
      out.push(bytes[i]);
      i++;
    }
  }
  return Buffer.from(out).toString("utf8");
}

export function callbackSuccessHtml(): string {
  return "<html><body><h3>tiny-crow: authorization complete.</h3>You can close this tab and return to the terminal.</body></html>";
}

export async function listenForCallback(port: number, timeoutMs: number): Promise<CapturedCode> {
  return new Promise<CapturedCode>((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        server.close();
      } catch {

      }
      reject(new Error(`timed out waiting for OAuth redirect on port ${port}`));
    }, timeoutMs);
    const server = createServer((req, res) => {
      clearTimeout(timer);
      try {
        const requestLine = `${req.method ?? "GET"} ${req.url ?? "/"} HTTP/1.1`;
        const captured = parseCallback(requestLine);
        const body = callbackSuccessHtml();
        res.writeHead(200, { "Content-Type": "text/html", "Content-Length": Buffer.byteLength(body), Connection: "close" });
        res.end(body);
        server.close();
        resolve(captured);
      } catch (e) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("bad redirect");
        server.close();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
    server.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`cannot bind 127.0.0.1:${port} for OAuth redirect: ${e.message}`));
    });
    server.listen(port, "127.0.0.1");
  });
}

export class LoginSession {
  readonly authUrl: string;
  readonly redirectPort: number;
  private readonly serverName: string;
  private readonly metadata: OAuthMetadata;
  private readonly clientId: string;
  private readonly clientSecret: string | undefined;
  private readonly redirectUri: string;
  private readonly verifier: string;
  private readonly state: string;

  constructor(opts: {
    authUrl: string;
    redirectPort: number;
    serverName: string;
    metadata: OAuthMetadata;
    clientId: string;
    clientSecret?: string;
    redirectUri: string;
    verifier: string;
    state: string;
  }) {
    this.authUrl = opts.authUrl;
    this.redirectPort = opts.redirectPort;
    this.serverName = opts.serverName;
    this.metadata = opts.metadata;
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.redirectUri = opts.redirectUri;
    this.verifier = opts.verifier;
    this.state = opts.state;
  }

  async waitForCallback(timeoutMs: number): Promise<void> {
    const captured = await listenForCallback(this.redirectPort, timeoutMs);
    if (captured.state !== this.state) throw new Error("OAuth state mismatch");
    const creds = await exchangeCode(
      this.metadata,
      this.clientId,
      this.clientSecret,
      captured.code,
      this.redirectUri,
      this.verifier,
    );
    await new FileCredentialStore(this.serverName).save(creds);
  }
}

export async function beginLogin(
  serverName: string,
  url: string,
  settings: OAuthSettings,
): Promise<LoginSession> {
  let metadata: OAuthMetadata;
  try {
    metadata = await discoverMetadata(url);
  } catch (e) {
    throw new Error(`OAuth metadata discovery failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const redirectUri = oauthRedirectUri(settings);
  const redirectPort = oauthRedirectPort(settings);
  let clientId = settings.clientId ?? null;
  let clientSecret: string | undefined;
  if (!clientId) {
    try {
      const registered = await registerClient(metadata, redirectUri);
      clientId = registered.clientId;
      clientSecret = registered.clientSecret;
    } catch (e) {
      throw new Error(`OAuth authorization setup failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const { verifier, challenge } = pkcePair();
  const state = base64Url(randomBytes(16));
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  if (settings.scopes.length > 0) params.set("scope", settings.scopes.join(" "));
  const authUrl = `${metadata.authorizationEndpoint}?${params.toString()}`;
  return new LoginSession({
    authUrl,
    redirectPort,
    serverName,
    metadata,
    clientId,
    clientSecret,
    redirectUri,
    verifier,
    state,
  });
}
