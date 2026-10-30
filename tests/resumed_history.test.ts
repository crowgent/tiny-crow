import test from "node:test";
import assert from "node:assert/strict";
import {
  convertHistory,
  defaultRetryConfig,
  runPrint,
  type AgentLike,
  type ChatMessage,
  type StreamItem,
} from "../src/agent/runner.ts";
import { MessageRole, Session } from "../src/session/mod.ts";

function resumedSession(): Session {
  const session = Session.create("anthropic", "claude-test", 200000, "");
  session.addMessage(MessageRole.User, "what's the plan");
  session.addMessage(MessageRole.Assistant, "ship section 3");
  return session;
}

function usage() {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0 };
}

/** Recording agent: captures the history each stream call receives. */
function recordingAgent(turnTexts: string[][]): { agent: AgentLike; histories: ChatMessage[][] } {
  const histories: ChatMessage[][] = [];
  let turn = 0;
  const agent: AgentLike = {
    async *stream(_prompt: string, history: ChatMessage[]): AsyncGenerator<StreamItem> {
      histories.push([...history]);
      const texts = turnTexts[turn] ?? [];
      turn += 1;
      for (const t of texts) yield { kind: "text", text: t };
      yield { kind: "final", output: texts.join(""), usage: usage(), messages: [] };
    },
  };
  return { agent, histories };
}

test("resumed_session_history_reaches_model_initial_turn", async () => {
  const session = resumedSession();
  const expectedHistory = convertHistory(session as never);
  const { agent, histories } = recordingAgent([["got it"]]);
  await runPrint(agent, "continue", false, defaultRetryConfig(), expectedHistory);
  assert.deepEqual(
    histories[0],
    expectedHistory,
    "runPrint must forward the resumed session's prior messages to the model as history on the initial stream call",
  );
});

test("resumed_session_tool_messages_replay_as_tagged_history_entries", async () => {
  const session = resumedSession();
  const callId = session.addToolCall("read", { path: "src/main.rs" });
  session.addToolResult(callId, "read", "file contents");
  const expectedHistory = convertHistory(session as never);
  const { agent, histories } = recordingAgent([["got it"]]);
  await runPrint(agent, "continue", false, defaultRetryConfig(), expectedHistory);
  assert.deepEqual(
    histories[0],
    expectedHistory,
    "runPrint must forward the resumed session's tool messages to the model as history, exactly as it does for plain user/assistant turns",
  );
  const rendered = JSON.stringify(histories[0]);
  assert.ok(rendered.includes("[ToolCall]:"), `resumed history must carry a [ToolCall] entry, rendered: ${rendered}`);
  assert.ok(rendered.includes("[ToolResult]:"), `resumed history must carry a [ToolResult] entry, rendered: ${rendered}`);
});

test("resumed_session_history_survives_stop_hook_continuation", async () => {
  const session = resumedSession();
  const expectedHistory = convertHistory(session as never);
  const { agent, histories } = recordingAgent([["partial answer"], ["final answer"]]);
  // Blocks exactly once: stop_hook_active is false on the first dispatch,
  // so the hook forces a continuation; on the retry it is true and the
  // hook stands down, releasing the final response.
  const stopHook = {
    async dispatchStop(stopHookActive: boolean): Promise<{ continue: boolean; reason?: string }> {
      if (!stopHookActive) return { continue: true, reason: "resume once more" };
      return { continue: false };
    },
  };
  const outcome = await runPrint(agent, "continue", false, defaultRetryConfig(), expectedHistory, undefined, stopHook);
  assert.equal(
    outcome.response,
    "partial answerfinal answer",
    "the Stop-forced continuation must run to completion and the returned response must keep both turns' text, not just the second turn's",
  );
  assert.ok(histories.length >= 2);
  const secondHistory = histories[1]!;
  assert.deepEqual(
    secondHistory.slice(0, expectedHistory.length),
    expectedHistory,
    "the Stop-hook continuation retry must still carry the resumed session's prior messages as history",
  );
});
