export const MessageRole = {
  User: "user",
  Assistant: "assistant",
  System: "system",
  ToolCall: "tool_call",
  ToolResult: "tool_result",
  SubagentToolCall: "subagent_tool_call",
} as const;

export type MessageRole = (typeof MessageRole)[keyof typeof MessageRole];

export type ToolRecord =
  | { kind: "call"; id: number; name: string; args: unknown }
  | {
      kind: "result";
      callId: number;
      name: string;
      truncated: boolean;
      fullOutputPath: string | null;
    }
  | { kind: "subagent_call"; parentCallId: number; name: string; args: unknown };

export interface SessionMessage {
  role: MessageRole;
  content: string;
  estimatedTokens: number;
  tool?: ToolRecord;
}

export interface Compaction {
  summary: string;
  firstKeptIndex: number;
  summarizedCount: number;
  tokenSavings: number;
  createdAt: string;
}

export interface PermissionAllowEntry {
  tool: string;
  pattern: string;
}

export const PromptSource = {
  BuiltIn: "built_in",
  UserFile: "user_file",
} as const;

export type PromptSource = (typeof PromptSource)[keyof typeof PromptSource];

export interface PromptRef {
  name: string;
  source: PromptSource;
}

export interface GitStatus {
  staged: number;
  modified: number;
  deleted: number;
  untracked: number;
  ahead: number;
  behind: number;
}

export function gitStatusIsDirty(g: GitStatus): boolean {
  return g.staged + g.modified + g.deleted + g.untracked > 0;
}

export interface Session {
  id: string;
  name: string;
  messages: SessionMessage[];
  compactions: Compaction[];
  createdAt: string;
  updatedAt: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedInputTokens: number;
  totalCacheCreationInputTokens: number;
  totalCost: number;
  totalEstimatedTokens: number;
  calibratedTokens: number;
  calibratedMsgCount: number;
  inputTokenCost: number;
  outputTokenCost: number;
  contextWindow: number;
  model: string;
  provider: string;
  workingDir: string;
  permissionAllowlist: PermissionAllowEntry[];
  nextToolCallId: number;
  prompt: PromptRef | null;
  showCostAlways: boolean;
  gitBranch: string | null;
  gitStatus: GitStatus | null;
  reasoningEnabled: boolean;
  overheadTokens: number;
  addMessage(role: MessageRole, content: string): void;
  addToolCall(name: string, args: unknown): number;
  addToolResult(callId: number, name: string, output: string): string;
  addSubagentToolCall(parentCallId: number | null, name: string, args: unknown): void;
  truncateTo(newLen: number): void;
  rewindTo(newLen: number): number;
  ctxIsEstimated(): boolean;
  effectiveContextTokens(): number;
  needsCompaction(reserveTokens: number): boolean;
  setCalibration(inputTokens: number, outputTokens: number): void;
  refreshGitBranch(): void;
  refreshGitStatus(): void;
  refreshGitBranchAsync(): Promise<void>;
  refreshGitStatusAsync(): Promise<void>;
}

export function realInputTokens(
  anthropicNative: boolean,
  inputTokens: number,
  cachedInputTokens: number,
  cacheCreationInputTokens: number,
): number {
  if (anthropicNative) {
    return inputTokens + cachedInputTokens + cacheCreationInputTokens;
  }
  return inputTokens;
}

export type ShowToolDetails = { kind: "bool"; value: boolean } | { kind: "lines"; value: number };

export type ResolvedShowToolDetails =
  | { kind: "off" }
  | { kind: "limited"; maxLines: number }
  | { kind: "unlimited" };

export function resolveShowToolDetails(show: ShowToolDetails | undefined): ResolvedShowToolDetails {
  if (show === undefined) return { kind: "limited", maxLines: 3 };
  if (show.kind === "bool") return show.value ? { kind: "unlimited" } : { kind: "off" };
  return { kind: "limited", maxLines: show.value };
}

export interface ColorsConfig {
  chatBackground?: string;
  inputBackground?: string;
  statusBackground?: string;
  schemeType?: "ansi" | "truecolor" | string;
  roles?: Record<string, string>;
}

export type StatusLineIconSpec = { kind: "auto"; value: boolean } | { kind: "custom"; value: string };

export interface StatusLineSegment {
  item: string;
  color?: string;
  bg?: string;
  text?: string;
  left?: string;
  right?: string;
  icon?: StatusLineIconSpec;
  always?: boolean;
}

export interface StatusLineConfigLike {
  lines: { segments: StatusLineSegment[] }[];
}

export interface ChainConfig {
  [key: string]: unknown;
}

export interface Config {
  model?: string;
  provider?: string;
  temperature?: number;
  extraBody?: unknown;
  retry?: unknown;
  showToolDetails?: ShowToolDetails;
  statusline?: StatusLineConfigLike;
  colors?: ColorsConfig;
  chain?: ChainConfig;
  editor?: string;
  compactEnabled?: boolean;
  midTurnCompactThreshold?: number;
  alwaysShowWelcome?: boolean;
  showReasoning?: boolean;
  showCostAlways?: boolean;
  mouseCapture?: boolean;
  chatLeftMargin?: number;
  reserveTokens?: number;
  keepRecentTokens?: number;
  quickModels?: Record<string, QuickModelConfig>;
  customProviders?: Record<string, unknown>;
  mcpServers?: Record<string, unknown>;
  promptToModel?: Record<string, string>;
  isAnthropicNative?(provider: string, modelId: string): boolean;
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

export function configIsAnthropicNative(cfg: Config, provider: string, modelId: string): boolean {
  if (cfg.isAnthropicNative !== undefined) return cfg.isAnthropicNative(provider, modelId);
  return provider === "anthropic" && !modelId.includes("/");
}

export function resolveMouseCapture(cfg: Config): boolean {
  return cfg.mouseCapture ?? false;
}

export function resolveChatLeftMargin(cfg: Config): number {
  return cfg.chatLeftMargin ?? 0;
}

export function resolveShowCostAlways(cfg: Config): boolean {
  return cfg.showCostAlways ?? false;
}

export function resolveShowReasoning(cfg: Config): boolean {
  return cfg.showReasoning ?? false;
}

export function resolveAlwaysShowWelcome(cfg: Config): boolean {
  return cfg.alwaysShowWelcome ?? false;
}

export function resolveCompactEnabled(cfg: Config): boolean {
  return cfg.compactEnabled ?? true;
}

export function resolveMidTurnCompactThreshold(cfg: Config): number | null {
  return cfg.midTurnCompactThreshold ?? null;
}

export function resolveReserveTokens(cfg: Config, modelId: string): number {
  const quick = cfg.quickModels?.[modelId];
  if (quick?.reserveTokens !== undefined) return quick.reserveTokens;
  return cfg.reserveTokens ?? 0;
}

export function resolveKeepRecentTokens(cfg: Config): number {
  return cfg.keepRecentTokens ?? 0;
}

export function quickModelsMap(cfg: Config): Map<string, QuickModelConfig> {
  return new Map(Object.entries(cfg.quickModels ?? {}));
}

export interface Cli {
  noSession: boolean;
  noColor: boolean;
  disableLazygit: boolean;
  print?: boolean;
  provider?: string;
  model?: string;
  quickModel?: string;
  parallel?: boolean;
  worktree?: string;
  name?: string;
  temperature?: number;
  resolveModel?(cfg: Config): string;
  resolveProvider?(cfg: Config): string;
  resolveWtBaseDir?(cfg: Config): string | null;
  resolveWtForce?(cfg: Config): boolean;
  resolveWtAutoMerge?(cfg: Config): boolean;
}

export function resolveModel(cli: Cli, cfg: Config): string {
  if (cli.resolveModel !== undefined) return cli.resolveModel(cfg);
  if (cli.model !== undefined) return cli.model;
  if (cli.quickModel !== undefined) {
    const quick = cfg.quickModels?.[cli.quickModel];
    if (quick !== undefined) return quick.model;
  }
  if (cfg.model !== undefined) return cfg.model;
  return "";
}

export function resolveTemperature(cli: Cli, cfg: Config, modelId: string): number | null {
  if (cli.temperature !== undefined) return cli.temperature;
  const quick = cfg.quickModels?.[modelId];
  if (quick?.temperature !== undefined) return quick.temperature;
  return cfg.temperature ?? null;
}

export function resolveExtraBody(cfg: Config, modelId: string): unknown {
  const quick = cfg.quickModels?.[modelId];
  if (quick?.extraBody !== undefined) return quick.extraBody;
  return cfg.extraBody ?? null;
}

export interface ContextFiles {
  agents?: string;
  architecture?: string;
  prompts: Map<string, string>;
  currentPrompt?: string;
  currentPromptName?: string;
  extraPromptsDirs: string[];
  themes: Map<string, string>;
  currentThemeName?: string;
  chainDeclined: string[];
  oneShotRestore?: string;
  
  promptSource?: (name: string) => PromptSource;
  memory?: string;
  reload(): void;
}

export const SecurityMode = {
  Standard: "standard",
  Restrictive: "restrictive",
  ReadOnly: "readonly",
  PlanWrite: "planwrite",
  Guarded: "guarded",
  Yolo: "yolo",
} as const;

export type SecurityMode = (typeof SecurityMode)[keyof typeof SecurityMode];

export function securityModeFromString(s: string): SecurityMode | null {
  switch (s) {
    case "standard":
      return SecurityMode.Standard;
    case "restrictive":
      return SecurityMode.Restrictive;
    case "readonly":
      return SecurityMode.ReadOnly;
    case "planwrite":
      return SecurityMode.PlanWrite;
    case "guarded":
      return SecurityMode.Guarded;
    case "yolo":
      return SecurityMode.Yolo;
    default:
      return null;
  }
}

export function securityModeToString(mode: SecurityMode): string {
  return mode;
}

export interface PermCheck {
  mode(): SecurityMode;
  modeString(): string;
  restoreUserMode(): void;
  setPromptMode(mode: SecurityMode): void;
}

export type UserDecision =
  | { kind: "allow_once" }
  | { kind: "allow_always"; pattern: string }
  | { kind: "deny" };

export interface AskRequest {
  tool: string;
  input: string;
  reply: { send(decision: UserDecision): void };
}

export interface Sandbox {
  killActive(): void;
}

export const BlockedReason = {
  Permission: "permission",
} as const;

export type BlockedReason = (typeof BlockedReason)[keyof typeof BlockedReason];

export interface BlockedScope {
  dispose(): void;
}

export interface StatusSignals {
  sendStart(): void;
  sendStop(): void;
  sendGitConflict(): void;
  blockedScope(reason: BlockedReason): BlockedScope;
}

export class EventQueue<T> {
  private items: T[] = [];
  private waiters: ((value: T | null) => void)[] = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter !== undefined) waiter(item);
    else this.items.push(item);
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter(null);
  }

  isClosed(): boolean {
    return this.closed;
  }

  tryNext(): T | null {
    const item = this.items.shift();
    return item === undefined ? null : item;
  }

  next(): Promise<T | null> {
    const item = this.items.shift();
    if (item !== undefined) return Promise.resolve(item);
    if (this.closed) return Promise.resolve(null);
    return new Promise<T | null>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private shared: Promise<T | null> | null = null;

  nextShared(): Promise<T | null> {
    if (this.shared === null) {
      this.shared = this.next().then((value) => {
        this.shared = null;
        return value;
      });
    }
    return this.shared;
  }

  get length(): number {
    return this.items.length;
  }
}

export type AgentEvent =
  | { type: "token"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; callId: string; name: string; args: unknown }
  | { type: "tool_result"; callId: string; name: string; output: string }
  | { type: "subagent_tool_call"; name: string; args: unknown }
  | { type: "error"; message: string }
  | { type: "retrying"; attempt: number; max: number }
  | {
      type: "completion_call";
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens: number;
      cacheCreationInputTokens: number;
    }
  | {
      type: "done";
      response: string;
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens: number;
      cacheCreationInputTokens: number;
    };

export type BtwEvent =
  | {
      type: "done";
      id: number;
      response: string;
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens: number;
      cacheCreationInputTokens: number;
    }
  | { type: "error"; id: number; message: string };

export interface KeyEvent {
  code:
    | "char"
    | "enter"
    | "esc"
    | "backspace"
    | "tab"
    | "up"
    | "down"
    | "left"
    | "right"
    | "home"
    | "end"
    | "pageup"
    | "pagedown"
    | "delete"
    | "insert"
    | "f1"
    | "f2"
    | "f3"
    | "f4"
    | "f5"
    | "f6"
    | "f7"
    | "f8"
    | "f9"
    | "f10"
    | "f11"
    | "f12"
    | "unknown";
  ch?: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

export function makeKeyEvent(
  code: KeyEvent["code"],
  opts?: { ch?: string; ctrl?: boolean; alt?: boolean; shift?: boolean },
): KeyEvent {
  return {
    code,
    ch: opts?.ch,
    ctrl: opts?.ctrl ?? false,
    alt: opts?.alt ?? false,
    shift: opts?.shift ?? false,
  };
}

export type UserEvent =
  | { type: "key"; key: KeyEvent }
  | { type: "scroll_up" }
  | { type: "scroll_down" }
  | { type: "mouse_down"; row: number; col: number }
  | { type: "mouse_drag"; row: number; col: number }
  | { type: "mouse_up"; row: number; col: number }
  | { type: "resize" }
  | { type: "paste"; data: string }
  | { type: "focus_gained" }
  | { type: "focus_lost" }
  | { type: "mcp_login_done"; server: string; error?: string };

export interface ModelInfo {
  id: string;
}

export interface AgentBuild {
  cli: Cli;
  cfg: Config;
  context: ContextFiles;
  permission: PermCheck | null;
  askTx: ((req: AskRequest) => void) | null;
  sandbox: Sandbox;
  reasoningEnabled: boolean;
  temperature: number | null;
  extraBody: unknown;
  mcpManager?: unknown;
}

export interface RunnerHandle {
  events: EventQueue<AgentEvent>;
  abortHandle: { abort(): void };
}

export interface AnyAgent {
  spawnRunner(
    prompt: string,
    history: unknown[],
    retry: unknown,
    hooks?: unknown,
  ): Promise<RunnerHandle>;
  spawnBtw?(
    prompt: string,
    snapshot: unknown,
    btwTx: EventQueue<BtwEvent>,
    id: number,
    retry: unknown,
  ): Promise<RunnerHandle>;
}

export interface AnyClient {
  completionModel(modelId: string): ModelInfo;
  buildAgent(model: ModelInfo, build: AgentBuild): Promise<AnyAgent>;
}

export class UiContext {
  cli: Cli;
  cfg: Config;
  session: Session;
  context: ContextFiles;
  client: AnyClient;
  permission: PermCheck | null;
  askTx: ((req: AskRequest) => void) | null;
  sandbox: Sandbox;
  statusSignals: StatusSignals | null;
  mcpManager: unknown | null;
  
  saveSession: ((session: Session) => Promise<void>) | null;
  
  handleCompress: (
    instructions: string | null,
    auto: boolean,
    agent: AnyAgent | null,
    reasoningEnabled: boolean,
  ) => Promise<void>;
  
  convertHistory: (session: Session) => unknown[];

  constructor(opts: {
    cli: Cli;
    cfg: Config;
    session: Session;
    context: ContextFiles;
    client: AnyClient;
    permission?: PermCheck | null;
    askTx?: ((req: AskRequest) => void) | null;
    sandbox: Sandbox;
    statusSignals?: StatusSignals | null;
    mcpManager?: unknown | null;
    saveSession?: ((session: Session) => Promise<void>) | null;
    handleCompress?: UiContext["handleCompress"];
    convertHistory?: (session: Session) => unknown[];
  }) {
    this.cli = opts.cli;
    this.cfg = opts.cfg;
    this.session = opts.session;
    this.context = opts.context;
    this.client = opts.client;
    this.permission = opts.permission ?? null;
    this.askTx = opts.askTx ?? null;
    this.sandbox = opts.sandbox;
    this.statusSignals = opts.statusSignals ?? null;
    this.mcpManager = opts.mcpManager ?? null;
    this.saveSession = opts.saveSession ?? null;
    this.handleCompress =
      opts.handleCompress ??
      (async () => {

      });
    this.convertHistory =
      opts.convertHistory ??
      ((session: Session) =>
        session.messages.map((m) => ({ role: m.role, content: m.content })));
  }

  agentBuildCtx(): AgentBuildCtx {
    return new AgentBuildCtx({
      cli: this.cli,
      cfg: this.cfg,
      context: this.context,
      client: this.client,
      permission: this.permission,
      askTx: this.askTx,
      sandbox: this.sandbox,
      mcpManager: this.mcpManager,
    });
  }

  async saveSessionIfEnabled(): Promise<void> {
    if (!this.cli.noSession && this.saveSession !== null) {
      await this.saveSession(this.session);
    }
  }
}

export class AgentBuildCtx {
  cli: Cli;
  cfg: Config;
  context: ContextFiles;
  client: AnyClient;
  permission: PermCheck | null;
  askTx: ((req: AskRequest) => void) | null;
  sandbox: Sandbox;
  mcpManager: unknown | null;

  constructor(opts: {
    cli: Cli;
    cfg: Config;
    context: ContextFiles;
    client: AnyClient;
    permission: PermCheck | null;
    askTx: ((req: AskRequest) => void) | null;
    sandbox: Sandbox;
    mcpManager?: unknown | null;
  }) {
    this.cli = opts.cli;
    this.cfg = opts.cfg;
    this.context = opts.context;
    this.client = opts.client;
    this.permission = opts.permission;
    this.askTx = opts.askTx;
    this.sandbox = opts.sandbox;
    this.mcpManager = opts.mcpManager ?? null;
  }

  async rebuildAgent(modelId: string, reasoningEnabled: boolean): Promise<AnyAgent> {
    const model = this.client.completionModel(modelId);
    const temperature = resolveTemperature(this.cli, this.cfg, modelId);
    const extraBody = resolveExtraBody(this.cfg, modelId);
    return this.client.buildAgent(model, {
      cli: this.cli,
      cfg: this.cfg,
      context: this.context,
      permission: this.permission,
      askTx: this.askTx,
      sandbox: this.sandbox,
      reasoningEnabled,
      temperature,
      extraBody,
      mcpManager: this.mcpManager ?? undefined,
    });
  }
}

export class AgentRunState {
  agent: AnyAgent | null = null;
  isRunning = false;
  agentRx: EventQueue<AgentEvent> | null = null;
  mainAbort: { abort(): void } | null = null;
  pendingInputs: string[] = [];
  agentLineStarted = false;
  responseBuf = "";
  responseStartBlock: number | null = null;
  pendingSend: string | null = null;
  wasReasoning = false;
  turnTrace: string[] = [];
  awaitingCompactionRelief = false;
  
  pendingToolCalls: [string, number][] = [];

  pushPendingToolCall(id: string, sessionCallId: number): void {
    const pos = this.pendingToolCalls.findIndex(([k]) => k === id);
    if (pos >= 0) this.pendingToolCalls.splice(pos, 1);
    this.pendingToolCalls.push([id, sessionCallId]);
  }

  takePendingToolCall(id: string): number | null {
    const pos = this.pendingToolCalls.findIndex(([k]) => k === id);
    if (pos < 0) return null;
    const [, callId] = this.pendingToolCalls.splice(pos, 1)[0];
    return callId;
  }

  newestPendingToolCall(): number | null {
    const last = this.pendingToolCalls[this.pendingToolCalls.length - 1];
    return last === undefined ? null : last[1];
  }

  clearPendingToolCalls(): void {
    this.pendingToolCalls = [];
  }
}

export class ChainState {
  pending: ChainPhase | null = null;
  labelMsg: string | null = null;
  dotPromptRestore: string | null = null;
  loopLabel: string | null = null;
  loopState: LoopState | null = null;
  wtReturnPath: WtReturn | null = null;
}

export interface ChainPhase {
  nextPromptName(): string;
  transitionMessage(): string;
  chainLabel(): string;
  isEnabled(chainCfg: ChainConfig | undefined): boolean;
}

export type ChainPhaseFromPrompt = (name: string) => ChainPhase | null;

export interface LoopState {
  active: boolean;
  iteration: number;
  runCmd?: string;
  lastSummary?: string;
  lastRunOutput?: string;
  shouldStop(): boolean;
  buildPrompt(): string;
  iterationLabel(): string;
}

export interface WtReturn {
  mainPath: string;
  wtPath: string;
  branch: string;
  target: string;
  force: boolean;
}

export interface MergeRequest {
  branch: string;
  target: string;
  mainPath: string;
  wtPath: string;
  force: boolean;
}

export class SlashState {
  showReasoning: boolean;
  reasoningEnabled: boolean;
  todoToolsEnabled: boolean;

  constructor(opts?: {
    showReasoning?: boolean;
    reasoningEnabled?: boolean;
    todoToolsEnabled?: boolean;
  }) {
    this.showReasoning = opts?.showReasoning ?? false;
    this.reasoningEnabled = opts?.reasoningEnabled ?? true;
    this.todoToolsEnabled = opts?.todoToolsEnabled ?? false;
  }
}

export class TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;

  constructor(opts?: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    cacheCreationInputTokens?: number;
  }) {
    this.inputTokens = opts?.inputTokens ?? 0;
    this.outputTokens = opts?.outputTokens ?? 0;
    this.cachedInputTokens = opts?.cachedInputTokens ?? 0;
    this.cacheCreationInputTokens = opts?.cacheCreationInputTokens ?? 0;
  }
}

export class BtwStats {
  cost: number;
  input: number;
  output: number;

  constructor(opts?: { cost?: number; input?: number; output?: number }) {
    this.cost = opts?.cost ?? 0;
    this.input = opts?.input ?? 0;
    this.output = opts?.output ?? 0;
  }
}

export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  inputTokenCost: number,
  outputTokenCost: number,
): number {
  return (
    (inputTokens * inputTokenCost) / 1_000_000 + (outputTokens * outputTokenCost) / 1_000_000
  );
}

const ANTHROPIC_CACHE_WRITE_MULT = 1.25;
const ANTHROPIC_CACHE_READ_MULT = 0.1;

export function billableInputTokens(
  anthropicNative: boolean,
  inputTokens: number,
  cachedInputTokens: number,
  cacheCreationInputTokens: number,
): number {
  if (anthropicNative) {
    return Math.round(
      inputTokens +
        cacheCreationInputTokens * ANTHROPIC_CACHE_WRITE_MULT +
        cachedInputTokens * ANTHROPIC_CACHE_READ_MULT,
    );
  }
  return inputTokens;
}
