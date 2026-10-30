import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { defaultCli } from "../src/cli.ts";
import { defaultConfig } from "../src/config/mod.ts";
import type { ContextFiles } from "../src/ui/state.ts";

function emptyContext(): ContextFiles {
  // App consumes the UI ContextFiles shape (Map-based prompts/themes),
  // not the context slice's Record-based shape.
  return {
    prompts: new Map<string, string>(),
    extraPromptsDirs: [],
    themes: new Map<string, string>(),
    chainDeclined: [],
    reload() {},
  };
}
import { Sandbox } from "../src/sandbox.ts";
import { Session } from "../src/session/mod.ts";
import { App, type SlashHandler } from "../src/ui/app.ts";
import { renderSession, showWelcome } from "../src/ui/events.ts";
import { StringBackend } from "../src/ui/renderer.ts";
import { handleSlash, SlashCtx } from "../src/ui/slash/mod.ts";
import {
  EventQueue,
  makeKeyEvent,
  UiContext,
  type AgentEvent,
  type AnyAgent,
  type UserEvent,
} from "../src/ui/state.ts";

class FakeAgent implements AnyAgent {
  turns: string[][];
  requests: string[] = [];
  private idx = 0;

  constructor(turns: string[][]) {
    this.turns = turns;
  }

  async spawnRunner(prompt: string, _history: unknown[], _retry: unknown): Promise<{ events: EventQueue<AgentEvent>; abortHandle: { abort(): void } }> {
    this.requests.push(prompt);
    const events = new EventQueue<AgentEvent>();
    const chunks = this.turns[this.idx++] ?? [];
    const text = chunks.join("");
    if (text !== "") events.push({ type: "token", text });
    events.push({ type: "done", response: text, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0 });
    return { events, abortHandle: { abort() {} } };
  }
}

function isolateDataDirs(): { dir: string; prevData: string | undefined; prevConfig: string | undefined } {
  const dir = path.join(os.tmpdir(), `tiny-crow-tui-loop-tests-${process.pid}`);
  fs.mkdirSync(dir, { recursive: true });
  const prevData = process.env.TC_DATA_DIR;
  const prevConfig = process.env.TC_CONFIG_DIR;
  process.env.TC_DATA_DIR = dir;
  process.env.TC_CONFIG_DIR = dir;
  return { dir, prevData, prevConfig };
}

// The App delegates slash commands to an injected handler; production
// wiring lives outside this slice, so the test adapts the real slash
// dispatcher (slash/mod.ts) to the App's SlashHandler shape.
const slashHandler: SlashHandler = async (text, ctx) => {
  const slashCtx = new SlashCtx({
    client: ctx.ui.client as never,
    renderer: ctx.renderer as never,
    session: ctx.ui.session as never,
    cli: ctx.ui.cli as never,
    cfg: ctx.ui.cfg as never,
    context: ctx.ui.context as never,
    input: ctx.input as never,
    renderSession: renderSession as never,
    showWelcome: showWelcome as never,
  });
  try {
    await handleSlash(text, slashCtx);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

function restoreEnv(saved: { prevData: string | undefined; prevConfig: string | undefined }): void {
  if (saved.prevData === undefined) delete process.env.TC_DATA_DIR;
  else process.env.TC_DATA_DIR = saved.prevData;
  if (saved.prevConfig === undefined) delete process.env.TC_CONFIG_DIR;
  else process.env.TC_CONFIG_DIR = saved.prevConfig;
}

async function headlessApp(turns: string[][]): Promise<{ app: App; agent: FakeAgent; saved: ReturnType<typeof isolateDataDirs> }> {
  const saved = isolateDataDirs();
  const cli = { ...defaultCli(), noSession: true, noColor: true };
  const cfg = defaultConfig();
  const session = Session.create("anthropic", "claude-sonnet-4-5", 200000, "tui-loop-test");
  const context = emptyContext();
  const agent = new FakeAgent(turns);
  const ui = new UiContext({
    cli,
    cfg: cfg as never,
    session: session as never,
    context,
    client: {
      completionModel: () => ({ id: "claude-sonnet-4-5" }),
      buildAgent: async () => agent,
    },
    sandbox: new Sandbox(false, "bwrap"),
  });
  const app = await App.createHeadless({ ui, agent, backend: new StringBackend(80, 24), dataDir: saved.dir, slashHandler });
  return { app, agent, saved };
}

async function headlessAppWithQuickModels(): Promise<{ app: App; saved: ReturnType<typeof isolateDataDirs> }> {
  const saved = isolateDataDirs();
  const cli = { ...defaultCli(), noSession: true, noColor: true };
  const cfg = {
    ...defaultConfig(),
    quickModels: {
      fast: { provider: "anthropic", model: "claude-fast-test", inputTokenCost: 1.0, outputTokenCost: 2.0 },
      pro: { provider: "anthropic", model: "claude-pro-test", inputTokenCost: 3.0, outputTokenCost: 4.0 },
    },
  };
  const session = Session.create("anthropic", "claude-sonnet-4-5", 200000, "tui-switcher-test");
  const context = emptyContext();
  const agent = new FakeAgent([]);
  const ui = new UiContext({
    cli,
    cfg: cfg as never,
    session: session as never,
    context,
    client: {
      completionModel: () => ({ id: "claude-sonnet-4-5" }),
      buildAgent: async () => agent,
    },
    sandbox: new Sandbox(false, "bwrap"),
  });
  const app = await App.createHeadless({ ui, agent, backend: new StringBackend(80, 24), dataDir: saved.dir, slashHandler });
  return { app, saved };
}

function charKey(c: string): UserEvent {
  return { type: "key", key: makeKeyEvent("char", { ch: c }) };
}

function enterKey(): UserEvent {
  return { type: "key", key: makeKeyEvent("enter") };
}

function ctrlKey(c: string): UserEvent {
  return { type: "key", key: makeKeyEvent("char", { ch: c, ctrl: true }) };
}

function altKey(c: string): UserEvent {
  return { type: "key", key: makeKeyEvent("char", { ch: c, alt: true }) };
}

function escKey(): UserEvent {
  return { type: "key", key: makeKeyEvent("esc") };
}

function typeAndSubmit(app: App, text: string): void {
  for (const c of text) app.inject(charKey(c));
  app.inject(enterKey());
}

function typeSlashAndSubmit(app: App, text: string): void {
  for (const c of text) app.inject(charKey(c));
  app.inject(enterKey());
  app.inject(enterKey());
}

async function pump(app: App): Promise<void> {
  await app.step();
}

async function stepUntil(app: App, done: (a: App) => boolean): Promise<void> {
  const MAX_STEPS = 300;
  for (let i = 0; i < MAX_STEPS; i++) {
    if (done(app)) return;
    await pump(app);
  }
  assert.ok(done(app), "condition not met within 300 steps");
}

test("submit_prompt_streams_response_and_updates_session", async () => {
  const { app, saved } = await headlessApp([["hi there"]]);
  try {
    typeAndSubmit(app, "hello");
    await stepUntil(app, (a) => a.isRunning());
    await stepUntil(app, (a) => !a.isRunning());
    const messages = app.session().messages;
    assert.equal(messages.length, 2);
    assert.equal(messages[0]!.role, "user");
    assert.equal(messages[0]!.content, "hello");
    assert.equal(messages[1]!.role, "assistant");
    assert.equal(messages[1]!.content, "hi there");
    const feed = app.feedText();
    assert.ok(feed.includes("> hello"), `feed should echo the prompt: ${feed}`);
    assert.ok(feed.includes("hi there"), `feed should show the response: ${feed}`);
  } finally {
    await app.teardown();
    restoreEnv(saved);
  }
});

test("spinner_cleared_when_run_finishes", async () => {
  const { app, saved } = await headlessApp([["done"]]);
  try {
    typeAndSubmit(app, "hi");
    await stepUntil(app, (a) => a.isRunning());
    const mid = app.backendOutput();
    assert.ok(
      [...mid].some((c) => ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"].includes(c)),
      "a spinner frame should be painted while running",
    );
    await stepUntil(app, (a) => !a.isRunning());
    const snap = app.lastBottomSnapshot();
    assert.ok(snap !== null, "bottom should have been drawn at least once");
    assert.ok(!snap.isRunning, "last bottom draw should be idle after the run finishes");
    assert.equal(snap.prompt.kind, "input", "last bottom draw should show the input prompt after the run finishes");
  } finally {
    await app.teardown();
    restoreEnv(saved);
  }
});

test("queued_input_replays_after_current_run", async () => {
  const { app, agent, saved } = await headlessApp([["answer one"], ["answer two"]]);
  try {
    typeAndSubmit(app, "first");
    typeAndSubmit(app, "second");
    await stepUntil(app, (a) => a.feedText().includes("queued: second"));
    await stepUntil(app, (a) => a.isRunning() && a.session().messages.length >= 3);
    await stepUntil(app, (a) => !a.isRunning());
    assert.equal(agent.requests.length, 2, "both turns should have reached the model");
    const roles = app.session().messages.map((m) => [m.role, m.content]);
    assert.deepEqual(roles, [
      ["user", "first"],
      ["assistant", "answer one"],
      ["user", "second"],
      ["assistant", "answer two"],
    ]);
  } finally {
    await app.teardown();
    restoreEnv(saved);
  }
});

test("ctrl_c_exits_main_loop_when_idle", async () => {
  const { app, saved } = await headlessApp([]);
  try {
    app.inject(ctrlKey("c"));
    await app.run();
  } finally {
    await app.teardown();
    restoreEnv(saved);
  }
});

test("slash_clear_resets_session_and_feed", async () => {
  const { app, saved } = await headlessApp([["hi there"]]);
  try {
    typeAndSubmit(app, "hello");
    await stepUntil(app, (a) => !a.isRunning() && a.session().messages.length === 2);
    assert.ok(app.feedText().includes("hi there"));
    typeSlashAndSubmit(app, "/clear");
    await stepUntil(app, (a) => a.session().messages.length === 0 && !a.feedText().includes("hi there"));
    assert.equal(app.session().messages.length, 0);
    const feed = app.feedText();
    assert.ok(feed.includes("tiny-crow"), `cleared feed should show the fresh welcome block: ${feed}`);
  } finally {
    await app.teardown();
    restoreEnv(saved);
  }
});

test("fake_backend_captures_output_and_paste_fills_input", async () => {
  const { app, saved } = await headlessApp([]);
  try {
    const captured = app.backendOutput();
    assert.ok(captured.includes("\x1b"), `backend should capture ANSI frames, got ${captured.length} bytes`);
    app.inject({ type: "paste", data: "a\nb" });
    await pump(app);
    assert.equal(app.inputBuffer(), "a\nb");
  } finally {
    await app.teardown();
    restoreEnv(saved);
  }
});

test("ctrl_c_aborts_running_agent", async () => {
  // The aborted run's turn is empty on purpose: in the Rust test the
  // aborted runner never reaches the model, so the single scripted turn
  // still serves the retry. The TS runner is spawned eagerly at submit,
  // so the empty first turn models that "never reached" state.
  const { app, agent, saved } = await headlessApp([[], ["second answer"]]);
  try {
    typeAndSubmit(app, "hello");
    app.inject(ctrlKey("c"));
    await stepUntil(app, (a) => !a.isRunning() && a.feedText().includes("interrupted"));
    assert.equal(agent.requests.length, 1, "the aborted turn was spawned but never completed");
    const messages = app.session().messages;
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.role, "user");
    typeAndSubmit(app, "again");
    await stepUntil(app, (a) => !a.isRunning() && a.session().messages.length === 3);
    const after = app.session().messages;
    assert.equal(after[1]!.content, "again");
    assert.equal(after[2]!.content, "second answer");
  } finally {
    await app.teardown();
    restoreEnv(saved);
  }
});

test("slash_rejected_while_running", async () => {
  const { app, saved } = await headlessApp([["answer"]]);
  try {
    typeAndSubmit(app, "hello");
    typeSlashAndSubmit(app, "/help");
    await stepUntil(app, (a) => a.feedText().includes("agent is running — wait for it to finish"));
    await stepUntil(app, (a) => !a.isRunning() && a.session().messages.length === 2);
    assert.equal(app.session().messages[1]!.content, "answer");
  } finally {
    await app.teardown();
    restoreEnv(saved);
  }
});

test("queue_commands_list_and_pop", async () => {
  const { app, agent, saved } = await headlessApp([["answer a"]]);
  try {
    typeAndSubmit(app, "a");
    typeAndSubmit(app, "b");
    typeSlashAndSubmit(app, "/queue ls");
    typeSlashAndSubmit(app, "/queue pop");
    await stepUntil(app, (a) => a.feedText().includes("  1. b"));
    await stepUntil(app, (a) => a.feedText().includes("unqueued: b"));
    await stepUntil(app, (a) => !a.isRunning());
    const feed = app.feedText();
    assert.ok(feed.includes("queued: b"), `feed: ${feed}`);
    assert.ok(feed.includes("queued (1):"), `feed: ${feed}`);
    assert.equal(agent.requests.length, 1);
    const messages = app.session().messages;
    assert.equal(messages.length, 2);
    assert.equal(messages[0]!.content, "a");
  } finally {
    await app.teardown();
    restoreEnv(saved);
  }
});

test("paste_multiline_submits_as_one_message", async () => {
  const { app, saved } = await headlessApp([["got it"]]);
  try {
    app.inject({ type: "paste", data: "line1\nline2" });
    app.inject(enterKey());
    await stepUntil(app, (a) => !a.isRunning() && a.session().messages.length === 2);
    const messages = app.session().messages;
    assert.equal(messages[0]!.role, "user");
    assert.equal(messages[0]!.content, "line1\nline2");
  } finally {
    await app.teardown();
    restoreEnv(saved);
  }
});

test("ctrl_r_toggles_reasoning_visibility", async () => {
  const { app, saved } = await headlessApp([]);
  try {
    app.inject(ctrlKey("r"));
    await stepUntil(app, (a) => a.feedText().includes("reasoning visibility: on"));
    app.inject(ctrlKey("r"));
    await stepUntil(app, (a) => a.feedText().includes("reasoning visibility: off"));
  } finally {
    await app.teardown();
    restoreEnv(saved);
  }
});

test("alt_m_switcher_esc_cancels_without_switching", async () => {
  const { app, saved } = await headlessAppWithQuickModels();
  try {
    const before = app.session().model;
    app.inject(altKey("m"));
    await stepUntil(app, (a) => a.switcherKind() === "model");
    app.inject(escKey());
    await stepUntil(app, (a) => a.switcherKind() == null);
    assert.equal(app.session().model, before);
  } finally {
    await app.teardown();
    restoreEnv(saved);
  }
});

test("scroll_and_resize_events", async () => {
  const longResponse = Array.from({ length: 45 }, (_, i) => `response line ${i}`).join("\n");
  const { app, saved } = await headlessApp([[longResponse]]);
  try {
    typeAndSubmit(app, "hello");
    await stepUntil(app, (a) => !a.isRunning() && a.session().messages.length === 2);
    assert.ok(!app.isScrolling());
    for (let i = 0; i < 3; i++) app.inject({ type: "scroll_up" });
    await stepUntil(app, (a) => a.isScrolling());
    assert.ok(app.backendOutput().includes("SCROLL"), "scrolled viewport should paint a scroll indicator");
    for (let i = 0; i < 3; i++) app.inject({ type: "scroll_down" });
    app.inject({ type: "resize" });
    await stepUntil(app, (a) => !a.isScrolling());
  } finally {
    await app.teardown();
    restoreEnv(saved);
  }
});
