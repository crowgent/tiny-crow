import { McpClientHandle } from "./client.ts";
import {
  type McpServerConfig,
} from "./config.ts";
import {
  mcpDynamicTool,
  type AskSenderLike,
  type DynamicTool,
  type HandleRef,
  type PermCheckLike,
} from "./tool.ts";

export const SHUTDOWN_TIMEOUT_MS = 5_000;

export class SharedHandle implements HandleRef {
  private handle: McpClientHandle;
  private refCount = 1;

  constructor(handle: McpClientHandle) {
    this.handle = handle;
  }

  get serverName(): string {
    return this.handle.serverName;
  }

  getHandle(): McpClientHandle {
    return this.handle;
  }

  replace(handle: McpClientHandle): void {
    this.handle = handle;
  }

  async reconnect(): Promise<McpClientHandle> {
    const fresh = await McpClientHandle.connect(this.handle.serverName, this.handle.config);
    this.handle = fresh;
    return fresh;
  }

  retain(): void {
    this.refCount++;
  }

  release(): void {
    this.refCount--;
  }

  get isSolelyOwned(): boolean {
    return this.refCount <= 1;
  }
}

export type SharedHandleLike = SharedHandle;

export class McpClientManager {
  handles: SharedHandle[];
  notices: string[];

  constructor(handles: SharedHandle[] = [], notices: string[] = []) {
    this.handles = handles;
    this.notices = notices;
  }

  static async connectAll(
    configs: Map<string, McpServerConfig> | Record<string, McpServerConfig>,
  ): Promise<McpClientManager> {
    const entries: Array<[string, McpServerConfig]> =
      configs instanceof Map ? [...configs.entries()] : Object.entries(configs);
    const results = await Promise.all(
      entries.map(async ([name, cfg]) => {
        const start = Date.now();
        try {
          const handle = await McpClientHandle.connect(name, cfg);
          return { name, elapsedMs: Date.now() - start, handle, error: null as Error | null };
        } catch (e) {
          return { name, elapsedMs: Date.now() - start, handle: null, error: e instanceof Error ? e : new Error(String(e)) };
        }
      }),
    );
    const handles: SharedHandle[] = [];
    const notices: string[] = [];
    for (const result of results) {
      if (result.handle) {
        handles.push(new SharedHandle(result.handle));
      } else {
        notices.push(`MCP server '${result.name}' not connected: ${result.error?.message ?? "unknown error"}`);
      }
    }
    notices.sort();
    return new McpClientManager(handles, notices);
  }

  takeNotices(): string[] {
    const taken = this.notices;
    this.notices = [];
    return taken;
  }

  getHandle(name: string): SharedHandle | null {
    for (const shared of this.handles) {
      if (shared.serverName === name) return shared;
    }
    return null;
  }

  async collectTools(
    permission?: PermCheckLike | null,
    askTx?: AskSenderLike | null,
  ): Promise<DynamicTool[]> {
    const perServer = await Promise.all(
      this.handles.map(async (shared) => {
        const handle = shared.getHandle();
        const serverName = handle.serverName;
        let tools: Awaited<ReturnType<typeof handle.listTools>>;
        try {
          tools = await handle.listTools();
        } catch (e) {
          console.warn(`Failed to list tools from MCP server '${serverName}': ${e instanceof Error ? e.message : String(e)}`);
          return [] as DynamicTool[];
        }
        return tools.map((definition) =>
          mcpDynamicTool(serverName, definition, shared, permission ?? null, askTx ?? null),
        );
      }),
    );
    return perServer.flat();
  }

  async reconnect(name: string, cfg: McpServerConfig): Promise<void> {
    const handle = await McpClientHandle.connect(name, cfg);
    const existing = this.getHandle(name);
    if (existing) {
      existing.replace(handle);
    } else {
      this.handles.push(new SharedHandle(handle));
    }
  }

  async shutdown(): Promise<void> {
    for (const shared of this.handles) {
      const name = shared.serverName;
      if (shared.isSolelyOwned) {
        const handle = shared.getHandle();
        try {
          await Promise.race([
            handle.cancel(),
            new Promise((r) => setTimeout(r, SHUTDOWN_TIMEOUT_MS)),
          ]);
        } catch {

        }
      }
      void name;
    }
    this.handles = [];
  }
}

export { McpClientHandle } from "./client.ts";
export type { McpToolDefinition, McpContentBlock, McpCallToolResult } from "./client.ts";
export { McpServiceError } from "./client.ts";
export {
  DEFAULT_CONNECT_TIMEOUT_SECS,
  DEFAULT_TOOL_TIMEOUT_SECS,
  DEFAULT_CONNECT_RETRIES,
  DEFAULT_REDIRECT_PORT,
  isValidServerName,
  parseCustomMcp,
  parseCustomMcpHttp,
  parseMcpServerConfig,
  mcpServerConfigToJson,
  oauthSettings,
  oauthRedirectPort,
  oauthRedirectUri,
} from "./config.ts";
export type { McpServerConfig, OAuthConfig, OAuthSettings } from "./config.ts";
export {
  AuthHttpClient,
  FileCredentialStore,
  LoginSession,
  beginLogin,
  buildAuthClient,
  logout,
  parseCallback,
  percentDecode,
  tokenFilename,
  tokenPath,
} from "./oauth.ts";
export type { StoredCredentials, OAuthMetadata, CapturedCode } from "./oauth.ts";
export {
  ToolExecutionError,
  mcpDynamicTool,
  renderResult,
  blocksToParts,
  callErrorMessage,
  textOutput,
  contentOutput,
} from "./tool.ts";
export type { DynamicTool, ToolOutput, ToolResultBlock, ToolContext, HandleRef, PermCheckLike, AskSenderLike } from "./tool.ts";
