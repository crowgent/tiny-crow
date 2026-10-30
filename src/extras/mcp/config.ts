// MCP server configuration: stdio commands and HTTP endpoints, OAuth
// settings, timeouts, and the --custom-mcp* CLI parsers.

export const DEFAULT_CONNECT_TIMEOUT_SECS = 10;
export const DEFAULT_TOOL_TIMEOUT_SECS = 20;
export const DEFAULT_CONNECT_RETRIES = 1;
export const DEFAULT_REDIRECT_PORT = 8970;

export type McpServerConfig =
  | {
      kind: "command";
      command: string;
      args: string[];
      env: Record<string, string>;
      connectTimeoutSecs?: number | null;
      toolTimeoutSecs?: number | null;
      connectRetries?: number | null;
    }
  | {
      kind: "url";
      url: string;
      headers: Record<string, string>;
      oauth?: OAuthConfig | null;
      connectTimeoutSecs?: number | null;
      toolTimeoutSecs?: number | null;
      connectRetries?: number | null;
    };

export interface OAuthSettings {
  scopes: string[];
  clientId?: string | null;
  redirectPort?: number | null;
}

export type OAuthConfig = boolean | OAuthSettings;

export function mcpTimeoutFields(config: McpServerConfig): {
  connectTimeoutSecs: number | null;
  toolTimeoutSecs: number | null;
  connectRetries: number | null;
} {
  return {
    connectTimeoutSecs: config.connectTimeoutSecs ?? null,
    toolTimeoutSecs: config.toolTimeoutSecs ?? null,
    connectRetries: config.connectRetries ?? null,
  };
}

export function mcpConnectTimeoutMs(config: McpServerConfig): number {
  return (config.connectTimeoutSecs ?? DEFAULT_CONNECT_TIMEOUT_SECS) * 1000;
}

export function mcpToolTimeoutMs(config: McpServerConfig): number {
  return (config.toolTimeoutSecs ?? DEFAULT_TOOL_TIMEOUT_SECS) * 1000;
}

export function mcpConnectRetries(config: McpServerConfig): number {
  return config.connectRetries ?? DEFAULT_CONNECT_RETRIES;
}

export function oauthSettings(config: OAuthConfig | undefined | null): OAuthSettings | null {
  if (config === undefined || config === null) return null;
  if (config === false) return null;
  if (config === true) return { scopes: [] };
  return { scopes: config.scopes ?? [], clientId: config.clientId ?? null, redirectPort: config.redirectPort ?? null };
}

export function oauthRedirectPort(settings: OAuthSettings): number {
  return settings.redirectPort ?? DEFAULT_REDIRECT_PORT;
}

export function oauthRedirectUri(settings: OAuthSettings): string {
  return `http://127.0.0.1:${oauthRedirectPort(settings)}/callback`;
}

export function isValidServerName(name: string): boolean {
  if (name.length === 0) return false;
  if (name.includes("__")) return false;
  for (const ch of name) {
    if (/\s/.test(ch) || ch === "=") return false;
  }
  return true;
}

/** Shell-style word splitting honouring single/double quotes and backslash
 *  escapes, matching the Rust shell-words behaviour used by --custom-mcp. */
export function splitShellWords(spec: string): string[] {
  const words: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let hasToken = false;
  let i = 0;
  while (i < spec.length) {
    const ch = spec[i];
    if (inSingle) {
      if (ch === "'") inSingle = false;
      else current += ch;
      i++;
      continue;
    }
    if (inDouble) {
      if (ch === '"') {
        inDouble = false;
        i++;
      } else if (ch === "\\" && i + 1 < spec.length && ['"', "\\", "$", "`"].includes(spec[i + 1])) {
        current += spec[i + 1];
        i += 2;
      } else {
        current += ch;
        i++;
      }
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      hasToken = true;
      i++;
    } else if (ch === '"') {
      inDouble = true;
      hasToken = true;
      i++;
    } else if (ch === "\\" && i + 1 < spec.length) {
      current += spec[i + 1];
      hasToken = true;
      i += 2;
    } else if (/\s/.test(ch)) {
      if (hasToken || current.length > 0) {
        words.push(current);
        current = "";
        hasToken = false;
      }
      i++;
    } else {
      current += ch;
      hasToken = true;
      i++;
    }
  }
  if (inSingle || inDouble) throw new Error("unterminated quote");
  if (hasToken || current.length > 0) words.push(current);
  return words;
}

export function parseCustomMcp(entry: string): [string, McpServerConfig] {
  const eq = entry.indexOf("=");
  if (eq === -1) throw new Error(`--custom-mcp '${entry}': expected NAME=COMMAND ...`);
  const name = entry.slice(0, eq).trim();
  const spec = entry.slice(eq + 1).trim();
  if (!isValidServerName(name)) {
    throw new Error(`--custom-mcp '${entry}': invalid server name '${name}'`);
  }
  let words: string[];
  try {
    words = splitShellWords(spec);
  } catch (e) {
    throw new Error(`--custom-mcp '${entry}': cannot parse command: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (words.length === 0) {
    throw new Error(`--custom-mcp '${entry}': command is empty (expected NAME=COMMAND ...)`);
  }
  const [command, ...args] = words;
  return [
    name,
    { kind: "command", command, args, env: {}, connectTimeoutSecs: null, toolTimeoutSecs: null, connectRetries: null },
  ];
}

export function parseCustomMcpHttp(entry: string): [string, McpServerConfig] {
  const eq = entry.indexOf("=");
  if (eq === -1) throw new Error(`--custom-mcp-http '${entry}': expected NAME=URL`);
  const name = entry.slice(0, eq).trim();
  const url = entry.slice(eq + 1).trim();
  if (!isValidServerName(name)) {
    throw new Error(`--custom-mcp-http '${entry}': invalid server name '${name}'`);
  }
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new Error(`--custom-mcp-http '${entry}': URL must start with http:// or https://`);
  }
  return [
    name,
    { kind: "url", url, headers: {}, oauth: null, connectTimeoutSecs: null, toolTimeoutSecs: null, connectRetries: null },
  ];
}

/** Parse an untagged JSON value into a McpServerConfig: an object with
 *  `command` is a stdio server, one with `url` is an HTTP server. */
export function parseMcpServerConfig(value: unknown): McpServerConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("MCP server config must be an object");
  }
  const obj = value as Record<string, unknown>;
  const connectTimeoutSecs = typeof obj["connect_timeout_secs"] === "number" ? (obj["connect_timeout_secs"] as number) : null;
  const toolTimeoutSecs = typeof obj["tool_timeout_secs"] === "number" ? (obj["tool_timeout_secs"] as number) : null;
  const connectRetries = typeof obj["connect_retries"] === "number" ? (obj["connect_retries"] as number) : null;
  if (typeof obj["command"] === "string") {
    return {
      kind: "command",
      command: obj["command"],
      args: Array.isArray(obj["args"]) ? (obj["args"] as unknown[]).map(String) : [],
      env: (obj["env"] as Record<string, string>) ?? {},
      connectTimeoutSecs,
      toolTimeoutSecs,
      connectRetries,
    };
  }
  if (typeof obj["url"] === "string") {
    let oauth: OAuthConfig | null = null;
    if (typeof obj["oauth"] === "boolean") oauth = obj["oauth"];
    else if (typeof obj["oauth"] === "object" && obj["oauth"] !== null) {
      const o = obj["oauth"] as Record<string, unknown>;
      oauth = {
        scopes: Array.isArray(o["scopes"]) ? (o["scopes"] as unknown[]).map(String) : [],
        clientId: typeof o["client_id"] === "string" ? o["client_id"] : null,
        redirectPort: typeof o["redirect_port"] === "number" ? o["redirect_port"] : null,
      };
    }
    return {
      kind: "url",
      url: obj["url"],
      headers: (obj["headers"] as Record<string, string>) ?? {},
      oauth,
      connectTimeoutSecs,
      toolTimeoutSecs,
      connectRetries,
    };
  }
  throw new Error("MCP server config must have a 'command' or 'url' field");
}

export function mcpServerConfigToJson(config: McpServerConfig): Record<string, unknown> {
  if (config.kind === "command") {
    return {
      command: config.command,
      args: config.args,
      env: config.env,
      ...(config.connectTimeoutSecs != null ? { connect_timeout_secs: config.connectTimeoutSecs } : {}),
      ...(config.toolTimeoutSecs != null ? { tool_timeout_secs: config.toolTimeoutSecs } : {}),
      ...(config.connectRetries != null ? { connect_retries: config.connectRetries } : {}),
    };
  }
  return {
    url: config.url,
    headers: config.headers,
    ...(config.oauth != null ? { oauth: config.oauth } : {}),
    ...(config.connectTimeoutSecs != null ? { connect_timeout_secs: config.connectTimeoutSecs } : {}),
    ...(config.toolTimeoutSecs != null ? { tool_timeout_secs: config.toolTimeoutSecs } : {}),
    ...(config.connectRetries != null ? { connect_retries: config.connectRetries } : {}),
  };
}
