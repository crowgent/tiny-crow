import test from "node:test";
import assert from "node:assert/strict";
import { Engine, RunKind, type EngineSession } from "../src/engine/mod.ts";
import type { AgentLike, ChatMessage, StreamItem } from "../src/agent/runner.ts";
import { MessageRole, Session } from "../src/session/mod.ts";

class FakeAgent implements AgentLike {
  turns: string[][];
  histories: ChatMessage[][] = [];
  errorNext: string | undefined;
  private index = 0;

  constructor(turns: string[][]) {
    this.turns = turns;
  }

  async *stream(prompt: string, history: ChatMessage[]): AsyncIterable<StreamItem> {
    this.histories.push([...history]);
    if (this.errorNext !== undefined) {
      const msg = this.errorNext;
      this.errorNext = undefined;
      throw new Error(msg);
    }
    const chunks = this.turns[this.index] ?? [];
    this.index++;
    for (const c of chunks) yield { kind: "text", text: c };
    yield {
      kind: "final",
      output: chunks.join(""),
      usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0 },
    };
  }
}

function makeEngine(turns: string[][]): { engine: Engine; agent: FakeAgent } {
  const agent = new FakeAgent(turns);
  const session = Session.create("anthropic", "claude-sonnet-4-5", 200000, "engine-test");
  const cli = { noSession: true, noColor: true } as never;
  const cfg = {} as never;
  const context = { prompts: {}, themes: {}, extraPromptsDirs: [] } as never;
  const client = {
    model: (_id: string) => ({}),
    buildAgent: async () => agent,
    buildBtwAgent: () => agent,
    compressMessages: async () => "",
  } as never;
  const sandbox = { enabled: false } as never;
  const engine = new Engine(cli, cfg, session as unknown as EngineSession, context, client, null, sandbox, {
    agentFactory: async () => agent,
  });
  engine.withAgent(agent);
  return { engine, agent };
}

function sessionOf(engine: Engine): Session {
  return engine.getSession() as unknown as Session;
}

test("run_string_empty_is_ignored", async () => {
  const { engine } = makeEngine([]);
  for (const input of ["", "   ", "\n\t "]) {
    const out = await engine.runString(input);
    assert.equal(out.kind, RunKind.Ignored);
    assert.equal(out.text, "");
  }
  assert.deepEqual(sessionOf(engine).messages, []);
});

test("run_string_message_runs_agent_and_updates_session", async () => {
  const { engine, agent } = makeEngine([["hi there"]]);
  const out = await engine.runString("hello");
  assert.equal(out.kind, RunKind.Agent);
  assert.equal(out.text, "hi there");
  const messages = sessionOf(engine).messages;
  assert.equal(messages.length, 2);
  assert.equal(messages[0]!.role, MessageRole.User);
  assert.equal(messages[0]!.content, "hello");
  assert.equal(messages[1]!.role, MessageRole.Assistant);
  assert.equal(messages[1]!.content, "hi there");
  assert.equal(agent.histories.length, 1);
  assert.deepEqual(agent.histories[0], []);
});

test("run_string_second_turn_sees_first_turn_history", async () => {
  const { engine, agent } = makeEngine([["one"], ["two"]]);
  await engine.runString("first");
  await engine.runString("second");
  assert.equal(agent.histories.length, 2);
  assert.equal(agent.histories[1]!.length, 2);
});

test("run_string_agent_error_rolls_back_user_message", async () => {
  const { engine, agent } = makeEngine([]);
  agent.errorNext = "stream broke";
  const out = await engine.runString("hello");
  assert.equal(out.kind, RunKind.Agent);
  assert.ok(out.text.includes("stream broke"), `error surfaces in output: ${out.text}`);
  assert.deepEqual(sessionOf(engine).messages, [], "failed turn leaves no optimistic user message");
});

test("run_string_bang_runs_shell_and_records_turn", async () => {
  const { engine } = makeEngine([]);
  const out = await engine.runString("!echo hi");
  assert.equal(out.kind, RunKind.Agent);
  assert.equal(out.text, "hi");
  const messages = sessionOf(engine).messages;
  assert.equal(messages.length, 2);
  assert.equal(messages[0]!.role, MessageRole.User);
  assert.equal(messages[0]!.content, "!echo hi");
  assert.equal(messages[1]!.role, MessageRole.Assistant);
  assert.equal(messages[1]!.content, "hi");
});

test("run_string_bang_empty_is_command_error", async () => {
  const { engine } = makeEngine([]);
  const out = await engine.runString("!  ");
  assert.equal(out.kind, RunKind.Command);
  assert.ok(out.text.includes("empty command"), `got: ${out.text}`);
  assert.deepEqual(sessionOf(engine).messages, []);
});

test("run_string_help_lists_commands", async () => {
  const { engine } = makeEngine([]);
  const out = await engine.runString("/help");
  assert.equal(out.kind, RunKind.Command);
  assert.ok(out.text.includes("/add"), `got: ${out.text}`);
  assert.ok(out.text.includes("/compress"), `got: ${out.text}`);
  assert.deepEqual(sessionOf(engine).messages, []);
});

test("run_string_unknown_command_errors", async () => {
  const { engine } = makeEngine([]);
  const out = await engine.runString("/nope-not-a-command");
  assert.equal(out.kind, RunKind.Command);
  assert.ok(out.text.includes("unknown command"), `got: ${out.text}`);
});

test("run_string_sessions_lists_without_mutation", async () => {
  const { engine } = makeEngine([]);
  const out = await engine.runString("/sessions");
  assert.equal(out.kind, RunKind.Command);
  assert.ok(out.text.includes("no saved sessions"), `isolated storage has none: ${out.text}`);
  assert.deepEqual(sessionOf(engine).messages, []);
});

test("run_string_rename_persists_in_session", async () => {
  const { engine } = makeEngine([]);
  const out = await engine.runString("/rename demo");
  assert.equal(out.kind, RunKind.Command);
  assert.ok(out.text.includes("demo"), `got: ${out.text}`);
  assert.equal(sessionOf(engine).name, "demo");
});

test("run_string_undo_redo_round_trip", async () => {
  const { engine } = makeEngine([["reply"]]);
  await engine.runString("hello");
  assert.equal(sessionOf(engine).messages.length, 2);
  const out = await engine.runString("/undo");
  assert.equal(out.kind, RunKind.Command);
  assert.deepEqual(sessionOf(engine).messages, [], `got: ${out.text}`);
  const out2 = await engine.runString("/redo");
  assert.equal(out2.kind, RunKind.Command);
  assert.equal(sessionOf(engine).messages.length, 2);
});

test("run_string_clear_empties_session", async () => {
  const { engine } = makeEngine([["reply"]]);
  await engine.runString("hello");
  await engine.runString("/clear");
  assert.deepEqual(sessionOf(engine).messages, []);
});

test("run_string_retry_reruns_last_message", async () => {
  const { engine, agent } = makeEngine([["one"], ["two"]]);
  await engine.runString("hello");
  const out = await engine.runString("/retry");
  assert.equal(out.kind, RunKind.Command);
  assert.ok(out.text.includes("two"), `got: ${out.text}`);
  assert.equal(agent.histories.length, 2);
});

test("run_string_mode_switches_security_mode", async () => {
  const agent = new FakeAgent([]);
  const session = Session.create("anthropic", "claude-sonnet-4-5", 200000, "engine-test");
  let mode = "standard";
  const permission = {
    mode: () => mode,
    setMode: (m: string) => { mode = m; },
    check: () => ({ kind: "allowed" }),
  } as never;
  const engine = new Engine(
    { noSession: true } as never,
    {} as never,
    session as unknown as EngineSession,
    { prompts: {}, themes: {}, extraPromptsDirs: [] } as never,
    { model: () => ({}), buildAgent: async () => agent, buildBtwAgent: () => agent, compressMessages: async () => "" } as never,
    permission,
    { enabled: false } as never,
    { agentFactory: async () => agent },
  );
  engine.withAgent(agent);
  const out = await engine.runString("/mode readonly");
  assert.equal(out.kind, RunKind.Command);
  assert.equal(mode, "readonly", `got: ${out.text}`);
});

test("run_string_reasoning_toggles", async () => {
  const { engine } = makeEngine([]);
  const out = await engine.runString("/reasoning");
  assert.equal(out.kind, RunKind.Command);
  assert.ok(out.text.includes("off"), `got: ${out.text}`);
  const out2 = await engine.runString("/reasoning");
  assert.ok(out2.text.includes("on"), `got: ${out2.text}`);
});

test("run_string_rewind_reports_headless_limitation", async () => {
  const { engine } = makeEngine([]);
  const out = await engine.runString("/rewind");
  assert.equal(out.kind, RunKind.Command);
  assert.ok(out.text.includes("TUI"), `got: ${out.text}`);
});

test("run_string_quit_does_not_exit_process", async () => {
  const { engine } = makeEngine([]);
  const out = await engine.runString("/quit");
  assert.equal(out.kind, RunKind.Command);
  assert.ok(out.text.includes("quit"), `got: ${out.text}`);
});

test("run_string_dot_unknown_prompt_errors", async () => {
  const { engine } = makeEngine([]);
  const out = await engine.runString(".nope-not-a-prompt");
  assert.equal(out.kind, RunKind.Command);
  assert.ok(out.text.includes("unknown prompt"), `got: ${out.text}`);
});

test("run_string_queue_is_always_empty_headless", async () => {
  const { engine } = makeEngine([]);
  const out = await engine.runString("/queue");
  assert.equal(out.kind, RunKind.Command);
  assert.ok(out.text.includes("empty"), `got: ${out.text}`);
});

test("run_string_btw_usage_without_message", async () => {
  const { engine } = makeEngine([]);
  const out = await engine.runString("/btw");
  assert.equal(out.kind, RunKind.Command);
  assert.ok(out.text.includes("usage"), `got: ${out.text}`);
  assert.deepEqual(sessionOf(engine).messages, []);
});
