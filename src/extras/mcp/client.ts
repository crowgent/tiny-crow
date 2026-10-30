// MCP client: JSON-RPC over stdio (newline-delimited) and over
// Streamable HTTP (POST + SSE), with connect retries, stderr draining,
// tool-call timeouts and the OAuth fetch wrapper for URL servers.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import {
  mcpConnectRetries,
  mcpConnectTimeoutMs,
  mcpToolTimeoutMs,
  oauthSettings,
  type McpServerConfig,
} from "./config.ts";
import { buildAuthClient, type AuthHttpClient } from "./oauth.ts";

export interface McpToolDefinition {
  name: string;
  description?: string | null;
  inputSchema: Record<string, unknown>;
}

export type McpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string }
  | { type: "resource"; uri?: string; mimeType?: string | null; text?: string | null; blob?: string | null };

export interface McpCallToolResult {
  content: McpContentBlock[];
  isError?: boolean;
}

export class McpServiceError extends Error {
  readonly kind: "timeout" | "transportClosed" | "unexpectedResponse" | "other";
  readonly timeoutMs?: number;

  constructor(kind: McpServiceError["kind"], message: string, timeoutMs?: number) {
    super(message);
    this.name = "McpServiceError";
    this.kind = kind;
    this.timeoutMs = timeoutMs;
  }

  static timeout(timeoutMs: number): McpServiceError {
    return new McpServiceError("timeout", `request timed out after ${timeoutMs}ms`, timeoutMs);
  }

  static transportClosed(): McpServiceError {
    return new McpServiceError("transportClosed", "MCP transport closed");
  }
}

export function parseHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) {
      throw new Error(`Invalid header name '${name}'`);
    }
    if (/[\r\n]/.test(value)) throw new Error(`Invalid header value for '${name}'`);
    result[name] = value;
  }
  return result;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

type Transport =
  | { kind: "stdio"; send: (msg: Record<string, unknown>) => void | Promise<Record<string, unknown>>; close: () => void }
  | { kind: "http"; send: (msg: Record<string, unknown>) => void | Promise<Record<string, unknown>>; close: () => void };

const MCP_PROTOCOL_VERSION = "2024-11-05";

export class McpClientHandle {
  readonly serverName: string;
  toolTimeoutMs: number;
  config: McpServerConfig;
  private transport: Transport | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  private sessionId: string | null = null;
  private closed = false;

  private constructor(serverName: string, config: McpServerConfig, transport: Transport) {
    this.serverName = serverName;
    this.config = config;
    this.transport = transport;
    this.toolTimeoutMs = mcpToolTimeoutMs(config);
  }

  static async connect(serverName: string, config: McpServerConfig): Promise<McpClientHandle> {
    const attempts = 1 + mcpConnectRetries(config);
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const handle = await McpClientHandle.connectOnce(serverName, config);
        handle.toolTimeoutMs = mcpToolTimeoutMs(config);
        handle.config = config;
        return handle;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (attempt < attempts) {
          await new Promise((r) => setTimeout(r, attempt * 1000));
        }
      }
    }
    throw lastError ?? new Error("MCP connect failed");
  }

  private static async connectOnce(serverName: string, config: McpServerConfig): Promise<McpClientHandle> {
    const connectTimeoutMs = mcpConnectTimeoutMs(config);
    if (config.kind === "command") {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(config.command, config.args, {
          env: { ...process.env, ...config.env },
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (e) {
        throw new Error(`MCP connection failed for '${serverName}': ${e instanceof Error ? e.message : String(e)}`);
      }
      const handle = new McpClientHandle(serverName, config, {
        kind: "stdio",
        send: (msg) => {
          try {
            child.stdin.write(`${JSON.stringify(msg)}\n`);
          } catch {
            // transport closed; pending requests fail below
          }
        },
        close: () => {
          try {
            child.kill();
          } catch {
            // already dead
          }
        },
      });
      const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
      lines.on("line", (line) => {
        if (!line.trim()) return;
        try {
          handle.onMessage(JSON.parse(line) as Record<string, unknown>);
        } catch {
          // ignore malformed server output
        }
      });
      const errLines = createInterface({ input: child.stderr, crlfDelay: Infinity });
      errLines.on("line", (line) => {
        console.debug(`[mcp ${serverName}] ${line}`);
      });
      child.on("exit", () => handle.onTransportClosed());
      child.on("error", () => handle.onTransportClosed());
      // A dead child's stdin raises EPIPE asynchronously; without a
      // listener that crashes the process instead of failing the request.
      child.stdin.on("error", () => {
        // Transport-closed handling (child exit/error above) rejects
        // pending requests; stdin errors alone carry no extra signal.
      });
      try {
        await handle.initialize(connectTimeoutMs);
      } catch (e) {
        // A failed handshake must not leak the child (e.g. an
        // unresponsive server would otherwise keep the process alive
        // for its full lifetime and hold the test runner open).
        try {
          child.kill();
        } catch {
          // already dead
        }
        throw e;
      }
      return handle;
    }

    // HTTP transport
    const customHeaders = parseHeaders(config.headers);
    const settings = oauthSettings(config.oauth ?? null);
    let auth: AuthHttpClient | null = null;
    if (settings) {
      auth = await buildAuthClient(serverName, config.url, settings);
    }
    const httpSend = async (msg: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...customHeaders,
      };
      if (handleRef.sessionId) headers["mcp-session-id"] = handleRef.sessionId;
      const doFetch = auth
        ? (u: string, init: RequestInit) => auth!.fetch(u, init)
        : (u: string, init: RequestInit) => fetch(u, init);
      const response = await doFetch(config.url, {
        method: "POST",
        headers,
        body: JSON.stringify(msg),
        signal: AbortSignal.timeout(connectTimeoutMs + 60_000),
      });
      const newSession = response.headers.get("mcp-session-id");
      if (newSession) handleRef.sessionId = newSession;
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`MCP HTTP ${response.status}: ${text.slice(0, 300)}`);
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("text/event-stream")) {
        const text = await response.text();
        for (const chunk of text.split("\n\n")) {
          for (const line of chunk.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (!data) continue;
            try {
              const parsed = JSON.parse(data) as Record<string, unknown>;
              if (typeof parsed["id"] === "number" || typeof parsed["result"] !== "undefined" || typeof parsed["error"] !== "undefined") {
                return parsed;
              }
              if (typeof parsed["method"] === "string") handleRef.onMessage(parsed);
            } catch {
              // ignore
            }
          }
        }
        throw new Error("MCP HTTP stream contained no response");
      }
      return (await response.json()) as Record<string, unknown>;
    };
    const handleRef = new McpClientHandle(serverName, config, {
      kind: "http",
      send: (msg) => {
        void httpSend(msg).then(
          (resp) => handleRef.onMessage(resp),
          (e: Error) => handleRef.onTransportError(e),
        );
      },
      close: () => undefined,
    });
    // HTTP: initialize is a direct request/response, not routed via pending.
    handleRef.transport = {
      kind: "http",
      send: (msg) => {
        void httpSend(msg).then(
          (resp) => handleRef.onMessage(resp),
          (e: Error) => handleRef.onTransportError(e),
        );
      },
      close: () => undefined,
    };
    await handleRef.initializeHttp(httpSend, connectTimeoutMs);
    return handleRef;
  }

  private onMessage(msg: Record<string, unknown>): void {
    const id = msg["id"];
    if (typeof id === "number" && this.pending.has(id)) {
      const entry = this.pending.get(id)!;
      this.pending.delete(id);
      if (msg["error"] !== undefined && msg["error"] !== null) {
        const err = msg["error"] as Record<string, unknown>;
        entry.reject(new Error(`MCP error ${String(err["code"] ?? "")}: ${String(err["message"] ?? "unknown")}`));
      } else {
        entry.resolve(msg);
      }
      return;
    }
    // Server notifications / requests are ignored (we declare no
    // capabilities that would legitimately trigger a server request).
  }

  private onTransportClosed(): void {
    this.closed = true;
    for (const [, entry] of this.pending) entry.reject(McpServiceError.transportClosed());
    this.pending.clear();
  }

  private onTransportError(e: Error): void {
    if (this.closed) return;
    for (const [, entry] of this.pending) entry.reject(e);
    this.pending.clear();
  }

  private async initialize(connectTimeoutMs: number): Promise<void> {
    const result = await this.request(
      "initialize",
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "zerostack-ts", version: "1.0.5" },
      },
      connectTimeoutMs,
    );
    void result;
    this.notify("notifications/initialized", {});
  }

  private async initializeHttp(
    send: (msg: Record<string, unknown>) => Promise<Record<string, unknown>>,
    connectTimeoutMs: number,
  ): Promise<void> {
    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "zerostack-ts", version: "1.0.5" },
      },
    };
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`MCP server '${this.serverName}' connection timed out after ${Math.round(connectTimeoutMs / 1000)}s`)), connectTimeoutMs),
    );
    const response = await Promise.race([send(request as unknown as Record<string, unknown>), timeout]);
    if (response["error"]) {
      const err = response["error"] as Record<string, unknown>;
      throw new Error(`MCP connection failed for '${this.serverName}': ${String(err["message"] ?? "unknown")}`);
    }
    const notif: JsonRpcNotification = { jsonrpc: "2.0", method: "notifications/initialized" };
    try {
      await send(notif as unknown as Record<string, unknown>);
    } catch {
      // initialized notification is best-effort
    }
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<Record<string, unknown>> {
    if (!this.transport || this.closed) return Promise.reject(McpServiceError.transportClosed());
    const id = this.nextId++;
    const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(McpServiceError.timeout(timeoutMs));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      try {
        this.transport!.send(request as unknown as Record<string, unknown>);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  private notify(method: string, params: unknown): void {
    if (!this.transport || this.closed) return;
    try {
      this.transport.send({ jsonrpc: "2.0", method, params });
    } catch {
      // notifications are best-effort
    }
  }

  /** Peer adapter: the request surface tools use (list + call). */
  peer(): { listTools: () => Promise<McpToolDefinition[]>; callTool: (name: string, args: Record<string, unknown> | null) => Promise<McpCallToolResult> } {
    return {
      listTools: () => this.listTools(),
      callTool: (name, args) => this.callTool(name, args),
    };
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const response = await this.request("tools/list", {}, this.toolTimeoutMs);
    const result = (response["result"] as Record<string, unknown> | undefined) ?? {};
    const tools = Array.isArray(result["tools"]) ? (result["tools"] as unknown[]) : [];
    return tools.map((raw) => {
      const t = raw as Record<string, unknown>;
      return {
        name: String(t["name"] ?? ""),
        description: typeof t["description"] === "string" ? t["description"] : null,
        inputSchema: (t["inputSchema"] as Record<string, unknown>) ?? { type: "object", properties: {} },
      };
    });
  }

  async callTool(name: string, args: Record<string, unknown> | null): Promise<McpCallToolResult> {
    const params: Record<string, unknown> = { name };
    if (args) params["arguments"] = args;
    let response: Record<string, unknown>;
    try {
      response = await this.request("tools/call", params, this.toolTimeoutMs);
    } catch (e) {
      if (e instanceof McpServiceError) throw e;
      throw new McpServiceError("other", e instanceof Error ? e.message : String(e));
    }
    const result = (response["result"] as Record<string, unknown> | undefined) ?? {};
    const content = Array.isArray(result["content"]) ? (result["content"] as unknown[]) : [];
    const blocks: McpContentBlock[] = content.map((raw) => {
      const c = raw as Record<string, unknown>;
      if (c["type"] === "image") {
        return { type: "image", mimeType: String(c["mimeType"] ?? ""), data: String(c["data"] ?? "") };
      }
      if (c["type"] === "resource") {
        const resource = (c["resource"] as Record<string, unknown>) ?? {};
        return {
          type: "resource",
          uri: typeof resource["uri"] === "string" ? resource["uri"] : undefined,
          mimeType: typeof resource["mimeType"] === "string" ? resource["mimeType"] : null,
          text: typeof resource["text"] === "string" ? resource["text"] : null,
          blob: typeof resource["blob"] === "string" ? resource["blob"] : null,
        };
      }
      return { type: "text", text: String(c["text"] ?? "") };
    });
    return { content: blocks, isError: result["isError"] === true };
  }

  async cancel(): Promise<void> {
    this.closed = true;
    this.onTransportClosed();
    this.transport?.close();
    this.transport = null;
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
