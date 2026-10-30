import { createServer, type Socket } from "node:net";
import { createInterface } from "node:readline";
import {
  createClient,
  OpencodeClient,
  type AnyClient,
  type ChatMessage,
  type CustomProvidersMap,
} from "../../provider.ts";
import type { AcpServerConfig } from "./config.ts";

export const AGENT_NAME = "tiny-crow";
export const AGENT_VERSION = "1.0.5";
export const DEFAULT_ACP_TCP_PORT = 7243;

export type SessionId = string;

export type AcpContentBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export interface TextContent {
  type: "text";
  text: string;
}

export type StopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";

export interface AgentCapabilities {
  loadSession: boolean;
  promptCapabilities: { image: boolean; audio: boolean; embeddedContext: boolean };
}

export interface Implementation {
  name: string;
  version: string;
}

export interface InitializeRequest {
  protocolVersion: number;
  clientCapabilities?: Record<string, unknown>;
  clientInfo?: Implementation;
}

export interface InitializeResponse {
  protocolVersion: number;
  agentCapabilities: AgentCapabilities;
  agentInfo: Implementation;
  authMethods?: unknown[];
}

export interface NewSessionRequest {
  cwd: string;
  mcpServers?: unknown[];
}

export interface NewSessionResponse {
  sessionId: SessionId;
}

export interface PromptRequest {
  sessionId: SessionId;
  prompt: AcpContentBlock[];
}

export interface PromptResponse {
  stopReason: StopReason;
}

export type SessionUpdate =
  | { kind: "agent_message_chunk"; content: TextContent }
  | { kind: "agent_thought_chunk"; content: TextContent }
  | { kind: "tool_call"; id: string; title: string; status: "pending" | "completed" | "failed"; rawInput?: unknown }
  | { kind: "tool_call_update"; id: string; status: "completed" | "failed"; content: TextContent[] };

export interface SessionNotification {
  sessionId: SessionId;
  update: SessionUpdate;
}

export interface SessionState {
  messages: Array<[string, string]>;
}

export type SecurityMode = "yolo" | "standard" | "guarded" | "readonly" | "restrictive";

export interface AcpCliLike {
  dangerouslySkipPermissions?: boolean;
  yolo?: boolean;
  acceptAll?: boolean;
  restrictive?: boolean;
  noTools?: boolean;
}

export interface AcpCfgLike {
  yolo?: boolean | null;
  acceptAll?: boolean | null;
  restrictive?: boolean | null;
  defaultPermissionMode?: string | null;
}

export function resolveAcpMode(cli: AcpCliLike, cfg: AcpCfgLike): SecurityMode {
  if (cli.dangerouslySkipPermissions) return "standard";
  if (cli.yolo || cfg.yolo) return "yolo";
  if (cli.acceptAll || cfg.acceptAll) return "standard";
  if (cli.restrictive || cfg.restrictive) return "restrictive";
  if (cfg.defaultPermissionMode) {
    switch (cfg.defaultPermissionMode) {
      case "yolo":
        return "yolo";
      case "accept":
      case "standard":
        return "standard";
      case "guarded":
        return "guarded";
      case "readonly":
        return "readonly";
      case "restrictive":
        return "restrictive";
      default:
        return "standard";
    }
  }
  return "standard";
}

export interface AcpPermission {
  mode: SecurityMode;
  autoApprove: boolean;
  ask: (tool: string, input: string) => Promise<"allowOnce">;
}

export function buildAcpPermission(
  cli: AcpCliLike,
  cfg: AcpCfgLike,
): AcpPermission | null {
  if (cli.noTools || cli.dangerouslySkipPermissions) return null;
  const mode = resolveAcpMode(cli, cfg);
  return {
    mode,
    autoApprove: true,
    ask: async (tool: string, input: string) => {
      console.warn(`ACP auto-approving tool call: tool=${tool}, input_len=${input.length}`);
      return "allowOnce";
    },
  };
}

export interface SandboxSetup {
  sandbox: unknown | null;
  warnings: string[];
}

export interface SandboxSettings {
  enabled: boolean;
  required: boolean;
  backend?: string;
  shell?: string;
  expose?: string[];
  network?: boolean;
}

export function buildSandboxSetup(settings: SandboxSettings): SandboxSetup {
  const warnings: string[] = [];
  if (!settings.enabled && settings.required) {
    warnings.push("sandbox is set to false but sandbox-required is set, enabling the sandbox anyway");
  }
  return { sandbox: settings.enabled || settings.required ? { enabled: true } : null, warnings };
}

export interface AgentRunEvent {
  type: "token" | "reasoning" | "toolCall" | "subagentToolCall" | "toolResult" | "retrying" | "completionCall" | "done" | "error";
  text?: string;
  callId?: string;
  name?: string;
  args?: unknown;
  output?: string;
  attempt?: number;
  max?: number;
  message?: string;
}

export type RunAgentFn = (
  prompt: string,
  sessionId: SessionId,
) => AsyncIterable<AgentRunEvent>;

export interface AcpServeOptions {
  host?: string | null;
  port?: number | null;
  provider?: string;
  model?: string;
  customProviders?: CustomProvidersMap;
  apiKeys?: Map<string, string> | Record<string, string> | null;
  
  runAgent?: RunAgentFn;
  sandbox?: SandboxSettings;
  cli?: AcpCliLike;
  cfg?: AcpCfgLike;
  
  transport?: AcpServerConfig;
}

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

export class AcpServer {
  private sessions = new Map<SessionId, SessionState>();
  private readonly options: AcpServeOptions;
  private send: (msg: Record<string, unknown>) => void = () => undefined;

  constructor(options: AcpServeOptions) {
    this.options = options;
  }

  setSender(send: (msg: Record<string, unknown>) => void): void {
    this.send = send;
  }

  get sessionIds(): SessionId[] {
    return [...this.sessions.keys()];
  }

  getSession(sessionId: SessionId): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  handleInitialize(req: InitializeRequest): InitializeResponse {
    const capabilities: AgentCapabilities = {
      loadSession: false,
      promptCapabilities: { image: false, audio: false, embeddedContext: false },
    };
    return {
      protocolVersion: req.protocolVersion,
      agentCapabilities: capabilities,
      agentInfo: { name: AGENT_NAME, version: AGENT_VERSION },
    };
  }

  handleNewSession(req: NewSessionRequest): NewSessionResponse {
    const sessionId = crypto.randomUUID();
    if (this.options.sandbox) {
      for (const warning of buildSandboxSetup(this.options.sandbox).warnings) {
        console.warn(warning);
      }
    }
    void req.cwd;
    this.sessions.set(sessionId, { messages: [] });
    return { sessionId };
  }

  promptText(prompt: AcpContentBlock[]): string {
    return prompt.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
  }

  private notify(sessionId: SessionId, update: SessionUpdate): void {
    const notification: Record<string, unknown> = {
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId, update: sessionUpdateToWire(update) },
    };
    try {
      this.send(notification);
    } catch (e) {
      console.warn(`ACP failed to send notification: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async handlePrompt(req: PromptRequest): Promise<PromptResponse> {
    const sessionId = req.sessionId;
    const promptText = this.promptText(req.prompt);
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = { messages: [] };
      this.sessions.set(sessionId, session);
    }
    session.messages.push(["user", promptText]);

    const runAgent = this.options.runAgent ?? this.defaultRunAgent.bind(this);
    const toolCallIds = new Map<string, string>();
    let finalResponse = "";
    try {
      for await (const event of runAgent(promptText, sessionId)) {
        switch (event.type) {
          case "token":
            finalResponse += event.text ?? "";
            this.notify(sessionId, { kind: "agent_message_chunk", content: { type: "text", text: event.text ?? "" } });
            break;
          case "reasoning":
            this.notify(sessionId, { kind: "agent_thought_chunk", content: { type: "text", text: event.text ?? "" } });
            break;
          case "toolCall": {
            const id = crypto.randomUUID();
            if (event.callId) toolCallIds.set(event.callId, id);
            this.notify(sessionId, {
              kind: "tool_call",
              id,
              title: event.name ?? "",
              status: "pending",
              rawInput: event.args,
            });
            break;
          }
          case "subagentToolCall": {

            this.notify(sessionId, {
              kind: "tool_call",
              id: crypto.randomUUID(),
              title: `[subagent] ${event.name ?? ""}`,
              status: "completed",
              rawInput: event.args,
            });
            break;
          }
          case "toolResult": {
            const id = event.callId ? toolCallIds.get(event.callId) : undefined;
            if (!id) {
              console.warn(`ACP tool result with no announced tool call (id=${event.callId ?? ""}); skipping update`);
              continue;
            }
            toolCallIds.delete(event.callId!);
            this.notify(sessionId, {
              kind: "tool_call_update",
              id,
              status: "completed",
              content: [{ type: "text", text: event.output ?? "" }],
            });
            break;
          }
          case "retrying":
            this.notify(sessionId, {
              kind: "agent_thought_chunk",
              content: { type: "text", text: `retrying... (${event.attempt ?? 0}/${event.max ?? 0})` },
            });
            break;
          case "completionCall":
            break;
          case "done":
            break;
          case "error":
            this.notify(sessionId, {
              kind: "agent_message_chunk",
              content: { type: "text", text: `[error: ${event.message ?? "unknown"}]` },
            });
            return { stopReason: "refusal" };
        }
        if (event.type === "done") break;
      }
    } catch (e) {
      this.notify(sessionId, {
        kind: "agent_message_chunk",
        content: { type: "text", text: `[error: ${e instanceof Error ? e.message : String(e)}]` },
      });
      return { stopReason: "refusal" };
    }

    if (finalResponse.length > 0) {
      session.messages.push(["assistant", finalResponse]);
    }
    return { stopReason: "end_turn" };
  }

  private async *defaultRunAgent(prompt: string, _sessionId: SessionId): AsyncGenerator<AgentRunEvent> {
    const provider = this.options.provider ?? "openrouter";
    const modelName = this.options.model ?? "openrouter/auto";
    let client: AnyClient | OpencodeClient;
    try {
      client = createClient(provider, null, this.options.customProviders ?? {}, this.options.apiKeys ?? null);
    } catch (e) {
      yield { type: "error", message: e instanceof Error ? e.message : String(e) };
      return;
    }
    const model =
      client instanceof OpencodeClient
        ? client.completionModel(modelName)
        : (client as AnyClient).completionModel(modelName);
    const providerModel =
      model.kind === "openrouter" ? model.value.model : model.kind === "openai" ? model.value.model : model.value;
    const messages: ChatMessage[] = [{ role: "user", content: prompt }];
    try {
      for await (const chunk of providerModel.stream(messages)) {
        yield { type: "token", text: chunk };
      }
    } catch (e) {
      yield { type: "error", message: e instanceof Error ? e.message : String(e) };
      return;
    }
    yield { type: "done" };
  }

  async dispatch(message: JsonRpcMessage): Promise<Record<string, unknown> | null> {
    const id = message.id ?? null;
    const respond = (result: unknown): Record<string, unknown> => ({
      jsonrpc: "2.0",
      id,
      result,
    });
    const respondError = (code: number, text: string): Record<string, unknown> => ({
      jsonrpc: "2.0",
      id,
      error: { code, message: text },
    });
    try {
      switch (message.method) {
        case "initialize": {
          const params = (message.params ?? {}) as unknown as InitializeRequest;
          return respond(this.handleInitialize(params));
        }
        case "session/new": {
          const params = (message.params ?? {}) as unknown as NewSessionRequest;
          return respond(this.handleNewSession(params));
        }
        case "session/prompt": {
          const params = (message.params ?? {}) as unknown as PromptRequest;
          const result = await this.handlePrompt(params);
          return respond(result);
        }
        default: {
          if (id === null || id === undefined) return null;
          return respondError(-32601, `Method not found: ${message.method ?? ""}`);
        }
      }
    } catch (e) {
      if (id === null || id === undefined) return null;
      return respondError(-32603, e instanceof Error ? e.message : String(e));
    }
  }

  async handleLine(line: string): Promise<void> {
    if (!line.trim()) return;
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      return;
    }
    const response = await this.dispatch(message);
    if (response) {
      try {
        this.send(response);
      } catch {

      }
    }
  }
}

function sessionUpdateToWire(update: SessionUpdate): Record<string, unknown> {
  switch (update.kind) {
    case "agent_message_chunk":
      return { sessionUpdate: "agent_message_chunk", content: update.content };
    case "agent_thought_chunk":
      return { sessionUpdate: "agent_thought_chunk", content: update.content };
    case "tool_call":
      return {
        sessionUpdate: "tool_call",
        toolCallId: update.id,
        title: update.title,
        status: update.status,
        ...(update.rawInput !== undefined ? { rawInput: update.rawInput } : {}),
      };
    case "tool_call_update":
      return {
        sessionUpdate: "tool_call_update",
        toolCallId: update.id,
        status: update.status,
        content: update.content,
      };
  }
}

export async function serve(options: AcpServeOptions): Promise<void> {
  const transport = options.transport;
  const host = transport?.type === "tcp" ? transport.host : (options.host ?? null);
  const port = transport?.type === "tcp" ? transport.port : (options.port ?? DEFAULT_ACP_TCP_PORT);
  const server = new AcpServer(options);
  if (host) {
    await new Promise<void>((resolve, reject) => {
      const tcp = createServer((socket: Socket) => {
        server.setSender((msg) => {
          try {
            socket.write(`${JSON.stringify(msg)}\n`);
          } catch {

          }
        });
        const lines = createInterface({ input: socket, crlfDelay: Infinity });
        lines.on("line", (line) => {
          void server.handleLine(line);
        });
        socket.on("close", () => resolve());
        socket.on("error", () => resolve());
      });
      tcp.on("error", (e) => reject(new Error(`ACP TCP server error: ${e.message}`)));
      tcp.listen(port, host, () => {
        console.log(`ACP TCP listening on ${host}:${port}`);
      });
    });
    return;
  }
  await new Promise<void>((resolve) => {
    server.setSender((msg) => {
      try {
        process.stdout.write(`${JSON.stringify(msg)}\n`);
      } catch {

      }
    });
    const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
    lines.on("line", (line) => {
      void server.handleLine(line);
    });
    lines.on("close", () => resolve());
  });
}

export { transportType, parseAcpServerConfig, acpServerConfigToJson } from "./config.ts";
export type { AcpServerConfig } from "./config.ts";
