import { spawnSync } from "node:child_process";
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
} from "./state.ts";
import { parseEditorCommand } from "./host-terminal.ts";
import { suggestPattern } from "./helpers.ts";
import { centeredBanner, setupGuideLines, welcomeHintLines } from "./banner.ts";
import { SLASH_COMMANDS, PROVIDER_NAMES, pickerWindow, slashCandidates, slashDescription } from "./slash.ts";
import { MaskedView, PanelView, type PanelItem } from "./panel.ts";
import {
  applyTheme,
  listPromptNames,
  listSessionFiles,
  listThemeNames,
  loadSetupCfg,
  providerEnvName,
  providerKeyState,
  setupReadyFromConfig,
  type ConfigLike,
} from "./adapter.ts";
import { catalogEntries } from "../models_catalog.ts";
import { saveConfig } from "../config/load.ts";
import type { Config } from "../config/mod.ts";
import { TuiMainScreen } from "./tui-main-screen.ts";
import { ProcessTerminal } from "./terminal.ts";
import { Text } from "./components/text.ts";
import { VStack } from "./components/v-stack.ts";
import { Input } from "./components/input.ts";
import type { Component } from "./tui.ts";

export type PituiSlashHandler = (
  text: string,
  ctx: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export interface PituiAppOptions {
  ui: UiContext;
  autoTriggerMsg?: string | null;
  slashHandler?: PituiSlashHandler | null;
  askEvents?: import("./state.ts").EventQueue<AskRequest> | null;
}

function singleLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 3)}...`;
}

function isNoKeyError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("No API key found");
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

export class PituiShell {
  mode: "chat" | "panel" | "masked" = "chat";
  ready = false;
  running = false;
  askActive = false;
  askKeyHandler: ((data: string) => boolean) | null = null;
  abortHandler: (() => void) | null = null;
  submitHandler: ((text: string) => Promise<void>) | null = null;
  private tui: TuiMainScreen;
  private inputComp = new Input({ prompt: "> " });
  private bannerText = new Text("", 0, 0);
  private feedText = new Text("", 0, 0);
  private pickerText = new Text("", 0, 0);
  private statusText = new Text("", 0, 0);
  private chatStack: VStack;
  private chatView: Component;
  private panelView: PanelView | null = null;
  private maskedView: MaskedView | null = null;
  private panelResolve: ((index: number | null) => void) | null = null;
  private maskedResolve: ((value: string | null) => void) | null = null;
  private feed: string[] = [];
  private streamBuf = "";
  private status = "ready";
  private pickerIndex = 0;
  private pickerDismissed = false;
  private lastPickerToken: string | null = null;
  private history: string[] = [];
  private historyIndex = -1;
  private draft = "";
  private quit = false;
  private quitResolve: (() => void) | null = null;
  private quitPromise: Promise<void>;

  constructor(initialFeed: string[], initialStatus: string) {
    this.feed = [...initialFeed];
    this.status = initialStatus;
    this.tui = new TuiMainScreen(new ProcessTerminal(), true);
    this.chatStack = new VStack([this.bannerText, this.feedText, this.pickerText, this.inputComp, this.statusText]);
    const shell = this;
    this.chatView = {
      invalidate(): void {
        shell.bannerText.invalidate();
        shell.feedText.invalidate();
        shell.pickerText.invalidate();
        shell.statusText.invalidate();
      },
      render(width: number): string[] {
        shell.bannerText.setText(centeredBanner(width).join("\n"));
        const lines = [...shell.feed];
        if (shell.streamBuf !== "") lines.push(...shell.streamBuf.split("\n"));
        shell.feedText.setText(lines.join("\n"));
        shell.pickerText.setText(shell.pickerLines());
        shell.statusText.setText(shell.status);
        return shell.chatStack.render(width);
      },
    };
    this.inputComp.onSubmit = (value: string) => {
      void this.handleSubmit(value);
    };
    this.tui.addChild(this.chatView);
    this.tui.addInputListener((data) => this.handleListener(data));
    this.quitPromise = new Promise<void>((resolve) => {
      this.quitResolve = resolve;
    });
  }

  private pickerLines(): string {
    const value = this.inputComp.getValue();
    if (this.pickerDismissed || !value.startsWith("/") || value.includes(" ")) return "";
    const token = value.slice(1);
    if (this.lastPickerToken !== token) {
      this.lastPickerToken = token;
      this.pickerIndex = 0;
    }
    const candidates = slashCandidates(token);
    if (candidates.length === 0) return "";
    if (this.pickerIndex >= candidates.length) this.pickerIndex = 0;
    const { rows, selected } = pickerWindow(candidates, this.pickerIndex, 8);
    return rows.map((row, i) => (i === selected ? `→ ${row.slice(2)}` : row)).join("\n");
  }

  private pickerCandidates(): string[] {
    const value = this.inputComp.getValue();
    if (!value.startsWith("/") || value.includes(" ")) return [];
    return slashCandidates(value.slice(1));
  }

  private applyPicker(): boolean {
    const candidates = this.pickerCandidates();
    if (candidates.length === 0) return false;
    const pick = candidates[this.pickerIndex % candidates.length]!;
    this.inputComp.setValue(`/${pick} `);
    this.pickerDismissed = false;
    return true;
  }

  private handleListener(data: string): { consume?: boolean } | undefined {
    if (this.askActive && this.askKeyHandler !== null) {
      if (this.askKeyHandler(data)) return { consume: true };
    }
    if (data === "\x03") {
      if (this.mode === "panel") {
        this.closePanel(null);
        return { consume: true };
      }
      if (this.mode === "masked") {
        this.closeMasked(null);
        return { consume: true };
      }
      if (this.running) {
        this.abortHandler?.();
        return { consume: true };
      }
      if (this.inputComp.getValue() === "") {
        this.requestQuit();
      } else {
        this.inputComp.setValue("");
      }
      return { consume: true };
    }
    if (this.mode !== "chat") return undefined;
    if (data === "\x04") {
      if (this.inputComp.getValue() === "") {
        this.requestQuit();
        return { consume: true };
      }
      return undefined;
    }
    if (data === "\x1b[A" || data === "\x1b[B") {
      const candidates = this.pickerCandidates();
      if (candidates.length > 0) {
        if (data === "\x1b[A") this.pickerIndex = (this.pickerIndex + candidates.length - 1) % candidates.length;
        else this.pickerIndex = (this.pickerIndex + 1) % candidates.length;
        this.tui.requestRender();
        return { consume: true };
      }
      if (data === "\x1b[A") this.historyUp();
      else this.historyDown();
      return { consume: true };
    }
    if (data === "\t") {
      if (this.applyPicker()) {
        this.tui.requestRender();
        return { consume: true };
      }
      return undefined;
    }
    if (data === "\x1b") {
      if (this.pickerCandidates().length > 0) {
        this.pickerDismissed = true;
      } else {
        this.inputComp.setValue("");
      }
      this.tui.requestRender();
      return { consume: true };
    }
    return undefined;
  }

  private historyUp(): void {
    if (this.history.length === 0) return;
    if (this.historyIndex === -1) {
      this.draft = this.inputComp.getValue();
      this.historyIndex = this.history.length - 1;
    } else if (this.historyIndex > 0) {
      this.historyIndex -= 1;
    } else {
      return;
    }
    this.inputComp.setValue(this.history[this.historyIndex]!);
    this.pickerDismissed = false;
  }

  private historyDown(): void {
    if (this.historyIndex === -1) return;
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex += 1;
      this.inputComp.setValue(this.history[this.historyIndex]!);
    } else {
      this.historyIndex = -1;
      this.inputComp.setValue(this.draft);
    }
    this.pickerDismissed = false;
  }

  private async handleSubmit(rawValue: string): Promise<void> {
    const value = rawValue.trim();
    if (value.startsWith("/") && !value.includes(" ")) {
      const token = value.slice(1);
      if (!SLASH_COMMANDS.includes(token)) {
        const candidates = slashCandidates(token);
        if (candidates.length > 0) {
          const pick = candidates[this.pickerIndex % candidates.length]!;
          await this.submit(`/${pick}`);
          return;
        }
      }
    }
    await this.submit(value);
  }

  private async submit(value: string): Promise<void> {
    if (value !== "") {
      this.history.push(value);
      if (this.history.length > 200) this.history.splice(0, this.history.length - 200);
    }
    this.historyIndex = -1;
    this.draft = "";
    this.inputComp.setValue("");
    this.pickerDismissed = false;
    this.pickerIndex = 0;
    await this.submitHandler?.(value);
    this.tui.requestRender();
  }

  requestQuit(): void {
    if (this.quit) return;
    this.quit = true;
    this.quitResolve?.();
  }

  feedLine(text: string): void {
    for (const line of text.split("\n")) this.feed.push(line);
    this.tui.requestRender();
  }

  clearFeed(): void {
    this.feed = [];
    this.tui.requestRender();
  }

  setStatus(text: string): void {
    this.status = text;
    this.tui.requestRender();
  }

  getStatus(): string {
    return this.status;
  }

  appendStream(text: string): void {
    this.streamBuf += text;
    this.tui.requestRender();
  }

  endStream(): void {
    if (this.streamBuf !== "") {
      for (const line of this.streamBuf.split("\n")) this.feed.push(line);
      this.streamBuf = "";
    }
    this.tui.requestRender();
  }

  inputValue(): string {
    return this.inputComp.getValue();
  }

  setInputValue(value: string): void {
    this.inputComp.setValue(value);
  }

  requestRender(): void {
    this.tui.requestRender();
  }

  openPanel(title: string, items: PanelItem[], statusHint: string): Promise<number | null> {
    return new Promise<number | null>((resolve) => {
      const view = new PanelView(title, statusHint, items);
      view.onSelect = (index) => {
        this.closePanel(index);
      };
      this.panelResolve = resolve;
      this.panelView = view;
      this.mode = "panel";
      this.tui.clear();
      this.tui.addChild(view);
      this.tui.setFocus(view);
      this.tui.requestRender();
    });
  }

  closePanel(index: number | null): void {
    if (this.mode !== "panel") return;
    this.panelView = null;
    this.mode = "chat";
    this.tui.clear();
    this.tui.addChild(this.chatView);
    this.tui.setFocus(this.inputComp);
    this.tui.requestRender();
    const resolve = this.panelResolve;
    this.panelResolve = null;
    resolve?.(index);
  }

  openMasked(title: string, statusHint: string): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const view = new MaskedView(title, statusHint);
      view.onDone = (value) => {
        this.closeMasked(value);
      };
      this.maskedResolve = resolve;
      this.maskedView = view;
      this.mode = "masked";
      this.tui.clear();
      this.tui.addChild(view);
      this.tui.setFocus(view);
      this.tui.requestRender();
    });
  }

  closeMasked(value: string | null): void {
    if (this.mode !== "masked") return;
    this.maskedView = null;
    this.mode = "chat";
    this.tui.clear();
    this.tui.addChild(this.chatView);
    this.tui.setFocus(this.inputComp);
    this.tui.requestRender();
    const resolve = this.maskedResolve;
    this.maskedResolve = null;
    resolve?.(value);
  }

  suspendEditor(fn: () => void): void {
    this.tui.stop();
    try {
      fn();
    } finally {
      this.tui.start();
      this.tui.setFocus(this.inputComp);
      this.tui.requestRender();
    }
  }

  async run(): Promise<boolean> {
    this.tui.start();
    this.tui.setFocus(this.inputComp);
    this.tui.requestRender();
    await this.quitPromise;
    this.tui.stop();
    return this.ready;
  }
}

const PANEL_COMMANDS = new Set(["provider", "model", "models", "prompt", "theme", "sessions", "help"]);

export class PituiApp {
  private ui: UiContext;
  private shell: PituiShell;
  private runState: AgentRunState;
  private slashState: SlashState;
  private chainState: ChainState;
  private slashHandler: PituiSlashHandler | null;
  private askEvents: import("./state.ts").EventQueue<AskRequest> | null;
  private autoTriggerMsg: string | null;
  private quit = false;
  private running = false;
  private streamKind: "agent" | "reasoning" | null = null;
  private queued: string[] = [];
  private toolCallMap = new Map<string, number>();
  private lastSessionCallId = 0;
  private btwActive: { queue: import("./state.ts").EventQueue<BtwEvent>; id: number }[] = [];
  private btwNextId = 0;
  private askPrompt: AskRequest | null = null;
  private noKey = false;

  private constructor(ui: UiContext, shell: PituiShell, opts: PituiAppOptions) {
    this.ui = ui;
    this.shell = shell;
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
    shell.abortHandler = () => this.abortMainRun();
    shell.askKeyHandler = (data) => this.handleAskKey(data);
    shell.submitHandler = (text) => this.submit(text);
  }

  static async create(opts: PituiAppOptions): Promise<PituiApp> {
    const ui = opts.ui;
    const feed: string[] = [];
    if (ui.session.messages.length > 0) {
      feed.push("Resumed session:");
      for (const message of ui.session.messages) {
        const role = (message as { role?: unknown }).role;
        const content = String((message as { content?: unknown }).content ?? "");
        if (role === "user") {
          for (const line of content.split("\n")) feed.push(`> ${line}`);
        } else if (role === "assistant") {
          for (const line of content.split("\n")) feed.push(line);
        } else if (role === "toolcall" || role === "tool_call") {
          feed.push(`◈ ${singleLine(content, 160)}`);
        }
      }
    }
    for (const line of welcomeHintLines()) feed.push(line);
    const shell = new PituiShell(feed, "ready");
    const app = new PituiApp(ui, shell, opts);
    return app;
  }

  private statusText(): string {
    const session = this.ui.session;
    const cost = typeof session.totalCost === "number" ? session.totalCost : 0;
    const state = this.running
      ? "working...  Ctrl-C aborts"
      : this.noKey
        ? "no API key: run /provider to configure one"
        : this.askPrompt !== null
          ? "permission needed: y allow once, a allow always, n deny"
          : "ready";
    return `${session.provider} / ${session.model} | ${session.messages.length} msgs | $${cost.toFixed(4)} | ${state} | /help`;
  }

  private refreshStatus(): void {
    this.shell.setStatus(this.statusText());
  }

  private async saveSession(): Promise<void> {
    try {
      await this.ui.saveSessionIfEnabled();
    } catch {
    }
  }

  private rendererAdapter(): Record<string, unknown> {
    return {
      writeLine: (text: string) => {
        this.shell.feedLine(text);
      },
      write: (text: string) => {
        this.shell.feedLine(text);
      },
      clearContent: () => {
        this.shell.clearFeed();
      },
      setBackgroundColors: () => undefined,
      renderViewport: () => {
        this.shell.requestRender();
      },
    };
  }

  private inputAdapter(): Record<string, unknown> {
    return {
      trim: () => this.shell.inputValue().trim(),
      cursor: () => this.shell.inputValue().length,
      buffer: () => this.shell.inputValue(),
      setLiveModelNames: () => undefined,
      startRewindPicker: () => undefined,
    };
  }

  async run(): Promise<void> {
    this.refreshStatus();
    const timer = setInterval(() => {
      void this.tick();
    }, 50);
    try {
      if (this.autoTriggerMsg !== null && this.autoTriggerMsg !== "") {
        await this.submitPlain(this.autoTriggerMsg, true);
      }
      await this.shell.run();
      this.quit = true;
    } finally {
      clearInterval(timer);
    }
  }

  private async tick(): Promise<void> {
    await this.drainAgentEvents();
    this.drainBtwEvents();
    this.drainAskEvents();
    if (!this.running && this.queued.length > 0) {
      const next = this.queued.shift()!;
      await this.submitPlain(next, false);
    }
    this.refreshStatus();
  }

  private handleAskKey(data: string): boolean {
    if (this.askPrompt === null) return false;
    const req = this.askPrompt;
    if (data === "y" || data === "Y") {
      this.askPrompt = null;
      this.shell.askActive = false;
      req.reply.send({ kind: "allow_once" });
      this.shell.feedLine("allowed once");
      return true;
    }
    if (data === "a" || data === "A") {
      this.askPrompt = null;
      this.shell.askActive = false;
      const pattern = suggestPattern(req.tool, req.input);
      this.ui.session.permissionAllowlist.push({ tool: req.tool, pattern });
      req.reply.send({ kind: "allow_always", pattern });
      this.shell.feedLine(`allowed always: ${pattern}`);
      return true;
    }
    if (data === "n" || data === "N" || data === "\x1b") {
      this.askPrompt = null;
      this.shell.askActive = false;
      req.reply.send({ kind: "deny" });
      this.shell.feedLine("denied");
      return true;
    }
    return false;
  }

  private async submit(text: string): Promise<void> {
    if (text === "/quit" || text === "/exit") {
      this.shell.requestQuit();
      return;
    }
    if (text.startsWith("/queue")) {
      this.runQueueCommand(text.slice("/queue".length).trim());
      this.refreshStatus();
      return;
    }
    if (text.startsWith("/btw ")) {
      await this.runBtw(text.slice("/btw".length).trim());
      this.refreshStatus();
      return;
    }
    if (text.startsWith("/")) {
      const parts = text.slice(1).split(/\s+/);
      const cmd = parts[0] ?? "";
      if (PANEL_COMMANDS.has(cmd) && parts.length === 1) {
        await this.runPanelCommand(text);
        this.refreshStatus();
        return;
      }
      await this.runSlash(text);
      this.refreshStatus();
      return;
    }
    if (text.startsWith("!")) {
      this.runBang(text);
      await this.saveSession();
      this.refreshStatus();
      return;
    }
    if (text === "") {
      this.refreshStatus();
      return;
    }
    if (this.running) {
      this.queued.push(text);
      this.shell.feedLine(`queued (${this.queued.length})`);
      return;
    }
    await this.submitPlain(text, false);
    this.refreshStatus();
  }

  private async submitPlain(text: string, alreadyRecorded: boolean): Promise<void> {
    for (const line of text.split("\n")) {
      this.shell.feedLine(`> ${line}`);
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
            this.shell.feedLine(line);
          }
          this.shell.feedLine("Use /provider here to configure a key, then chat again.");
        } else {
          this.shell.feedLine(`error: ${e instanceof Error ? e.message : String(e)}`);
        }
        this.refreshStatus();
        return;
      }
    }
    try {
      const history = this.ui.convertHistory(this.ui.session);
      const runner = await this.runState.agent.spawnRunner(text, history, this.ui.cfg.retry);
      const raw = runner as unknown as {
        events?: unknown;
        abortHandle?: { abort(): void };
        abort?: () => void;
      };
      const rawEvents = raw.events as { tryNext?: unknown } | undefined;
      if (raw.abortHandle !== undefined && rawEvents !== undefined && typeof rawEvents.tryNext === "function") {
        this.runState.agentRx = runner.events;
        this.runState.mainAbort = runner.abortHandle;
      } else {
        const queue = new EventQueue<AgentEvent>();
        this.runState.agentRx = queue;
        this.runState.mainAbort = {
          abort: () => {
            try {
              raw.abort?.();
            } catch {
            }
          },
        };
        void (async () => {
          try {
            const iterable = raw.events as AsyncIterable<Record<string, unknown>>;
            for await (const ev of iterable) {
              const type = ev["type"];
              if (type === "token" && typeof ev["text"] === "string") {
                queue.push({ type: "token", text: ev["text"] as string });
              } else if (type === "reasoning" && typeof ev["text"] === "string") {
                queue.push({ type: "reasoning", text: ev["text"] as string });
              } else if (type === "done") {
                queue.push({
                  type: "done",
                  response: typeof ev["output"] === "string" ? (ev["output"] as string) : "",
                  inputTokens: 0,
                  outputTokens: 0,
                  cachedInputTokens: 0,
                  cacheCreationInputTokens: 0,
                });
              } else if (type === "error") {
                queue.push({
                  type: "error",
                  message: typeof ev["message"] === "string" ? (ev["message"] as string) : "agent error",
                });
              }
            }
          } catch (e) {
            queue.push({ type: "error", message: e instanceof Error ? e.message : String(e) });
          } finally {
            queue.close();
          }
        })();
      }
      this.runState.isRunning = true;
      this.running = true;
      this.shell.running = true;
      this.ui.statusSignals?.sendStart();
    } catch (e) {
      this.shell.feedLine(`error: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.refreshStatus();
  }

  private abortMainRun(): void {
    try {
      this.runState.mainAbort?.abort();
    } catch {
    }
    this.runState.isRunning = false;
    this.running = false;
    this.shell.running = false;
    this.shell.endStream();
    this.streamKind = null;
    this.shell.feedLine("aborted");
    try {
      this.ui.statusSignals?.sendStop();
    } catch {
    }
    this.refreshStatus();
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
          this.shell.endStream();
          this.streamKind = "agent";
        }
        this.shell.appendStream(event.text);
        return;
      }
      case "reasoning": {
        if (!this.slashState.showReasoning) return;
        if (this.streamKind !== "reasoning") {
          this.shell.endStream();
          this.streamKind = "reasoning";
        }
        this.shell.appendStream(event.text);
        return;
      }
      case "tool_call": {
        this.shell.endStream();
        this.streamKind = null;
        const sessionCallId = this.ui.session.addToolCall(event.name, event.args);
        this.toolCallMap.set(event.callId, sessionCallId);
        this.lastSessionCallId = sessionCallId;
        this.shell.feedLine(`◈ ${toolSummary(event.name, event.args)}`);
        await this.saveSession();
        return;
      }
      case "subagent_tool_call": {
        this.ui.session.addSubagentToolCall(this.lastSessionCallId, event.name, event.args);
        this.shell.feedLine(`⌥ ${toolSummary(event.name, event.args)}`);
        await this.saveSession();
        return;
      }
      case "tool_result": {
        const sessionCallId = this.toolCallMap.get(event.callId) ?? this.lastSessionCallId;
        this.ui.session.addToolResult(sessionCallId, event.name, event.output);
        this.shell.feedLine(`✓ ${event.name}`);
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
        this.shell.endStream();
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
        this.shell.running = false;
        this.runState.isRunning = false;
        try {
          this.ui.statusSignals?.sendStop();
        } catch {
        }
        await this.saveSession();
        this.refreshStatus();
        return;
      }
      case "retrying": {
        this.shell.feedLine(`retrying ${event.attempt}/${event.max}...`);
        return;
      }
      case "error": {
        this.shell.endStream();
        this.streamKind = null;
        this.shell.feedLine(`error: ${event.message}`);
        this.running = false;
        this.shell.running = false;
        this.runState.isRunning = false;
        try {
          this.ui.statusSignals?.sendStop();
        } catch {
        }
        await this.saveSession();
        this.refreshStatus();
        return;
      }
    }
  }

  private drainBtwEvents(): void {
    for (const active of [...this.btwActive]) {
      let event: BtwEvent | null;
      while ((event = active.queue.tryNext()) !== null) {
        if (event.type === "done") {
          this.shell.feedLine(`[btw #${active.id}]`);
          for (const line of event.response.split("\n")) {
            this.shell.feedLine(line);
          }
          this.btwActive = this.btwActive.filter((item) => item !== active);
        } else {
          this.shell.feedLine(`[btw #${active.id}] error: ${event.message}`);
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
    this.shell.askActive = true;
    this.shell.feedLine(`Allow tool '${req.tool}'?`);
    this.shell.feedLine(`  ${singleLine(req.input, 160)}`);
    this.shell.feedLine("  y allow once | a allow always | n deny");
    this.refreshStatus();
  }

  private runQueueCommand(arg: string): void {
    switch (arg) {
      case "clear": {
        const count = this.queued.length;
        this.queued = [];
        this.shell.feedLine(`queue cleared (${count} removed)`);
        return;
      }
      case "pop": {
        const item = this.queued.pop();
        if (item !== undefined) this.shell.feedLine(`unqueued: ${item}`);
        else this.shell.feedLine("queue is empty");
        return;
      }
      case "":
      case "ls":
      case "list": {
        if (this.queued.length === 0) {
          this.shell.feedLine("queue is empty");
        } else {
          this.shell.feedLine(`queued (${this.queued.length}):`);
          this.queued.forEach((item, idx) => {
            this.shell.feedLine(`  ${idx + 1}. ${item}`);
          });
        }
        return;
      }
      default:
        this.shell.feedLine("usage: /queue [ls|clear|pop]");
        return;
    }
  }

  private async runBtw(text: string): Promise<void> {
    if (text === "") {
      this.shell.feedLine("usage: /btw <message>");
      return;
    }
    if (this.runState.agent === null) {
      try {
        this.runState.agent = await this.ui
          .agentBuildCtx()
          .rebuildAgent(this.ui.session.model, true);
      } catch (e) {
        this.shell.feedLine(`error: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }
    const agent = this.runState.agent;
    if (agent.spawnBtw === undefined) {
      this.shell.feedLine("side-question agent unavailable");
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
      this.shell.feedLine(`[btw #${id}] thinking...`);
    } catch (e) {
      this.shell.feedLine(`error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private uiCfg(): ConfigLike {
    return this.ui.cfg as unknown as ConfigLike;
  }

  private uiApiKeys(): Record<string, string> | undefined {
    return this.uiCfg().apiKeys ?? undefined;
  }

  private async saveUiCfg(): Promise<void> {
    try {
      await saveConfig(this.ui.cfg as unknown as Config);
    } catch {
    }
  }

  private async runPanelCommand(text: string): Promise<void> {
    switch (text) {
      case "/provider": {
        await this.liveProviderFlow();
        return;
      }
      case "/model": {
        await this.liveModelFlow();
        return;
      }
      case "/models": {
        await this.liveModelsFlow();
        return;
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
        const idx = await this.shell.openPanel("prompt", items, "prompt | ↑↓ move | type to filter | Enter switch | Esc back");
        if (idx === null) {
          this.shell.setStatus("prompt selection cancelled");
          return;
        }
        await this.runSlash(`/prompt ${items[idx]!.label}`);
        this.shell.setStatus(`prompt: ${items[idx]!.label}`);
        return;
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
        const idx = await this.shell.openPanel("theme", items, "theme | ↑↓ move | type to filter | Enter switch | Esc back");
        if (idx === null) {
          this.shell.setStatus("theme selection cancelled");
          return;
        }
        await this.runSlash(`/theme ${items[idx]!.label}`);
        this.shell.setStatus(`theme: ${items[idx]!.label}`);
        return;
      }
      case "/sessions": {
        const sessions = listSessionFiles();
        const items: PanelItem[] = sessions.map((s) => ({
          label: s.id,
          detail: `${s.provider} / ${s.model} | ${s.messages} msgs`,
        }));
        const idx = await this.shell.openPanel("sessions", items, "sessions | ↑↓ move | type to filter | Enter detail | Esc back");
        if (idx === null) {
          this.shell.setStatus("sessions selection cancelled");
          return;
        }
        const s = sessions[idx]!;
        const detail: PanelItem[] = [
          { label: `session: ${s.id}` },
          { label: `provider: ${s.provider}` },
          { label: `model: ${s.model}` },
          { label: `messages: ${s.messages}` },
          { label: "resume with /resume after configuring a key" },
        ];
        await this.shell.openPanel("session detail", detail, "session detail | Enter or Esc to go back");
        this.shell.setStatus(`session: ${s.id}`);
        return;
      }
      case "/help": {
        const items: PanelItem[] = SLASH_COMMANDS.map((name) => ({
          label: `/${name}`,
          detail: slashDescription(name),
        }));
        const idx = await this.shell.openPanel("commands", items, "commands | ↑↓ move | type to filter | Enter run | Esc back");
        if (idx === null) {
          this.shell.setStatus("help cancelled");
          return;
        }
        const name = SLASH_COMMANDS[idx]!;
        if (name === "help") {
          this.shell.setStatus("commands listed");
          return;
        }
        if (name === "quit" || name === "exit") {
          this.shell.requestQuit();
          return;
        }
        await this.submit(`/${name}`);
        return;
      }
      default:
        return;
    }
  }

  private async liveProviderFlow(): Promise<void> {
    const items: PanelItem[] = PROVIDER_NAMES.map((name) => ({
      label: name,
      detail: `${name === this.ui.session.provider ? "current · " : ""}${providerKeyState(this.uiApiKeys(), name)}`,
    }));
    const idx = await this.shell.openPanel("provider", items, "provider | ↑↓ move | type to filter | Enter switch | Esc back");
    if (idx === null) {
      this.shell.setStatus("provider selection cancelled");
      return;
    }
    const name = PROVIDER_NAMES[idx]!;
    if (providerKeyState(this.uiApiKeys(), name) === "needs key") {
      const key = await this.shell.openMasked(`API key for ${name}`, `API key for ${name} (${providerEnvName(name)}) | Enter save | Esc cancel`);
      if (key === null) {
        this.shell.setStatus("provider key entry cancelled");
        return;
      }
      const cfg = this.uiCfg();
      cfg.provider = name;
      cfg.apiKeys = { ...(cfg.apiKeys ?? {}), [name]: key };
      await this.saveUiCfg();
      this.runState.agent = null;
      this.noKey = false;
      await this.runSlash(`/provider ${name}`);
      await this.liveModelFlow();
      this.shell.setStatus(`provider: ${name} (key saved)`);
      return;
    }
    const cfg = this.uiCfg();
    cfg.provider = name;
    await this.saveUiCfg();
    this.runState.agent = null;
    await this.runSlash(`/provider ${name}`);
    await this.liveModelFlow();
    this.shell.setStatus(`provider: ${name}`);
  }

  private async liveModelFlow(): Promise<void> {
    const provider = this.ui.session.provider;
    const catalog = [...(catalogEntries(provider) ?? [])];
    const items: PanelItem[] = catalog.map((m) => ({ label: m.id, detail: provider }));
    const quick = Object.entries(this.uiCfg().quickModels ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
    const quickStart = items.length;
    for (const [qname, q] of quick) items.push({ label: qname, detail: `quick · ${q.provider} / ${q.model}` });
    const idx = await this.shell.openPanel(`model (${provider})`, items, "model | ↑↓ move | type to filter | Enter switch | Esc back");
    if (idx === null) {
      this.shell.setStatus("model selection cancelled");
      return;
    }
    if (idx >= quickStart) {
      await this.runSlash(`/models ${quick[idx - quickStart]![0]}`);
      this.shell.setStatus(`model: ${quick[idx - quickStart]![0]}`);
    } else {
      await this.runSlash(`/model ${catalog[idx]!.id}`);
      this.shell.setStatus(`model: ${catalog[idx]!.id}`);
    }
  }

  private async liveModelsFlow(): Promise<void> {
    const quick = Object.entries(this.uiCfg().quickModels ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
    if (quick.length === 0) {
      this.shell.setStatus("no quick models saved");
      return;
    }
    const items: PanelItem[] = quick.map(([qname, q]) => ({ label: qname, detail: `${q.provider} / ${q.model}` }));
    const idx = await this.shell.openPanel("quick models", items, "quick models | ↑↓ move | type to filter | Enter switch | Esc back");
    if (idx === null) {
      this.shell.setStatus("quick model selection cancelled");
      return;
    }
    await this.runSlash(`/models ${quick[idx]![0]}`);
    this.shell.setStatus(`model: ${quick[idx]![0]}`);
  }

  private async runSlash(text: string): Promise<void> {
    for (const line of text.split("\n")) {
      this.shell.feedLine(`> ${line}`);
    }
    if (this.slashHandler === null) {
      this.shell.feedLine("error: slash commands unavailable");
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
            this.shell.feedLine(`compress error: ${e instanceof Error ? e.message : String(e)}`);
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
          const editor = (this.ui.cfg as unknown as { editor?: string }).editor ?? process.env["EDITOR"] ?? "vi";
          const editorPath = outcome.path ?? "";
          this.shell.suspendEditor(() => {
            const [prog, args] = parseEditorCommand(editor);
            try {
              spawnSync(prog, [...args, editorPath], { stdio: "inherit" });
            } catch {
            }
          });
          this.shell.feedLine(`returned from editing ${editorPath}`);
          return;
        }
        default:
          break;
      }
    }
    const error = result["error"];
    this.shell.feedLine(`error: ${error !== undefined ? String(error) : "slash command failed"}`);
    await this.saveSession();
  }

  private runBang(text: string): void {
    const cmd = text.slice(1).trim();
    if (cmd === "") {
      this.shell.feedLine("error: empty command after '!'");
      return;
    }
    for (const line of text.split("\n")) {
      this.shell.feedLine(`> ${line}`);
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
      this.shell.feedLine(line);
    }
    this.ui.session.addMessage("user", text);
    this.ui.session.addMessage("assistant", result);
  }
}

async function setupProviderFlow(shell: PituiShell, arg: string | null): Promise<boolean> {
  const cfg = loadSetupCfg();
  const current = cfg.provider ?? "openrouter";
  let name = arg;
  if (name === null) {
    const items: PanelItem[] = PROVIDER_NAMES.map((p) => ({
      label: p,
      detail: `${p === current ? "current · " : ""}${providerKeyState(cfg.apiKeys, p)}`,
    }));
    const idx = await shell.openPanel("provider", items, "provider | ↑↓ move | type to filter | Enter select | Esc back");
    if (idx === null) {
      shell.setStatus("provider selection cancelled");
      return false;
    }
    name = PROVIDER_NAMES[idx]!;
  }
  if (!PROVIDER_NAMES.includes(name)) {
    shell.setStatus(`unknown provider: '${name}'`);
    return false;
  }
  const state = providerKeyState(cfg.apiKeys, name);
  if (state !== "needs key") {
    cfg.provider = name;
    try {
      await saveConfig(cfg);
    } catch (e) {
      shell.setStatus(`error: could not save provider: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
    shell.setStatus(`Provider set to ${name} (${state}).`);
    return true;
  }
  const key = await shell.openMasked(`API key for ${name}`, `API key for ${name} (${providerEnvName(name)}) | Enter save | Esc cancel`);
  if (key === null) {
    shell.setStatus("provider key entry cancelled");
    return false;
  }
  cfg.provider = name;
  cfg.apiKeys = { ...(cfg.apiKeys ?? {}), [name]: key };
  try {
    await saveConfig(cfg);
  } catch (e) {
    shell.setStatus(`error: could not save key: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
  shell.setStatus(`Saved key for ${name}.`);
  return true;
}

async function setupModelFlow(shell: PituiShell, arg: string | null): Promise<boolean> {
  const cfg = loadSetupCfg();
  const provider = cfg.provider ?? "openrouter";
  const catalog = [...(catalogEntries(provider) ?? [])];
  const quick = Object.entries(cfg.quickModels ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  if (arg !== null) {
    const hit = catalog.find((m) => m.id === arg);
    if (hit !== undefined) {
      cfg.model = hit.id;
      try {
        await saveConfig(cfg);
        shell.setStatus(`Model set to ${hit.id} (${provider}).`);
        return true;
      } catch (e) {
        shell.setStatus(`error: could not save model: ${e instanceof Error ? e.message : String(e)}`);
      }
      return false;
    }
    const q = cfg.quickModels?.[arg];
    if (q !== undefined) {
      cfg.provider = q.provider;
      cfg.model = q.model;
      try {
        await saveConfig(cfg);
        shell.setStatus(`Model set to ${arg} (${q.provider} / ${q.model}).`);
        return true;
      } catch (e) {
        shell.setStatus(`error: could not save model: ${e instanceof Error ? e.message : String(e)}`);
      }
      return false;
    }
    shell.setStatus(`unknown model: '${arg}'`);
    return false;
  }
  const items: PanelItem[] = catalog.map((m) => ({ label: m.id, detail: provider }));
  const quickStart = items.length;
  for (const [qname, q] of quick) items.push({ label: qname, detail: `quick · ${q.provider} / ${q.model}` });
  const idx = await shell.openPanel(`model (${provider})`, items, "model | ↑↓ move | type to filter | Enter select | Esc back");
  if (idx === null) {
    shell.setStatus("model selection cancelled");
    return false;
  }
  try {
    if (idx >= quickStart) {
      const [qname, q] = quick[idx - quickStart]!;
      cfg.provider = q.provider;
      cfg.model = q.model;
      await saveConfig(cfg);
      shell.setStatus(`Model set to ${qname} (${q.provider} / ${q.model}).`);
    } else {
      cfg.model = catalog[idx]!.id;
      await saveConfig(cfg);
      shell.setStatus(`Model set to ${catalog[idx]!.id} (${provider}).`);
    }
    return true;
  } catch (e) {
    shell.setStatus(`error: could not save model: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

async function setupModelsFlow(shell: PituiShell): Promise<boolean> {
  const cfg = loadSetupCfg();
  const quick = Object.entries(cfg.quickModels ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  if (quick.length === 0) {
    shell.setStatus("no quick models saved");
    return false;
  }
  const items: PanelItem[] = quick.map(([qname, q]) => ({ label: qname, detail: `${q.provider} / ${q.model}` }));
  const idx = await shell.openPanel("quick models", items, "quick models | ↑↓ move | type to filter | Enter select | Esc back");
  if (idx === null) {
    shell.setStatus("quick model selection cancelled");
    return false;
  }
  const [qname, q] = quick[idx]!;
  cfg.provider = q.provider;
  cfg.model = q.model;
  try {
    await saveConfig(cfg);
    shell.setStatus(`Model set to ${qname} (${q.provider} / ${q.model}).`);
    return true;
  } catch (e) {
    shell.setStatus(`error: could not save model: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

async function setupPromptFlow(shell: PituiShell, arg: string | null): Promise<void> {
  const unique = listPromptNames();
  if (arg !== null) {
    if (!unique.includes(arg)) {
      shell.setStatus(`unknown prompt: '${arg}'`);
      return;
    }
    const cfg = loadSetupCfg();
    cfg.defaultPrompt = arg;
    try {
      await saveConfig(cfg);
      shell.setStatus(`Default prompt set to ${arg}.`);
    } catch (e) {
      shell.setStatus(`error: could not save prompt: ${e instanceof Error ? e.message : String(e)}`);
    }
    return;
  }
  const cfg = loadSetupCfg();
  const current = cfg.defaultPrompt;
  const items: PanelItem[] = unique.map((name) => ({
    label: name,
    detail: name === current ? "current" : "",
  }));
  const idx = await shell.openPanel("prompt", items, "prompt | ↑↓ move | type to filter | Enter select | Esc back");
  if (idx === null) {
    shell.setStatus("prompt selection cancelled");
    return;
  }
  cfg.defaultPrompt = unique[idx]!;
  try {
    await saveConfig(cfg);
    shell.setStatus(`Default prompt set to ${unique[idx]!}.`);
  } catch (e) {
    shell.setStatus(`error: could not save prompt: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function setupThemeFlow(shell: PituiShell, arg: string | null): Promise<void> {
  const unique = listThemeNames();
  if (arg !== null) {
    if (!unique.includes(arg)) {
      shell.setStatus(`unknown theme: '${arg}'`);
      return;
    }
    if (applyTheme(arg)) shell.setStatus(`Theme set to ${arg}.`);
    else shell.setStatus("error: could not save theme");
    return;
  }
  const items: PanelItem[] = unique.map((name) => ({ label: name, detail: "" }));
  const idx = await shell.openPanel("theme", items, "theme | ↑↓ move | type to filter | Enter select | Esc back");
  if (idx === null) {
    shell.setStatus("theme selection cancelled");
    return;
  }
  if (applyTheme(unique[idx]!)) shell.setStatus(`Theme set to ${unique[idx]!}.`);
  else shell.setStatus("error: could not save theme");
}

async function setupSessionsFlow(shell: PituiShell): Promise<void> {
  const sessions = listSessionFiles();
  const items: PanelItem[] = sessions.map((s) => ({
    label: s.id,
    detail: `${s.provider} / ${s.model} | ${s.messages} msgs`,
  }));
  const idx = await shell.openPanel("sessions", items, "sessions | ↑↓ move | type to filter | Enter detail | Esc back");
  if (idx === null) {
    shell.setStatus("sessions selection cancelled");
    return;
  }
  const s = sessions[idx]!;
  const detail: PanelItem[] = [
    { label: `session: ${s.id}` },
    { label: `provider: ${s.provider}` },
    { label: `model: ${s.model}` },
    { label: `messages: ${s.messages}` },
    { label: "to resume: configure a key with /provider, then use /resume in live chat" },
  ];
  await shell.openPanel("session detail", detail, "session detail | Enter or Esc to go back");
  shell.setStatus(`session: ${s.id}`);
}

async function setupHelpFlow(shell: PituiShell): Promise<boolean> {
  const items: PanelItem[] = SLASH_COMMANDS.map((name) => ({
    label: `/${name}`,
    detail: slashDescription(name),
  }));
  const idx = await shell.openPanel("commands", items, "commands | ↑↓ move | type to filter | Enter run | Esc back");
  if (idx === null) return false;
  const name = SLASH_COMMANDS[idx]!;
  switch (name) {
    case "provider":
      await setupProviderFlow(shell, null);
      return false;
    case "model":
      await setupModelFlow(shell, null);
      return false;
    case "models":
      await setupModelsFlow(shell);
      return false;
    case "prompt":
      await setupPromptFlow(shell, null);
      return false;
    case "theme":
      await setupThemeFlow(shell, null);
      return false;
    case "sessions":
      await setupSessionsFlow(shell);
      return false;
    case "quit":
    case "exit":
      return true;
    case "help":
      return false;
    default:
      shell.setStatus("This command needs a provider key. Run tiny-crow --setup after leaving this screen.");
      return false;
  }
}

export async function runPituiSetupMode(): Promise<boolean> {
  const feed = [
    "No provider API key is configured yet, so live chat is not available.",
    "",
    "To configure a provider here, open /provider and pick one.",
    "After a provider is ready, this screen switches to live chat automatically.",
    "",
    "Or set the provider key in your environment or config, then start again.",
    "Type /quit to leave, /help to see commands.",
  ];
  const shell = new PituiShell(feed, "setup mode | /quit to leave");
  shell.submitHandler = async (text: string) => {
    let checkTransition = false;
    if (text === "/quit" || text === "/exit") {
      shell.requestQuit();
    } else if (text === "") {
    } else if (text.startsWith("/")) {
      const parts = text.slice(1).split(/\s+/);
      const cmd = parts[0] ?? "";
      const arg = parts[1] ?? null;
      switch (cmd) {
        case "provider":
          checkTransition = await setupProviderFlow(shell, arg);
          break;
        case "model":
          checkTransition = await setupModelFlow(shell, arg);
          break;
        case "models":
          checkTransition = await setupModelsFlow(shell);
          break;
        case "prompt":
          await setupPromptFlow(shell, arg);
          break;
        case "theme":
          await setupThemeFlow(shell, arg);
          break;
        case "sessions":
          await setupSessionsFlow(shell);
          break;
        case "help":
          if (await setupHelpFlow(shell)) shell.requestQuit();
          else checkTransition = true;
          break;
        default:
          shell.setStatus("This command needs a provider key. Configure a provider first with /provider.");
          break;
      }
    } else {
      const cfg = loadSetupCfg();
      if (setupReadyFromConfig(cfg) && (cfg.model ?? "") !== "") {
        shell.ready = true;
        shell.requestQuit();
      } else {
        shell.setStatus("Configure a provider first with /provider, then chat here.");
      }
    }
    if (checkTransition) {
      const cfg = loadSetupCfg();
      if (setupReadyFromConfig(cfg)) {
        if ((cfg.model ?? "") === "") {
          await setupModelFlow(shell, null);
          const afterModel = loadSetupCfg();
          if (setupReadyFromConfig(afterModel) && (afterModel.model ?? "") !== "") {
            shell.ready = true;
            shell.requestQuit();
          }
        } else {
          shell.ready = true;
          shell.requestQuit();
        }
      }
    }
  };
  return shell.run();
}

