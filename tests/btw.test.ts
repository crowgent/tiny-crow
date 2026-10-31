import test from "node:test";
import assert from "node:assert/strict";
import { buildBtwSnapshot } from "../src/agent/runner.ts";
import { MessageRole, Session } from "../src/session/mod.ts";

function sampleSession(): Session {
  const s = Session.create("anthropic", "claude-test", 200000, "");
  s.addMessage(MessageRole.User, "hello");
  s.addMessage(MessageRole.Assistant, "hi there");
  return s;
}

test("snapshot_without_trace_matches_history", () => {
  const session = sampleSession();
  const snapshot = buildBtwSnapshot(session as never, [], false);
  assert.equal(snapshot.length, 2);
});

test("trace_is_appended_only_while_main_is_running", () => {
  const session = sampleSession();
  const trace = ["→ bash: npm test", "← running…"];
  const running = buildBtwSnapshot(session as never, trace, true);
  assert.equal(running.length, 3);
  const idle = buildBtwSnapshot(session as never, trace, false);
  assert.equal(idle.length, 2);
});

test("empty_trace_while_running_adds_nothing", () => {
  const session = sampleSession();
  const snapshot = buildBtwSnapshot(session as never, [], true);
  assert.equal(snapshot.length, 2);
});

test("snapshot_does_not_mutate_session", () => {
  const session = sampleSession();
  const beforeLen = session.messages.length;
  const beforeIn = session.totalInputTokens;
  const beforeOut = session.totalOutputTokens;
  const beforeCost = session.totalCost;
  const trace = ["→ read: src/main.rs"];
  buildBtwSnapshot(session as never, trace, true);
  assert.equal(session.messages.length, beforeLen);
  assert.equal(session.totalInputTokens, beforeIn);
  assert.equal(session.totalOutputTokens, beforeOut);
  assert.equal(session.totalCost, beforeCost);
  session.addMessage(MessageRole.User, "again");
  assert.equal(session.messages.length, beforeLen + 1);
});
