import test from "node:test";
import assert from "node:assert/strict";
import { convertHistory } from "../src/agent/runner.ts";
import { MessageRole, Session } from "../src/session/mod.ts";

function sampleSession(): Session {
  return Session.create("anthropic", "claude-test", 200000, "");
}

test("uncompacted_session_gives_full_tail_in_order_no_summary", () => {
  const session = sampleSession();
  session.addMessage(MessageRole.User, "hello");
  session.addMessage(MessageRole.Assistant, "hi there");
  session.addMessage(MessageRole.User, "how are you");
  const history = convertHistory(session as never);
  assert.deepEqual(history, [
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi there" },
    { role: "user", content: "how are you" },
  ]);
});

test("compacted_session_gives_summary_as_assistant_then_kept_tail", () => {
  const session = sampleSession();
  session.addMessage(MessageRole.User, "old question");
  session.addMessage(MessageRole.Assistant, "old answer");
  session.addMessage(MessageRole.User, "kept question");
  session.addMessage(MessageRole.Assistant, "kept answer");
  session.compress("did some prior work", 2, 100);
  const history = convertHistory(session as never);
  assert.deepEqual(history, [
    {
      role: "assistant",
      content: "[Recap of my prior work in this conversation]\ndid some prior work",
    },
    { role: "user", content: "kept question" },
    { role: "assistant", content: "kept answer" },
  ]);
});

test("empty_session_gives_empty_vec", () => {
  const session = sampleSession();
  assert.deepEqual(convertHistory(session as never), []);
});
