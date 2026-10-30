// ACP server configuration: TCP or stdio transport selection.

export type AcpServerConfig =
  | { type: "tcp"; host: string; port: number; apiKey?: string | null }
  | { type: "stdio" };

export function transportType(config: AcpServerConfig): string {
  return config.type;
}

export function parseAcpServerConfig(value: unknown): AcpServerConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("ACP server config must be an object");
  }
  const obj = value as Record<string, unknown>;
  if (obj["type"] === "tcp") {
    if (typeof obj["host"] !== "string" || typeof obj["port"] !== "number") {
      throw new Error("ACP tcp config requires host (string) and port (number)");
    }
    return {
      type: "tcp",
      host: obj["host"],
      port: obj["port"],
      apiKey: typeof obj["api_key"] === "string" ? obj["api_key"] : null,
    };
  }
  if (obj["type"] === "stdio") return { type: "stdio" };
  throw new Error("ACP server config type must be 'tcp' or 'stdio'");
}

export function acpServerConfigToJson(config: AcpServerConfig): Record<string, unknown> {
  if (config.type === "tcp") {
    return {
      type: "tcp",
      host: config.host,
      port: config.port,
      ...(config.apiKey != null ? { api_key: config.apiKey } : {}),
    };
  }
  return { type: "stdio" };
}
