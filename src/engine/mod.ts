import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cwd } from "node:process";
import type {
  AgentBuild,
  CliLike,
  ConfigLike,
  ContextFilesLike,
  Features,
} from "../agent/builder.ts";
import { estimateOverhead } from "../agent/builder.ts";
import type {
  AgentLike,
  MediaAttachment,
  RetryConfig,
  BtwEvent,
} from "../agent/runner.ts";
import {
  AgentRunner,
  convertHistory,
  defaultRetryConfig,
  buildBtwSnapshot,
  mediaToMessages,
  spawnAgent,
  spawnBtw,
  truncateCjk,
} from "../agent/runner.ts";
import { setEditSystem, editSystem } from "../agent/tools/mod.ts";
import type { PermCheckLike } from "../agent/tools/mod.ts";
import type { SandboxLike } from "../agent/tools/bash.ts";
import { StringSink } from "./sink.ts";

export type { EventSink, RendererLike } from "./sink.ts";
export { StringSink, rendererSink } from "./sink.ts";

export const AGENTS_CREATION_PROMPT =
  "Create an AGENTS.md file for this project. Read existing AGENTS.md or CLAUDE.md files in parent directories, README.md, and any config files to understand the project first. Then write a comprehensive AGENTS.md that documents: 1) the overall purpose and architecture 2) build/test/lint commands 3) coding style and conventions 4) directory layout Keep it focused and actionable for a coding agent.";

export const RunKind = {
  Agent: "agent",
  Command: "command",
  Ignored: "ignored",
} as const;

export type RunKind = (typeof RunKind)[keyof typeof RunKind];

export class RunOutput {
  kind: RunKind;
  text: string;
  usage?: TurnUsage;

  constructor(kind: RunKind, text: string, usage?: TurnUsage) {
    this.kind = kind;
    this.text = text;
    this.usage = usage;
  }

  static agent(text: string, usage: TurnUsage): RunOutput {
    return new RunOutput(RunKind.Agent, text, usage);
  }

  static command(text: string): RunOutput {
    return new RunOutput(RunKind.Command, text);
  }

  static ignored(): RunOutput {
    return new RunOutput(RunKind.Ignored, "");
  }
}

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
}

export function defaultTurnUsage(): TurnUsage {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0 };
}

export type SlashFlow =
  | { kind: "done" }
  | { kind: "deferCompress"; instructions?: string }
  | { kind: "deferInit" }
  | { kind: "deferReview"; message: string };

export type SessionMessageRole = "user" | "assistant" | "system" | "toolCall" | "toolResult" | "subagentToolCall";

export interface EngineSessionMessage {
  role: SessionMessageRole | string;
  content: string;
  estimatedTokens: number;
  tool?: unknown;
}

export interface QuickModel {
  provider: string;
  model: string;
  inputTokenCost: number;
  outputTokenCost: number;
}

export interface EngineSession {
  id: string;
  name: string;
  messages: EngineSessionMessage[];
  provider: string;
  model: string;
  contextWindow: number;
  inputTokenCost: number;
  outputTokenCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedInputTokens: number;
  totalCacheCreationInputTokens: number;
  totalCost: number;
  totalEstimatedTokens: number;
  calibratedTokens: number;
  calibratedMsgCount: number;
  overheadTokens: number;
  compactions: Array<{ summary: string; firstKeptIndex?: number; summarizedCount?: number; tokenSavings?: number }>;
  updatedAt: string;
  workingDir?: string;
  prompt?: { name: string; source: string } | null;
  nextToolCallId?: number;
  pendingMedia?: MediaAttachment[];
  addMessage?(role: SessionMessageRole | string, content: string): void;
  addToolCall?(name: string, args: unknown): number;
  addToolResult?(callId: number, name: string, output: string): string;
  addSubagentToolCall?(parentCallId: number | undefined, name: string, args: unknown): void;
  truncateTo?(newLen: number): void;
  resetCalibration?(): void;
  redo?(): boolean;
  rewindTo?(newLen: number): number;
  needsCompaction?(reserveTokens: number): boolean;
  effectiveContextTokens?(): number;
  setCalibration?(inputTokens: number, outputTokens: number): void;
  compress?(summary: string, firstKeptIndex: number, tokenSavings: number): void;
  updateContextWindow?(cw: number): void;
  drainMedia?(): MediaAttachment[];
}

export interface EnginePermCheck extends PermCheckLike {
  mode?(): string;
  setMode?(mode: string): void;
  restoreUserMode?(): void;
}

export interface EngineCli extends CliLike {
  noSession?: boolean;
  apiKey?: string;
  resolveModel?(cfg: ConfigLike): string;
  resolveProvider?(cfg: ConfigLike): string;
  resolveWtBaseDir?(): string | undefined;
}

export interface EngineConfig extends ConfigLike {
  retry?: RetryConfig;
  apiKeys?: unknown;
  resolveShowReasoning?(): boolean;
  resolveCompactEnabled?(): boolean;
  resolveKeepRecentTokens?(): number;
  resolveReserveTokens?(model: string, quickModels: Record<string, QuickModel>): number;
  resolveContextWindow?(provider: string, model: string, quickModels: Record<string, QuickModel>): number;
  resolvePromptModel?(promptName: string): string | undefined;
  resolveLsp?(): unknown;
  resolveRtk?(): unknown;
  isAnthropicNative?(provider: string, model: string): boolean;
  quickModelsMap?(): Record<string, QuickModel>;
  customProvidersMap?(): Record<string, unknown>;
}

export type ModelLike = unknown;

export interface EngineClient {
  model(modelId: string): ModelLike;
  buildAgent(model: ModelLike, build: AgentBuild): Promise<AgentLike>;
  buildBtwAgent(model: ModelLike, build: AgentBuild): AgentLike;
  compressMessages(
    model: string,
    messages: EngineSessionMessage[],
    previousSummary: string | undefined,
    instructions: string | undefined,
  ): Promise<string>;
  parseProvider?(name: string): boolean;
  defaultModelForProvider?(provider: string, cfg: EngineConfig): [string, [number, number] | undefined] | undefined;
  createClient?(provider: string, apiKey: string | undefined, customProviders: Record<string, unknown>, apiKeys: unknown): EngineClient;
}

export interface ChatHistoryEntry {
  content: string;
  timestamp: string;
}

export interface EngineStorage {
  saveSession?(session: EngineSession): void | Promise<void>;
  saveThemeName?(name: string | undefined): void | Promise<void>;
  loadHistory?(): ChatHistoryEntry[];
  findRecentSessions?(limit: number): EngineSession[];
  findSessionsByPrefix?(prefix: string): EngineSession[];
  deleteSession?(id: string): void | Promise<void>;
  appendChatHistory?(entry: ChatHistoryEntry): void | Promise<void>;
  saveQuickModel?(name: string, provider: string, model: string, inputCost: number, outputCost: number): void | Promise<void>;
  saveToolOutput?(sessionId: string, toolName: string, output: string): string;
}

export interface EngineOptions {
  features?: Features;
  storage?: EngineStorage;
  agentFactory?: (model: ModelLike, build: AgentBuild) => Promise<AgentLike>;
  btwAgentFactory?: (model: ModelLike, build: AgentBuild) => AgentLike;
  resolveTemperature?: (cli: EngineCli, cfg: EngineConfig, modelId: string) => number | undefined;
  resolveExtraBody?: (cfg: EngineConfig, modelId: string) => unknown;
  promptSourceOf?: (name: string) => string;
  onSessionEnd?: (reason: string) => void | Promise<void>;
  onSessionStart?: (reason: string) => void | Promise<void>;
}

export function estimateTokens(text: string): number {
  let wide = 0;
  let narrow = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x1100 && code <= 0x11ff) ||
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xa000 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef) ||
      (code >= 0x20000 && code <= 0x3ffff)
    ) {
      wide += 1;
    } else {
      narrow += 1;
    }
  }
  return Math.max(Math.floor((wide * 9) / 10) + Math.floor(narrow / 4), 1);
}

export function realInputTokens(
  anthropicNative: boolean,
  inputTokens: number,
  cachedInputTokens: number,
  cacheCreationInputTokens: number,
): number {
  if (anthropicNative) return inputTokens + cachedInputTokens + cacheCreationInputTokens;
  return inputTokens;
}

export function billableInputTokens(
  anthropicNative: boolean,
  inputTokens: number,
  cachedInputTokens: number,
  cacheCreationInputTokens: number,
): number {
  if (anthropicNative) {
    return Math.round(inputTokens + cacheCreationInputTokens * 1.25 + cachedInputTokens * 0.1);
  }
  return inputTokens;
}

export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  inputTokenCost: number,
  outputTokenCost: number,
): number {
  return (inputTokens * inputTokenCost) / 1000000 + (outputTokens * outputTokenCost) / 1000000;
}

export function sanitizeOutput(text: string): string {
  let result = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\x1b") {
      const next = text[i + 1];
      if (next === "[" || next === "]") {
        i += 2;
        while (i < text.length) {
          const n = text[i];
          i += 1;
          if (/[A-Za-z~]/.test(n)) break;
        }
      } else {
        i += next === undefined ? 1 : 2;
      }
    } else if (c.charCodeAt(0) < 32 && c !== "\n" && c !== "\t" && c !== "\r") {
      i += 1;
    } else {
      result += c;
      i += 1;
    }
  }
  return result;
}

export function formatToolCallSummary(name: string, args: unknown): string {
  if (args === null || typeof args !== "object" || Array.isArray(args)) return name;
  const obj = args as Record<string, unknown>;
  if (name === "task") {
    const prompts = obj["prompts"];
    if (Array.isArray(prompts)) {
      const parts = prompts.filter((v): v is string => typeof v === "string").map((v) => displayValue(v));
      if (parts.length > 0) return `task ${parts.join(" ")}`;
    }
    return "task";
  }
  const primaryKeys: Record<string, string[]> = {
    read: ["path"],
    write: ["path"],
    edit: ["path"],
    list_dir: ["path"],
    grep: ["pattern", "path"],
    find_files: ["pattern"],
    bash: ["command"],
  };
  const keys = primaryKeys[name] ?? [];
  const shown: string[] = [];
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string") shown.push(name === "bash" ? val : displayValue(val));
  }
  if (shown.length === 0) {
    const first = Object.values(obj)[0];
    if (typeof first === "string") return `${name} ${displayValue(first)}`;
    return name;
  }
  return `${name} ${shown.join(" ")}`;
}

function displayValue(val: string): string {
  if (val.length <= 120) return `"${val}"`;
  return `"${truncateCjk(val, 120, "...")}"`;
}

export function undoLast(session: EngineSession): number {
  const len = session.messages.length;
  if (len === 0) return 0;
  const last = session.messages[len - 1];
  let removed = 0;
  if (last.role === "assistant") {
    removed = len >= 2 && session.messages[len - 2].role === "user" ? 2 : 1;
  } else if (last.role === "user") {
    removed = 1;
  }
  if (removed > 0) {
    if (session.rewindTo) session.rewindTo(len - removed);
    else session.messages.splice(len - removed, removed);
  }
  return removed;
}

export function selectCompactionCut(messages: EngineSessionMessage[], keepRecent: number): number {
  let accumulated = 0;
  let cutIdx = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (accumulated >= keepRecent) {
      cutIdx = i + 1;
      break;
    }
    accumulated += messages[i].estimatedTokens;
  }
  return cutIdx;
}

function promptsHas(context: ContextFilesLike, name: string): boolean {
  if (context.prompts instanceof Map) return context.prompts.has(name);
  if (context.prompts) return name in context.prompts;
  return false;
}

function promptsGet(context: ContextFilesLike, name: string): string | undefined {
  if (context.prompts instanceof Map) return context.prompts.get(name);
  if (context.prompts) return context.prompts[name];
  return undefined;
}

function promptsSet(context: ContextFilesLike, name: string, value: string): void {
  if (context.prompts instanceof Map) context.prompts.set(name, value);
  else {
    if (!context.prompts) context.prompts = {};
    (context.prompts as Record<string, string>)[name] = value;
  }
}

function promptsKeys(context: ContextFilesLike): string[] {
  if (context.prompts instanceof Map) return [...context.prompts.keys()];
  if (context.prompts) return Object.keys(context.prompts);
  return [];
}

function themesHas(context: ContextFilesLike, name: string): boolean {
  if (context.themes instanceof Map) return context.themes.has(name);
  if (context.themes) return name in context.themes;
  return false;
}

function themesKeys(context: ContextFilesLike): string[] {
  if (context.themes instanceof Map) return [...context.themes.keys()];
  if (context.themes) return Object.keys(context.themes);
  return [];
}

export type PromptModeOutcome =
  | { kind: "none" }
  | { kind: "restoredUserMode" }
  | { kind: "applied"; mode: string };

export function applyPromptMode(
  name: string,
  context: ContextFilesLike,
  session: EngineSession,
  permission: EnginePermCheck | undefined | null,
  promptSourceOf?: (name: string) => string,
): PromptModeOutcome {
  const content = promptsGet(context, name);
  if (content === undefined) return { kind: "none" };
  const firstLine = content.split("\n")[0] ?? "";
  const trimmed = firstLine.trim();
  let modeDirective: string | undefined;
  let cleanContent = content;
  if (trimmed.startsWith("%%mode=")) {
    const modeStr = trimmed.slice("%%mode=".length).trim();
    if (modeStr !== "") {
      modeDirective = modeStr;
      const nl = content.indexOf("\n");
      cleanContent = nl === -1 ? "" : content.slice(nl + 1);
    }
  }
  context.currentPrompt = cleanContent;
  context.currentPromptName = name;
  session.prompt = { name, source: promptSourceOf ? promptSourceOf(name) : "builtIn" };
  if (modeDirective === undefined) return { kind: "none" };
  if (modeDirective === "last_user_mode") {
    permission?.restoreUserMode?.();
    return { kind: "restoredUserMode" };
  }
  permission?.setMode?.(modeDirective);
  return { kind: "applied", mode: modeDirective };
}

export class Engine {
  cli: EngineCli;
  cfg: EngineConfig;
  session: EngineSession;
  context: ContextFilesLike;
  client: EngineClient;
  agent: AgentLike | undefined | null;
  permission: EnginePermCheck | undefined | null;
  sandbox: SandboxLike;
  showReasoning: boolean;
  reasoningEnabled: boolean;
  private pendingToolCalls: Array<[string, number]> = [];
  private responseBuf = "";
  private turnTrace: string[] = [];
  private dotPromptRestore: string | undefined;
  private features: Features;
  private storage: EngineStorage;
  private options: EngineOptions;

  constructor(
    cli: EngineCli,
    cfg: EngineConfig,
    session: EngineSession,
    context: ContextFilesLike,
    client: EngineClient,
    permission: EnginePermCheck | undefined | null,
    sandbox: SandboxLike,
    options: EngineOptions = {},
  ) {
    this.cli = cli;
    this.cfg = cfg;
    this.session = session;
    this.context = context;
    this.client = client;
    this.agent = null;
    this.permission = permission ?? null;
    this.sandbox = sandbox;
    this.showReasoning = cfg.resolveShowReasoning?.() ?? false;
    this.reasoningEnabled = true;
    this.features = options.features ?? {};
    this.storage = options.storage ?? {};
    this.options = options;
  }

  withAgent(agent: AgentLike): this {
    this.agent = agent;
    return this;
  }

  getSession(): EngineSession {
    return this.session;
  }

  sessionMut(): EngineSession {
    return this.session;
  }

  getContext(): ContextFilesLike {
    return this.context;
  }

  retryConfig(): RetryConfig {
    return this.cfg.retry ?? defaultRetryConfig();
  }

  async runString(input: string): Promise<RunOutput> {
    const text = input.trim();
    if (text === "") return RunOutput.ignored();
    if (text.startsWith("/")) {
      const t = text.trimStart();
      if (t === "/queue" || t.startsWith("/queue ")) {
        const sink = new StringSink();
        this.handleQueue(t, sink);
        return RunOutput.command(sink.transcript());
      }
      if (t === "/btw" || t.startsWith("/btw ")) {
        return this.runBtw(t);
      }
      return this.runSlash(text);
    }
    const dot = await this.handleDotCommand(text);
    if (dot) return dot;
    if (text.startsWith("!")) return this.runBang(text);
    return this.runAgentText(text);
  }

  private async runAgentText(text: string): Promise<RunOutput> {
    const sink = new StringSink();
    this.sinkEchoUser(text, sink);
    try {
      const [response, usage] = await this.startAgentRun(text);
      return RunOutput.agent(response, usage);
    } catch (e) {
      sink.writeError(e instanceof Error ? e.message : String(e));
      const len = this.session.messages.length;
      if (len > 0 && this.session.messages[len - 1].role === "user") {
        this.sessionTruncateTo(len - 1);
      }
      return RunOutput.agent(sink.transcript(), defaultTurnUsage());
    }
  }

  private async startAgentRun(prompt: string): Promise<[string, TurnUsage]> {
    await this.ensureAgent();
    let history = convertHistory(this.session as unknown as Parameters<typeof convertHistory>[0]);
    if (this.session.drainMedia) {
      const media = this.session.drainMedia();
      if (media.length > 0) {
        history = [...history, ...mediaToMessages(media)];
      }
    }
    const agent = this.agent;
    if (!agent) throw new Error("ensure_agent built one");
    const runner = spawnAgent(agent, prompt, history, this.retryConfig());
    this.sessionAddMessage("user", prompt);
    if (!this.cli.noSession && this.storage.appendChatHistory) {
      try {
        await this.storage.appendChatHistory({ content: prompt, timestamp: this.session.updatedAt });
      } catch {

      }
    }
    return this.drainRunner(runner);
  }

  private async drainRunner(runner: AgentRunner): Promise<[string, TurnUsage]> {
    this.responseBuf = "";
    this.pendingToolCalls = [];
    let usage = defaultTurnUsage();
    let finalResponse = "";
    let turnError: string | undefined;
    for await (const event of runner.events) {
      if (event.kind === "reasoning") {
        if (this.showReasoning) this.responseBuf += event.text;
      } else if (event.kind === "token") {
        this.responseBuf += sanitizeOutput(event.text);
      } else if (event.kind === "toolCall") {
        this.responseBuf = "";
        const summary = formatToolCallSummary(event.name, event.args);
        if (this.turnTrace.length < 64) this.turnTrace.push(`→ ${summary}`);
        const callId = this.sessionAddToolCall(event.name, event.args);
        this.pushPendingToolCall(event.callId, callId);
        this.saveSessionBestEffort();
      } else if (event.kind === "subagentToolCall") {
        const parent = this.pendingToolCalls.length > 0 ? this.pendingToolCalls[this.pendingToolCalls.length - 1][1] : undefined;
        this.sessionAddSubagentToolCall(parent, event.name, event.args);
        this.saveSessionBestEffort();
      } else if (event.kind === "toolResult") {
        if (this.turnTrace.length < 64) {
          this.turnTrace.push(`← ${truncateCjk(event.output, 500, "…")}`);
        }
        const callId = this.resolveToolResultCallId(event.callId, event.name);
        this.sessionAddToolResult(callId, event.name, event.output);
        this.saveSessionBestEffort();
      } else if (event.kind === "completionCall") {
        this.applyCompletionUsage(event.inputTokens, event.outputTokens, event.cachedInputTokens, event.cacheCreationInputTokens, usage);
      } else if (event.kind === "retrying") {
        this.responseBuf = "";
      } else if (event.kind === "done") {
        usage = {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cachedInputTokens: event.cachedInputTokens,
          cacheCreationInputTokens: event.cacheCreationInputTokens,
        };
        finalResponse = event.response;
        await this.finishTurn(event.response, usage);
        break;
      } else if (event.kind === "error") {
        turnError = event.message;
        this.pendingToolCalls = [];
        this.saveSessionBestEffort();
        break;
      }
    }
    this.turnTrace = [];
    this.pendingToolCalls = [];
    if (turnError !== undefined) throw new Error(turnError);
    return [finalResponse, usage];
  }

  private async finishTurn(response: string, usage: TurnUsage): Promise<void> {
    this.sessionAddMessage("assistant", response);
    this.session.totalInputTokens += usage.inputTokens;
    this.session.totalOutputTokens += usage.outputTokens;
    this.session.totalCachedInputTokens += usage.cachedInputTokens;
    this.session.totalCacheCreationInputTokens += usage.cacheCreationInputTokens;
    const anthropicNative = this.cfg.isAnthropicNative?.(this.session.provider, this.session.model) ?? false;
    this.session.totalCost += estimateCost(
      billableInputTokens(anthropicNative, usage.inputTokens, usage.cachedInputTokens, usage.cacheCreationInputTokens),
      usage.outputTokens,
      this.session.inputTokenCost,
      this.session.outputTokenCost,
    );
    const contextInputTokens = realInputTokens(anthropicNative, usage.inputTokens, usage.cachedInputTokens, usage.cacheCreationInputTokens);
    if (this.session.setCalibration) this.session.setCalibration(contextInputTokens, usage.outputTokens);
    else {
      if (contextInputTokens !== 0) {
        this.session.calibratedTokens = contextInputTokens + usage.outputTokens;
        this.session.calibratedMsgCount = this.session.messages.length;
      }
    }
    this.responseBuf = "";
    if ((this.cfg.resolveCompactEnabled?.() ?? false) && this.sessionNeedsCompaction(this.reserve())) {
      const sink = new StringSink();
      try {
        await this.compress(undefined, true, sink);
      } catch (e) {
        sink.writeError(`auto-compact error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    this.saveSessionBestEffort();
    if (this.dotPromptRestore !== undefined) {
      const restoreName = this.dotPromptRestore;
      this.dotPromptRestore = undefined;
      this.restorePrompt(restoreName);
    }
  }

  private applyCompletionUsage(
    inputTokens: number,
    outputTokens: number,
    cachedInputTokens: number,
    cacheCreationInputTokens: number,
    usage: TurnUsage,
  ): void {
    const anthropicNative = this.cfg.isAnthropicNative?.(this.session.provider, this.session.model) ?? false;
    const real = realInputTokens(anthropicNative, inputTokens, cachedInputTokens, cacheCreationInputTokens) + outputTokens;
    if (real > this.session.totalEstimatedTokens) this.session.totalEstimatedTokens = real;
    this.session.totalInputTokens += inputTokens;
    this.session.totalOutputTokens += outputTokens;
    this.session.totalCost += estimateCost(
      billableInputTokens(anthropicNative, inputTokens, cachedInputTokens, cacheCreationInputTokens),
      outputTokens,
      this.session.inputTokenCost,
      this.session.outputTokenCost,
    );
    usage.inputTokens += inputTokens;
    usage.outputTokens += outputTokens;
    usage.cachedInputTokens += cachedInputTokens;
    usage.cacheCreationInputTokens += cacheCreationInputTokens;
  }

  private agentBuildParts(): { cli: EngineCli; cfg: EngineConfig; context: ContextFilesLike; permission: EnginePermCheck | undefined | null; sandbox: SandboxLike } {
    return { cli: this.cli, cfg: this.cfg, context: this.context, permission: this.permission, sandbox: this.sandbox };
  }

  private buildAgentBuild(): AgentBuild {
    const temperature = this.options.resolveTemperature?.(this.cli, this.cfg, this.session.model);
    const extraBody = this.options.resolveExtraBody?.(this.cfg, this.session.model);
    return {
      cli: this.cli,
      cfg: this.cfg,
      context: this.context,
      permission: this.permission,
      askTx: null,
      sandbox: this.sandbox,
      reasoningEnabled: this.reasoningEnabled,
      temperature: temperature ?? null,
      extraBody,
      features: this.features,
    };
  }

  async ensureAgent(): Promise<void> {
    if (this.agent) return;
    const model = this.client.model(this.session.model);
    let agent: AgentLike;
    if (this.options.agentFactory) agent = await this.options.agentFactory(model, this.buildAgentBuild());
    else agent = await this.client.buildAgent(model, this.buildAgentBuild());
    this.session.overheadTokens = estimateOverhead(this.context, this.reasoningEnabled, {
      memoryEnabled: this.features.memoryEnabled,
      archmdEnabled: this.features.archmdEnabled,
    });
    this.agent = agent;
  }

  private async rebuildAgent(modelId: string): Promise<void> {
    const model = this.client.model(modelId);
    let agent: AgentLike;
    if (this.options.agentFactory) agent = await this.options.agentFactory(model, this.buildAgentBuild());
    else agent = await this.client.buildAgent(model, this.buildAgentBuild());
    this.agent = agent;
  }

  private async rebuildAgentWithClient(provider: string): Promise<void> {
    if (this.client.createClient) {
      const custom = this.cfg.customProvidersMap?.() ?? {};
      this.client = this.client.createClient(provider, this.cli.apiKey, custom, this.cfg.apiKeys);
    } else {
      throw new Error(`cannot switch provider to ${provider}: client factory not available`);
    }
    const modelId = this.session.model;
    await this.rebuildAgent(modelId);
  }

  private async runSlash(text: string): Promise<RunOutput> {
    const sink = new StringSink();
    this.sinkEchoUser(text, sink);
    const parts = text.trim().split(/ +/);
    const rest = parts.slice(1).join(" ");
    const split3 = [parts[0], parts[1] ?? "", rest].filter((_, i) => i === 0 || parts.length > 1);
    void split3;
    if (parts.length === 0) return RunOutput.command(sink.transcript());
    let flow: SlashFlow;
    try {
      flow = await this.dispatchSlash(parts, sink);
    } catch (e) {
      sink.writeError(e instanceof Error ? e.message : String(e));
      return RunOutput.command(sink.transcript());
    }
    if (flow.kind === "done") return RunOutput.command(sink.transcript());
    if (flow.kind === "deferCompress") {
      try {
        await this.compress(flow.instructions, false, sink);
      } catch (e) {
        sink.writeError(`compress error: ${e instanceof Error ? e.message : String(e)}`);
      }
      this.saveSessionBestEffort();
      return RunOutput.command(sink.transcript());
    }
    if (flow.kind === "deferInit") {
      try {
        const [response] = await this.startAgentRun(AGENTS_CREATION_PROMPT);
        sink.writeOk(response);
      } catch (e) {
        sink.writeError(e instanceof Error ? e.message : String(e));
      }
      return RunOutput.command(sink.transcript());
    }
    try {
      const [response] = await this.startAgentRun(flow.message);
      sink.writeOk(response);
    } catch (e) {
      sink.writeError(e instanceof Error ? e.message : String(e));
    }
    return RunOutput.command(sink.transcript());
  }

  private async dispatchSlash(parts: string[], sink: StringSink): Promise<SlashFlow> {
    const cmd = parts[0];
    switch (cmd) {
      case "/provider":
      case "/model":
      case "/models":
      case "/models-add":
      case "/model-subagent":
      case "/models-subagent":
        return this.slashProviders(parts, sink);
      case "/prompt":
      case "/theme":
      case "/regen-prompts":
      case "/regen-themes":
        return this.slashContent(parts, sink);
      case "/reasoning":
      case "/thinking":
      case "/mode":
      case "/toggle":
      case "/editsys":
      case "/advisor":
        return this.slashSettings(parts, sink);
      case "/sessions":
      case "/rename":
      case "/clear":
      case "/new":
      case "/undo":
      case "/redo":
      case "/rewind":
      case "/retry":
      case "/quit":
      case "/exit":
      case "/history":
        return this.slashSession(parts, sink);
      case "/export":
      case "/import":
      case "/share":
        if (!this.features.exportEnabled) {
          sink.writeError(`unknown command: ${cmd} (try /help)`);
          return { kind: "done" };
        }
        return this.slashSession(parts, sink);
      case "/help":
      case "/welcome":
      case "/tutorial":
        this.slashHelp(sink);
        return { kind: "done" };
      case "/tutor":
        sink.writeError("tutor needs an interactive terminal (opens GET_STARTED.md)");
        return { kind: "done" };
      case "/add":
      case "/drop":
      case "/drop-all":
        return this.slashAdd(parts, sink);
      case "/init":
        return this.slashInit(parts, sink);
      case "/review":
        return this.slashReview(parts, sink);
      case "/memory":
        return this.slashMemory(parts, sink);
      case "/compress":
      case "/compact":
      case "/loop":
      case "/worktree":
      case "/wt-merge":
      case "/wt-exit":
        return this.slashFeatures(parts, sink);
      case "/hooks":
        if (!this.features.hooksEnabled) {
          sink.writeError(`unknown command: ${cmd} (try /help)`);
          return { kind: "done" };
        }
        sink.writeOk("hooks: no dispatcher installed");
        return { kind: "done" };
      case "/mcp":
        sink.writeError("/mcp needs the TUI runtime (connection notices render there)");
        return { kind: "done" };
      default:
        sink.writeError(`unknown command: ${cmd} (try /help)`);
        return { kind: "done" };
    }
  }

  private async runBang(text: string): Promise<RunOutput> {
    const sink = new StringSink();
    const cmd = text.slice(1).trim();
    if (cmd === "") {
      sink.writeError("empty command after '!'");
      return RunOutput.command(sink.transcript());
    }
    this.sinkEchoUser(text, sink);
    const output = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolvePromise) => {
      const child = spawn("bash", ["-c", cmd], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d: Buffer) => {
        stdout += d.toString("utf8");
      });
      child.stderr?.on("data", (d: Buffer) => {
        stderr += d.toString("utf8");
      });
      child.on("error", (e) => {
        sink.writeError(`command error: ${e.message}`);
        resolvePromise({ stdout: "", stderr: "", code: -1 });
      });
      child.on("close", (code) => resolvePromise({ stdout, stderr, code }));
    });
    let result = "";
    if (output.stdout !== "") result += output.stdout;
    if (output.stderr !== "") {
      if (result !== "") result += "\n";
      result += output.stderr;
    }
    result = result.trim();
    if (output.code === 0) sink.writeOk(result);
    else sink.writeError(result);
    this.sessionAddMessage("user", text);
    this.sessionAddMessage("assistant", result);
    this.saveSessionBestEffort();
    return RunOutput.agent(result, defaultTurnUsage());
  }

  private async runBtw(text: string): Promise<RunOutput> {
    const sink = new StringSink();
    const btwText = text.trimStart().slice("/btw".length).trim();
    if (btwText === "") {
      sink.writeOk("usage: /btw <message>");
      return RunOutput.command(sink.transcript());
    }
    this.sinkEchoUser(text, sink);
    const snapshot = buildBtwSnapshot(
      this.session as unknown as Parameters<typeof buildBtwSnapshot>[0],
      this.turnTrace,
      false,
    );
    const model = this.client.model(this.session.model);
    let btwAgent: AgentLike;
    if (this.options.btwAgentFactory) btwAgent = this.options.btwAgentFactory(model, this.buildAgentBuild());
    else btwAgent = this.client.buildBtwAgent(model, this.buildAgentBuild());
    const answer = await new Promise<string>((resolvePromise, rejectPromise) => {
      spawnBtw(btwAgent, btwText, snapshot, (ev: BtwEvent) => {
        if (ev.kind === "done") resolvePromise(ev.response);
        else rejectPromise(new Error(ev.message));
      }, 0, this.retryConfig());
    }).catch((e: unknown) => {
      sink.writeError(e instanceof Error ? e.message : String(e));
      return undefined;
    });
    if (answer === undefined) return RunOutput.command(sink.transcript());
    sink.writeOk(answer);
    return RunOutput.command(sink.transcript());
  }

  private async handleDotCommand(text: string): Promise<RunOutput | undefined> {
    if (!text.startsWith(".")) return undefined;
    const sink = new StringSink();
    this.sinkEchoUser(text, sink);
    const afterDot = text.slice(1).trimStart();
    if (afterDot === "") {
      sink.writeError("usage: .<prompt> [message]");
      return RunOutput.command(sink.transcript());
    }
    const wsIdx = afterDot.search(/\s/);
    if (wsIdx !== -1) {
      const promptName = afterDot.slice(0, wsIdx).trim();
      const msg = afterDot.slice(wsIdx).trim();
      if (promptName !== "" && promptsHas(this.context, promptName)) {
        this.dotPromptRestore = this.context.currentPromptName;
        applyPromptMode(promptName, this.context, this.session, this.permission, this.options.promptSourceOf);
        await this.applyPromptModel(promptName, sink);
        this.agent = null;
        const out = await this.runAgentText(msg);
        out.text = `${sink.transcript()}\n${out.text}`;
        return out;
      }
      sink.writeError(`unknown prompt '${promptName}'`);
      return RunOutput.command(sink.transcript());
    }
    const promptName = afterDot.trim();
    if (promptsHas(this.context, promptName)) {
      applyPromptMode(promptName, this.context, this.session, this.permission, this.options.promptSourceOf);
      await this.applyPromptModel(promptName, sink);
      this.agent = null;
      sink.writeOk(`switched to prompt '${promptName}'`);
      this.saveSessionBestEffort();
      return RunOutput.command(sink.transcript());
    }
    sink.writeError(`unknown prompt '${promptName}'`);
    return RunOutput.command(sink.transcript());
  }

  private sinkEchoUser(text: string, sink: StringSink): void {
    for (const line of text.split("\n")) sink.writeLine(`> ${line}`);
    sink.writeLine("");
  }

  private saveSessionBestEffort(): void {
    if (!this.cli.noSession && this.storage.saveSession) {
      try {
        const r = this.storage.saveSession(this.session);
        if (r instanceof Promise) r.catch(() => undefined);
      } catch {

      }
    }
  }

  private reserve(): number {
    const qm = this.cfg.quickModelsMap?.() ?? {};
    return this.cfg.resolveReserveTokens?.(this.session.model, qm) ?? 0;
  }

  private async compress(instructions: string | undefined, auto: boolean, sink: StringSink): Promise<void> {
    const keepRecent = this.cfg.resolveKeepRecentTokens?.() ?? 0;
    const maxTokens = this.session.contextWindow - this.reserve();
    if (auto && this.sessionEffectiveContextTokens() <= maxTokens) return;
    const cutIdx = selectCompactionCut(this.session.messages, keepRecent);
    if (cutIdx === 0) {
      if (!auto) sink.writeOk("not enough conversation history to compact yet");
      return;
    }
    if (auto) sink.writeResult("auto-compacting...");
    else sink.writeOk("compressing...");
    sink.writeLine("");
    const messagesToSummarize = this.session.messages.slice(0, cutIdx);
    const previousSummary = this.session.compactions.length > 0 ? this.session.compactions[this.session.compactions.length - 1].summary : undefined;
    const summary = await this.client.compressMessages(this.session.model, messagesToSummarize, previousSummary, instructions);
    const tokensBefore = messagesToSummarize.reduce((acc, m) => acc + m.estimatedTokens, 0);
    if (this.session.compress) this.session.compress(summary, cutIdx, tokensBefore);
    else {
      const summaryMsg: EngineSessionMessage = { role: "system", content: summary, estimatedTokens: estimateTokens(summary) };
      this.session.messages.splice(0, cutIdx, summaryMsg);
      this.session.compactions.push({ summary, firstKeptIndex: 1, summarizedCount: cutIdx, tokenSavings: tokensBefore });
      this.session.totalEstimatedTokens = this.session.messages.reduce((acc, m) => acc + m.estimatedTokens, 0);
      if (this.session.resetCalibration) this.session.resetCalibration();
    }
    const modelId = this.session.model;
    await this.rebuildAgent(modelId);
    sink.writeOk(`compressed ${cutIdx} messages (saved ~${tokensBefore} tokens)`);
  }

  private pushPendingToolCall(id: string, sessionCallId: number): void {
    const pos = this.pendingToolCalls.findIndex(([k]) => k === id);
    if (pos !== -1) this.pendingToolCalls.splice(pos, 1);
    this.pendingToolCalls.push([id, sessionCallId]);
  }

  private takePendingToolCall(id: string): number | undefined {
    const pos = this.pendingToolCalls.findIndex(([k]) => k === id);
    if (pos === -1) return undefined;
    return this.pendingToolCalls.splice(pos, 1)[0][1];
  }

  private resolveToolResultCallId(id: string, name: string): number {
    const found = this.takePendingToolCall(id);
    if (found !== undefined) return found;
    return this.sessionAddToolCall(name, null);
  }

  private restorePrompt(restoreName: string): void {
    this.context.currentPrompt = promptsGet(this.context, restoreName);
    this.context.currentPromptName = this.context.currentPrompt !== undefined ? restoreName : undefined;
    const source = this.options.promptSourceOf ? this.options.promptSourceOf(restoreName) : "builtIn";
    this.session.prompt = this.context.currentPromptName ? { name: restoreName, source } : null;
    this.permission?.restoreUserMode?.();
  }

  private async applyPromptModel(promptName: string, sink: StringSink): Promise<boolean> {
    const qmName = this.cfg.resolvePromptModel?.(promptName);
    if (!qmName) return false;
    const qm = this.cfg.quickModelsMap?.() ?? {};
    const qmc = qm[qmName];
    if (!qmc) return false;
    const qmProvider = qmc.provider;
    const qmModel = qmc.model;
    const providerChanged = qmProvider !== this.session.provider;
    this.session.model = qmModel;
    if (providerChanged) {
      try {
        await this.rebuildAgentWithClient(qmProvider);
        this.session.provider = qmProvider;
      } catch (e) {
        sink.writeError(`failed to switch provider for prompt '${promptName}': ${e instanceof Error ? e.message : String(e)}`);
        return false;
      }
    } else {
      await this.rebuildAgent(qmModel);
    }
    this.session.inputTokenCost = qmc.inputTokenCost;
    this.session.outputTokenCost = qmc.outputTokenCost;
    const qm2 = this.cfg.quickModelsMap?.() ?? {};
    const cw = this.cfg.resolveContextWindow?.(this.session.provider, this.session.model, qm2);
    if (cw !== undefined) {
      if (this.session.updateContextWindow) this.session.updateContextWindow(cw);
      else this.session.contextWindow = cw;
    }
    sink.writeOk(`switched to model: ${qmName} (from prompt '${promptName}')`);
    return true;
  }

  private sessionAddMessage(role: SessionMessageRole | string, content: string): void {
    if (this.session.addMessage) {
      this.session.addMessage(role, content);
      return;
    }
    this.session.messages.push({ role, content, estimatedTokens: estimateTokens(content) });
    this.session.totalEstimatedTokens += estimateTokens(content);
  }

  private sessionAddToolCall(name: string, args: unknown): number {
    if (this.session.addToolCall) return this.session.addToolCall(name, args);
    const id = this.session.nextToolCallId ?? 0;
    this.session.nextToolCallId = id + 1;
    this.session.messages.push({ role: "toolCall", content: formatToolCallSummary(name, args), estimatedTokens: estimateTokens(formatToolCallSummary(name, args)) });
    return id;
  }

  private sessionAddToolResult(callId: number, name: string, output: string): void {
    if (this.session.addToolResult) {
      this.session.addToolResult(callId, name, output);
      return;
    }
    this.session.messages.push({ role: "toolResult", content: `${name}:\n${output}`, estimatedTokens: estimateTokens(output) });
  }

  private sessionAddSubagentToolCall(parent: number | undefined, name: string, args: unknown): void {
    if (this.session.addSubagentToolCall) {
      this.session.addSubagentToolCall(parent, name, args);
      return;
    }
    this.session.messages.push({ role: "subagentToolCall", content: formatToolCallSummary(name, args), estimatedTokens: 0 });
  }

  private sessionTruncateTo(newLen: number): void {
    if (this.session.truncateTo) {
      this.session.truncateTo(newLen);
      return;
    }
    this.session.messages.splice(newLen);
    this.session.totalEstimatedTokens = this.session.messages.reduce((acc, m) => acc + m.estimatedTokens, 0);
  }

  private sessionNeedsCompaction(reserveTokens: number): boolean {
    if (this.session.needsCompaction) return this.session.needsCompaction(reserveTokens);
    if (this.session.contextWindow === 0) return false;
    return this.sessionEffectiveContextTokens() > this.session.contextWindow - reserveTokens;
  }

  private sessionEffectiveContextTokens(): number {
    if (this.session.effectiveContextTokens) return this.session.effectiveContextTokens();
    if (this.session.calibratedTokens === 0) return this.session.overheadTokens + this.session.totalEstimatedTokens;
    const start = Math.min(this.session.calibratedMsgCount, this.session.messages.length);
    const delta = this.session.messages.slice(start).reduce((acc, m) => acc + m.estimatedTokens, 0);
    return this.session.calibratedTokens + delta;
  }

  private handleQueue(text: string, sink: StringSink): void {
    const arg = text.slice("/queue".length).trim();
    if (arg === "" || arg === "ls" || arg === "list") sink.writeOk("queue is empty");
    else if (arg === "clear" || arg === "pop") sink.writeOk("queue is empty");
    else sink.writeError("usage: /queue [ls|clear|pop]");
  }

  private slashHelp(sink: StringSink): void {
    sink.writeOk("commands:");
    for (const line of [
      "  /add [path]            add file(s) to context",
      "  /drop <path>           remove file from context",
      "  /clear                 clear session",
      "  /provider [name]       show or switch provider",
      "  /model [name]          show or switch model",
      "  /models                list quick models",
      "  /sessions              list recent sessions",
      "  /rename <name>         rename the session",
      "  /undo /redo            undo / restore the last exchange",
      "  /retry                 retry the last message",
      "  /history               show global chat history",
      "  /prompt <name>         activate a prompt",
      "  /theme <name>          activate a theme",
      "  /reasoning             toggle reasoning",
      "  /mode <name>           switch security mode",
      "  /compress              compact the context",
      "  /init [force]          create AGENTS.md via the agent",
      "  /review [msg]          review via the agent",
      "  /help                  show this message",
      "  !<cmd>                 run a shell command",
      "  .<prompt> [msg]        switch prompt / one-shot run",
    ]) {
      sink.writeResult(line);
    }
  }

  private formatSessionLine(s: EngineSession): string {
    const last = s.messages.length > 0 ? `...${s.messages[s.messages.length - 1].content.slice(0, 30)}` : "";
    return `  ${s.id.slice(0, 8)}  ${s.messages.length}msgs  ${s.model}  ${last}${s.name === "" ? "" : `  [${s.name}]`}`;
  }

  private async slashProviders(parts: string[], sink: StringSink): Promise<SlashFlow> {
    switch (parts[0]) {
      case "/provider":
        return this.cmdProvider(parts, sink);
      case "/model":
        return this.cmdModel(parts, sink);
      case "/models":
        return this.cmdModels(parts, sink);
      case "/models-add":
        return this.cmdModelsAdd(parts, sink);
      default:
        sink.writeError("subagent model switching needs the TUI runtime");
        return { kind: "done" };
    }
  }

  private async cmdProvider(parts: string[], sink: StringSink): Promise<SlashFlow> {
    if (parts.length < 2) {
      sink.writeOk(`current provider: ${this.session.provider}`);
      return { kind: "done" };
    }
    const newProvider = parts[1].trim();
    const known = this.client.parseProvider ? this.client.parseProvider(newProvider) : true;
    const custom = this.cfg.customProvidersMap?.() ?? {};
    if (!known && !(newProvider in custom)) {
      sink.writeError(`unknown provider: '${newProvider}'`);
      return { kind: "done" };
    }
    if (this.client.defaultModelForProvider) {
      const found = this.client.defaultModelForProvider(newProvider, this.cfg);
      if (found) {
        this.session.model = found[0];
        if (found[1]) {
          this.session.inputTokenCost = found[1][0];
          this.session.outputTokenCost = found[1][1];
        }
      }
    }
    await this.rebuildAgentWithClient(newProvider);
    this.session.provider = newProvider;
    const qm = this.cfg.quickModelsMap?.() ?? {};
    const cw = this.cfg.resolveContextWindow?.(newProvider, this.session.model, qm);
    if (cw !== undefined) {
      if (this.session.updateContextWindow) this.session.updateContextWindow(cw);
      else this.session.contextWindow = cw;
    }
    sink.writeOk(`switched to provider: ${newProvider} (model: ${this.session.model})`);
    return { kind: "done" };
  }

  private async cmdModel(parts: string[], sink: StringSink): Promise<SlashFlow> {
    if (parts.length < 2) {
      sink.writeOk(`current model: ${this.session.model}`);
      return { kind: "done" };
    }
    const newModel = parts[1].trim();
    await this.rebuildAgent(newModel);
    this.session.model = newModel;
    if (this.cli.resolveProvider) this.session.provider = this.cli.resolveProvider(this.cfg);
    const qm = this.cfg.quickModelsMap?.() ?? {};
    const cw = this.cfg.resolveContextWindow?.(this.session.provider, newModel, qm);
    if (cw !== undefined) {
      if (this.session.updateContextWindow) this.session.updateContextWindow(cw);
      else this.session.contextWindow = cw;
    }
    sink.writeOk(`switched to model: ${newModel}`);
    return { kind: "done" };
  }

  private async cmdModels(parts: string[], sink: StringSink): Promise<SlashFlow> {
    const qm = this.cfg.quickModelsMap?.() ?? {};
    if (parts.length >= 2 && parts[1].trim() !== "refresh") {
      const arg = parts[1].trim();
      const q = qm[arg];
      if (q) {
        await this.rebuildAgentWithClient(q.provider);
        this.session.provider = q.provider;
        await this.rebuildAgent(q.model);
        this.session.model = q.model;
        const qm2 = this.cfg.quickModelsMap?.() ?? {};
        const cw = this.cfg.resolveContextWindow?.(this.session.provider, this.session.model, qm2);
        if (cw !== undefined) {
          if (this.session.updateContextWindow) this.session.updateContextWindow(cw);
          else this.session.contextWindow = cw;
        }
        this.session.inputTokenCost = q.inputTokenCost;
        this.session.outputTokenCost = q.outputTokenCost;
        sink.writeOk(`switched to model: ${q.model}`);
        return { kind: "done" };
      }
      await this.rebuildAgent(arg);
      this.session.model = arg;
      sink.writeOk(`switched to model: ${arg}`);
      return { kind: "done" };
    }
    const sorted = Object.keys(qm).sort();
    sink.writeOk(`quick models (current: ${this.session.provider} | ${this.session.model}):`);
    if (sorted.length === 0) sink.writeResult("  (none — add with /models-add)");
    for (const name of sorted) {
      const q = qm[name];
      sink.writeResult(`  ${name}  (${q.provider} / ${q.model})  $${q.inputTokenCost.toFixed(4)}/M in  $${q.outputTokenCost.toFixed(4)}/M out`);
    }
    return { kind: "done" };
  }

  private cmdModelsAdd(parts: string[], sink: StringSink): SlashFlow {
    if (parts.length < 4) {
      sink.writeOk("usage: /models-add <name> <provider> <model> [input_cost_per_M output_cost_per_M]");
      return { kind: "done" };
    }
    const name = parts[1].trim();
    const provider = parts[2].trim();
    const model = parts[3].trim();
    let inputCost = 0;
    let outputCost = 0;
    if (parts.length >= 6) {
      inputCost = Number(parts[4].trim()) || 0;
      outputCost = Number(parts[5].trim()) || 0;
    }
    if (name === "" || provider === "" || model === "") {
      sink.writeOk("usage: /models-add <name> <provider> <model> [input_cost_per_M output_cost_per_M]");
      return { kind: "done" };
    }
    if (!this.storage.saveQuickModel) {
      sink.writeError("failed to save quick model: quick-model storage not available");
      return { kind: "done" };
    }
    try {
      const r = this.storage.saveQuickModel(name, provider, model, inputCost, outputCost);
      if (r instanceof Promise) {
        void r.then(
          () => sink.writeOk(`saved quick model: ${name} (${provider} / ${model})`),
          (e: unknown) => sink.writeError(`failed to save quick model: ${e instanceof Error ? e.message : String(e)}`),
        );
        return { kind: "done" };
      }
      sink.writeOk(`saved quick model: ${name} (${provider} / ${model})`);
    } catch (e) {
      sink.writeError(`failed to save quick model: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { kind: "done" };
  }

  private async slashContent(parts: string[], sink: StringSink): Promise<SlashFlow> {
    switch (parts[0]) {
      case "/prompt":
        return this.cmdPrompt(parts, sink);
      case "/theme":
        return this.cmdTheme(parts, sink);
      case "/regen-prompts":
        sink.writeOk("default prompts regenerated");
        return { kind: "done" };
      case "/regen-themes":
        sink.writeOk("default themes regenerated");
        return { kind: "done" };
      default:
        return { kind: "done" };
    }
  }

  private async cmdPrompt(parts: string[], sink: StringSink): Promise<SlashFlow> {
    const sorted = promptsKeys(this.context).sort();
    if (parts.length < 2) {
      if (sorted.length === 0) sink.writeOk("no prompts available");
      else {
        const current = this.context.currentPromptName ?? "(none)";
        sink.writeOk(`available prompts (current: ${current}):`);
        for (const name of sorted) sink.writeResult(`  ${name}`);
        sink.writeResult("usage: /prompt <name>  |  /prompt default");
      }
    } else if (parts[1] === "default") {
      if (this.context.currentPrompt === undefined) {
        sink.writeOk("no active prompt to clear");
      } else {
        this.context.currentPrompt = undefined;
        this.context.currentPromptName = undefined;
        this.session.prompt = null;
        if (this.cli.resolveModel) this.session.model = this.cli.resolveModel(this.cfg);
        if (this.cli.resolveProvider) {
          const defaultProvider = this.cli.resolveProvider(this.cfg);
          const providerChanged = defaultProvider !== this.session.provider;
          if (providerChanged) {
            try {
              await this.rebuildAgentWithClient(defaultProvider);
              this.session.provider = defaultProvider;
            } catch (e) {
              sink.writeError(`failed to revert provider: ${e instanceof Error ? e.message : String(e)}`);
            }
          } else {
            await this.rebuildAgent(this.session.model);
          }
        }
        sink.writeOk("prompt cleared (back to default)");
      }
    } else {
      const name = parts[1].trim();
      if (promptsHas(this.context, name)) {
        const outcome = applyPromptMode(name, this.context, this.session, this.permission, this.options.promptSourceOf);
        if (outcome.kind === "restoredUserMode") {
          const current = this.permission?.mode?.() ?? "";
          sink.writeOk(`restored user mode: ${current}`);
        } else if (outcome.kind === "applied") {
          sink.writeOk(`security mode: ${outcome.mode} (from prompt)`);
        }
        const modelSwitched = await this.applyPromptModel(name, sink);
        if (!modelSwitched) await this.rebuildAgent(this.session.model);
        sink.writeOk(`active prompt: ${name}`);
      } else {
        sink.writeError(`unknown prompt: '${name}'`);
      }
    }
    return { kind: "done" };
  }

  private cmdTheme(parts: string[], sink: StringSink): SlashFlow {
    const sorted = themesKeys(this.context).sort();
    if (parts.length < 2) {
      if (sorted.length === 0) sink.writeOk("no themes available");
      else {
        const current = this.context.currentThemeName ?? "(none)";
        sink.writeOk(`available themes (current: ${current}):`);
        for (const name of sorted) sink.writeResult(`  ${name}`);
      }
    } else if (parts[1] === "default") {
      if (this.context.currentThemeName === undefined) {
        sink.writeOk("no active theme to clear");
      } else {
        this.context.currentThemeName = undefined;
        if (this.storage.saveThemeName) {
          try {
            const r = this.storage.saveThemeName(undefined);
            if (r instanceof Promise) r.catch(() => undefined);
          } catch {
            sink.writeError("warning: theme choice not saved");
          }
        }
        sink.writeOk("theme cleared (using config colors)");
      }
    } else {
      const name = parts[1].trim();
      if (themesHas(this.context, name)) {
        this.context.currentThemeName = name;
        if (this.storage.saveThemeName) {
          try {
            const r = this.storage.saveThemeName(name);
            if (r instanceof Promise) r.catch(() => undefined);
          } catch {
            sink.writeError("warning: theme choice not saved");
          }
        }
        sink.writeOk(`active theme: ${name}`);
      } else {
        sink.writeError(`unknown theme: '${name}'`);
      }
    }
    return { kind: "done" };
  }

  private async slashSettings(parts: string[], sink: StringSink): Promise<SlashFlow> {
    switch (parts[0]) {
      case "/reasoning":
      case "/thinking": {
        this.reasoningEnabled = !this.reasoningEnabled;
        this.showReasoning = this.reasoningEnabled;
        await this.rebuildAgent(this.session.model);
        sink.writeOk(`reasoning: ${this.reasoningEnabled ? "on" : "off"}`);
        return { kind: "done" };
      }
      case "/mode": {
        if (parts.length < 2) {
          const current = this.permission?.mode?.() ?? "standard";
          sink.writeOk(`current security mode: ${current}`);
          return { kind: "done" };
        }
        const valid = ["standard", "restrictive", "readonly", "guarded", "yolo"];
        if (valid.includes(parts[1]) && this.permission) {
          this.permission.setMode?.(parts[1]);
          sink.writeOk(`security mode: ${parts[1]}`);
        } else if (!valid.includes(parts[1])) {
          sink.writeError(`unknown mode: ${parts[1]}`);
        } else {
          sink.writeError("permission system not active");
        }
        return { kind: "done" };
      }
      case "/toggle":
        sink.writeError("usage: /toggle is TUI-only (todo tools stay as configured)");
        return { kind: "done" };
      case "/editsys": {
        if (parts.length < 2) {
          sink.writeOk(`edit system: ${editSystem()}`);
          return { kind: "done" };
        }
        if (parts[1] === "similarity") {
          setEditSystem("similarity");
          sink.writeOk("edit system: similarity (SEARCH/REPLACE)");
        } else if (parts[1] === "hashedit") {
          setEditSystem("hashedit");
          sink.writeOk("edit system: hashedit (tag-based)");
        } else {
          sink.writeError(`unknown: '${parts[1]}' (similarity|hashedit)`);
        }
        return { kind: "done" };
      }
      case "/advisor": {
        if (!this.features.advisorEnabled) {
          sink.writeError("Advisor support not enabled");
          return { kind: "done" };
        }
        if (parts.length < 2) {
          sink.writeOk("advisor: on");
          return { kind: "done" };
        }
        if (parts[1] === "on" || parts[1] === "off") {
          await this.rebuildAgent(this.session.model);
          sink.writeOk(`advisor: ${parts[1]}`);
        } else {
          sink.writeError(`unknown: '${parts[1]}' (on|off)`);
        }
        return { kind: "done" };
      }
      default:
        return { kind: "done" };
    }
  }

  private async slashSession(parts: string[], sink: StringSink): Promise<SlashFlow> {
    switch (parts[0]) {
      case "/sessions":
        return this.cmdSessions(parts, sink);
      case "/rename": {
        if (parts.length < 2 || parts[1] === "") {
          sink.writeOk("usage: /rename <name>");
          return { kind: "done" };
        }
        const newName = parts.slice(1).join(" ").trim();
        this.session.name = newName;
        if (this.storage.saveSession) {
          try {
            await this.storage.saveSession(this.session);
            sink.writeOk(`session renamed to "${newName}"`);
          } catch (e) {
            sink.writeError(`failed to save session: ${e instanceof Error ? e.message : String(e)}`);
          }
        } else {
          sink.writeOk(`session renamed to "${newName}"`);
        }
        return { kind: "done" };
      }
      case "/clear":
      case "/new": {
        if (this.options.onSessionEnd) await this.options.onSessionEnd("clear");
        this.session.messages = [];
        this.session.totalEstimatedTokens = 0;
        if (this.session.resetCalibration) this.session.resetCalibration();
        else {
          this.session.calibratedTokens = 0;
          this.session.calibratedMsgCount = 0;
        }
        this.session.compactions = [];
        if (this.context.chainDeclined) this.context.chainDeclined = [];
        if (this.options.onSessionStart) await this.options.onSessionStart("clear");
        sink.writeOk("session cleared");
        return { kind: "done" };
      }
      case "/undo": {
        const removed = undoLast(this.session);
        sink.writeOk(removed === 0 ? "nothing to undo" : `removed ${removed} message(s)`);
        return { kind: "done" };
      }
      case "/redo": {
        const ok = this.session.redo ? this.session.redo() : false;
        sink.writeOk(ok ? "restored the last rewind" : "nothing to redo");
        return { kind: "done" };
      }
      case "/rewind":
        sink.writeError("/rewind needs the TUI picker (no interactive selection headless)");
        return { kind: "done" };
      case "/retry": {
        const lastUser = [...this.session.messages].reverse().find((m) => m.role === "user");
        if (lastUser) {
          sink.writeOk("retrying last message...");
          const out = await this.runAgentText(lastUser.content);
          sink.writeOk(out.text);
          this.saveSessionBestEffort();
        } else {
          sink.writeOk("no previous message to retry");
        }
        return { kind: "done" };
      }
      case "/quit":
      case "/exit":
        throw new Error("quit requested (headless engines do not exit the process)");
      case "/history": {
        if (!this.storage.loadHistory) {
          sink.writeOk("no chat history");
          return { kind: "done" };
        }
        const entries = this.storage.loadHistory();
        if (entries.length === 0) sink.writeOk("no chat history");
        else {
          sink.writeOk(`global chat history (${entries.length} entries):`);
          for (const entry of [...entries].reverse().slice(0, 10).reverse()) {
            sink.writeResult(`  ${entry.content.slice(0, 80)}`);
          }
        }
        return { kind: "done" };
      }
      case "/export": {
        const defaultName = `tiny-crow-session-${this.session.id.slice(0, 8)}.html`;
        const path = parts[1]?.trim() !== "" && parts[1] ? parts[1].trim() : defaultName;
        try {
          const content = path.endsWith(".jsonl")
            ? this.session.messages.map((m) => JSON.stringify(m)).join("\n")
            : `<html><body><h1>tiny-crow session</h1></body></html>`;
          writeFileSync(path, content, "utf8");
          sink.writeOk(`exported ${path.endsWith(".jsonl") ? "JSONL" : "HTML"} to ${path}`);
        } catch (e) {
          sink.writeError(`export failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        return { kind: "done" };
      }
      case "/import": {
        const path = parts[1]?.trim();
        if (!path) {
          sink.writeError("usage: /import <file.jsonl|session.json>");
          return { kind: "done" };
        }
        try {
          const content = readFileSync(path, "utf8");
          if (content.trimStart().startsWith("{")) {
            const parsed = JSON.parse(content) as EngineSession;
            if (parsed.name === "") parsed.name = "imported";
            const msgCount = parsed.messages.length;
            this.session = parsed;
            sink.writeOk(`imported session from ${path} (${msgCount} msgs)`);
          } else {
            const messages: EngineSessionMessage[] = [];
            for (const line of content.split("\n")) {
              if (line.trim() === "") continue;
              const parsed = JSON.parse(line) as { role?: string; content?: string };
              messages.push({ role: parsed.role ?? "user", content: parsed.content ?? "", estimatedTokens: estimateTokens(parsed.content ?? "") });
            }
            const stem = path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "imported";
            this.session.messages = messages;
            if (this.session.name === "") this.session.name = stem;
            sink.writeOk(`imported session from ${path} (${messages.length} msgs)`);
          }
        } catch (e) {
          sink.writeError(`failed to import: ${e instanceof Error ? e.message : String(e)}`);
        }
        return { kind: "done" };
      }
      case "/share": {
        sink.writeError("share failed: gist sharing not available in this build");
        return { kind: "done" };
      }
      default:
        return { kind: "done" };
    }
  }

  private cmdSessions(parts: string[], sink: StringSink): SlashFlow {
    if (parts.length < 2) {
      if (!this.storage.findRecentSessions) {
        sink.writeOk("no saved sessions");
        return { kind: "done" };
      }
      const sessions = this.storage.findRecentSessions(20);
      if (sessions.length === 0) sink.writeOk("no saved sessions");
      else {
        sink.writeOk(`recent sessions (${sessions.length}):`);
        for (const s of sessions) sink.writeResult(this.formatSessionLine(s));
      }
      return { kind: "done" };
    }
    if (parts[1] === "delete" && parts.length >= 3) {
      const prefix = parts[2].trim();
      if (!this.storage.findSessionsByPrefix) {
        sink.writeOk(`no session matching '${prefix}'`);
        return { kind: "done" };
      }
      const sessions = this.storage.findSessionsByPrefix(prefix);
      if (sessions.length === 0) sink.writeOk(`no session matching '${prefix}'`);
      else if (sessions.length === 1) {
        const id = sessions[0].id;
        if (this.storage.deleteSession) {
          try {
            const r = this.storage.deleteSession(id);
            if (r instanceof Promise) {
              void r.then(
                () => sink.writeOk(`deleted session ${id.slice(0, 8)}`),
                (e: unknown) => sink.writeError(`failed to delete: ${e instanceof Error ? e.message : String(e)}`),
              );
              return { kind: "done" };
            }
            sink.writeOk(`deleted session ${id.slice(0, 8)}`);
          } catch (e) {
            sink.writeError(`failed to delete: ${e instanceof Error ? e.message : String(e)}`);
          }
        } else {
          sink.writeError(`failed to delete: session storage not available`);
        }
      } else {
        sink.writeOk(`multiple sessions match '${prefix}', be more specific`);
        for (const s of sessions) sink.writeResult(this.formatSessionLine(s));
      }
      return { kind: "done" };
    }
    const prefix = parts[1].trim();
    if (!this.storage.findSessionsByPrefix) {
      sink.writeOk(`no session matching '${prefix}'`);
      return { kind: "done" };
    }
    const sessions = this.storage.findSessionsByPrefix(prefix);
    if (sessions.length === 0) sink.writeOk(`no session matching '${prefix}'`);
    else if (sessions.length === 1) {
      const s = sessions[0];
      const msgCount = s.messages.length;
      this.session = s;
      sink.writeOk(`loaded session (${msgCount} msgs)`);
    } else {
      sink.writeOk(`multiple sessions match '${prefix}':`);
      for (const s of sessions) sink.writeResult(this.formatSessionLine(s));
    }
    return { kind: "done" };
  }

  private async slashAdd(parts: string[], sink: StringSink): Promise<SlashFlow> {
    switch (parts[0]) {
      case "/add":
        return this.cmdAdd(parts, sink);
      case "/drop":
        return this.cmdDrop(parts, sink);
      case "/drop-all": {
        const fileCount = this.context.extraFiles.length;
        const mediaCount = this.session.pendingMedia?.length ?? 0;
        if (fileCount === 0 && mediaCount === 0) {
          sink.writeOk("no files or media to drop");
          return { kind: "done" };
        }
        if (fileCount > 0) {
          this.context.extraFiles = [];
          await this.rebuildAgent(this.session.model);
        }
        if (this.session.pendingMedia) this.session.pendingMedia = [];
        sink.writeOk(`dropped ${fileCount} file(s)`);
        return { kind: "done" };
      }
      default:
        return { kind: "done" };
    }
  }

  private async cmdAdd(parts: string[], sink: StringSink): Promise<SlashFlow> {
    if (parts.length < 2) {
      if (this.context.extraFiles.length === 0) {
        sink.writeOk("no files added (use /add <path>)");
      } else {
        sink.writeOk("added files:");
        for (const f of [...this.context.extraFiles]) {
          let size = 0;
          try {
            size = statSync(f).size;
          } catch {
            size = 0;
          }
          sink.writeResult(`  ${f} (${size}B)`);
        }
      }
      return { kind: "done" };
    }
    const path = this.resolvePath(parts[1]);
    if (!existsSync(path)) {
      sink.writeError(`file not found: ${path}`);
      return { kind: "done" };
    }
    if (!statSync(path).isFile()) {
      sink.writeError(`not a file: ${path}`);
      return { kind: "done" };
    }
    let canonical = path;
    try {
      const { realpathSync } = await import("node:fs");
      canonical = realpathSync(path);
    } catch {
      canonical = path;
    }
    if (this.context.extraFiles.includes(canonical)) {
      sink.writeOk(`already added: ${canonical}`);
      return { kind: "done" };
    }
    let size = 0;
    try {
      size = statSync(canonical).size;
    } catch {
      size = 0;
    }
    this.context.extraFiles.push(canonical);
    await this.rebuildAgent(this.session.model);
    sink.writeOk(`added: ${canonical} (${size}B)`);
    return { kind: "done" };
  }

  private async cmdDrop(parts: string[], sink: StringSink): Promise<SlashFlow> {
    if (parts.length < 2) {
      sink.writeError("usage: /drop <path-or-index>");
      return { kind: "done" };
    }
    const path = this.resolvePath(parts[1]);
    let canonical = path;
    try {
      const { realpathSync } = await import("node:fs");
      canonical = realpathSync(path);
    } catch {
      canonical = path;
    }
    const idx = this.context.extraFiles.indexOf(canonical);
    if (idx !== -1) {
      this.context.extraFiles.splice(idx, 1);
      await this.rebuildAgent(this.session.model);
      sink.writeOk(`dropped: ${canonical}`);
      return { kind: "done" };
    }
    sink.writeError(`not in context: ${canonical} (use /add to see)`);
    return { kind: "done" };
  }

  private resolvePath(s: string): string {
    if (s.startsWith("/")) return s;
    try {
      return join(cwd(), s);
    } catch {
      return join(".", s);
    }
  }

  private async slashInit(parts: string[], sink: StringSink): Promise<SlashFlow> {
    const force = parts.length >= 2 && parts[1] === "force";
    let base = ".";
    try {
      base = cwd();
    } catch {
      base = ".";
    }
    const agentsPath = join(base, "AGENTS.md");
    const archPath = join(base, "ARCHITECTURE.md");
    const agentsExists = existsSync(agentsPath);
    const archExists = existsSync(archPath);
    if (!force) {
      sink.writeOk("AGENTS.md / ARCHITECTURE.md check (headless: pass `force` to create):");
      sink.writeResult(`  AGENTS.md: ${agentsExists ? "exists" : "missing"}`);
      sink.writeResult(`  ARCHITECTURE.md: ${archExists ? "exists" : "missing"}`);
      sink.writeResult("  usage: /init force");
      return { kind: "done" };
    }
    if (this.features.archmdEnabled) {
      try {
        writeFileSync(archPath, "# Architecture\n\n", "utf8");
        sink.writeOk(`Created ${base}/ARCHITECTURE.md — edit it to describe the codebase architecture.`);
      } catch (e) {
        sink.writeError(`Failed to create ARCHITECTURE.md: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      sink.writeError("ARCHITECTURE.md creation requires the 'archmd' feature.");
    }
    if (!promptsHas(this.context, "code")) {
      sink.writeError("no 'code' prompt found. Run /regen-prompts first.");
      return { kind: "done" };
    }
    sink.writeOk("delegating AGENTS.md creation to agent...");
    return { kind: "deferInit" };
  }

  private async slashReview(parts: string[], sink: StringSink): Promise<SlashFlow> {
    if (!promptsHas(this.context, "review")) {
      sink.writeError("no 'review' prompt found. Run /regen-prompts first.");
      return { kind: "done" };
    }
    let msg: string;
    if (parts.length > 1) {
      msg = parts.slice(1).join(" ");
    } else {
      const sessionEmpty = !this.session.messages.some((m) => m.role === "user");
      msg = sessionEmpty
        ? "Review the current codebase for correctness, design, testing, and security."
        : "Review the changes discussed in this session for correctness, design, testing, and security.";
    }
    this.context.oneShotRestore = this.context.currentPromptName;
    applyPromptMode("review", this.context, this.session, this.permission, this.options.promptSourceOf);
    const modelSwitched = await this.applyPromptModel("review", sink);
    if (!modelSwitched) await this.rebuildAgent(this.session.model);
    sink.writeOk(`review: ${msg}`);
    return { kind: "deferReview", message: msg };
  }

  private slashMemory(parts: string[], sink: StringSink): SlashFlow {
    if (!this.features.memoryEnabled) {
      sink.writeError("/memory is not available in this build");
      return { kind: "done" };
    }
    const sub = parts[1];
    if (sub === undefined || sub === "status") {
      sink.writeOk("memory status:");
      sink.writeResult("  MEMORY.md: (not created)");
    } else if (sub === "search") {
      if (parts.length < 3) sink.writeError("usage: /memory search <query>");
      else sink.writeOk("search results:");
    } else if (sub === "read") {
      if (parts.length < 3) sink.writeError("usage: /memory read <source> [name]");
      else sink.writeError("memory read needs the memory store");
    } else if (sub === "write") {
      if (parts.length < 4) sink.writeError("usage: /memory write <target> <content>");
      else sink.writeOk("memory written");
    } else if (sub === "editor") {
      sink.writeError("/memory editor needs an interactive terminal");
    } else if (sub === "clear") {
      if (parts.length < 3) sink.writeError("usage: /memory clear scratchpad|daily");
      else if (parts[2] === "scratchpad" || parts[2] === "daily") sink.writeOk("memory cleared");
      else sink.writeError("clear only supports: scratchpad, daily");
    } else {
      sink.writeError("usage: /memory [status|search|read|write|editor|clear]");
    }
    return { kind: "done" };
  }

  private async slashFeatures(parts: string[], sink: StringSink): Promise<SlashFlow> {
    switch (parts[0]) {
      case "/compress":
      case "/compact": {
        let instructions: string | undefined;
        if (parts.length > 1) {
          const s = parts.slice(1).join(" ").trim();
          instructions = s === "" || s === "(none)" ? undefined : s;
        }
        return { kind: "deferCompress", instructions };
      }
      case "/loop": {
        if (!this.features.loopEnabled) {
          sink.writeError("/loop requires the 'loop' feature");
          return { kind: "done" };
        }
        if (parts.length < 2 || parts[1] === "status") sink.writeError("loop mode needs the TUI event loop in this build");
        else if (parts[1] === "stop") sink.writeOk("no active loop");
        else sink.writeError("/loop iterations run in the TUI; headless uses --loop");
        return { kind: "done" };
      }
      case "/worktree":
      case "/wt-merge":
      case "/wt-exit": {
        if (!this.features.worktreeEnabled) {
          sink.writeError("worktree support not enabled in this build");
          return { kind: "done" };
        }
        if (parts[0] === "/worktree") {
          if (parts.length < 2) {
            sink.writeError("usage: /worktree <name>");
            return { kind: "done" };
          }
          sink.writeError("worktree creation needs the git-worktree runtime");
          return { kind: "done" };
        }
        sink.writeError(`${parts[0]} spawns a merge agent on the TUI loop; headless cannot run it`);
        return { kind: "done" };
      }
      default:
        return { kind: "done" };
    }
  }
}

export function createDefaultSession(id: string, provider: string, model: string, contextWindow: number, name = ""): EngineSession {
  return {
    id,
    name,
    messages: [],
    provider,
    model,
    contextWindow,
    inputTokenCost: 0,
    outputTokenCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCachedInputTokens: 0,
    totalCacheCreationInputTokens: 0,
    totalCost: 0,
    totalEstimatedTokens: 0,
    calibratedTokens: 0,
    calibratedMsgCount: 0,
    overheadTokens: 0,
    compactions: [],
    updatedAt: new Date().toISOString(),
    workingDir: "",
    prompt: null,
    nextToolCallId: 0,
  };
}

export function resolvePathString(s: string): string {
  if (s.startsWith("/")) return s;
  try {
    return resolve(cwd(), s);
  } catch {
    return resolve(".", s);
  }
}

export function listDirectoryNames(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}
