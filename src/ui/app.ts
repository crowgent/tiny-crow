import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  ensureAgent,
  estimateOverhead,
  handleAgentEvent as handleAgentEventInner,
} from "./event_handler.ts";
import { renderSession, sanitizeOutput, showWelcome } from "./events.ts";
import { handlePermissionRequest } from "./permission_handler.ts";
import {
  initStatusline,
  lineCount,
  needsGitStatus,
} from "./statusline.ts";
import { BlockStyle } from "./feed.ts";
import {
  copyToClipboard,
  openUrl,
  Renderer,
  StringBackend,
  type RenderBackend,
} from "./renderer.ts";
import { C_AGENT, C_BTW, C_ERROR, C_TOOL } from "./roles.ts";
import {
  AgentRunState,
  BtwStats,
  ChainState,
  EventQueue,
  SlashState,
  UiContext,
  quickModelsMap,
  resolveAlwaysShowWelcome,
  resolveChatLeftMargin,
  resolveMouseCapture,
  resolveShowCostAlways,
  resolveShowReasoning,
  type AgentEvent,
  type AnyAgent,
  type AskRequest,
  type BtwEvent,
  type ChainPhaseFromPrompt,
  type KeyEvent,
  type UserEvent,
} from "./state.ts";
import { parseEditorCommand, suspendTui, TerminalGuard } from "./terminal.ts";
import {
  applyPromptMode,
  classifySubmission,
  parsePromptMode,
  midTurnCompactAndRespawn,
  refreshDisplay,
  spawnEventThread,
  startMainRun as startMainRunFromMod,
  stopTurnContextExhausted,
} from "./mod.ts";
import { formatToolCallSummary } from "./utils.ts";

export interface PickerLike {
  active(): boolean;
  draw(): void;
}

export interface InputEditorLike {
  buffer: string;
  cursor: number;
  picker: PickerLike | null;
  setCursor(pos: number): void;
  clearBuffer(): void;
  loadText(text: string): void;
  handleKey(key: KeyEvent): string | null;
  handlePaste(data: string): void;
  handlePickerKey(key: KeyEvent): boolean;
  takeRewindOutcome(): { kind: "confirmed"; idx: number } | null;
  takeSwitcheroOutcome():
    | { kind: "model"; name: string }
    | { kind: "prompt"; name: string }
    | { kind: "cancelled" }
    | null;
  switcherKind(): string | null;
  setMonochrome(v: boolean): void;
  setMouseCapture(v: boolean): void;
  setPromptNames(names: string[]): void;
  setThemeNames(names: string[]): void;
  setEditor(editor: string): void;
  setQuickModelNames(names: string[]): void;
  setProviderNames(names: string[]): void;
  setLiveModelNames(names: string[]): void;
  loadGlobalHistory(): void;
  startDotPicker(): void;
  startModelSwitcher(
    quick: string[],
    live: string[],
    details: Map<string, string>,
    currentQuick: string | null,
    currentModel: string,
  ): void;
  startPromptSwitcher(
    items: string[],
    details: Map<string, string>,
    current: string | null,
  ): void;
  openInEditor(): void;
}

type SwitcherOutcome =
  | { kind: "model"; name: string }
  | { kind: "prompt"; name: string }
  | { kind: "cancelled" };

class ListPicker implements PickerLike {
  private items: string[];
  private selected = 0;
  private kind: "model" | "prompt" | "dot";
  private editor: SimpleInputEditor;
  private done = false;

  constructor(
    kind: "model" | "prompt" | "dot",
    items: string[],
    editor: SimpleInputEditor,
    current: string | null,
  ) {
    this.kind = kind;
    this.items = items;
    this.editor = editor;
    if (current !== null) {
      const idx = items.indexOf(current);
      if (idx >= 0) this.selected = idx;
    }
  }

  active(): boolean {
    return !this.done;
  }

  draw(): void {
    const lines = this.items.map((item, i) =>
      i === this.selected ? `> ${item}` : `  ${item}`,
    );
    try {
      process.stdout.write(`\n${lines.join("\n")}\n`);
    } catch {

    }
  }

  handleKey(key: KeyEvent): boolean {
    if (key.code === "up" || (key.code === "char" && key.ch === "k" && !key.ctrl)) {
      this.selected = Math.max(0, this.selected - 1);
      return true;
    }
    if (key.code === "down" || (key.code === "char" && key.ch === "j" && !key.ctrl)) {
      this.selected = Math.min(this.items.length - 1, this.selected + 1);
      return true;
    }
    if (key.code === "esc") {
      this.done = true;
      if (this.kind !== "dot") {
        this.editor.pushSwitcherOutcome({ kind: "cancelled" });
      }
      return true;
    }
    if (key.code === "enter") {
      this.done = true;
      const picked = this.items[this.selected];
      if (picked !== undefined) {
        if (this.kind === "model") this.editor.pushSwitcherOutcome({ kind: "model", name: picked });
        else if (this.kind === "prompt") {
          this.editor.pushSwitcherOutcome({ kind: "prompt", name: picked });
        } else {
          this.editor.loadText(`.${picked}`);
        }
      }
      return true;
    }
    return false;
  }
}

export class SimpleInputEditor implements InputEditorLike {
  buffer = "";
  cursor = 0;
  picker: PickerLike | null = null;
  private activeSwitcher: "model" | "prompt" | null = null;
  private history: string[] = [];
  private historyIdx: number | null = null;
  private switcherOutcomes: SwitcherOutcome[] = [];
  private editorCmd: string | null = null;
  private promptNames: string[] = [];

  setCursor(pos: number): void {
    const len = [...this.buffer].length;
    this.cursor = Math.max(0, Math.min(pos, len));
  }

  clearBuffer(): void {
    this.buffer = "";
    this.cursor = 0;
  }

  loadText(text: string): void {
    this.buffer = text;
    this.cursor = [...text].length;
  }

  handlePaste(data: string): void {
    this.insert(data);
  }

  private insert(text: string): void {
    const chars = [...this.buffer];
    const insertChars = [...text];
    chars.splice(this.cursor, 0, ...insertChars);
    this.buffer = chars.join("");
    this.cursor += insertChars.length;
  }

  handleKey(key: KeyEvent): string | null {
    if (key.code === "enter") {
      const text = this.buffer;
      if (text !== "") this.history.push(text);
      this.historyIdx = null;
      this.clearBuffer();
      return text;
    }
    if (key.code === "char" && key.ch !== undefined && !key.ctrl && !key.alt) {
      this.insert(key.ch);
      return null;
    }
    if (key.code === "backspace") {
      const chars = [...this.buffer];
      if (this.cursor > 0) {
        chars.splice(this.cursor - 1, 1);
        this.buffer = chars.join("");
        this.cursor -= 1;
      }
      return null;
    }
    if (key.code === "delete") {
      const chars = [...this.buffer];
      if (this.cursor < chars.length) {
        chars.splice(this.cursor, 1);
        this.buffer = chars.join("");
      }
      return null;
    }
    if (key.code === "left") {
      this.cursor = Math.max(0, this.cursor - 1);
      return null;
    }
    if (key.code === "right") {
      this.cursor = Math.min([...this.buffer].length, this.cursor + 1);
      return null;
    }
    if (key.code === "home" || (key.code === "char" && key.ch === "a" && key.ctrl)) {
      this.cursor = 0;
      return null;
    }
    if (key.code === "end" || (key.code === "char" && key.ch === "e" && key.ctrl)) {
      this.cursor = [...this.buffer].length;
      return null;
    }
    if (key.code === "char" && key.ch === "u" && key.ctrl) {
      this.clearBuffer();
      return null;
    }
    if (key.code === "char" && key.ch === "k" && key.ctrl) {
      const chars = [...this.buffer];
      this.buffer = chars.slice(0, this.cursor).join("");
      return null;
    }
    if (key.code === "char" && key.ch === "w" && key.ctrl) {
      const chars = [...this.buffer];
      let end = this.cursor;
      while (end > 0 && chars[end - 1] === " ") end -= 1;
      while (end > 0 && chars[end - 1] !== " ") end -= 1;
      chars.splice(end, this.cursor - end);
      this.buffer = chars.join("");
      this.cursor = end;
      return null;
    }
    if (key.code === "up") {
      if (this.history.length > 0) {
        if (this.historyIdx === null) this.historyIdx = this.history.length - 1;
        else this.historyIdx = Math.max(0, this.historyIdx - 1);
        this.loadText(this.history[this.historyIdx]);
      }
      return null;
    }
    if (key.code === "down") {
      if (this.historyIdx !== null) {
        if (this.historyIdx >= this.history.length - 1) {
          this.historyIdx = null;
          this.clearBuffer();
        } else {
          this.historyIdx += 1;
          this.loadText(this.history[this.historyIdx]);
        }
      }
      return null;
    }
    return null;
  }

  handlePickerKey(key: KeyEvent): boolean {
    if (this.picker !== null && this.picker.active()) {
      const handled = (this.picker as ListPicker).handleKey(key);
      if (!this.picker.active()) {
        this.picker = null;
        this.activeSwitcher = null;
      }
      return handled;
    }
    return false;
  }

  takeRewindOutcome(): { kind: "confirmed"; idx: number } | null {

    return null;
  }

  takeSwitcheroOutcome(): SwitcherOutcome | null {
    return this.switcherOutcomes.shift() ?? null;
  }

  pushSwitcherOutcome(outcome: SwitcherOutcome): void {
    this.switcherOutcomes.push(outcome);
  }

  switcherKind(): string | null {
    if (this.picker === null || !this.picker.active()) return null;
    return this.activeSwitcher;
  }

  setMonochrome(_v: boolean): void {}
  setMouseCapture(_v: boolean): void {}
  setPromptNames(names: string[]): void {
    this.promptNames = names;
  }
  setThemeNames(_names: string[]): void {}
  setEditor(editor: string): void {
    this.editorCmd = editor;
  }
  setQuickModelNames(_names: string[]): void {}
  setProviderNames(_names: string[]): void {}
  setLiveModelNames(_names: string[]): void {}
  loadGlobalHistory(): void {}

  startDotPicker(): void {
    this.picker = new ListPicker("dot", this.promptNames, this, null);
    this.activeSwitcher = null;
  }

  startModelSwitcher(
    quick: string[],
    live: string[],
    _details: Map<string, string>,
    currentQuick: string | null,
    _currentModel: string,
  ): void {
    const items = [...new Set([...quick, ...live])];
    this.picker = new ListPicker("model", items, this, currentQuick);
    this.activeSwitcher = "model";
  }

  startPromptSwitcher(
    items: string[],
    _details: Map<string, string>,
    current: string | null,
  ): void {
    this.picker = new ListPicker("prompt", items, this, current);
    this.activeSwitcher = "prompt";
  }

  openInEditor(): void {
    const editor = this.editorCmd ?? process.env["EDITOR"] ?? "vi";
    const tmpFile = join(
      process.env["TMPDIR"] ?? "/tmp",
      `tiny-crow-input-${process.pid}.txt`,
    );
    try {
      writeFileSync(tmpFile, this.buffer);
    } catch {
      return;
    }
    const [prog, args] = parseEditorCommand(editor);
    const mouseCapture = false;
    suspendTui(mouseCapture, () => {
      try {
        spawnSync(prog, [...args, tmpFile], { stdio: "inherit" });
      } catch {

      }
    });
    try {
      this.loadText(readFileSync(tmpFile, "utf8"));
    } catch {

    }
  }
}

export type SlashOutcome =
  | { kind: "defer_compress"; instructions?: string }
  | { kind: "defer_init" }
  | { kind: "defer_review"; message: string }
  | { kind: "defer_editor"; path: string };

export type SlashResult =
  | { ok: true }
  | { ok: false; error: string; outcome?: SlashOutcome };

export interface SlashHandlerCtx {
  renderer: Renderer;
  input: InputEditorLike;
  run: AgentRunState;
  ui: UiContext;
  slash: SlashState;
  chain: ChainState;
}

export type SlashHandler = (text: string, ctx: SlashHandlerCtx) => Promise<SlashResult>;

export interface AppOptions {
  ui: UiContext;
  agent?: AnyAgent | null;
  askEvents?: EventQueue<AskRequest> | null;
  autoTriggerMsg?: string | null;
  headlessBackend?: RenderBackend | null;
  inputEditor?: InputEditorLike | null;
  slashHandler?: SlashHandler | null;
  chainPhaseFromPrompt?: ChainPhaseFromPrompt | null;
  applyPromptModel?: (
    promptName: string,
    ui: UiContext,
    agent: AnyAgent | null,
    reasoningEnabled: boolean,
    renderer: Renderer,
  ) => Promise<void>;
  warmModelCache?: (
    provider: string,
    isCustom: boolean,
    client: UiContext["client"],
    cli: UiContext["cli"],
    cfg: UiContext["cfg"],
  ) => Promise<string[]>;
  cachedModelIds?: (provider: string) => string[];
  dataDir?: string;
}

const TURN_TRACE_MAX = 64;

export const AGENTS_CREATION_PROMPT =
  "Create an AGENTS.md file in the current project that describes how to build, test, and work in this codebase, based on what you can see in the repository. Keep it concise and factual.";

const BUILTIN_PROVIDERS = [
  "anthropic",
  "openai",
  "gemini",
  "openrouter",
  "ollama",
  "opencode-zen",
  "opencode-go",
];

export class App {
  private ui: UiContext;
  private runState: AgentRunState;
  private chain: ChainState;
  private slash: SlashState;
  private renderer: Renderer;
  private input: InputEditorLike;
  private askEvents: EventQueue<AskRequest> | null;
  private btwEvents: EventQueue<BtwEvent> = new EventQueue<BtwEvent>();
  private btwAbort: [number, { abort(): void }][] = [];
  private btwInflight = 0;
  private btwNextId = 0;
  private btwTotalCost = 0;
  private btwTotalIn = 0;
  private btwTotalOut = 0;
  private userEvents: EventQueue<UserEvent> = new EventQueue<UserEvent>();
  private running = true;
  private eventThread: { stop(): void } | null = null;
  private prebuildPromise: Promise<AnyAgent | null> | null = null;
  private prebuildValue: AnyAgent | null = null;
  private prebuildDone = false;
  private terminalGuard: TerminalGuard | null = null;
  private lastGitRefresh: number | null = null;
  private slashHandler: SlashHandler;
  private chainPhaseFromPrompt: ChainPhaseFromPrompt | null;
  private applyPromptModelFn: AppOptions["applyPromptModel"];
  private warmModelCacheFn: AppOptions["warmModelCache"];
  private cachedModelIdsFn: AppOptions["cachedModelIds"];
  private dataDir: string;
  private headless: boolean;

  private constructor(
    ui: UiContext,
    runState: AgentRunState,
    chain: ChainState,
    slash: SlashState,
    renderer: Renderer,
    input: InputEditorLike,
    askEvents: EventQueue<AskRequest> | null,
    opts: AppOptions,
  ) {
    this.ui = ui;
    this.runState = runState;
    this.chain = chain;
    this.slash = slash;
    this.renderer = renderer;
    this.input = input;
    this.askEvents = askEvents;
    this.slashHandler =
      opts.slashHandler ??
      (async (text) => ({ ok: false, error: `unknown slash command: ${text}` }));
    this.chainPhaseFromPrompt = opts.chainPhaseFromPrompt ?? null;
    this.applyPromptModelFn = opts.applyPromptModel;
    this.warmModelCacheFn = opts.warmModelCache;
    this.cachedModelIdsFn = opts.cachedModelIds;
    this.dataDir =
      opts.dataDir ??
      join(process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share"), "tiny-crow");
    this.headless = opts.headlessBackend !== undefined && opts.headlessBackend !== null;
  }

  static async create(opts: AppOptions): Promise<App> {
    const ui = opts.ui;
    const headless = opts.headlessBackend !== undefined && opts.headlessBackend !== null;
    const terminalGuard = headless ? null : new TerminalGuard(resolveMouseCapture(ui.cfg));

    ui.session.showCostAlways = resolveShowCostAlways(ui.cfg);
    initStatusline(ui.cfg);

    try {
      ui.session.refreshGitBranch();
    } catch {

    }
    if (needsGitStatus()) {
      try {
        await ui.session.refreshGitStatusAsync();
      } catch {

      }
    }

    const renderer = headless
      ? Renderer.withBackend(opts.headlessBackend as RenderBackend)
      : Renderer.new();
    renderer.setStatuslineHeight(lineCount());
    renderer.setMonochrome(ui.cli.noColor);
    renderer.setChatMargin(resolveChatLeftMargin(ui.cfg));
    if (ui.context.currentThemeName !== undefined) {
      const content = ui.context.themes.get(ui.context.currentThemeName);
      if (content !== undefined) applyThemeContent(content, renderer);
    } else if (ui.cfg.colors !== undefined) {
      applyColorsConfig(ui.cfg.colors, renderer);
    }

    const input = opts.inputEditor ?? new SimpleInputEditor();
    input.setMonochrome(ui.cli.noColor);
    input.setMouseCapture(resolveMouseCapture(ui.cfg));
    input.setPromptNames([...ui.context.prompts.keys()]);
    input.setThemeNames([...ui.context.themes.keys()]);
    if (ui.cfg.editor !== undefined) input.setEditor(ui.cfg.editor);
    input.setQuickModelNames([...quickModelsMap(ui.cfg).keys()]);
    {
      const providers = [...BUILTIN_PROVIDERS];
      for (const key of Object.keys(ui.cfg.customProviders ?? {})) providers.push(key);
      input.setProviderNames(providers);
    }
    input.loadGlobalHistory();

    const runState = new AgentRunState();
    runState.agent = opts.agent ?? null;
    const chain = new ChainState();
    const slash = new SlashState({
      showReasoning: resolveShowReasoning(ui.cfg),
      reasoningEnabled: true,
      todoToolsEnabled: false,
    });
    ui.session.reasoningEnabled = slash.reasoningEnabled;
    ui.session.overheadTokens = estimateOverhead(ui, slash.reasoningEnabled);

    renderSession(renderer, ui.session, ui.cli, ui.cfg, ui.context);
    const dataDir =
      opts.dataDir ?? join(process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share"), "tiny-crow");
    const markerPath = join(dataDir, "shown_welcome_msg");
    if (resolveAlwaysShowWelcome(ui.cfg) || !existsSync(markerPath)) {
      showWelcome(renderer, !ui.cli.disableLazygit);
      if (!resolveAlwaysShowWelcome(ui.cfg)) {
        try {
          mkdirSync(dirname(markerPath), { recursive: true });
          writeFileSync(markerPath, "");
        } catch {

        }
      }
    }
    const app = new App(ui, runState, chain, slash, renderer, input, opts.askEvents ?? null, opts);
    app.terminalGuard = terminalGuard;
    app.refresh();
    app.lastGitRefresh = Date.now();

    {
      const provider = ui.session.provider;
      const isCustom = (ui.cfg.customProviders ?? {})[provider] !== undefined;
      let ids: string[] = [];
      if (!headless && opts.warmModelCache !== undefined) {
        try {
          ids = await opts.warmModelCache(provider, isCustom, ui.client, ui.cli, ui.cfg);
        } catch {
          ids = [];
        }
      } else if (opts.cachedModelIds !== undefined) {
        ids = opts.cachedModelIds(provider);
      }
      input.setLiveModelNames(ids);
    }

    if (opts.autoTriggerMsg !== undefined && opts.autoTriggerMsg !== null) {
      const triggerMsg = opts.autoTriggerMsg;
      for (const line of triggerMsg.split("\n")) {
        renderer.writeLine(`> ${sanitizeOutput(line)}`, "green");
      }
      renderer.writeLine("", "white");
      await ensureAgent(runState, ui, slash.reasoningEnabled);
      const history = ui.convertHistory(ui.session);
      if (runState.agent !== null) {
        const runner = await runState.agent.spawnRunner(triggerMsg, history, ui.cfg.retry);
        runState.agentRx = runner.events;
        runState.mainAbort = runner.abortHandle;
        runState.isRunning = true;
        ui.statusSignals?.sendStart();
      }
      ui.session.addMessage("user", triggerMsg);
    }

    if (!headless) {
      app.eventThread = spawnEventThread(app.userEvents, () => app.running);
    }

    if (
      (opts.autoTriggerMsg === undefined || opts.autoTriggerMsg === null) &&
      runState.agent === null
    ) {
      const sessionModel = ui.session.model;
      const reasoningEnabled = slash.reasoningEnabled;
      app.prebuildPromise = ui
        .agentBuildCtx()
        .rebuildAgent(sessionModel, reasoningEnabled)
        .then((agent) => {
          app.prebuildValue = agent;
          app.prebuildDone = true;
          return agent;
        })
        .catch(() => {
          app.prebuildDone = true;
          return null;
        });
    }

    return app;
  }

  static async createHeadless(
    opts: AppOptions & { backend: RenderBackend },
  ): Promise<App> {
    return App.create({ ...opts, headlessBackend: opts.backend });
  }

  async run(): Promise<void> {
    for (;;) {
      const flow = await this.step();
      if (flow === "break") break;
    }
    await this.handleWorktreeAutoMerge();
  }

  async step(): Promise<"continue" | "break"> {
    this.ui.session.reasoningEnabled = this.slash.reasoningEnabled;

    const sleep = (ms: number): Promise<null> =>
      new Promise((resolve) => setTimeout(() => resolve(null), ms));
    const never: Promise<null> = new Promise(() => {});

    const userQueued = this.userEvents.tryNext();
    if (userQueued !== null) {
      const flow = await this.handleUserEvent(userQueued);
      return flow;
    }
    const agentQueued =
      this.runState.agentRx !== null ? this.runState.agentRx.tryNext() : null;
    if (agentQueued !== null) {
      await this.handleAgentEvent(agentQueued);
      return "continue";
    }
    const askQueued = this.askEvents?.tryNext() ?? null;
    if (askQueued !== null) {
      await handlePermissionRequest(
        askQueued,
        this.renderer,
        this.ui,
        this.runState,
        this.userEvents,
      );
      this.refresh();
      return "continue";
    }
    const btwQueued = this.btwEvents.tryNext();
    if (btwQueued !== null) {
      this.handleBtwEvent(btwQueued);
      this.refresh();
      return "continue";
    }
    if (this.prebuildDone && this.runState.agent === null && this.prebuildValue !== null) {
      this.takePrebuild(this.prebuildValue, true);
      this.refresh();
      return "continue";
    }

    const timeoutMs = this.runState.isRunning ? 100 : 250;
    const raced = await Promise.race([
      this.userEvents.nextShared().then((ev) => ({ kind: "user" as const, ev })),
      this.runState.agentRx !== null
        ? this.runState.agentRx.nextShared().then((ev) => ({ kind: "agent" as const, ev }))
        : never.then(() => ({ kind: "agent" as const, ev: null })),
      this.askEvents !== null
        ? this.askEvents.nextShared().then((ev) => ({ kind: "ask" as const, ev }))
        : never.then(() => ({ kind: "ask" as const, ev: null })),
      this.btwEvents.nextShared().then((ev) => ({ kind: "btw" as const, ev })),
      sleep(timeoutMs).then(() => ({ kind: "tick" as const, ev: null })),
    ]);

    switch (raced.kind) {
      case "user":
        if (raced.ev !== null) return this.handleUserEvent(raced.ev);
        break;
      case "agent":
        if (raced.ev !== null) await this.handleAgentEvent(raced.ev);
        break;
      case "ask":
        if (raced.ev !== null) {
          await handlePermissionRequest(
            raced.ev,
            this.renderer,
            this.ui,
            this.runState,
            this.userEvents,
          );
          this.refresh();
        }
        break;
      case "btw":
        if (raced.ev !== null) {
          this.handleBtwEvent(raced.ev);
          this.refresh();
        }
        break;
      case "tick":
        if (this.runState.isRunning) {
          this.refresh();
        } else if (!this.running) {
          return "break";
        }
        break;
    }
    if (this.prebuildDone && this.runState.agent === null && this.prebuildValue !== null) {
      this.takePrebuild(this.prebuildValue, false);
    }
    return "continue";
  }

  inject(ev: UserEvent): void {
    this.userEvents.push(ev);
  }

  isRunning(): boolean {
    return this.runState.isRunning;
  }

  isScrolling(): boolean {
    return this.renderer.isScrolling();
  }

  lastBottomSnapshot(): ReturnType<Renderer["lastBottomSnapshot"]> {
    return this.renderer.lastBottomSnapshot();
  }

  feedText(): string {
    return this.renderer
      .feed()
      .lines(80)
      .map((l) => l.text)
      .join("\n");
  }

  inputBuffer(): string {
    return this.input.buffer;
  }

  backendOutput(): string {
    return this.renderer.capturedOutput();
  }

  session(): UiContext["session"] {
    return this.ui.session;
  }

  switcherKind(): string | null {
    return this.input.switcherKind();
  }

  async teardown(): Promise<void> {
    this.running = false;
    this.eventThread?.stop();
    this.terminalGuard?.dispose();
    this.terminalGuard = null;
  }

  private refresh(): void {
    refreshDisplay(
      this.renderer,
      this.input.buffer,
      this.input.cursor,
      this.input.picker,
      this.ui,
      this.runState,
      this.chain,
      new BtwStats({
        cost: this.btwTotalCost,
        input: this.btwTotalIn,
        output: this.btwTotalOut,
      }),
    );
  }

  private async refreshGitStateAsync(): Promise<void> {
    const now = Date.now();
    if (this.lastGitRefresh !== null && now - this.lastGitRefresh < 2000) return;
    this.lastGitRefresh = now;
    try {
      await this.ui.session.refreshGitBranchAsync();
    } catch {

    }
    if (needsGitStatus()) {
      try {
        await this.ui.session.refreshGitStatusAsync();
      } catch {

      }
    }
  }

  private async handleUserEvent(ev: UserEvent): Promise<"continue" | "break"> {
    switch (ev.type) {
      case "focus_gained":
        await this.refreshGitStateAsync();
        break;
      case "resize":
        this.renderer.resize();
        break;
      case "scroll_up":
        if (!this.renderer.inputScrollUp()) this.renderer.scrollLineUp();
        break;
      case "scroll_down":
        if (this.renderer.isScrolling()) this.renderer.scrollLineDown();
        else this.renderer.inputScrollDown();
        break;
      case "mouse_down": {
        const pos = this.renderer.inputCursorForClick(ev.row, ev.col, this.input.buffer);
        if (pos !== null) {
          this.input.setCursor(pos);
        } else if (
          ev.row < this.renderer.visibleLines() &&
          this.renderer.bufferLineAtRow(ev.row) !== null
        ) {
          const idx = this.renderer.bufferLineAtRow(ev.row) as number;
          const url = this.renderer.linkUrlAt(idx, ev.col);
          if (url !== null) {
            try {
              openUrl(url);
            } catch (e) {
              this.renderer.writeLine(
                `cannot open link: ${e instanceof Error ? e.message : String(e)}`,
                C_ERROR,
              );
            }
          } else {
            this.renderer.selectionActive = true;
            this.renderer.selectionStart = idx;
            this.renderer.selectionEnd = idx;
          }
        }
        break;
      }
      case "mouse_drag": {
        if (this.renderer.selectionActive) {
          const idx = this.renderer.bufferLineAtRow(ev.row);
          if (idx !== null) this.renderer.selectionEnd = idx;
        }
        break;
      }
      case "mouse_up": {
        if (this.renderer.selectionActive) {
          const idx = this.renderer.bufferLineAtRow(ev.row);
          if (idx !== null) this.renderer.selectionEnd = idx;
          const text = this.renderer.selectedText();
          if (text !== null) {
            try {
              copyToClipboard(text);
            } catch (e) {
              this.renderer.writeLine(
                `copy to clipboard failed: ${e instanceof Error ? e.message : String(e)}`,
                C_ERROR,
              );
            }
          }
          this.renderer.clearSelection();
        }
        break;
      }
      case "paste":
        this.input.handlePaste(ev.data);
        break;
      case "mcp_login_done":
        this.renderer.writeLine(
          ev.error !== undefined
            ? `login failed for '${ev.server}': ${ev.error}`
            : `authorized '${ev.server}' (will connect on next start)`,
          ev.error !== undefined ? C_ERROR : C_AGENT,
        );
        break;
      case "key": {
        const key = ev.key;
        const isCtrlC = key.code === "char" && key.ch === "c" && key.ctrl;
        const isCtrlD = key.code === "char" && key.ch === "d" && key.ctrl;
        if (isCtrlC || isCtrlD) {
          if (this.btwInflight > 0) {
            for (const [, h] of this.btwAbort) h.abort();
            this.btwAbort = [];
            this.btwInflight = 0;
            this.renderer.writeLine("btw cancelled", C_ERROR);
          } else if (this.runState.isRunning) {
            this.abortMainRun();
          } else {
            return "break";
          }
          this.refresh();
          return "continue";
        }
        try {
          await this.handleKeyEvent(key);
        } catch (e) {
          if (e instanceof Error && e.message === "Interrupted") return "break";
          throw e;
        }
        break;
      }
      case "focus_lost":
        break;
    }
    this.refresh();
    return "continue";
  }

  private async handleKeyEvent(key: KeyEvent): Promise<void> {
    if (this.renderer.selectionActive && key.code === "char" && key.ch === "y") {
      const text = this.renderer.selectedText();
      if (text !== null) {
        try {
          copyToClipboard(text);
          this.renderer.writeLine("copied selection", "green");
        } catch (e) {
          this.renderer.writeLine(
            `copy to clipboard failed: ${e instanceof Error ? e.message : String(e)}`,
            C_ERROR,
          );
        }
      }
      this.renderer.clearSelection();
      return;
    }
    if (this.renderer.selectionActive && key.code === "esc") {
      this.renderer.clearSelection();
      return;
    }

    if (key.code === "char" && key.ch === "r" && key.ctrl) {
      this.slash.showReasoning = !this.slash.showReasoning;
      this.renderer.writeLine(
        `reasoning visibility: ${this.slash.showReasoning ? "on" : "off"}`,
        "white",
      );
      return;
    }
    if (key.code === "up" && key.ctrl) {
      this.renderer.scrollLineUp();
      return;
    }
    if (key.code === "down" && key.ctrl) {
      this.renderer.scrollLineDown();
      return;
    }
    switch (key.code) {
      case "pageup":
        this.renderer.scrollPageUp();
        return;
      case "pagedown":
        this.renderer.scrollPageDown();
        return;
      case "home":
        this.renderer.scrollToTop();
        return;
      case "end":
        this.renderer.scrollToBottom();
        return;
      default:
        break;
    }

    if (key.alt && key.code === "char" && (key.ch === "m" || key.ch === "M")) {
      this.openModelSwitcher();
      return;
    }
    if (key.alt && key.code === "char" && (key.ch === "p" || key.ch === "P")) {
      this.openPromptSwitcher();
      return;
    }

    if (this.input.picker !== null && this.input.picker.active()) {
      if (this.input.handlePickerKey(key)) {
        const rewind = this.input.takeRewindOutcome();
        if (rewind !== null && rewind.kind === "confirmed") {
          const msg = this.ui.session.messages[rewind.idx];
          if (msg !== undefined && this.ui.session.rewindTo(rewind.idx) > 0) {
            this.input.loadText(msg.content);
            await this.saveSession();
            renderSession(this.renderer, this.ui.session, this.ui.cli, this.ui.cfg, this.ui.context);
            this.renderer.writeLine("rewound; /redo to restore", "green");
          }
        }
        const switcher = this.input.takeSwitcheroOutcome();
        if (switcher !== null) {
          if (switcher.kind === "model") {
            await this.runSlashCommand(`/models ${switcher.name}`);
          } else if (switcher.kind === "prompt") {
            await this.runSlashCommand(`/prompt ${switcher.name}`);
          }
        }
        return;
      }
    }

    if (key.code === "char" && key.ch === "g" && key.ctrl) {
      this.rebindEventThread();
      this.input.openInEditor();
      return;
    }

    if (
      !this.ui.cli.disableLazygit &&
      key.code === "char" &&
      key.ch === "h" &&
      key.ctrl
    ) {
      this.runLazygit();
      return;
    }

    if (this.renderer.chainPrompt !== null && !this.renderer.chainButMode) {
      if (key.code === "char" && (key.ch === "y" || key.ch === "Y")) {
        this.renderer.chainPrompt = null;
        const phase = this.chain.pending;
        this.chain.pending = null;
        if (phase !== null) {
          this.chain.labelMsg = null;
          await this.runChainTransition(phase, null);
        }
        return;
      }
      if (key.code === "char" && (key.ch === "n" || key.ch === "N")) {
        this.renderer.chainPrompt = null;
        this.chain.pending = null;
        this.chain.labelMsg = null;
        this.renderer.writeLine("chain declined — won't ask again this session", C_AGENT);
        const name = this.ui.context.currentPromptName;
        if (name !== undefined && !this.ui.context.chainDeclined.includes(name)) {
          this.ui.context.chainDeclined.push(name);
        }
        return;
      }
      if (key.code === "char" && (key.ch === "b" || key.ch === "B")) {
        this.renderer.chainButMode = true;
        this.renderer.chainPrompt = null;
        this.input.clearBuffer();
        this.chain.labelMsg =
          this.chain.pending !== null ? this.chain.pending.chainLabel() : null;
        return;
      }
      return;
    }

    if (this.renderer.chainButMode && key.code === "esc") {
      this.renderer.chainButMode = false;
      if (this.chain.pending !== null) {
        this.renderer.chainPrompt = { question: this.chain.pending.chainLabel() };
        this.chain.labelMsg = this.chain.pending.chainLabel();
      }
      this.input.clearBuffer();
      return;
    }

    const text = this.input.handleKey(key);
    if (text !== null) {
      if (this.renderer.isScrolling()) this.renderer.scrollToBottom();

      if (!this.runState.isRunning && this.chain.pending !== null) {
        const phase = this.chain.pending;
        this.chain.pending = null;
        this.chain.labelMsg = null;
        this.renderer.chainButMode = false;
        const trimmed = text.trim();
        if (trimmed === "") {
          this.chain.pending = phase;
          this.chain.labelMsg = phase.chainLabel();
          this.renderer.chainPrompt = { question: phase.chainLabel() };
          return;
        }
        await this.runChainTransition(phase, trimmed);
        return;
      }

      const action = classifySubmission(this.runState.isRunning, text);
      if (action === "ignore") return;
      if (action === "reject_while_running") {
        this.renderer.writeLine(
          "agent is running — wait for it to finish or press Ctrl-C before running a command",
          C_ERROR,
        );
        return;
      }
      if (action === "queue") {
        this.runState.pendingInputs.push(text);
        this.renderer.writeLine(`queued: ${sanitizeOutput(text)}`, C_TOOL);
        return;
      }

      {
        const t = text.trimStart();
        if (t === "/queue" || t.startsWith("/queue ")) {
          this.runQueueCommand(t.slice("/queue".length).trim());
          return;
        }
      }
      {
        const t = text.trimStart();
        if (t === "/btw" || t.startsWith("/btw ")) {
          await this.runBtw(text);
          return;
        }
      }

      if (await this.handleDotCommand(text)) return;

      if (text.startsWith("/")) {
        await this.runSlashCommand(text);
      } else if (text.startsWith("!")) {
        await this.runBangCommand(text);
      } else {
        for (const line of text.split("\n")) {
          this.renderer.writeLine(`> ${sanitizeOutput(line)}`, "green");
        }
        this.renderer.writeLine("", "white");
        await this.startMainRun(text);
      }
    }
  }

  private async handleAgentEvent(event: AgentEvent): Promise<void> {
    if (event.type === "tool_call") {
      if (this.runState.turnTrace.length < TURN_TRACE_MAX) {
        this.runState.turnTrace.push(`→ ${formatToolCallSummary(event.name, event.args)}`);
      }
    } else if (event.type === "tool_result") {
      if (this.runState.turnTrace.length < TURN_TRACE_MAX) {
        this.runState.turnTrace.push(`← ${truncateCjk(event.output, 500, "…")}`);
      }
    } else if (event.type === "done" || event.type === "error") {
      this.runState.turnTrace = [];
      this.runState.awaitingCompactionRelief = false;
    }

    const loopRunning = this.chain.loopState !== null && this.chain.loopState.active;
    if (
      event.type === "completion_call" &&
      this.runState.isRunning &&
      !loopRunning &&
      !this.ui.cli.noSession &&
      resolveCompactEnabled(this.ui.cfg) &&
      this.ui.session.contextWindow > 0
    ) {
      const threshold = resolveMidTurnCompactThreshold(this.ui.cfg);
      if (threshold !== null) {
        const anthropic = configIsAnthropicNative(
          this.ui.cfg,
          this.ui.session.provider,
          this.ui.session.model,
        );
        const realInput = realInputTokens(
          anthropic,
          event.inputTokens,
          event.cachedInputTokens,
          event.cacheCreationInputTokens,
        );
        const pressure = realInput / this.ui.session.contextWindow;
        if (pressure > threshold) {
          if (this.runState.awaitingCompactionRelief) {
            this.stopContextExhausted(realInput, threshold);
            this.runState.awaitingCompactionRelief = false;
          } else {
            await this.midTurnCompact(pressure);
            this.runState.awaitingCompactionRelief = true;
          }
          this.refresh();
          return;
        }
        this.runState.awaitingCompactionRelief = false;
      }
    }

    const turnErrored = event.type === "error";
    const isTerminal = event.type === "done" || event.type === "error";
    const isBashResult = event.type === "tool_result" && event.name === "bash";
    await handleAgentEventInner(event, this.renderer, this.runState, this.ui, this.slash, this.chain);

    if (isBashResult) await this.refreshGitStateAsync();

    await this.finalizeTurn(turnErrored);

    if (isTerminal || !this.runState.isRunning) this.refresh();
  }

  private async finalizeTurn(turnErrored: boolean): Promise<void> {
    if (turnErrored) {
      const text = this.runState.pendingSend;
      this.runState.pendingSend = null;
      if (text !== null) {
        const len = this.ui.session.messages.length;
        if (
          len > 0 &&
          this.ui.session.messages[len - 1].role === "user"
        ) {
          this.ui.session.truncateTo(len - 1);
        }
        this.input.loadText(text);
      }
    } else if (!this.runState.isRunning) {
      this.runState.pendingSend = null;
    }

    if (!this.runState.isRunning && this.chain.dotPromptRestore !== null) {
      const restoreName = this.chain.dotPromptRestore;
      this.chain.dotPromptRestore = null;
      this.ui.context.currentPrompt = this.ui.context.prompts.get(restoreName);
      this.ui.context.currentPromptName =
        this.ui.context.currentPrompt !== undefined ? restoreName : undefined;
      this.ui.session.prompt =
        this.ui.context.currentPromptName !== undefined
          ? {
              name: this.ui.context.currentPromptName,
              source: this.ui.context.promptSource?.(this.ui.context.currentPromptName) ?? "user_file",
            }
          : null;
      this.ui.permission?.restoreUserMode();
    }

    if (
      !turnErrored &&
      !this.runState.isRunning &&
      this.chain.pending === null &&
      this.chainPhaseFromPrompt !== null &&
      this.ui.context.currentPromptName !== undefined &&
      !this.ui.context.chainDeclined.includes(this.ui.context.currentPromptName)
    ) {
      const phase = this.chainPhaseFromPrompt(this.ui.context.currentPromptName);
      if (phase !== null && phase.isEnabled(this.ui.cfg.chain)) {
        this.chain.pending = phase;
        this.chain.labelMsg = phase.chainLabel();
        this.renderer.chainButMode = false;
        this.renderer.chainPrompt = { question: phase.chainLabel() };
      }
    }

    if (!this.runState.isRunning) {
      this.runState.mainAbort = null;
      const next = this.runState.pendingInputs.shift();
      if (next !== undefined) {
        this.renderer.chainPrompt = null;
        this.renderer.chainButMode = false;
        this.chain.pending = null;
        this.chain.labelMsg = null;
        for (const line of next.split("\n")) {
          this.renderer.writeLine(`> ${sanitizeOutput(line)}`, "green");
        }
        this.renderer.writeLine("", "white");
        await this.startMainRun(next);
      }
    }
  }

  private abortMainRun(): void {
    this.runState.mainAbort?.abort();
    this.runState.mainAbort = null;
    this.ui.sandbox.killActive();
    this.runState.isRunning = false;
    this.ui.statusSignals?.sendStop();
    this.runState.agentRx = null;
    this.runState.turnTrace = [];
    this.runState.awaitingCompactionRelief = false;
    this.runState.clearPendingToolCalls();
    this.runState.pendingInputs = [];
    if (this.chain.loopState !== null) {
      this.chain.loopState.active = false;
      this.chain.loopLabel = null;
    }
    if (this.input.buffer !== "") this.input.clearBuffer();
    if (this.chain.dotPromptRestore !== null) {
      const restoreName = this.chain.dotPromptRestore;
      this.chain.dotPromptRestore = null;
      this.ui.context.currentPrompt = this.ui.context.prompts.get(restoreName);
      this.ui.context.currentPromptName =
        this.ui.context.currentPrompt !== undefined ? restoreName : undefined;
      this.ui.session.prompt =
        this.ui.context.currentPromptName !== undefined
          ? {
              name: this.ui.context.currentPromptName,
              source: this.ui.context.promptSource?.(this.ui.context.currentPromptName) ?? "user_file",
            }
          : null;
      this.ui.permission?.restoreUserMode();
    }
    this.renderer.writeLine(
      "interrupted (changes may be partial; review with git diff)",
      C_ERROR,
    );
  }

  private async resolvePrebuild(): Promise<void> {
    if (this.runState.agent !== null) return;
    if (this.prebuildPromise !== null) {
      const agent = await this.prebuildPromise;
      if (agent !== null) this.takePrebuild(agent, false);
    }
  }

  private async startMainRun(text: string): Promise<void> {
    await this.resolvePrebuild();
    await startMainRunFromMod(text, this.runState, this.ui, this.slash);
  }

  private async ensureAgent(): Promise<void> {
    await ensureAgent(this.runState, this.ui, this.slash.reasoningEnabled);
  }

  private async runChainTransition(
    phase: import("./state.ts").ChainPhase,
    extra: string | null,
  ): Promise<void> {
    const nextName = phase.nextPromptName();
    applyPromptMode(nextName, this.ui.context, this.ui.session, this.ui.permission);
    if (this.applyPromptModelFn !== undefined) {
      await this.applyPromptModelFn(
        nextName,
        this.ui,
        this.runState.agent,
        this.slash.reasoningEnabled,
        this.renderer,
      );
    }
    const baseMsg = phase.transitionMessage();
    const msg = extra !== null ? `${baseMsg}\n\nAdditional instructions: ${extra}` : baseMsg;
    for (const line of msg.split("\n")) {
      this.renderer.writeLine(`> ${sanitizeOutput(line)}`, "green");
    }
    this.renderer.writeLine("", "white");
    this.ui.session.addMessage("user", msg);
    this.runState.agent = null;
    await this.startMainRun(msg);
  }

  private async handleDotCommand(text: string): Promise<boolean> {
    if (!text.startsWith(".")) return false;
    const afterDot = text.slice(1).trimStart();

    for (const line of text.split("\n")) {
      this.renderer.writeLine(`> ${sanitizeOutput(line)}`, "green");
    }
    this.renderer.writeLine("", "white");

    if (afterDot === "") {
      this.input.loadText(".");
      this.input.startDotPicker();
      return true;
    }

    const spaceIdx = afterDot.search(/\s/);
    if (spaceIdx >= 0) {
      const promptName = afterDot.slice(0, spaceIdx).trim();
      const msg = afterDot.slice(spaceIdx).trim();
      if (promptName !== "" && this.ui.context.prompts.has(promptName)) {
        this.chain.dotPromptRestore = this.ui.context.currentPromptName ?? null;
        applyPromptMode(promptName, this.ui.context, this.ui.session, this.ui.permission);
        if (this.applyPromptModelFn !== undefined) {
          await this.applyPromptModelFn(
            promptName,
            this.ui,
            this.runState.agent,
            this.slash.reasoningEnabled,
            this.renderer,
          );
        }
        this.runState.agent = null;

        await this.runPlainMessage(msg);
        return true;
      }
      this.renderer.writeLine(`error: unknown prompt '${promptName}'`, C_ERROR);
      return true;
    }

    const promptName = afterDot.trim();
    if (this.ui.context.prompts.has(promptName)) {
      applyPromptMode(promptName, this.ui.context, this.ui.session, this.ui.permission);
      if (this.applyPromptModelFn !== undefined) {
        await this.applyPromptModelFn(
          promptName,
          this.ui,
          this.runState.agent,
          this.slash.reasoningEnabled,
          this.renderer,
        );
      }
      this.runState.agent = null;
      this.renderer.writeLine(`switched to prompt '${promptName}'`, C_AGENT);
      await this.saveSession();
      return true;
    }
    this.renderer.writeLine(`error: unknown prompt '${promptName}'`, C_ERROR);
    return true;
  }

  private async runPlainMessage(msg: string): Promise<void> {
    if (msg === "") return;
    for (const line of msg.split("\n")) {
      this.renderer.writeLine(`> ${sanitizeOutput(line)}`, "green");
    }
    this.renderer.writeLine("", "white");
    await this.startMainRun(msg);
  }

  private runQueueCommand(arg: string): void {
    switch (arg) {
      case "clear": {
        const n = this.runState.pendingInputs.length;
        this.runState.pendingInputs = [];
        this.renderer.writeLine(`queue cleared (${n} removed)`, C_TOOL);
        break;
      }
      case "pop": {
        const x = this.runState.pendingInputs.pop();
        if (x !== undefined) {
          this.renderer.writeLine(`unqueued: ${sanitizeOutput(x)}`, C_TOOL);
        } else {
          this.renderer.writeLine("queue is empty", C_TOOL);
        }
        break;
      }
      case "":
      case "ls":
      case "list": {
        if (this.runState.pendingInputs.length === 0) {
          this.renderer.writeLine("queue is empty", C_TOOL);
        } else {
          this.renderer.writeLine(`queued (${this.runState.pendingInputs.length}):`, C_TOOL);
          this.runState.pendingInputs.forEach((q, i) => {
            this.renderer.writeLine(`  ${i + 1}. ${sanitizeOutput(q)}`, C_TOOL);
          });
        }
        break;
      }
      default:
        this.renderer.writeLine("usage: /queue [ls|clear|pop]", C_ERROR);
        break;
    }
  }

  private async runBtw(text: string): Promise<void> {
    for (const line of text.split("\n")) {
      this.renderer.writeLine(`> ${sanitizeOutput(line)}`, "green");
    }
    this.renderer.writeLine("", "white");
    const btwText = text.trimStart().slice("/btw".length).trim();
    if (btwText === "") {
      this.renderer.writeLine("usage: /btw <message>", C_AGENT);
      return;
    }
    const id = this.btwNextId;
    this.btwNextId = (this.btwNextId + 1) >>> 0;
    const snapshot = {
      messages: this.ui.session.messages.map((m) => ({ role: m.role, content: m.content })),
      turnTrace: [...this.runState.turnTrace],
      isRunning: this.runState.isRunning,
    };
    await this.ensureAgent();
    const agent = this.runState.agent;
    if (agent === null || agent.spawnBtw === undefined) {
      this.renderer.writeLine("[btw] error: side-question agent unavailable", C_ERROR);
      return;
    }
    try {
      const runner = await agent.spawnBtw(btwText, snapshot, this.btwEvents, id, this.ui.cfg.retry);
      this.btwAbort.push([id, runner.abortHandle]);
      this.btwInflight += 1;
      this.renderer.writeLine(`[btw #${id}] thinking...`, C_BTW);
    } catch (e) {
      this.renderer.writeLine(
        `[btw] error: ${e instanceof Error ? e.message : String(e)}`,
        C_ERROR,
      );
    }
  }

  private async runSlashCommand(text: string): Promise<void> {
    for (const line of text.split("\n")) {
      this.renderer.writeLine(`> ${sanitizeOutput(line)}`, "green");
    }
    this.renderer.writeLine("", "white");

    const result = await this.slashHandler(text, {
      renderer: this.renderer,
      input: this.input,
      run: this.runState,
      ui: this.ui,
      slash: this.slash,
      chain: this.chain,
    });

    if (this.warmModelCacheFn !== undefined) {
      const provider = this.ui.session.provider;
      const isCustom = (this.ui.cfg.customProviders ?? {})[provider] !== undefined;
      try {
        const ids = await this.warmModelCacheFn(provider, isCustom, this.ui.client, this.ui.cli, this.ui.cfg);
        this.input.setLiveModelNames(ids);
      } catch {

      }
    }

    await this.handleSlashResult(result);
    await this.saveSession();
  }

  private async handleSlashResult(result: SlashResult): Promise<void> {
    if (result.ok) return;
    if (result.outcome !== undefined) {
      const outcome = result.outcome;
      switch (outcome.kind) {
        case "defer_compress": {
          try {
            await this.ui.handleCompress(outcome.instructions ?? null, false, this.runState.agent, this.slash.reasoningEnabled);
          } catch (e) {
            this.renderer.writeLine(
              `compress error: ${e instanceof Error ? e.message : String(e)}`,
              C_ERROR,
            );
          }
          await this.saveSession();
          return;
        }
        case "defer_init": {
          await this.ensureAgent();
          const history = this.ui.convertHistory(this.ui.session);
          if (this.runState.agent !== null) {
            const runner = await this.runState.agent.spawnRunner(
              AGENTS_CREATION_PROMPT,
              history,
              this.ui.cfg.retry,
            );
            this.runState.agentRx = runner.events;
            this.runState.mainAbort = runner.abortHandle;
            this.runState.isRunning = true;
            this.ui.statusSignals?.sendStart();
          }
          return;
        }
        case "defer_review": {
          this.chain.dotPromptRestore = this.ui.context.oneShotRestore ?? null;
          this.ui.session.addMessage("user", outcome.message);
          await this.ensureAgent();
          const history = this.ui.convertHistory(this.ui.session);
          if (this.runState.agent !== null) {
            const runner = await this.runState.agent.spawnRunner(
              outcome.message,
              history,
              this.ui.cfg.retry,
            );
            this.runState.agentRx = runner.events;
            this.runState.mainAbort = runner.abortHandle;
            this.runState.isRunning = true;
            this.ui.statusSignals?.sendStart();
          }
          return;
        }
        case "defer_editor": {
          const editor = this.ui.cfg.editor ?? process.env["EDITOR"] ?? "vi";
          const mouseCapture = resolveMouseCapture(this.ui.cfg);
          suspendTui(mouseCapture, () => {
            const [prog, args] = parseEditorCommand(editor);
            try {
              spawnSync(prog, [...args, outcome.path], { stdio: "inherit" });
            } catch {

            }
          });
          renderSession(this.renderer, this.ui.session, this.ui.cli, this.ui.cfg, this.ui.context);
          this.renderer.writeLine(`returned from editing ${outcome.path}`, C_AGENT);
          return;
        }
      }
    }
    this.renderer.writeLine(`error: ${result.error}`, C_ERROR);
  }

  private async runBangCommand(text: string): Promise<void> {
    const cmd = text.slice(1).trim();
    if (cmd === "") {
      this.renderer.writeLine("error: empty command after '!'", C_ERROR);
      return;
    }
    for (const line of text.split("\n")) {
      this.renderer.writeLine(`> ${sanitizeOutput(line)}`, "green");
    }
    this.renderer.writeLine("", "white");

    const out = spawnSync("bash", ["-c", cmd], { encoding: "utf8" });
    let result = "";
    if (out.stdout !== "") result += out.stdout;
    if (out.stderr !== "") {
      if (result !== "") result += "\n";
      result += out.stderr;
    }
    result = result.trim();

    for (const line of result.split("\n")) {
      this.renderer.writeLine(
        sanitizeOutput(line),
        out.status === 0 ? C_AGENT : C_ERROR,
      );
    }
    this.renderer.writeLine("", "white");

    this.ui.session.addMessage("user", text);
    this.ui.session.addMessage("assistant", result);
    await this.saveSession();
    await this.refreshGitStateAsync();
  }

  private async midTurnCompact(pressure: number): Promise<void> {
    await midTurnCompactAndRespawn(pressure, this.renderer, this.runState, this.ui, this.slash);
  }

  private stopContextExhausted(promptTokens: number, threshold: number): void {
    stopTurnContextExhausted(promptTokens, threshold, this.renderer, this.ui, this.runState);
  }

  private handleBtwEvent(bev: BtwEvent): void {
    if (bev.type === "done") {
      const anthropic = configIsAnthropicNative(
        this.ui.cfg,
        this.ui.session.provider,
        this.ui.session.model,
      );
      this.btwTotalCost += estimateCost(
        billableInputTokens(
          anthropic,
          bev.inputTokens,
          bev.cachedInputTokens,
          bev.cacheCreationInputTokens,
        ),
        bev.outputTokens,
        this.ui.session.inputTokenCost,
        this.ui.session.outputTokenCost,
      );
      this.btwTotalIn += bev.inputTokens;
      this.btwTotalOut += bev.outputTokens;
      this.btwAbort = this.btwAbort.filter(([i]) => i !== bev.id);
      this.btwInflight = Math.max(0, this.btwInflight - 1);
      this.renderer.writeLine(`[btw #${bev.id}] answer:`, C_BTW);
      for (const line of bev.response.split("\n")) {
        this.renderer.writeLine(sanitizeOutput(line), C_AGENT);
      }
      this.renderer.writeLine("", "white");
    } else {
      this.btwAbort = this.btwAbort.filter(([i]) => i !== bev.id);
      this.btwInflight = Math.max(0, this.btwInflight - 1);
      this.renderer.writeLine(
        `[btw #${bev.id}] error: ${sanitizeOutput(bev.message)}`,
        C_ERROR,
      );
    }
  }

  private takePrebuild(prebuilt: AnyAgent, _notify: boolean): void {
    this.runState.agent = prebuilt;
    this.prebuildPromise = null;
    this.prebuildDone = true;
    this.prebuildValue = null;
  }

  private rebindEventThread(): void {
    this.eventThread?.stop();
    this.eventThread = null;
    this.running = true;
    const newQueue = new EventQueue<UserEvent>();
    this.userEvents = newQueue;
    if (!this.headless) {
      this.eventThread = spawnEventThread(newQueue, () => this.running);
    }
  }

  private runLazygit(): void {
    const probe = spawnSync("lazygit", ["--version"], { encoding: "utf8" });
    if (probe.error !== undefined || probe.status !== 0) {
      this.renderer.writeLine(
        "warning: lazygit not found — install it (https://github.com/jesseduffield/lazygit)",
        C_ERROR,
      );
      return;
    }
    this.eventThread?.stop();
    this.eventThread = null;
    const mouseCapture = resolveMouseCapture(this.ui.cfg);
    suspendTui(mouseCapture, () => {
      try {
        spawnSync("lazygit", [], { stdio: "inherit" });
      } catch {

      }
    });
    this.rebindEventThread();
  }

  private async saveSession(): Promise<void> {
    if (!this.ui.cli.noSession && this.ui.saveSession !== null) {
      try {
        await this.ui.saveSession(this.ui.session);
      } catch (e) {
        this.renderer.writeLine(
          `warning: failed to save session: ${e instanceof Error ? e.message : String(e)}`,
          C_ERROR,
        );
      }
    }
  }

  private openModelSwitcher(): void {
    if (this.runState.isRunning) {
      this.renderer.writeLine(
        "agent is running — wait for it to finish or press Ctrl-C before switching models",
        C_ERROR,
      );
      return;
    }
    const qm = quickModelsMap(this.ui.cfg);
    const quick = [...qm.keys()].sort();
    const provider = this.ui.session.provider;
    const live = this.cachedModelIdsFn !== undefined ? this.cachedModelIdsFn(provider) : [];
    this.input.setQuickModelNames(quick);
    this.input.setLiveModelNames(live);
    const details = new Map<string, string>();
    for (const name of quick) {
      const q = qm.get(name);
      if (q !== undefined) {
        details.set(
          name,
          `(${q.provider} / ${q.model})  $${q.inputTokenCost.toFixed(4)}/M in  $${q.outputTokenCost.toFixed(4)}/M out`,
        );
      }
    }
    const currentQuick = quick.find((name) => {
      const q = qm.get(name);
      return (
        q !== undefined &&
        q.provider === this.ui.session.provider &&
        q.model === this.ui.session.model
      );
    }) ?? null;
    this.input.startModelSwitcher(quick, live, details, currentQuick, this.ui.session.model);
  }

  private openPromptSwitcher(): void {
    if (this.runState.isRunning) {
      this.renderer.writeLine(
        "agent is running — wait for it to finish or press Ctrl-C before switching prompts",
        C_ERROR,
      );
      return;
    }
    const items = [...this.ui.context.prompts.keys()].sort();
    this.input.setPromptNames(items);
    const details = new Map<string, string>();
    for (const name of items) {
      const content = this.ui.context.prompts.get(name);
      if (content !== undefined) {
        const source = this.ui.context.promptSource?.(name) ?? "user_file";
        const sourceLabel = source === "built_in" ? "BuiltIn" : "UserFile";
        const [mode] = parsePromptMode(content);
        details.set(
          name,
          mode !== null ? `${sourceLabel} · mode: ${mode}` : sourceLabel,
        );
      }
    }
    this.input.startPromptSwitcher(
      items,
      details,
      this.ui.context.currentPromptName ?? null,
    );
  }

  private async handleWorktreeAutoMerge(): Promise<void> {
    const autoMerge = this.ui.cli.resolveWtAutoMerge?.(this.ui.cfg) ?? false;
    if (!autoMerge) return;
    const info = detectWorktreeInfo(this.ui.session.workingDir);
    if (info === null) return;
    const target = defaultBranch(info.mainRepoPath);
    this.renderer.writeLine(
      `auto-merging worktree '${info.branch}' into '${target}'...`,
      C_AGENT,
    );
    let proceed = true;
    if (worktreeHasUncommitted(info.worktreePath)) {
      this.renderer.writeLine(
        "worktree has uncommitted changes. [c]ommit all and continue  [a]bort merge",
        C_TOOL,
      );
      this.ui.statusSignals?.sendGitConflict();
      const action = await this.readWorktreeKey(["c", "a"]);
      if (action === "c") {
        const committed = spawnSync(
          "git",
          ["-C", info.worktreePath, "add", "-A"],
          { encoding: "utf8" },
        );
        const commit = spawnSync(
          "git",
          ["-C", info.worktreePath, "commit", "--no-edit"],
          { encoding: "utf8" },
        );
        if (committed.status !== 0 || commit.status !== 0) {
          this.renderer.writeLine("auto-commit failed, merge aborted", C_ERROR);
          proceed = false;
        } else {
          this.renderer.writeLine("committed all worktree changes, proceeding with merge", C_AGENT);
        }
      } else {
        this.renderer.writeLine("merge aborted, worktree left untouched", C_AGENT);
        proceed = false;
      }
    }
    if (!proceed) return;
    const force = this.ui.cli.resolveWtForce?.(this.ui.cfg) ?? false;
    const checkout = spawnSync("git", ["-C", info.mainRepoPath, "checkout", target], {
      encoding: "utf8",
    });
    if (checkout.status !== 0) {
      this.renderer.writeLine("merge failed: could not check out target branch", C_ERROR);
      return;
    }
    const merge = spawnSync(
      "git",
      ["-C", info.mainRepoPath, "merge", "--squash", info.branch],
      { encoding: "utf8" },
    );
    if (merge.status !== 0) {
      const files = unmergedFiles(info.mainRepoPath);
      if (files.length === 0) {
        this.renderer.writeLine(
          "merge conflict detected but the conflicting file list is unavailable; run `git status` in the main repo to see them",
          C_ERROR,
        );
      } else {
        this.renderer.writeLine(`merge conflict in ${files.length} file(s):`, C_ERROR);
        for (const f of files) this.renderer.writeLine(`  ${f}`, C_ERROR);
      }
      this.ui.statusSignals?.sendGitConflict();
      this.renderer.writeLine("[a]bort  [l]eave for manual resolution  [h]elp (agent resolves)", C_TOOL);
      const action = await this.readWorktreeKey(["a", "l", "h"]);
      if (action === "a") {
        spawnSync("git", ["-C", info.mainRepoPath, "merge", "--abort"], { encoding: "utf8" });
        spawnSync("git", ["-C", info.mainRepoPath, "reset", "--merge"], { encoding: "utf8" });
        this.renderer.writeLine("merge aborted, restored original state", C_AGENT);
      } else if (action === "l") {
        this.renderer.writeLine(
          `conflict state left in ${info.mainRepoPath} for manual resolution`,
          C_AGENT,
        );
      } else {
        this.renderer.writeLine("agent resolving merge...", C_AGENT);
        await spawnMergeAgent(
          {
            branch: info.branch,
            target,
            mainPath: info.mainRepoPath,
            wtPath: info.worktreePath,
            force,
          },
          this.runState,
          this.ui,
          this.chain,
        );
      }
      return;
    }
    const commit = spawnSync(
      "git",
      ["-C", info.mainRepoPath, "commit", "--no-edit"],
      { encoding: "utf8" },
    );
    if (commit.status === 0) {
      spawnSync("git", ["-C", info.mainRepoPath, "worktree", "remove", ...(force ? ["--force"] : []), info.worktreePath], { encoding: "utf8" });
      spawnSync("git", ["-C", info.mainRepoPath, "branch", force ? "-D" : "-d", info.branch], { encoding: "utf8" });
      this.renderer.writeLine(
        `merged '${info.branch}' into '${target}' and cleaned up`,
        C_AGENT,
      );
    } else {
      this.renderer.writeLine("merge succeeded but cleanup failed: commit failed", C_ERROR);
    }
  }

  private async readWorktreeKey(valid: string[]): Promise<string> {
    for (;;) {
      const ev = await this.userEvents.next();
      if (ev === null) return valid[valid.length - 1] ?? "a";
      if (ev.type === "key" && ev.key.code === "char" && ev.key.ch !== undefined) {
        const ch = ev.key.ch.toLowerCase();
        if (valid.includes(ch)) return ch;
      }
      if (ev.type === "key" && (ev.key.code === "enter" || ev.key.code === "esc")) {
        return valid.includes("a") ? "a" : (valid[0] ?? "a");
      }
    }
  }
}

export function applyThemeContent(content: string, renderer: Renderer): void {
  let chatBg: import("./utils.ts").Color | null = null;
  let inputBg: import("./utils.ts").Color | null = null;
  let statusBg: import("./utils.ts").Color | null = null;
  let ansi = false;
  const roles: Record<string, string> = {};
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("[")) {
      if (line === "[colors]") continue;
      if (line.toLowerCase().includes("ansi")) ansi = true;
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^"|"$/g, "");
    if (key === "chat_background") chatBg = parseColorLoose(value);
    else if (key === "input_background") inputBg = parseColorLoose(value);
    else if (key === "status_background") statusBg = parseColorLoose(value);
    else if (key === "scheme_type" && value === "ansi") ansi = true;
    else if (key.startsWith("roles.")) roles[key.slice("roles.".length)] = value;
  }
  const convert = (c: import("./utils.ts").Color | null): import("./utils.ts").Color | null =>
    c !== null && ansi ? toAnsi256Loose(c) : c;
  renderer.setBackgroundColors(convert(chatBg), convert(inputBg), convert(statusBg));
  if (Object.keys(roles).length > 0) applyRolesLoose(roles);
  else resetRolesLoose();
}

export function applyColorsConfig(
  colors: NonNullable<import("./state.ts").Config["colors"]>,
  renderer: Renderer,
): void {
  const ansi = colors.schemeType === "ansi";
  const convert = (v: string | undefined): import("./utils.ts").Color | null => {
    if (v === undefined) return null;
    const parsed = parseColorLoose(v);
    return parsed !== null && ansi ? toAnsi256Loose(parsed) : parsed;
  };
  renderer.setBackgroundColors(
    convert(colors.chatBackground),
    convert(colors.inputBackground),
    convert(colors.statusBackground),
  );
  if (colors.roles !== undefined) applyRolesLoose(colors.roles);
  else resetRolesLoose();
}

import { parseColor as parseColorLoose, toAnsi256 as toAnsi256Loose } from "./utils.ts";
import { applyRoles as applyRolesLoose, resetRoles as resetRolesLoose } from "./roles.ts";
import { spawnMergeAgent } from "./mod.ts";
import {
  billableInputTokens,
  configIsAnthropicNative,
  estimateCost,
  realInputTokens,
  resolveCompactEnabled,
  resolveMidTurnCompactThreshold,
} from "./state.ts";
import { truncateCjk } from "./utils.ts";

interface WorktreeInfo {
  mainRepoPath: string;
  worktreePath: string;
  branch: string;
}

function detectWorktreeInfo(workingDir: string): WorktreeInfo | null {
  let content: string;
  try {
    content = readFileSync(join(workingDir, ".git"), "utf8");
  } catch {
    return null;
  }
  if (!content.startsWith("gitdir:")) return null;
  const gitdir = content.slice("gitdir:".length).trim();
  const parts = gitdir.split("/");
  const wtIdx = parts.indexOf("worktrees");
  if (wtIdx < 0) return null;
  const branch = parts[parts.length - 1] ?? "";
  
  const mainRepoPath = parts.slice(0, Math.max(0, wtIdx - 1)).join("/") || "/";
  if (branch === "") return null;
  return { mainRepoPath, worktreePath: workingDir, branch };
}

function defaultBranch(mainRepoPath: string): string {
  const out = spawnSync("git", ["-C", mainRepoPath, "symbolic-ref", "--short", "HEAD"], {
    encoding: "utf8",
  });
  const branch = (out.stdout ?? "").trim();
  return branch !== "" ? branch : "main";
}

function worktreeHasUncommitted(worktreePath: string): boolean {
  const out = spawnSync("git", ["-C", worktreePath, "status", "--porcelain"], {
    encoding: "utf8",
  });
  return (out.stdout ?? "").trim() !== "";
}

function unmergedFiles(mainRepoPath: string): string[] {
  const out = spawnSync("git", ["-C", mainRepoPath, "ls-files", "-u"], {
    encoding: "utf8",
  });
  return [
    ...new Set(
      (out.stdout ?? "")
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => {
          const parts = l.split("\t");
          return parts[parts.length - 1] ?? l;
        }),
    ),
  ];
}
