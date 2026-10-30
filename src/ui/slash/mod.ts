import type { InputEditor } from "../input/mod.ts";
import { handle as handleAdd } from "./add.ts";
import { handle as handleContent } from "./content.ts";
import { handle as handleFeatures } from "./features.ts";
import { handle as handleHelp, handleTutor, handleWelcome } from "./help.ts";
import { handle as handleHooks } from "./hooks.ts";
import { handle as handleInit } from "./init.ts";
import { handle as handleMemory } from "./memory.ts";
import { handle as handleProviders } from "./providers.ts";
import { handle as handleReview } from "./review.ts";
import { handle as handleSession } from "./session.ts";
import { handle as handleSettings } from "./settings.ts";
import { handle as handleDocs } from "./docs.ts";

export const C_AGENT = "white";
export const C_RESULT = "darkGrey";
export const C_ERROR = "red";

export type SecurityMode =
  | "standard"
  | "restrictive"
  | "readonly"
  | "guarded"
  | "yolo";

export function parseSecurityMode(s: string): SecurityMode | undefined {
  switch (s) {
    case "standard":
    case "restrictive":
    case "readonly":
    case "guarded":
    case "yolo":
      return s;
    default:
      return undefined;
  }
}

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface MessageLike {
  role: MessageRole | string;
  content: string;
  estimatedTokens: number;
}

export interface CompactionLike {
  summary: string;
  tokenSavings: number;
}

export interface SessionLike {
  id: string;
  name: string;
  model: string;
  provider: string;
  messages: MessageLike[];
  inputTokenCost: number;
  outputTokenCost: number;
  contextWindow: number;
  totalEstimatedTokens: number;
  compactions: CompactionLike[];
  workingDir?: string;
  prompt?: { name: string; source?: string };
  pendingMedia?: PendingMediaLike[];
  updatedAt?: string;
  rewindTo?(newLen: number): number;
  redo?(): boolean;
  resetCalibration?(): void;
  updateContextWindow?(cw: number): void;
  effectiveContextTokens?(): number;
  compress?(summary: string, firstKeptIndex: number, tokenSavings: number): void;
  addMessage?(role: MessageRole | string, content: string): void;
}

export interface PendingMediaLike {
  kind: "image" | "audio" | "document";
  size: number;
  pathText: string;
  mime: string;
}

export interface RendererLike {
  writeLine(text: string, color?: string): void;
  setBackgroundColors(chat?: string, input?: string, status?: string): void;
  clearContent(): void;
}

export interface ContextFilesLike {
  prompts: Map<string, string>;
  themes: Map<string, string>;
  currentPrompt?: string;
  currentPromptName?: string;
  currentThemeName?: string;
  extraFiles: string[];
  extraPromptsDirs: string[];
  chainDeclined: string[] | Set<string>;
  agents?: unknown;
  architecture?: unknown;
  memory?: string;
  oneShotRestore?: string;
  reload?(): void;
}

export interface QuickModelConfig {
  provider: string;
  model: string;
  inputTokenCost: number;
  outputTokenCost: number;
  reserveTokens?: number;
  temperature?: number;
  extraBody?: unknown;
  contextWindow?: number;
}

export interface CustomProviderLike {
  providerType: string;
  baseUrl: string;
  apiKeyEnv?: string;
  dangerAcceptInvalidCerts?: boolean;
  apiStyle?: string;
  headers?: Record<string, string>;
  timeoutSecs?: number;
  model?: string;
}

export interface McpServerLike {
  url?: string;
  isCommand?: boolean;
  oauthSettings?: unknown;
}

export interface ConfigLike {
  colors?: {
    chatBackground?: string;
    inputBackground?: string;
    statusBackground?: string;
  };
  contextWindow?: number;
  apiKeys?: Record<string, string>;
  customProviders?: Record<string, CustomProviderLike>;
  quickModels?: Record<string, QuickModelConfig>;
  promptToModel?: Record<string, string>;
  mcpServers?: Record<string, McpServerLike>;
  taskMaxTurns?: number;
  resolveMouseCapture?(): boolean;
  resolvePromptModel?(name: string): string | undefined;
  resolveContextWindow?(
    provider: string,
    model: string,
    quickModels: Record<string, QuickModelConfig>,
  ): number | undefined;
  resolveReserveTokens?(
    model: string,
    quickModels: Record<string, QuickModelConfig>,
  ): number;
  resolveKeepRecentTokens?(): number;
  customProvidersMap?(): Record<string, CustomProviderLike>;
}

export interface CliLike {
  apiKey?: string;
  disableLazygit?: boolean;
  resolveModel?(cfg: ConfigLike): string | undefined;
  resolveProvider?(cfg: ConfigLike): string | undefined;
  resolveWtBaseDir?(cfg: ConfigLike): string | undefined;
}

export interface PermissionLike {
  mode(): SecurityMode | string;
  setMode(mode: SecurityMode): void;
  setPromptMode?(mode: SecurityMode): void;
  restoreUserMode?(): void;
}

export interface ModelEntry {
  id: string;
  display: string;
  inputPrice?: number;
  outputPrice?: number;
  contextLength?: number;
}

export interface AnyClientLike {
  listModels?(): Promise<ModelEntry[]>;
  compressMessages?(
    model: string,
    messages: MessageLike[],
    previousSummary: string | undefined,
    instructions: string | undefined,
  ): Promise<string>;
  completionModel?(id: string): unknown;
  providerName?(): string;
}

export interface InputEditorLike {
  buffer: string;
  cursor: number;
  setLiveModelNames(names: string[]): void;
  startRewindPicker(targets: Array<[number, string]>): void;
}

export interface LoopStateLike {
  active: boolean;
  iterationLabel(): string;
  planFile: string;
}

export interface McpManagerLike {
  getHandle(name: string): Promise<McpHandleLike | undefined>;
}

export interface McpHandleLike {
  listTools(): Promise<Array<{ name: string; description?: string }>>;
}

export interface HooksDispatcherLike {
  summary(): Array<[string, number]>;
}

export interface SessionStoreLike {
  findRecentSessions(limit: number): SessionLike[];
  findSessionsByPrefix(prefix: string): SessionLike[];
  saveSession(session: SessionLike): void;
  deleteSession(id: string): void;
  saveThemeName(name: string | undefined): void;
}

export interface MemoryStoreLike {
  memoryMd(): string;
  scratchpad(): string;
  dailyFile(date: string): string;
  today: string;
  search(query: string): { render(maxChars: number): string };
  notePath(name: string): string | undefined;
  write(
    target: "longTerm" | "scratchpad" | "daily" | "note",
    content: string,
    mode: "append" | "overwrite",
    name?: string,
  ): string;
}

export interface AdvisorConfigLike {
  enabled: boolean;
  humanHandoff: boolean;
  advisorModel: string;
  maxUses?: number;
  kilobytesLimit: number;
  handoffTx?: unknown;
}

export interface AdvisorLike {
  config(): AdvisorConfigLike;
  initConfig(cfg: AdvisorConfigLike): void;
}

export interface EditSystemLike {
  current(): string;
  set(system: "similarity" | "hashedit"): void;
}

export interface SubagentLike {
  providerName(): string;
  modelName(): string;
  setModelName(name: string): void;
  setClientAndModel(client: unknown, model: string): void;
  buildExploreAgent?(
    model: unknown,
    maxTurns: number,
    cfg: ConfigLike,
  ): Promise<unknown>;
}

export type PromptModeOutcome =
  | { kind: "none" }
  | { kind: "restoredUserMode" }
  | { kind: "applied"; mode: SecurityMode };

export interface SlashCtxInit {
  agent?: unknown;
  client: AnyClientLike;
  renderer: RendererLike;
  session: SessionLike;
  cli: CliLike;
  cfg: ConfigLike;
  context: ContextFilesLike;
  showReasoning?: boolean;
  reasoningEnabled?: boolean;
  isRunning?: boolean;
  input: InputEditorLike | InputEditor;
  permission?: PermissionLike;
  askTx?: unknown;
  todoToolsEnabled?: boolean;
  sandbox?: unknown;
  loopState?: LoopStateLike;
  advisor?: AdvisorLike;
  editSystem?: EditSystemLike;
  loopFactory?: (prompt: string, planFile: string) => LoopStateLike;
  mcpManager?: McpManagerLike;
  hooksDispatcher?: HooksDispatcherLike;
  sessionStore?: SessionStoreLike;
  memoryStore?: MemoryStoreLike;
  subagent?: SubagentLike;
  renderSession?: (
    renderer: RendererLike,
    session: SessionLike,
    cli: CliLike,
    cfg: ConfigLike,
    context: ContextFilesLike,
  ) => void;
  showWelcome?: (renderer: RendererLike, showLazygit: boolean) => void;
  showGetStarted?: () => void;
  suspendTui?: <T>(mouseCapture: boolean, fn: () => T) => T;
  docsDir?: string;
  saveThemeName?: (name: string | undefined) => void;
  regenPrompts?: () => void;
  loadPrompts?: (extraDirs: string[]) => Map<string, string>;
  regenThemes?: () => void;
  loadThemes?: () => Map<string, string>;
  applyTheme?: (content: string, renderer: RendererLike) => void;
  promptSource?: (name: string, extraDirs: string[]) => string | undefined;
  createClient?: (provider: string) => AnyClientLike | Promise<AnyClientLike>;
  buildAgent?: (model: string, reasoning: boolean) => unknown | Promise<unknown>;
  defaultModelForProvider?: (
    provider: string,
    cfg: ConfigLike,
  ) => [string, [number, number] | undefined] | undefined;
  parseProvider?: (name: string) => boolean;
  fetchCustomModelsRaw?: (
    provider: string,
    apiKey: string | undefined,
    customMap: Record<string, CustomProviderLike>,
    apiKeys: Record<string, string> | undefined,
  ) => Promise<
    [ModelEntry[], Map<string, { inputCost: number; outputCost: number }>]
  >;
  fetchLiveModelInfo?: (
    provider: string,
    apiKey: string | undefined,
    customMap: Record<string, CustomProviderLike>,
    apiKeys: Record<string, string> | undefined,
  ) => Promise<
    Map<string, { inputCost: number; outputCost: number; contextLength?: number }>
  >;
  catalogEntries?: (provider: string) => ModelEntry[] | undefined;
  catalogContextWindow?: (provider: string, model: string) => number | undefined;
  isAgentModel?: (entry: ModelEntry) => boolean;
  saveQuickModel?: (
    name: string,
    provider: string,
    model: string,
    inputCost: number,
    outputCost: number,
  ) => void;
  loadHistory?: () => Array<{ content: string }>;
  formatTime?: (updatedAt: string) => string;
  rewindTargets?: (session: SessionLike) => Array<[number, string]>;
  dispatchSessionEnd?: (reason: string) => void | Promise<void>;
  dispatchSessionStart?: (reason: string) => void | Promise<void>;
  memoryFlushCompaction?: (summary: string, cutIdx: number) => void;
  effectiveReserve?: (reserve: number, memory: string | undefined) => number;
  exportToHtml?: (session: SessionLike) => string;
  exportToJsonl?: (session: SessionLike) => string;
  parseJsonlImport?: (content: string) => MessageLike[];
  shareGist?: (
    filename: string,
    content: string,
    description: string,
  ) => Promise<string>;
  mcpLogout?: (name: string) => boolean;
}

export class SlashCtx {
  agent: unknown;
  client: AnyClientLike;
  renderer: RendererLike;
  session: SessionLike;
  cli: CliLike;
  cfg: ConfigLike;
  context: ContextFilesLike;
  showReasoning: boolean;
  reasoningEnabled: boolean;
  isRunning: boolean;
  input: InputEditorLike | InputEditor;
  permission?: PermissionLike;
  askTx?: unknown;
  todoToolsEnabled: boolean;
  sandbox: unknown;
  loopState?: LoopStateLike;
  advisor?: AdvisorLike;
  editSystem?: EditSystemLike;
  loopFactory?: SlashCtxInit["loopFactory"];
  mcpManager?: McpManagerLike;
  hooksDispatcher?: HooksDispatcherLike;
  sessionStore?: SessionStoreLike;
  memoryStore?: MemoryStoreLike;
  subagent?: SubagentLike;
  renderSession?: SlashCtxInit["renderSession"];
  showWelcome?: SlashCtxInit["showWelcome"];
  showGetStarted?: SlashCtxInit["showGetStarted"];
  suspendTui?: SlashCtxInit["suspendTui"];
  docsDir?: string;
  saveThemeName?: SlashCtxInit["saveThemeName"];
  regenPrompts?: SlashCtxInit["regenPrompts"];
  loadPrompts?: SlashCtxInit["loadPrompts"];
  regenThemes?: SlashCtxInit["regenThemes"];
  loadThemes?: SlashCtxInit["loadThemes"];
  applyTheme?: SlashCtxInit["applyTheme"];
  promptSource?: SlashCtxInit["promptSource"];
  createClient?: SlashCtxInit["createClient"];
  buildAgent?: SlashCtxInit["buildAgent"];
  defaultModelForProvider?: SlashCtxInit["defaultModelForProvider"];
  parseProvider?: SlashCtxInit["parseProvider"];
  fetchCustomModelsRaw?: SlashCtxInit["fetchCustomModelsRaw"];
  fetchLiveModelInfo?: SlashCtxInit["fetchLiveModelInfo"];
  catalogEntries?: SlashCtxInit["catalogEntries"];
  catalogContextWindow?: SlashCtxInit["catalogContextWindow"];
  isAgentModel?: SlashCtxInit["isAgentModel"];
  saveQuickModel?: SlashCtxInit["saveQuickModel"];
  loadHistory?: SlashCtxInit["loadHistory"];
  formatTime?: SlashCtxInit["formatTime"];
  rewindTargets?: SlashCtxInit["rewindTargets"];
  dispatchSessionEnd?: SlashCtxInit["dispatchSessionEnd"];
  dispatchSessionStart?: SlashCtxInit["dispatchSessionStart"];
  memoryFlushCompaction?: SlashCtxInit["memoryFlushCompaction"];
  effectiveReserve?: SlashCtxInit["effectiveReserve"];
  exportToHtml?: SlashCtxInit["exportToHtml"];
  exportToJsonl?: SlashCtxInit["exportToJsonl"];
  parseJsonlImport?: SlashCtxInit["parseJsonlImport"];
  shareGist?: SlashCtxInit["shareGist"];
  mcpLogout?: SlashCtxInit["mcpLogout"];

  constructor(init: SlashCtxInit) {
    this.agent = init.agent;
    this.client = init.client;
    this.renderer = init.renderer;
    this.session = init.session;
    this.cli = init.cli;
    this.cfg = init.cfg;
    this.context = init.context;
    this.showReasoning = init.showReasoning ?? false;
    this.reasoningEnabled = init.reasoningEnabled ?? false;
    this.isRunning = init.isRunning ?? false;
    this.input = init.input;
    this.permission = init.permission;
    this.askTx = init.askTx;
    this.todoToolsEnabled = init.todoToolsEnabled ?? false;
    this.sandbox = init.sandbox;
    this.loopState = init.loopState;
    this.advisor = init.advisor;
    this.editSystem = init.editSystem;
    this.loopFactory = init.loopFactory;
    this.mcpManager = init.mcpManager;
    this.hooksDispatcher = init.hooksDispatcher;
    this.sessionStore = init.sessionStore;
    this.memoryStore = init.memoryStore;
    this.subagent = init.subagent;
    this.renderSession = init.renderSession;
    this.showWelcome = init.showWelcome;
    this.showGetStarted = init.showGetStarted;
    this.suspendTui = init.suspendTui;
    this.docsDir = init.docsDir;
    this.saveThemeName = init.saveThemeName;
    this.regenPrompts = init.regenPrompts;
    this.loadPrompts = init.loadPrompts;
    this.regenThemes = init.regenThemes;
    this.loadThemes = init.loadThemes;
    this.applyTheme = init.applyTheme;
    this.promptSource = init.promptSource;
    this.createClient = init.createClient;
    this.buildAgent = init.buildAgent;
    this.defaultModelForProvider = init.defaultModelForProvider;
    this.parseProvider = init.parseProvider;
    this.fetchCustomModelsRaw = init.fetchCustomModelsRaw;
    this.fetchLiveModelInfo = init.fetchLiveModelInfo;
    this.catalogEntries = init.catalogEntries;
    this.catalogContextWindow = init.catalogContextWindow;
    this.isAgentModel = init.isAgentModel;
    this.saveQuickModel = init.saveQuickModel;
    this.loadHistory = init.loadHistory;
    this.formatTime = init.formatTime;
    this.rewindTargets = init.rewindTargets;
    this.dispatchSessionEnd = init.dispatchSessionEnd;
    this.dispatchSessionStart = init.dispatchSessionStart;
    this.memoryFlushCompaction = init.memoryFlushCompaction;
    this.effectiveReserve = init.effectiveReserve;
    this.exportToHtml = init.exportToHtml;
    this.exportToJsonl = init.exportToJsonl;
    this.parseJsonlImport = init.parseJsonlImport;
    this.shareGist = init.shareGist;
    this.mcpLogout = init.mcpLogout;
  }

  async rebuildAgent(): Promise<void> {
    if (this.buildAgent !== undefined) {
      this.agent = await this.buildAgent(this.session.model, this.reasoningEnabled);
    }
  }

  async rebuildAgentWithClient(provider: string, newReasoning: boolean): Promise<void> {
    if (this.createClient === undefined) {
      throw new Error(
        `cannot create client for provider '${provider}' (client factory not wired)`,
      );
    }
    this.client = await this.createClient(provider);
    await this.rebuildAgentWithReasoning(newReasoning);
  }

  private async rebuildAgentWithReasoning(newReasoning: boolean): Promise<void> {
    if (this.buildAgent !== undefined) {
      this.agent = await this.buildAgent(this.session.model, newReasoning);
    }
  }

  async switchToPromptModel(promptName: string): Promise<boolean> {
    const qmName = resolvePromptModel(this.cfg, promptName);
    if (qmName === undefined) return false;
    const qm = quickModelsMap(this.cfg);
    const qmc = qm[qmName];
    if (qmc === undefined) return false;
    const newModel = qmc.model;
    const providerChanged = qmc.provider !== this.session.provider;
    this.session.model = newModel;
    if (providerChanged) {
      try {
        await this.rebuildAgentWithClient(qmc.provider, this.reasoningEnabled);
        this.session.provider = qmc.provider;
      } catch (e) {
        this.renderer.writeLine(
          `failed to switch provider for prompt '${promptName}': ${e instanceof Error ? e.message : String(e)}`,
          C_ERROR,
        );
        return false;
      }
    } else {
      await this.rebuildAgent();
    }
    this.session.inputTokenCost = qmc.inputTokenCost;
    this.session.outputTokenCost = qmc.outputTokenCost;
    const cw = resolveContextWindow(this.cfg, this.session.provider, newModel, qm);
    if (cw !== undefined) sessionUpdateContextWindow(this.session, cw);
    this.renderer.writeLine(
      `switched to model: ${qmName} (from prompt '${promptName}')`,
      C_AGENT,
    );
    return true;
  }
}

export function customProvidersMap(cfg: ConfigLike): Record<string, CustomProviderLike> {
  return cfg.customProvidersMap?.() ?? cfg.customProviders ?? {};
}

export function quickModelsMap(cfg: ConfigLike): Record<string, QuickModelConfig> {
  return cfg.quickModels ?? {};
}

export function resolvePromptModel(
  cfg: ConfigLike,
  promptName: string,
): string | undefined {
  return cfg.resolvePromptModel?.(promptName) ?? cfg.promptToModel?.[promptName];
}

export function resolveContextWindow(
  cfg: ConfigLike,
  provider: string,
  model: string,
  qm: Record<string, QuickModelConfig>,
): number | undefined {
  const direct = cfg.resolveContextWindow?.(provider, model, qm);
  if (direct !== undefined) return direct;
  for (const entry of Object.values(qm)) {
    if (entry.provider === provider && entry.model === model && entry.contextWindow !== undefined) {
      return entry.contextWindow;
    }
  }
  return cfg.contextWindow;
}

export function resolveReserveTokens(
  cfg: ConfigLike,
  model: string,
  qm: Record<string, QuickModelConfig>,
): number {
  return cfg.resolveReserveTokens?.(model, qm) ?? 0;
}

export function resolveKeepRecentTokens(cfg: ConfigLike): number {
  return cfg.resolveKeepRecentTokens?.() ?? 0;
}

export function resolveMouseCapture(cfg: ConfigLike): boolean {
  return cfg.resolveMouseCapture?.() ?? true;
}

export function cliResolveModel(cli: CliLike, cfg: ConfigLike): string | undefined {
  return cli.resolveModel?.(cfg);
}

export function cliResolveProvider(cli: CliLike, cfg: ConfigLike): string | undefined {
  return cli.resolveProvider?.(cfg);
}

export function cliResolveWtBaseDir(cli: CliLike, cfg: ConfigLike): string | undefined {
  return cli.resolveWtBaseDir?.(cfg);
}

export function writeOk(renderer: RendererLike, msg: string): void {
  renderer.writeLine(msg, C_AGENT);
}

export function writeResult(renderer: RendererLike, msg: string): void {
  renderer.writeLine(msg, C_RESULT);
}

export function writeError(renderer: RendererLike, msg: string): void {
  renderer.writeLine(msg, C_ERROR);
}

export function parsePromptMode(content: string): {
  mode?: string;
  cleanContent: string;
} {
  const lines = content.split("\n");
  let mode: string | undefined;
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("%%mode=")) {
      mode = trimmed.slice("%%mode=".length).trim();
    } else {
      kept.push(line);
    }
  }
  return { mode, cleanContent: kept.join("\n") };
}

export function applyPromptMode(
  name: string,
  context: ContextFilesLike,
  session: SessionLike,
  permission: PermissionLike | undefined,
  promptSource?: (name: string, extraDirs: string[]) => string | undefined,
): PromptModeOutcome {
  const content = context.prompts.get(name);
  if (content === undefined) return { kind: "none" };
  const { mode, cleanContent } = parsePromptMode(content);
  context.currentPrompt = mode !== undefined ? cleanContent : content;
  context.currentPromptName = name;
  session.prompt = {
    name,
    source: promptSource?.(name, context.extraPromptsDirs),
  };
  if (mode === undefined || permission === undefined) return { kind: "none" };
  if (mode === "last_user_mode") {
    permission.restoreUserMode?.();
    return { kind: "restoredUserMode" };
  }
  const parsed = parseSecurityMode(mode);
  if (parsed !== undefined) {
    if (permission.setPromptMode !== undefined) permission.setPromptMode(parsed);
    else permission.setMode(parsed);
    return { kind: "applied", mode: parsed };
  }
  return { kind: "none" };
}

export async function applyPromptModel(
  promptName: string,
  ctx: SlashCtx,
): Promise<boolean> {
  return ctx.switchToPromptModel(promptName);
}

const redoStacks = new WeakMap<SessionLike, MessageLike[][]>();

export function sessionUpdateContextWindow(session: SessionLike, cw: number): void {
  if (session.updateContextWindow !== undefined) session.updateContextWindow(cw);
  else session.contextWindow = cw;
}

export function sessionEffectiveTokens(session: SessionLike): number {
  if (session.effectiveContextTokens !== undefined) {
    return session.effectiveContextTokens();
  }
  return session.messages.reduce((sum, m) => sum + m.estimatedTokens, 0);
}

export function sessionRewindTo(session: SessionLike, newLen: number): number {
  if (session.rewindTo !== undefined) return session.rewindTo(newLen);
  const removed = session.messages.splice(newLen);
  const stack = redoStacks.get(session) ?? [];
  stack.push(removed);
  redoStacks.set(session, stack);
  return removed.length;
}

export function sessionRedo(session: SessionLike): boolean {
  if (session.redo !== undefined) return session.redo();
  const stack = redoStacks.get(session);
  const removed = stack?.pop();
  if (removed === undefined || removed.length === 0) return false;
  session.messages.push(...removed);
  return true;
}

export function sessionResetCalibration(session: SessionLike): void {
  session.resetCalibration?.();
}

export function sessionCompress(
  session: SessionLike,
  summary: string,
  firstKeptIndex: number,
  tokenSavings: number,
): void {
  if (session.compress !== undefined) {
    session.compress(summary, firstKeptIndex, tokenSavings);
    return;
  }
  session.messages.splice(0, firstKeptIndex, {
    role: "system",
    content: summary,
    estimatedTokens: 0,
  });
  session.compactions.push({ summary, tokenSavings });
}

export function sessionAddMessage(
  session: SessionLike,
  role: MessageRole | string,
  content: string,
): void {
  if (session.addMessage !== undefined) session.addMessage(role, content);
  else session.messages.push({ role, content, estimatedTokens: 0 });
}

export function clearChainDeclined(context: ContextFilesLike): void {
  if (Array.isArray(context.chainDeclined)) context.chainDeclined.length = 0;
  else context.chainDeclined.clear();
}

export function renderSessionWithCtx(ctx: SlashCtx): void {
  if (ctx.renderSession !== undefined) {
    ctx.renderSession(ctx.renderer, ctx.session, ctx.cli, ctx.cfg, ctx.context);
  } else {
    ctx.renderer.clearContent();
  }
}

export function undoLast(session: SessionLike): number {
  const len = session.messages.length;
  if (len === 0) return 0;
  const last = session.messages[len - 1];
  let removed = 0;
  if (last.role === "assistant") {
    removed = len >= 2 && session.messages[len - 2].role === "user" ? 2 : 1;
  } else if (last.role === "user") {
    removed = 1;
  }
  if (removed > 0) sessionRewindTo(session, len - removed);
  return removed;
}

export function selectCompactionCut(
  messages: MessageLike[],
  keepRecent: number,
): number {
  let accumulated = 0;
  let cutIdx = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (accumulated >= keepRecent) {
      cutIdx = i + 1;
      break;
    }
    accumulated += messages[i].estimatedTokens;
  }
  return cutIdx;
}

export async function handleCompress(
  instructions: string | undefined,
  auto: boolean,
  ctx: SlashCtx,
): Promise<void> {
  const qm = quickModelsMap(ctx.cfg);
  let reserve = resolveReserveTokens(ctx.cfg, ctx.session.model, qm);
  if (ctx.effectiveReserve !== undefined) {
    reserve = ctx.effectiveReserve(reserve, ctx.context.memory);
  }
  const keepRecent = resolveKeepRecentTokens(ctx.cfg);
  const maxTokens = ctx.session.contextWindow - reserve;
  if (auto && sessionEffectiveTokens(ctx.session) <= maxTokens) return;
  const cutIdx = selectCompactionCut(ctx.session.messages, keepRecent);
  if (cutIdx === 0) {
    if (!auto) {
      ctx.renderer.writeLine("not enough conversation history to compact yet", C_AGENT);
    }
    return;
  }
  ctx.renderer.writeLine(auto ? "auto-compacting..." : "compressing...", auto ? C_RESULT : C_AGENT);
  ctx.renderer.writeLine("", C_AGENT);
  const messagesToSummarize = ctx.session.messages.slice(0, cutIdx);
  const previousSummary = ctx.session.compactions[ctx.session.compactions.length - 1]?.summary;
  if (ctx.client.compressMessages === undefined) {
    throw new Error("compress not available: client does not support compression");
  }
  const summary = await ctx.client.compressMessages(
    ctx.session.model,
    messagesToSummarize,
    previousSummary,
    instructions,
  );
  const tokensBefore = messagesToSummarize.reduce((sum, m) => sum + m.estimatedTokens, 0);
  ctx.memoryFlushCompaction?.(summary, cutIdx);
  sessionCompress(ctx.session, summary, cutIdx, tokensBefore);
  await ctx.rebuildAgent();
  renderSessionWithCtx(ctx);
  ctx.renderer.writeLine(
    `compressed ${cutIdx} messages (saved ~${tokensBefore} tokens)`,
    C_AGENT,
  );
}

export function splitSlashParts(text: string): string[] {
  const trimmed = text.trim();
  const first = trimmed.indexOf(" ");
  if (first === -1) return [trimmed];
  const second = trimmed.indexOf(" ", first + 1);
  if (second === -1) return [trimmed.slice(0, first), trimmed.slice(first + 1)];
  return [
    trimmed.slice(0, first),
    trimmed.slice(first + 1, second),
    trimmed.slice(second + 1),
  ];
}

export async function handleSlash(text: string, ctx: SlashCtx): Promise<void> {
  const parts = splitSlashParts(text);
  switch (parts[0]) {
    case "/provider":
    case "/model":
    case "/models":
    case "/models-add":
    case "/model-subagent":
    case "/models-subagent":
      await handleProviders(parts, ctx);
      break;
    case "/prompt":
    case "/theme":
    case "/regen-prompts":
    case "/regen-themes":
      await handleContent(parts, ctx);
      break;
    case "/reasoning":
    case "/thinking":
    case "/mode":
    case "/toggle":
    case "/mcp":
    case "/editsys":
    case "/advisor":
      await handleSettings(parts, ctx);
      break;
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
    case "/export":
    case "/import":
    case "/share":
      await handleSession(parts, ctx);
      break;
    case "/help":
      handleHelp(parts, ctx);
      break;
    case "/welcome":
    case "/tutorial":
      handleWelcome(ctx.renderer, !(ctx.cli.disableLazygit ?? false), ctx.showWelcome);
      break;
    case "/tutor":
      handleTutor(
        ctx.renderer,
        resolveMouseCapture(ctx.cfg),
        ctx.showGetStarted,
        ctx.suspendTui,
      );
      break;
    case "/add":
    case "/drop":
    case "/drop-all":
      await handleAdd(parts, ctx);
      break;
    case "/init":
      await handleInit(parts, ctx);
      break;
    case "/review":
      await handleReview(parts, ctx);
      break;
    case "/memory":
      await handleMemory(parts, ctx);
      break;
    case "/compress":
    case "/compact":
    case "/loop":
    case "/worktree":
    case "/wt-merge":
    case "/wt-exit":
      await handleFeatures(parts, ctx);
      break;
    case "/hooks":
      await handleHooks(parts, ctx);
      break;
    case "/docs":
      await handleDocs(parts, ctx);
      break;
    default:
      writeError(ctx.renderer, `unknown command: ${parts[0]} (try /help)`);
      break;
  }
}
