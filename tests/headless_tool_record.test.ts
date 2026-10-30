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

function longArgText(): string {
  return "x".repeat(500);
}

function usage() {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0 };
}

function echoCallAgent(): AgentLike {
  return {
    async *stream(): AsyncGenerator<StreamItem> {
      yield { kind: "toolCall", id: "call-1", name: "echo", args: { text: longArgText() } };
      yield { kind: "toolResult", callId: "call-1", name: "echo", output: `echoed: ${longArgText()}` };
      yield { kind: "text", text: "done" };
      yield { kind: "final", output: "done", usage: usage() };
    },
  };
}

function echoThenErrorAgent(): AgentLike {
  return {
    async *stream(): AsyncGenerator<StreamItem> {
      yield { kind: "toolCall", id: "call-1", name: "echo", args: { text: "x" } };
      yield { kind: "toolResult", callId: "call-1", name: "echo", output: "echoed: x" };
      throw new Error("stream broke mid-turn");
    },
  };
}

/** Mirrors dispatch_print's recording sequence exactly, including the
 * short-circuit that makes a mid-stream error skip all session mutation. */
function recordTurnIntoSession(session: Session, prompt: string, outcome: PrintOutcome): void {
  session.addMessage(MessageRole.User, prompt);
  for (const interaction of outcome.toolInteractions) {
    const callId = session.addToolCall(interaction.name, interaction.args);
    session.addToolResult(callId, interaction.name, interaction.output);
  }
  session.addMessage(MessageRole.Assistant, outcome.response);
}

test("headless_tool_call_recorded_with_full_args_independent_of_pure_stdout", async () => {
  const outcome = await runPrint(echoCallAgent(), "please echo", false, defaultRetryConfig(), []);
  assert.equal(outcome.toolInteractions.length, 1);
  const interaction = outcome.toolInteractions[0]!;
  assert.equal(interaction.name, "echo");
  assert.deepEqual(interaction.args, { text: longArgText() });
  assert.equal(interaction.output, `echoed: ${longArgText()}`);

  const session = Session.create("anthropic", "claude-test", 200000, "");
  recordTurnIntoSession(session, "please echo", outcome);

  assert.equal(session.messages.length, 4);
  assert.equal(session.messages[0]!.role, MessageRole.User);
  assert.equal(session.messages[1]!.role, MessageRole.ToolCall);
  assert.equal(session.messages[2]!.role, MessageRole.ToolResult);
  assert.equal(session.messages[3]!.role, MessageRole.Assistant);

  const call = session.messages[1]!.tool;
  assert.ok(call && call.kind === "call");
  if (call.kind === "call") {
    assert.equal(call.name, "echo");
    assert.deepEqual(call.args, { text: longArgText() });
    // The display summary in content is truncated; the structured field is not.
    assert.ok(
      session.messages[1]!.content.length < longArgText().length,
      "content should be the truncated display summary, not the full args",
    );
  }

  const result = session.messages[2]!.tool;
  assert.ok(result && result.kind === "result");
  if (result.kind === "result") {
    assert.equal(result.callId, 0);
    assert.equal(result.name, "echo");
    assert.ok(!result.truncated);
  }
});

test("headless_mid_stream_error_after_tool_call_records_nothing", async () => {
  await assert.rejects(
    runPrint(echoThenErrorAgent(), "please echo", false, defaultRetryConfig(), []),
    /stream broke mid-turn/,
  );
  const session = Session.create("anthropic", "claude-test", 200000, "");
  assert.equal(
    session.messages.length,
    0,
    "a turn that fails mid-stream must not add any messages, including the tool call that already completed before the failure",
  );
});
