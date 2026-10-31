import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultRetryConfig,
  runPrint,
  spawnAgent,
  type AgentLike,
  type StreamItem,
} from "../src/agent/runner.ts";
import { Session } from "../src/session/mod.ts";
import { resolveToolResultCallId } from "../src/ui/event_handler.ts";
import { AgentRunState } from "../src/ui/state.ts";

async function* twoCallStream(): AsyncIterable<StreamItem> {
  yield { kind: "toolCall", id: "call-1", name: "echo", args: { text: "alpha" } };
  yield { kind: "toolCall", id: "call-2", name: "reverse", args: { text: "beta" } };
  yield { kind: "toolResult", callId: "call-1", name: "echo", output: "echoed: alpha" };
  yield { kind: "toolResult", callId: "call-2", name: "reverse", output: "ateb" };
  yield { kind: "text", text: "done" };
  yield {
    kind: "final",
    output: "done",
    usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0 },
  };
}

const twoCallAgent: AgentLike = {
  stream: () => twoCallStream(),
};

type ToolEvent =
  | { kind: "call"; id: string; name: string; args: unknown }
  | { kind: "result"; id: string; name: string; output: string };

test("run_print_pairs_each_result_with_its_own_call_in_a_parallel_batch", async () => {
  const outcome = await runPrint(twoCallAgent, "please echo and reverse", false, defaultRetryConfig(), []);
  assert.equal(outcome.toolInteractions.length, 2);
  const echo = outcome.toolInteractions.find((i) => i.name === "echo");
  assert.ok(echo, "an interaction named 'echo' must be recorded (an empty or mispaired name means single-slot tracking regressed)");
  assert.deepEqual(echo.args, { text: "alpha" });
  assert.equal(echo.output, "echoed: alpha");
  const reverse = outcome.toolInteractions.find((i) => i.name === "reverse");
  assert.ok(reverse, "an interaction named 'reverse' must be recorded");
  assert.deepEqual(reverse.args, { text: "beta" });
  assert.equal(reverse.output, "ateb");
});

test("spawn_agent_events_pair_each_result_with_its_own_call_by_id", async () => {
  const runner = spawnAgent(twoCallAgent, "please echo and reverse", [], defaultRetryConfig());
  const log: ToolEvent[] = [];
  for await (const event of runner) {
    if (event.kind === "toolCall") {
      log.push({ kind: "call", id: event.callId, name: event.name, args: event.args });
    } else if (event.kind === "toolResult") {
      log.push({ kind: "result", id: event.callId, name: event.name, output: event.output });
    } else if (event.kind === "done" || event.kind === "error") {
      break;
    }
  }
  const firstResult = log.findIndex((e) => e.kind === "result");
  assert.ok(firstResult !== -1, "the fake model's two calls must produce results");
  const callsBeforeFirstResult = log.slice(0, firstResult).filter((e) => e.kind === "call").length;
  assert.equal(
    callsBeforeFirstResult,
    2,
    "this test's premise is the parallel-batch shape: both ToolCall events must arrive before the first ToolResult",
  );
  const calls = log.filter((e): e is Extract<ToolEvent, { kind: "call" }> => e.kind === "call");
  const results = log.filter((e): e is Extract<ToolEvent, { kind: "result" }> => e.kind === "result");
  assert.equal(calls.length, 2);
  assert.equal(results.length, 2);
  assert.notEqual(calls[0]!.id, calls[1]!.id, "event ids must be unique per call");
  for (const result of results) {
    const call = calls.find((c) => c.id === result.id);
    assert.ok(call, "every ToolResult event must reference a ToolCall event's id");
    assert.equal(result.name, call.name, "a ToolResult must carry the name of the call it answers");
    const args = call.args as { text: string };
    const expected = call.name === "echo" ? `echoed: ${args.text}` : [...args.text].reverse().join("");
    assert.equal(result.output, expected);
  }
});

test("agent_run_state_pairs_each_result_of_a_two_call_batch", () => {
  const run = new AgentRunState();
  run.pushPendingToolCall("call-1", 7);
  run.pushPendingToolCall("call-2", 8);
  
  assert.equal(run.takePendingToolCall("call-2"), 8);
  assert.equal(run.takePendingToolCall("call-1"), 7);
  assert.equal(run.takePendingToolCall("call-1"), null);
  assert.ok(run.pendingToolCalls.length === 0);
});

test("newest_pending_tool_call_falls_back_to_the_next_newest", () => {
  const run = new AgentRunState();
  assert.equal(run.newestPendingToolCall(), null);
  run.pushPendingToolCall("call-1", 7);
  run.pushPendingToolCall("call-2", 8);
  assert.equal(run.newestPendingToolCall(), 8);

  run.takePendingToolCall("call-2");
  assert.equal(run.newestPendingToolCall(), 7);
  run.takePendingToolCall("call-1");
  assert.equal(run.newestPendingToolCall(), null);
});

test("pushing_a_duplicate_id_replaces_the_stale_entry", () => {
  const run = new AgentRunState();
  run.pushPendingToolCall("call-1", 7);
  run.pushPendingToolCall("call-2", 8);
  run.pushPendingToolCall("call-1", 9);
  
  assert.equal(run.pendingToolCalls.length, 2);
  assert.equal(run.newestPendingToolCall(), 9);
  assert.equal(run.takePendingToolCall("call-1"), 9);
  assert.equal(run.takePendingToolCall("call-2"), 8);
});

test("clearing_drops_calls_stranded_by_a_teardown", () => {
  const run = new AgentRunState();
  run.pushPendingToolCall("call-1", 7);
  run.pushPendingToolCall("call-2", 8);
  run.clearPendingToolCalls();
  assert.ok(run.pendingToolCalls.length === 0);
  assert.equal(run.takePendingToolCall("call-1"), null);

  assert.equal(run.newestPendingToolCall(), null);
});

test("an_unmatched_tool_result_gets_its_own_call_instead_of_call_zero", () => {
  const session = Session.create("anthropic", "claude-test", 200000, "");
  const run = new AgentRunState();

  const realCall = session.addToolCall("read", { path: "a.txt" });
  assert.equal(realCall, 0);
  run.pushPendingToolCall("call-1", realCall);
  const orphan = resolveToolResultCallId(run, session as never, "call-ghost", "grep");
  assert.notEqual(orphan, realCall);
  session.addToolResult(orphan, "grep", "no matches");
  
  const calls = session.messages
    .map((m) => m.tool)
    .filter((t) => t !== undefined && t.kind === "call");
  assert.equal(calls.length, 2);
  const first = calls[0]!;
  assert.ok(first.kind === "call" && first.id === realCall && first.name === "read");
  assert.ok(first.kind === "call" && JSON.stringify(first.args) === JSON.stringify({ path: "a.txt" }));

  const second = calls[1]!;
  assert.ok(second.kind === "call" && second.id === orphan && second.name === "grep");
  assert.ok(second.kind === "call" && second.args === null);
  
  assert.equal(run.takePendingToolCall("call-1"), realCall);
});
