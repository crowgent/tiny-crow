import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultRetryConfig,
  runPrint,
  type AgentLike,
  type PrintOutcome,
  type StreamItem,
} from "../src/agent/runner.ts";
import { MessageRole, Session } from "../src/session/mod.ts";

function longPrompt(tag: string): string {
  return `${tag}-${"x".repeat(500)}`;
}

function usage() {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0 };
}

function taskTurnAgent(taskPrompts: string[][]): AgentLike {
  return {
    async *stream(): AsyncGenerator<StreamItem> {
      for (const prompts of taskPrompts) {
        yield { kind: "toolCall", id: `call-${prompts[0]}`, name: "task", args: { prompts } };
        for (const prompt of prompts) {
          yield { kind: "subagentToolCall", name: "grep", args: { pattern: prompt } };
        }
        yield { kind: "toolResult", callId: `call-${prompts[0]}`, name: "task", output: `investigated ${prompts.length} prompt(s)` };
      }
      yield { kind: "text", text: "done" };
      yield { kind: "final", output: "done", usage: usage() };
    },
  };
}

function recordTurnIntoSession(session: Session, prompt: string, outcome: PrintOutcome): void {
  session.addMessage(MessageRole.User, prompt);
  for (const interaction of outcome.toolInteractions) {
    const callId = session.addToolCall(interaction.name, interaction.args);
    for (const subagentCall of interaction.subagentCalls) {
      session.addSubagentToolCall(callId, subagentCall.name, subagentCall.args);
    }
    session.addToolResult(callId, interaction.name, interaction.output);
  }
  session.addMessage(MessageRole.Assistant, outcome.response);
}

function callIdOf(session: Session, index: number): number {
  const tool = session.messages[index]!.tool;
  assert.ok(tool && tool.kind === "call", `expected a Call record at message ${index}, got ${JSON.stringify(tool)}`);
  return (tool as { kind: "call"; id: number }).id;
}

function subagentRecord(session: Session, index: number): [number, string, unknown] {
  const tool = session.messages[index]!.tool;
  assert.ok(tool && tool.kind === "subagentCall", `expected a SubagentCall record at message ${index}, got ${JSON.stringify(tool)}`);
  const t = tool as { kind: "subagentCall"; parentCallId: number; name: string; args: unknown };
  return [t.parentCallId, t.name, t.args];
}

test("headless_subagent_calls_recorded_with_full_args_and_parent_call_id", async () => {
  const prompts = [longPrompt("first"), longPrompt("second")];
  const outcome = await runPrint(taskTurnAgent([prompts]), "investigate", false, defaultRetryConfig(), []);
  assert.equal(outcome.toolInteractions.length, 1);
  const interaction = outcome.toolInteractions[0]!;
  assert.equal(interaction.name, "task");
  assert.deepEqual(
    interaction.subagentCalls.map((c) => [c.name, c.args]),
    prompts.map((p) => ["grep", { pattern: p }]),
    "every subagent tool call of the enclosing task call must be collected, in order and with complete args",
  );

  const session = Session.create("anthropic", "claude-test", 200000, "");
  recordTurnIntoSession(session, "investigate", outcome);
  assert.deepEqual(
    session.messages.map((m) => m.role),
    [MessageRole.User, MessageRole.ToolCall, MessageRole.SubagentToolCall, MessageRole.SubagentToolCall, MessageRole.ToolResult, MessageRole.Assistant],
    "subagent calls belong between their task call and its result, the order they happened in",
  );

  const taskCallId = callIdOf(session, 1);
  prompts.forEach((prompt, offset) => {
    const [parentCallId, name, args] = subagentRecord(session, 2 + offset);
    assert.equal(parentCallId, taskCallId);
    assert.equal(name, "grep");
    assert.deepEqual(args, { pattern: prompt });
    assert.ok(
      session.messages[2 + offset]!.content.length < prompt.length,
      "content should be the truncated display summary, not the full args",
    );
  });
});

test("subagent_calls_beyond_the_channel_capacity_do_not_stall_the_turn", async () => {
  const prompts: string[] = Array.from({ length: 200 }, (_, i) => `prompt ${i}`);
  const outcome = await Promise.race([
    runPrint(taskTurnAgent([prompts]), "investigate", false, defaultRetryConfig(), []),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("the turn must not stall on a full subagent event channel")), 30000),
    ),
  ]);
  assert.equal(outcome.toolInteractions.length, 1);
  assert.deepEqual(
    outcome.toolInteractions[0]!.subagentCalls.map((c) => (c.args as { pattern: string }).pattern),
    prompts,
    "every subagent call must be collected, in order, however many there are",
  );
});

test("subagent_calls_attribute_to_their_own_task_call", async () => {
  const first = ["first prompt"];
  const second = ["second prompt"];
  const outcome = await runPrint(taskTurnAgent([first, second]), "investigate", false, defaultRetryConfig(), []);
  assert.equal(outcome.toolInteractions.length, 2);
  [first, second].forEach((prompts, i) => {
    const interaction = outcome.toolInteractions[i]!;
    assert.equal(interaction.subagentCalls.length, 1);
    assert.deepEqual(
      interaction.subagentCalls[0]!.args,
      { pattern: prompts[0] },
      "a task call must collect only the subagent calls it spawned",
    );
  });

  const session = Session.create("anthropic", "claude-test", 200000, "");
  recordTurnIntoSession(session, "investigate", outcome);
  assert.equal(session.messages.length, 8);
  const firstCallId = callIdOf(session, 1);
  const secondCallId = callIdOf(session, 4);
  assert.notEqual(firstCallId, secondCallId);
  assert.equal(subagentRecord(session, 2)[0], firstCallId);
  assert.equal(subagentRecord(session, 5)[0], secondCallId);
});
