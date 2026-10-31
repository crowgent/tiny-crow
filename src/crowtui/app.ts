import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentRunState,
  ChainState,
  EventQueue,
  SlashState,
  billableInputTokens,
  configIsAnthropicNative,
  estimateCost,
  resolveShowReasoning,
  type AgentEvent,
  type AskRequest,
  type BtwEvent,
  type UiContext,
} from "../ui/state.ts";
import { parseEditorCommand } from "../ui/terminal.ts";
import { suggestPattern } from "../ui/utils.ts";
import { centeredBanner, setupGuideLines, welcomeHintLines } from "./banner.ts";
import { LineInput } from "./input.ts";
import { SLASH_COMMANDS, PROVIDER_NAMES, pickerWindow, slashDescription } from "./slash.ts";
import { runMaskedEntry, runPanel, type PanelItem } from "./panel.ts";
import { catalogEntries } from "../models_catalog.ts";
import { providerKindEnvVar, providerKindFromName, type ModelEntry } from "../provider.ts";
import { dataDir, load as loadConfig, richDefaultConfig, saveConfig } from "../config/load.ts";
import { parseKeys, type CrowKey } from "./keys.ts";
import {
  ANSI_AGENT,
  ANSI_ERROR,
  ANSI_GREEN,
  ANSI_MUTED,
  ANSI_PINK,
  ANSI_REASONING,
  ANSI_SYSTEM,
  ANSI_TOOL,
  ANSI_WELCOME,
  Screen,
} from "./screen.ts";

export type CrowSlashHandler = (
  text: string,
  ctx: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export interface CrowAppOptions {
  ui: UiContext;
  autoTriggerMsg?: string | null;
  slashHandler?: CrowSlashHandler | null;
  askEvents?: EventQueue<AskRequest> | null;
}

class KeyPump {
  queue: CrowKey[] = [];
  waiter: (() => void) | null = null;
  private onData = (data: Buffer): void => {
    for (const key of parseKeys(data)) this.queue.push(key);
    if (this.waiter !== null) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter();
    }
  };

  attach(): void {
    process.stdin.on("data", this.onData);
    try {
      process.stdin.resume();
    } catch {
    }
  }

  detach(): void {
    process.stdin.removeListener("data", this.onData);
    try {
      process.stdin.pause();
    } catch {
    }
  }

  clear(): void {
    this.queue.length = 0;
  }

  async next(timeoutMs: number): Promise<CrowKey | null> {
    const queued = this.queue.shift();
    if (queued !== undefined) return queued;
    return new Promise<CrowKey | null>((resolve) => {
      let done = false;
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              if (done) return;
              done = true;
              this.waiter = null;
              resolve(null);
            }, timeoutMs)
          : null;
      this.waiter = () => {
        if (done) return;
        done = true;
        if (timer !== null) clearTimeout(timer);
        resolve(this.queue.shift() ?? null);
      };
    });
  }
}

function colorFor(value: unknown): string {
  if (typeof value === "string") {
    if (value === "green") return ANSI_GREEN;
    if (value === "dark_magenta") return ANSI_REASONING;
    if (value === "white") return ANSI_AGENT;
    return ANSI_AGENT;
  }
  if (typeof value === "object" && value !== null) {
    const color = value as { kind?: unknown; r?: unknown; g?: unknown; b?: unknown };
    if (color.kind === "rgb" && typeof color.r === "number" && typeof color.g === "number" && typeof color.b === "number") {
      if (color.r >= 230 && color.g < 160) return ANSI_ERROR;
      if (color.r >= 230 && color.g >= 200) return ANSI_TOOL;
      if (color.r >= 190 && color.b >= 240) return ANSI_REASONING;
      if (color.r >= 160 && color.g >= 210) return ANSI_GREEN;
    }
  }
  return ANSI_AGENT;
}

function toolSummary(name: string, args: unknown): string {
  if (args === undefined || args === null) return name;
  let text: string;
  try {
    text = typeof args === "string" ? args : JSON.stringify(args);
  } catch {
    text = String(args);
  }
  if (text.length > 160) text = `${text.slice(0, 157)}...`;
  return `${name} ${text}`;
}

function singleLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 3)}...`;
}

function isNoKeyError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("No API key found");
}

function providerEnvName(name: string): string {
  const kind = providerKindFromName(name);
  if (kind === null) return "";
  return providerKindEnvVar(kind);
}

function providerKeyState(apiKeys: Record<string, string> | undefined, name: string): string {
  if (name === "ollama" || name === "opencode-zen") return "no key needed";
  if (apiKeys !== undefined && (apiKeys[name] ?? "") !== "") return "key saved";
  const envName = providerEnvName(name);
  if (envName !== "" && (process.env[envName] ?? "") !== "") return "key saved";
  return "needs key";
}

interface SessionFileInfo {
  id: string;
  provider: string;
  model: string;
  messages: number;
  updated: number;
}

function listSessionFiles(): SessionFileInfo[] {
  let files: string[] = [];
  try {
    files = readdirSync(path.join(dataDir(), "sessions"));
  } catch {
    return [];
  }
  const infos: SessionFileInfo[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const full = path.join(dataDir(), "sessions", file);
    try {
      const parsed = JSON.parse(readFileSync(full, "utf-8")) as Record<string, unknown>;
      const messages = Array.isArray(parsed["messages"]) ? parsed["messages"].length : 0;
      infos.push({
        id: typeof parsed["id"] === "string" ? parsed["id"] : file.slice(0, -5),
        provider: typeof parsed["provider"] === "string" ? parsed["provider"] : "",
        model: typeof parsed["model"] === "string" ? parsed["model"] : "",
        messages,
        updated: statSync(full).mtimeMs,
      });
    } catch {
      continue;
    }
  }
  infos.sort((a, b) => b.updated - a.updated);
  return infos.slice(0, 30);
}

function listDirNames(dir: string, ext: string): string[] {
  let files: string[] = [];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  const names: string[] = [];
  for (const file of files) {
    if (file.endsWith(`.${ext}`)) names.push(file.slice(0, -(ext.length + 1)));
  }
  return [...new Set(names)].sort();
}

function repoDataDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
}

interface BtwActive {
  queue: EventQueue<BtwEvent>;
  id: number;
}

export class CrowApp {
  private ui: UiContext;
  private screen: Screen;
  private input: LineInput;
  private keys: KeyPump;
  private runState: AgentRunState;
  private slashState: SlashState;
  private chainState: ChainState;
  private slashHandler: CrowSlashHandler | null;
  private askEvents: EventQueue<AskRequest> | null;
  private autoTriggerMsg: string | null;
  private quit = false;
  private running = false;
  private streamKind: "agent" | "reasoning" | null = null;
  private queued: string[] = [];
  private toolCallMap = new Map<string, number>();
  private lastSessionCallId = 0;
  private btwActive: BtwActive[] = [];
  private btwNextId = 0;
  private askPrompt: AskRequest | null = null;
  private noKey = false;

  private constructor(
    ui: UiContext,
    screen: Screen,
    input: LineInput,
    keys: KeyPump,
    opts: CrowAppOptions,
  ) {
    this.ui = ui;
    this.screen = screen;
    this.input = input;
    this.keys = keys;
    this.runState = new AgentRunState();
    this.slashState = new SlashState({
      showReasoning: resolveShowReasoning(ui.cfg),
      reasoningEnabled: true,
      todoToolsEnabled: false,
    });
    this.chainState = new ChainState();
    this.slashHandler = opts.slashHandler ?? null;
    this.askEvents = opts.askEvents ?? null;
    this.autoTriggerMsg = opts.autoTriggerMsg ?? null;
  }

  static async create(opts: CrowAppOptions): Promise<CrowApp> {
    const ui = opts.ui;
    const screen = new Screen();
    const input = new LineInput();
    const keys = new KeyPump();
    const app = new CrowApp(ui, screen, input, keys, opts);
    screen.enter();
    keys.attach();
    screen.setHeader([
      ...centeredBanner(screen.cols).map((line) => ({ text: line, color: ANSI_WELCOME })),
      ...welcomeHintLines().map((line) => ({ text: line, color: ANSI_MUTED })),
    ]);
    screen.setResizeHandler(() => {
      screen.setHeader([
        ...centeredBanner(screen.cols).map((line) => ({ text: line, color: ANSI_WELCOME })),
        ...welcomeHintLines().map((line) => ({ text: line, color: ANSI_MUTED })),
      ]);
      app.render();
    });
    if (ui.session.messages.length > 0) {
      screen.writeLine("Resumed session:", ANSI_SYSTEM);
      for (const message of ui.session.messages) {
        const role = (message as { role?: unknown }).role;
        const content = String((message as { content?: unknown }).content ?? "");
        if (role === "user") {
          for (const line of content.split("\n")) screen.writeLine(`> ${line}`, ANSI_GREEN);
        } else if (role === "assistant") {
          for (const line of content.split("\n")) screen.writeLine(line, ANSI_AGENT);
        } else if (role === "toolcall" || role === "tool_call") {
          screen.writeLine(`◈ ${singleLine(content, 160)}`, ANSI_TOOL);
        }
      }
    }
    return app;
  }

  private render(): void {
    const candidates = this.input.pickerCandidates();
    const { rows: picker, selected: pickerSelected } = pickerWindow(
      candidates,
      this.input.pickerIndex,
      8,
    );
    this.screen.render(
      this.input.value(),
      this.input.cursor,
      picker,
      pickerSelected,
      this.statusText(),
    );
  }

  private statusText(): string {
    const session = this.ui.session;
    const cost = typeof session.totalCost === "number" ? session.totalCost : 0;
    const state = this.running
      ? "working...  Ctrl-C aborts"
      : this.noKey
        ? "no API key: run tiny-crow --setup"
        : this.askPrompt !== null
          ? "permission needed: y allow once, a allow always, n deny"
          : "ready";
    return `${session.provider} / ${session.model} | ${session.messages.length} msgs | $${cost.toFixed(4)} | ${state} | /help`;
  }

  private async saveSession(): Promise<void> {
    try {
      await this.ui.saveSessionIfEnabled();
    } catch {
    }
  }

  private rendererAdapter(): Record<string, unknown> {
    return {
      writeLine: (text: string, color?: unknown) => {
        this.screen.writeLine(text, colorFor(color));
        this.render();
      },
      write: (text: string, color?: unknown) => {
        this.screen.write(text, colorFor(color));
        this.render();
      },
      clearContent: () => {
        this.screen.clearFeed();
        this.render();
      },
      setBackgroundColors: () => undefined,
      renderViewport: () => {
        this.render();
      },
    };
  }

  private inputAdapter(): Record<string, unknown> {
    return {
      trim: () => this.input.value().trim(),
      cursor: () => this.input.cursor,
      buffer: () => this.input.value(),
      setLiveModelNames: () => undefined,
      startRewindPicker: () => undefined,
    };
  }

  async run(): Promise<void> {
    try {
      this.render();
      if (this.autoTriggerMsg !== null && this.autoTriggerMsg !== "") {
        await this.submitPlain(this.autoTriggerMsg, true);
        this.render();
      }
      while (!this.quit) {
        await this.drainAgentEvents();
        this.drainBtwEvents();
        this.drainAskEvents();
        if (!this.running && this.queued.length > 0) {
          const next = this.queued.shift()!;
          await this.submitPlain(next, false);
        }
        const key = await this.keys.next(this.running ? 50 : 200);
        if (key !== null) await this.handleKey(key);
        this.render();
      }
    } finally {
      this.keys.detach();
      this.screen.leave();
    }
  }

  private async handleKey(key: CrowKey): Promise<void> {
    if (this.askPrompt !== null) {
      const req = this.askPrompt;
      if (key.kind === "char" && (key.ch === "y" || key.ch === "Y")) {
        this.askPrompt = null;
        req.reply.send({ kind: "allow_once" });
        this.screen.writeLine("allowed once", ANSI_GREEN);
      } else if (key.kind === "char" && (key.ch === "a" || key.ch === "A")) {
        this.askPrompt = null;
        const pattern = suggestPattern(req.tool, req.input);
        this.ui.session.permissionAllowlist.push({ tool: req.tool, pattern });
        req.reply.send({ kind: "allow_always", pattern });
        this.screen.writeLine(`allowed always: ${pattern}`, ANSI_GREEN);
      } else if (key.kind === "char" && (key.ch === "n" || key.ch === "N") || key.kind === "esc") {
        this.askPrompt = null;
        req.reply.send({ kind: "deny" });
        this.screen.writeLine("denied", ANSI_ERROR);
      }
      return;
    }
    if (key.kind === "ctrlc") {
      if (this.running) {
        this.abortMainRun();
      } else if (this.input.value() === "") {
        this.quit = true;
      } else {
        this.input.clear();
      }
      return;
    }
    if (key.kind === "ctrld") {
      if (this.input.value() === "") this.quit = true;
      return;
    }
    if (key.kind === "up") {
      const candidates = this.input.pickerCandidates();
      if (candidates.length > 0) {
        this.input.pickerIndex = (this.input.pickerIndex + candidates.length - 1) % candidates.length;
      } else {
        this.input.historyUp();
      }
      return;
    }
    if (key.kind === "down") {
      const candidates = this.input.pickerCandidates();
      if (candidates.length > 0) {
        this.input.pickerIndex = (this.input.pickerIndex + 1) % candidates.length;
      } else {
        this.input.historyDown();
      }
      return;
    }
    if (key.kind === "enter") {
      const applied = this.input.enterSlash();
      if (applied !== null) {
        this.input.pushHistory(applied);
        this.input.clear();
        await this.submit(applied);
        return;
      }
      const text = this.input.value();
      this.input.pushHistory(text);
      this.input.clear();
      if (text !== "") await this.submit(text);
      return;
    }
    if (key.kind === "esc") {
      if (this.input.pickerCandidates().length > 0) {
        this.input.dismissPicker();
        return;
      }
      this.input.clear();
      return;
    }
    if (key.kind === "pageup" || key.kind === "pagedown") return;
    this.input.handleKey(key);
  }

  private async submit(text: string): Promise<void> {
    if (text === "/quit" || text === "/exit") {
      this.quit = true;
      return;
    }
    if (text.startsWith("/queue")) {
      this.runQueueCommand(text.slice("/queue".length).trim());
      return;
    }
    if (text.startsWith("/btw ")) {
      await this.runBtw(text.slice("/btw".length).trim());
      return;
    }
    if (
      text === "/provider" || text === "/model" || text === "/models" ||
      text === "/prompt" || text === "/theme" || text === "/sessions" || text === "/help"
    ) {
      if (await this.runPanelCommand(text)) return;
    }
    if (text.startsWith("/")) {
      await this.runSlash(text);
      return;
    }
    if (text.startsWith("!")) {
      this.runBang(text);
      await this.saveSession();
      return;
    }
    if (this.running) {
      this.queued.push(text);
      this.screen.writeLine(`queued (${this.queued.length})`, ANSI_MUTED);
      return;
    }
    await this.submitPlain(text, false);
  }

  private async submitPlain(text: string, alreadyRecorded: boolean): Promise<void> {
    for (const line of text.split("\n")) {
      this.screen.writeLine(`> ${line}`, ANSI_GREEN);
    }
    if (!alreadyRecorded) this.ui.session.addMessage("user", text);
    await this.startMainRun(text);
  }

  private async startMainRun(text: string): Promise<void> {
    if (this.runState.agent === null) {
      try {
        this.runState.agent = await this.ui
          .agentBuildCtx()
          .rebuildAgent(this.ui.session.model, true);
      } catch (e) {
        this.noKey = isNoKeyError(e);
        if (this.noKey) {
          for (const line of setupGuideLines(this.ui.session.provider, this.ui.session.model)) {
            this.screen.writeLine(line, ANSI_SYSTEM);
          }
        } else {
          this.screen.writeLine(`error: ${e instanceof Error ? e.message : String(e)}`, ANSI_ERROR);
        }
        return;
      }
    }
    try {
      const history = this.ui.convertHistory(this.ui.session);
      const runner = await this.runState.agent.spawnRunner(text, history, this.ui.cfg.retry);
      this.runState.agentRx = runner.events;
      this.runState.mainAbort = runner.abortHandle;
      this.runState.isRunning = true;
      this.running = true;
      this.ui.statusSignals?.sendStart();
    } catch (e) {
      this.screen.writeLine(`error: ${e instanceof Error ? e.message : String(e)}`, ANSI_ERROR);
    }
  }

  private abortMainRun(): void {
    try {
      this.runState.mainAbort?.abort();
    } catch {
    }
    this.runState.isRunning = false;
    this.running = false;
    this.screen.endStream();
    this.streamKind = null;
    this.screen.writeLine("aborted", ANSI_ERROR);
    try {
      this.ui.statusSignals?.sendStop();
    } catch {
    }
  }

  private async drainAgentEvents(): Promise<void> {
    const rx = this.runState.agentRx;
    if (rx === null) return;
    let event: AgentEvent | null;
    while ((event = rx.tryNext()) !== null) {
      await this.handleAgentEvent(event);
    }
  }

  private addUsage(
    inputTokens: number,
    outputTokens: number,
    cached: number,
    cacheCreation: number,
    addCost: boolean,
  ): void {
    const session = this.ui.session;
    session.totalInputTokens += inputTokens;
    session.totalOutputTokens += outputTokens;
    session.totalCachedInputTokens += cached;
    session.totalCacheCreationInputTokens += cacheCreation;
    if (addCost) {
      const anthropic = configIsAnthropicNative(this.ui.cfg, session.provider, session.model);
      session.totalCost += estimateCost(
        billableInputTokens(anthropic, inputTokens, cached, cacheCreation),
        outputTokens,
        session.inputTokenCost,
        session.outputTokenCost,
      );
    }
  }

  private async handleAgentEvent(event: AgentEvent): Promise<void> {
    switch (event.type) {
      case "token": {
        if (this.streamKind !== "agent") {
          this.screen.endStream();
          this.screen.startStream(ANSI_AGENT);
          this.streamKind = "agent";
        }
        this.screen.appendStream(event.text);
        return;
      }
      case "reasoning": {
        if (!this.slashState.showReasoning) return;
        if (this.streamKind !== "reasoning") {
          this.screen.endStream();
          this.screen.startStream(ANSI_REASONING);
          this.streamKind = "reasoning";
        }
        this.screen.appendStream(event.text);
        return;
      }
      case "tool_call": {
        this.screen.endStream();
        this.streamKind = null;
        const sessionCallId = this.ui.session.addToolCall(event.name, event.args);
        this.toolCallMap.set(event.callId, sessionCallId);
        this.lastSessionCallId = sessionCallId;
        this.screen.writeLine(`◈ ${toolSummary(event.name, event.args)}`, ANSI_TOOL);
        await this.saveSession();
        return;
      }
      case "subagent_tool_call": {
        this.ui.session.addSubagentToolCall(this.lastSessionCallId, event.name, event.args);
        this.screen.writeLine(`⌥ ${toolSummary(event.name, event.args)}`, ANSI_TOOL);
        await this.saveSession();
        return;
      }
      case "tool_result": {
        const sessionCallId = this.toolCallMap.get(event.callId) ?? this.lastSessionCallId;
        this.ui.session.addToolResult(sessionCallId, event.name, event.output);
        this.screen.writeLine(`✓ ${event.name}`, ANSI_MUTED);
        await this.saveSession();
        return;
      }
      case "completion_call": {
        this.addUsage(
          event.inputTokens,
          event.outputTokens,
          event.cachedInputTokens,
          event.cacheCreationInputTokens,
          false,
        );
        return;
      }
      case "done": {
        this.screen.endStream();
        this.streamKind = null;
        this.ui.session.addMessage("assistant", event.response);
        this.addUsage(
          event.inputTokens,
          event.outputTokens,
          event.cachedInputTokens,
          event.cacheCreationInputTokens,
          true,
        );
        this.running = false;
        this.runState.isRunning = false;
        try {
          this.ui.statusSignals?.sendStop();
        } catch {
        }
        await this.saveSession();
        return;
      }
      case "retrying": {
        this.screen.writeLine(`retrying ${event.attempt}/${event.max}...`, ANSI_MUTED);
        return;
      }
      case "error": {
        this.screen.endStream();
        this.streamKind = null;
        this.screen.writeLine(`error: ${event.message}`, ANSI_ERROR);
        this.running = false;
        this.runState.isRunning = false;
        try {
          this.ui.statusSignals?.sendStop();
        } catch {
        }
        await this.saveSession();
        return;
      }
    }
  }

  private drainBtwEvents(): void {
    for (const active of [...this.btwActive]) {
      let event: BtwEvent | null;
      while ((event = active.queue.tryNext()) !== null) {
        if (event.type === "done") {
          this.screen.writeLine(`[btw #${active.id}]`, ANSI_WELCOME);
          for (const line of event.response.split("\n")) {
            this.screen.writeLine(line, ANSI_AGENT);
          }
          this.btwActive = this.btwActive.filter((item) => item !== active);
        } else {
          this.screen.writeLine(`[btw #${active.id}] error: ${event.message}`, ANSI_ERROR);
          this.btwActive = this.btwActive.filter((item) => item !== active);
        }
      }
    }
  }

  private drainAskEvents(): void {
    if (this.askEvents === null || this.askPrompt !== null) return;
    const req = this.askEvents.tryNext();
    if (req === null) return;
    this.askPrompt = req;
    this.screen.writeLine(`Allow tool '${req.tool}'?`, ANSI_PINK);
    this.screen.writeLine(`  ${singleLine(req.input, 160)}`, ANSI_SYSTEM);
    this.screen.writeLine("  y allow once | a allow always | n deny", ANSI_SYSTEM);
  }

  private runQueueCommand(arg: string): void {
    switch (arg) {
      case "clear": {
        const count = this.queued.length;
        this.queued = [];
        this.screen.writeLine(`queue cleared (${count} removed)`, ANSI_TOOL);
        return;
      }
      case "pop": {
        const item = this.queued.pop();
        if (item !== undefined) this.screen.writeLine(`unqueued: ${item}`, ANSI_TOOL);
        else this.screen.writeLine("queue is empty", ANSI_TOOL);
        return;
      }
      case "":
      case "ls":
      case "list": {
        if (this.queued.length === 0) {
          this.screen.writeLine("queue is empty", ANSI_TOOL);
        } else {
          this.screen.writeLine(`queued (${this.queued.length}):`, ANSI_TOOL);
          this.queued.forEach((item, idx) => {
            this.screen.writeLine(`  ${idx + 1}. ${item}`, ANSI_TOOL);
          });
        }
        return;
      }
      default:
        this.screen.writeLine("usage: /queue [ls|clear|pop]", ANSI_ERROR);
        return;
    }
  }

  private async runBtw(text: string): Promise<void> {
    if (text === "") {
      this.screen.writeLine("usage: /btw <message>", ANSI_AGENT);
      return;
    }
    if (this.runState.agent === null) {
      try {
        this.runState.agent = await this.ui
          .agentBuildCtx()
          .rebuildAgent(this.ui.session.model, true);
      } catch (e) {
        this.screen.writeLine(`error: ${e instanceof Error ? e.message : String(e)}`, ANSI_ERROR);
        return;
      }
    }
    const agent = this.runState.agent;
    if (agent.spawnBtw === undefined) {
      this.screen.writeLine("side-question agent unavailable", ANSI_ERROR);
      return;
    }
    const id = this.btwNextId;
    this.btwNextId = (this.btwNextId + 1) >>> 0;
    const queue = new EventQueue<BtwEvent>();
    const snapshot = {
      messages: this.ui.session.messages.map((m) => ({
        role: (m as { role?: unknown }).role,
        content: String((m as { content?: unknown }).content ?? ""),
      })),
      turnTrace: [],
      isRunning: this.running,
    };
    try {
      await agent.spawnBtw(text, snapshot, queue, id, this.ui.cfg.retry);
      this.btwActive.push({ queue, id });
      this.screen.writeLine(`[btw #${id}] thinking...`, ANSI_WELCOME);
    } catch (e) {
      this.screen.writeLine(`error: ${e instanceof Error ? e.message : String(e)}`, ANSI_ERROR);
    }
  }

  private uiApiKeys(): Record<string, string> | undefined {
    const raw = (this.ui.cfg as unknown as Record<string, unknown>)["apiKeys"];
    if (raw !== undefined && typeof raw === "object" && raw !== null) {
      return raw as Record<string, string>;
    }
    return undefined;
  }

  private async runPanelCommand(text: string): Promise<boolean> {
    switch (text) {
      case "/provider": {
        const items: PanelItem[] = PROVIDER_NAMES.map((name) => ({
          label: name,
          detail: `${name === this.ui.session.provider ? "current · " : ""}${providerKeyState(this.uiApiKeys(), name)}`,
        }));
        const idx = await runPanel(this.screen, this.keys, "provider | ↑↓ move | type to filter | Enter switch | Esc back", items);
        if (idx === null) return true;
        const name = PROVIDER_NAMES[idx]!;
        if (providerKeyState(this.uiApiKeys(), name) === "needs key") {
          this.screen.writeLine(`provider ${name} needs a key: set ${providerEnvName(name)} or run tiny-crow --setup`, ANSI_ERROR);
          return true;
        }
        await this.submit(`/provider ${name}`);
        return true;
      }
      case "/model": {
        const provider = this.ui.session.provider;
        const catalog: ModelEntry[] = [...(catalogEntries(provider) ?? [])];
        const items: PanelItem[] = catalog.map((m) => ({ label: m.id, detail: provider }));
        const quick = Object.entries(this.ui.cfg.quickModels ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
        const quickStart = items.length;
        for (const [qname, q] of quick) items.push({ label: qname, detail: `quick · ${q.provider} / ${q.model}` });
        const idx = await runPanel(this.screen, this.keys, `model (${provider}) | ↑↓ move | type to filter | Enter switch | Esc back`, items);
        if (idx === null) return true;
        if (idx >= quickStart) {
          await this.submit(`/models ${quick[idx - quickStart]![0]}`);
        } else {
          await this.submit(`/model ${catalog[idx]!.id}`);
        }
        return true;
      }
      case "/models": {
        const quick = Object.entries(this.ui.cfg.quickModels ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
        const items: PanelItem[] = quick.map(([qname, q]) => ({ label: qname, detail: `${q.provider} / ${q.model}` }));
        const idx = await runPanel(this.screen, this.keys, "quick models | ↑↓ move | type to filter | Enter switch | Esc back", items);
        if (idx === null) return true;
        await this.submit(`/models ${quick[idx]![0]}`);
        return true;
      }
      case "/prompt": {
        const current = this.ui.context.currentPromptName;
        const items: PanelItem[] = [
          { label: "default", detail: "clear prompt" },
          ...[...this.ui.context.prompts.keys()].sort().map((name) => ({
            label: name,
            detail: name === current ? "current" : "",
          })),
        ];
        const idx = await runPanel(this.screen, this.keys, "prompt | ↑↓ move | type to filter | Enter switch | Esc back", items);
        if (idx === null) return true;
        await this.submit(`/prompt ${items[idx]!.label}`);
        return true;
      }
      case "/theme": {
        const current = this.ui.context.currentThemeName;
        const items: PanelItem[] = [
          { label: "default", detail: "clear theme" },
          ...[...this.ui.context.themes.keys()].sort().map((name) => ({
            label: name,
            detail: name === current ? "current" : "",
          })),
        ];
        const idx = await runPanel(this.screen, this.keys, "theme | ↑↓ move | type to filter | Enter switch | Esc back", items);
        if (idx === null) return true;
        await this.submit(`/theme ${items[idx]!.label}`);
        return true;
      }
      case "/sessions": {
        const sessions = listSessionFiles();
        const items: PanelItem[] = sessions.map((s) => ({
          label: s.id,
          detail: `${s.provider} / ${s.model} | ${s.messages} msgs`,
        }));
        const idx = await runPanel(this.screen, this.keys, "sessions | ↑↓ move | type to filter | Enter detail | Esc back", items);
        if (idx === null) return true;
        const s = sessions[idx]!;
        const detail: PanelItem[] = [
          { label: `session: ${s.id}` },
          { label: `provider: ${s.provider}` },
          { label: `model: ${s.model}` },
          { label: `messages: ${s.messages}` },
          { label: "resume with /resume after configuring a key" },
        ];
        await runPanel(this.screen, this.keys, "session detail | Enter or Esc to go back", detail);
        return true;
      }
      case "/help": {
        const items: PanelItem[] = SLASH_COMMANDS.map((name) => ({
          label: `/${name}`,
          detail: slashDescription(name),
        }));
        const idx = await runPanel(this.screen, this.keys, "commands | ↑↓ move | type to filter | Enter run | Esc back", items);
        if (idx === null) return true;
        const name = SLASH_COMMANDS[idx]!;
        if (name === "help") return true;
        if (name === "quit" || name === "exit") {
          this.quit = true;
          return true;
        }
        await this.submit(`/${name}`);
        return true;
      }
      default:
        return false;
    }
  }

  private async runSlash(text: string): Promise<void> {
    for (const line of text.split("\n")) {
      this.screen.writeLine(`> ${line}`, ANSI_GREEN);
    }
    if (this.slashHandler === null) {
      this.screen.writeLine("error: slash commands unavailable", ANSI_ERROR);
      return;
    }
    const result = await this.slashHandler(text, {
      renderer: this.rendererAdapter(),
      input: this.inputAdapter(),
      run: this.runState,
      ui: this.ui,
      slash: this.slashState,
      chain: this.chainState,
    });
    if (result["ok"] === true) {
      await this.saveSession();
      return;
    }
    const outcome = result["outcome"] as
      | { kind?: string; instructions?: string | null; message?: string; path?: string }
      | undefined;
    if (outcome !== undefined) {
      switch (outcome.kind) {
        case "defer_compress": {
          try {
            await this.ui.handleCompress(outcome.instructions ?? null, false, this.runState.agent, this.slashState.reasoningEnabled);
          } catch (e) {
            this.screen.writeLine(`compress error: ${e instanceof Error ? e.message : String(e)}`, ANSI_ERROR);
          }
          await this.saveSession();
          return;
        }
        case "defer_init": {
          await this.startMainRun(
            "Create an AGENTS.md file in the current project that describes how to build, test, and work in this codebase, based on what you can see in the repository. Keep it concise and factual.",
          );
          return;
        }
        case "defer_review": {
          const message = outcome.message ?? "";
          this.ui.session.addMessage("user", message);
          await this.startMainRun(message);
          return;
        }
        case "defer_editor": {
          const editor = this.ui.cfg.editor ?? process.env["EDITOR"] ?? "vi";
          const path = outcome.path ?? "";
          this.screen.suspend(() => {
            const [prog, args] = parseEditorCommand(editor);
            try {
              spawnSync(prog, [...args, path], { stdio: "inherit" });
            } catch {
            }
          });
          this.keys.clear();
          this.screen.writeLine(`returned from editing ${path}`, ANSI_AGENT);
          return;
        }
        default:
          break;
      }
    }
    const error = result["error"];
    this.screen.writeLine(`error: ${error !== undefined ? String(error) : "slash command failed"}`, ANSI_ERROR);
    await this.saveSession();
  }

  private runBang(text: string): void {
    const cmd = text.slice(1).trim();
    if (cmd === "") {
      this.screen.writeLine("error: empty command after '!'", ANSI_ERROR);
      return;
    }
    for (const line of text.split("\n")) {
      this.screen.writeLine(`> ${line}`, ANSI_GREEN);
    }
    const out = spawnSync("bash", ["-c", cmd], { encoding: "utf8" });
    let result = "";
    if (out.stdout !== "") result += out.stdout;
    if (out.stderr !== "") {
      if (result !== "") result += "\n";
      result += out.stderr;
    }
    result = result.trim();
    for (const line of result.split("\n")) {
      this.screen.writeLine(line, out.status === 0 ? ANSI_AGENT : ANSI_ERROR);
    }
    this.ui.session.addMessage("user", text);
    this.ui.session.addMessage("assistant", result);
  }
}

async function loadSetupCfg() {
  try {
    return loadConfig()[0];
  } catch {
    return richDefaultConfig();
  }
}

async function setupProviderFlow(
  screen: Screen,
  keys: KeyPump,
  arg: string | null,
): Promise<void> {
  const cfg = await loadSetupCfg();
  const current = cfg.provider ?? "openrouter";
  let name = arg;
  if (name === null) {
    const items: PanelItem[] = PROVIDER_NAMES.map((p) => ({
      label: p,
      detail: `${p === current ? "current · " : ""}${providerKeyState(cfg.apiKeys, p)}`,
    }));
    const idx = await runPanel(screen, keys, "provider | ↑↓ move | type to filter | Enter select | Esc back", items);
    if (idx === null) return;
    name = PROVIDER_NAMES[idx]!;
  }
  if (!PROVIDER_NAMES.includes(name)) {
    screen.writeLine(`unknown provider: '${name}'`, ANSI_ERROR);
    return;
  }
  const state = providerKeyState(cfg.apiKeys, name);
  if (state !== "needs key") {
    cfg.provider = name;
    try {
      await saveConfig(cfg);
    } catch (e) {
      screen.writeLine(`error: could not save provider: ${e instanceof Error ? e.message : String(e)}`, ANSI_ERROR);
      return;
    }
    screen.writeLine(`Provider set to ${name} (${state}). Quit and run tiny-crow again to start chatting.`, ANSI_GREEN);
    return;
  }
  const key = await runMaskedEntry(screen, keys, `API key for ${name} (${providerEnvName(name)}) | Enter save | Esc cancel`);
  if (key === null) return;
  cfg.provider = name;
  cfg.apiKeys = { ...(cfg.apiKeys ?? {}), [name]: key };
  try {
    await saveConfig(cfg);
  } catch (e) {
    screen.writeLine(`error: could not save key: ${e instanceof Error ? e.message : String(e)}`, ANSI_ERROR);
    return;
  }
  screen.writeLine(`Saved key for ${name}. Quit and run tiny-crow again to start chatting.`, ANSI_GREEN);
}

async function setupModelFlow(
  screen: Screen,
  keys: KeyPump,
  arg: string | null,
): Promise<void> {
  const cfg = await loadSetupCfg();
  const provider = cfg.provider ?? "openrouter";
  const catalog: ModelEntry[] = [...(catalogEntries(provider) ?? [])];
  const quick = Object.entries(cfg.quickModels ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  if (arg !== null) {
    const hit = catalog.find((m) => m.id === arg);
    if (hit !== undefined) {
      cfg.model = hit.id;
      try {
        await saveConfig(cfg);
        screen.writeLine(`Model set to ${hit.id} (${provider}). Quit and run tiny-crow again to start chatting.`, ANSI_GREEN);
      } catch (e) {
        screen.writeLine(`error: could not save model: ${e instanceof Error ? e.message : String(e)}`, ANSI_ERROR);
      }
      return;
    }
    const q = cfg.quickModels?.[arg];
    if (q !== undefined) {
      cfg.provider = q.provider;
      cfg.model = q.model;
      try {
        await saveConfig(cfg);
        screen.writeLine(`Model set to ${arg} (${q.provider} / ${q.model}). Quit and run tiny-crow again to start chatting.`, ANSI_GREEN);
      } catch (e) {
        screen.writeLine(`error: could not save model: ${e instanceof Error ? e.message : String(e)}`, ANSI_ERROR);
      }
      return;
    }
    screen.writeLine(`unknown model: '${arg}'`, ANSI_ERROR);
    return;
  }
  const items: PanelItem[] = catalog.map((m) => ({ label: m.id, detail: provider }));
  const quickStart = items.length;
  for (const [qname, q] of quick) items.push({ label: qname, detail: `quick · ${q.provider} / ${q.model}` });
  const idx = await runPanel(screen, keys, `model (${provider}) | ↑↓ move | type to filter | Enter select | Esc back`, items);
  if (idx === null) return;
  try {
    if (idx >= quickStart) {
      const [qname, q] = quick[idx - quickStart]!;
      cfg.provider = q.provider;
      cfg.model = q.model;
      await saveConfig(cfg);
      screen.writeLine(`Model set to ${qname} (${q.provider} / ${q.model}). Quit and run tiny-crow again to start chatting.`, ANSI_GREEN);
    } else {
      cfg.model = catalog[idx]!.id;
      await saveConfig(cfg);
      screen.writeLine(`Model set to ${catalog[idx]!.id} (${provider}). Quit and run tiny-crow again to start chatting.`, ANSI_GREEN);
    }
  } catch (e) {
    screen.writeLine(`error: could not save model: ${e instanceof Error ? e.message : String(e)}`, ANSI_ERROR);
  }
}

async function setupModelsFlow(screen: Screen, keys: KeyPump): Promise<void> {
  const cfg = await loadSetupCfg();
  const quick = Object.entries(cfg.quickModels ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  const items: PanelItem[] = quick.map(([qname, q]) => ({ label: qname, detail: `${q.provider} / ${q.model}` }));
  const idx = await runPanel(screen, keys, "quick models | ↑↓ move | type to filter | Enter select | Esc back", items);
  if (idx === null) return;
  const [qname, q] = quick[idx]!;
  cfg.provider = q.provider;
  cfg.model = q.model;
  try {
    await saveConfig(cfg);
    screen.writeLine(`Model set to ${qname} (${q.provider} / ${q.model}). Quit and run tiny-crow again to start chatting.`, ANSI_GREEN);
  } catch (e) {
    screen.writeLine(`error: could not save model: ${e instanceof Error ? e.message : String(e)}`, ANSI_ERROR);
  }
}

async function setupPromptFlow(
  screen: Screen,
  keys: KeyPump,
  arg: string | null,
): Promise<void> {
  const names = [
    ...listDirNames(path.join(repoDataDir(), "prompts"), "md"),
    ...listDirNames(path.join(dataDir(), "prompts"), "md"),
  ];
  const unique = [...new Set(names)].sort();
  if (arg !== null) {
    if (!unique.includes(arg)) {
      screen.writeLine(`unknown prompt: '${arg}'`, ANSI_ERROR);
      return;
    }
    const cfg = await loadSetupCfg();
    cfg.defaultPrompt = arg;
    try {
      await saveConfig(cfg);
      screen.writeLine(`Default prompt set to ${arg}.`, ANSI_GREEN);
    } catch (e) {
      screen.writeLine(`error: could not save prompt: ${e instanceof Error ? e.message : String(e)}`, ANSI_ERROR);
    }
    return;
  }
  const cfg = await loadSetupCfg();
  const current = cfg.defaultPrompt;
  const items: PanelItem[] = unique.map((name) => ({
    label: name,
    detail: name === current ? "current" : "",
  }));
  const idx = await runPanel(screen, keys, "prompt | ↑↓ move | type to filter | Enter select | Esc back", items);
  if (idx === null) return;
  cfg.defaultPrompt = unique[idx]!;
  try {
    await saveConfig(cfg);
    screen.writeLine(`Default prompt set to ${unique[idx]!}.`, ANSI_GREEN);
  } catch (e) {
    screen.writeLine(`error: could not save prompt: ${e instanceof Error ? e.message : String(e)}`, ANSI_ERROR);
  }
}

async function setupThemeFlow(
  screen: Screen,
  keys: KeyPump,
  arg: string | null,
): Promise<void> {
  const names = [
    ...listDirNames(path.join(repoDataDir(), "themes"), "json"),
    ...listDirNames(path.join(dataDir(), "themes"), "json"),
  ];
  const unique = [...new Set(names)].sort();
  const apply = (name: string): void => {
    try {
      mkdirSync(dataDir(), { recursive: true });
      writeFileSync(path.join(dataDir(), "theme.json"), `${JSON.stringify({ theme: name })}\n`);
      screen.writeLine(`Theme set to ${name}.`, ANSI_GREEN);
    } catch (e) {
      screen.writeLine(`error: could not save theme: ${e instanceof Error ? e.message : String(e)}`, ANSI_ERROR);
    }
  };
  if (arg !== null) {
    if (!unique.includes(arg)) {
      screen.writeLine(`unknown theme: '${arg}'`, ANSI_ERROR);
      return;
    }
    apply(arg);
    return;
  }
  const items: PanelItem[] = unique.map((name) => ({ label: name, detail: "" }));
  const idx = await runPanel(screen, keys, "theme | ↑↓ move | type to filter | Enter select | Esc back", items);
  if (idx === null) return;
  apply(unique[idx]!);
}

async function setupSessionsFlow(screen: Screen, keys: KeyPump): Promise<void> {
  const sessions = listSessionFiles();
  const items: PanelItem[] = sessions.map((s) => ({
    label: s.id,
    detail: `${s.provider} / ${s.model} | ${s.messages} msgs`,
  }));
  const idx = await runPanel(screen, keys, "sessions | ↑↓ move | type to filter | Enter detail | Esc back", items);
  if (idx === null) return;
  const s = sessions[idx]!;
  const detail: PanelItem[] = [
    { label: `session: ${s.id}` },
    { label: `provider: ${s.provider}` },
    { label: `model: ${s.model}` },
    { label: `messages: ${s.messages}` },
    { label: "to resume: configure a key with /provider, then restart and use /resume" },
  ];
  await runPanel(screen, keys, "session detail | Enter or Esc to go back", detail);
}

async function setupHelpFlow(screen: Screen, keys: KeyPump): Promise<boolean> {
  const items: PanelItem[] = SLASH_COMMANDS.map((name) => ({
    label: `/${name}`,
    detail: slashDescription(name),
  }));
  const idx = await runPanel(screen, keys, "commands | ↑↓ move | type to filter | Enter run | Esc back", items);
  if (idx === null) return false;
  const name = SLASH_COMMANDS[idx]!;
  switch (name) {
    case "provider":
      await setupProviderFlow(screen, keys, null);
      return false;
    case "model":
      await setupModelFlow(screen, keys, null);
      return false;
    case "models":
      await setupModelsFlow(screen, keys);
      return false;
    case "prompt":
      await setupPromptFlow(screen, keys, null);
      return false;
    case "theme":
      await setupThemeFlow(screen, keys, null);
      return false;
    case "sessions":
      await setupSessionsFlow(screen, keys);
      return false;
    case "quit":
    case "exit":
      return true;
    case "help":
      return false;
    default:
      screen.writeLine("This command needs a provider key. Run tiny-crow --setup after leaving this screen.", ANSI_MUTED);
      return false;
  }
}

export async function runCrowSetupMode(): Promise<void> {
  const screen = new Screen();
  const input = new LineInput();
  const keys = new KeyPump();
  screen.enter();
  keys.attach();
  const applyHeader = (): void => {
    screen.setHeader(
      centeredBanner(screen.cols).map((line) => ({ text: line, color: ANSI_WELCOME })),
    );
  };
  applyHeader();
  screen.writeLine("No provider API key is configured yet, so live chat is not available.", ANSI_SYSTEM);
  screen.writeLine("", ANSI_SYSTEM);
  screen.writeLine("To configure a provider here, open /provider and pick one.", ANSI_SYSTEM);
  screen.writeLine("Or quit this screen and run:", ANSI_SYSTEM);
  screen.writeLine("  tiny-crow --setup", ANSI_SYSTEM);
  screen.writeLine("", ANSI_SYSTEM);
  screen.writeLine("Or set the provider key in your environment or config, then start again.", ANSI_SYSTEM);
  screen.writeLine("Type /quit to leave, /help to see commands.", ANSI_SYSTEM);
  const renderSetup = (): void => {
    const candidates = input.pickerCandidates();
    const { rows: picker, selected: pickerSelected } = pickerWindow(
      candidates,
      input.pickerIndex,
      8,
    );
    screen.render(input.value(), input.cursor, picker, pickerSelected, "setup mode | /quit to leave");
  };
  screen.setResizeHandler(() => {
    applyHeader();
    renderSetup();
  });
  try {
    let quit = false;
    while (!quit) {
      renderSetup();
      const key = await keys.next(0);
      if (key === null) continue;
      if (key.kind === "ctrlc") {
        if (input.value() === "") quit = true;
        else input.clear();
        continue;
      }
      if (key.kind === "ctrld" && input.value() === "") {
        quit = true;
        continue;
      }
      if (key.kind === "up") {
        const candidates = input.pickerCandidates();
        if (candidates.length > 0) {
          input.pickerIndex = (input.pickerIndex + candidates.length - 1) % candidates.length;
        } else {
          input.historyUp();
        }
        continue;
      }
      if (key.kind === "down") {
        const candidates = input.pickerCandidates();
        if (candidates.length > 0) {
          input.pickerIndex = (input.pickerIndex + 1) % candidates.length;
        } else {
          input.historyDown();
        }
        continue;
      }
      if (key.kind === "enter") {
        const applied = input.enterSlash();
        const text = (applied ?? input.value()).trim();
        input.pushHistory(text);
        input.clear();
        if (text === "/quit" || text === "/exit") {
          quit = true;
        } else if (text === "") {
        } else if (text.startsWith("/")) {
          const parts = text.slice(1).split(/\s+/);
          const cmd = parts[0] ?? "";
          const arg = parts[1] ?? null;
          switch (cmd) {
            case "provider":
              await setupProviderFlow(screen, keys, arg);
              break;
            case "model":
              await setupModelFlow(screen, keys, arg);
              break;
            case "models":
              await setupModelsFlow(screen, keys);
              break;
            case "prompt":
              await setupPromptFlow(screen, keys, arg);
              break;
            case "theme":
              await setupThemeFlow(screen, keys, arg);
              break;
            case "sessions":
              await setupSessionsFlow(screen, keys);
              break;
            case "help":
              if (await setupHelpFlow(screen, keys)) quit = true;
              break;
            default:
              screen.writeLine("This command needs a provider key. Run tiny-crow --setup after leaving this screen.", ANSI_MUTED);
              break;
          }
        } else {
          screen.writeLine("Live chat needs a provider key. Run tiny-crow --setup after leaving this screen.", ANSI_MUTED);
        }
        continue;
      }
      if (key.kind === "esc") {
        if (input.pickerCandidates().length > 0) {
          input.dismissPicker();
        } else {
          input.clear();
        }
        continue;
      }
      if (key.kind === "pageup" || key.kind === "pagedown") continue;
      input.handleKey(key);
    }
  } finally {
    keys.detach();
    screen.leave();
  }
}
