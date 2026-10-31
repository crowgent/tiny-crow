import test from "node:test";
import assert from "node:assert/strict";
import { allowedWhileRunning, classifySubmission } from "../src/ui/mod.ts";

test("idle_runs_immediately", () => {
  assert.equal(classifySubmission(false, "hello"), "run");
  assert.equal(classifySubmission(false, "/help"), "run");
});

test("running_plain_text_is_queued", () => {
  assert.equal(classifySubmission(true, "ok"), "queue");
  assert.equal(classifySubmission(true, "compile this"), "queue");
  assert.equal(classifySubmission(true, "  leading space"), "queue");
});

test("running_commands_are_rejected_not_queued", () => {
  assert.equal(classifySubmission(true, "/model gpt"), "reject_while_running");
  assert.equal(classifySubmission(true, ".prompt"), "reject_while_running");
  assert.equal(classifySubmission(true, "!ls"), "reject_while_running");
  assert.equal(classifySubmission(true, "   /compress"), "reject_while_running");
});

test("whitelisted_commands_pass_through_while_running", () => {
  assert.ok(allowedWhileRunning("/queue"));
  assert.ok(allowedWhileRunning("/queue ls"));
  assert.ok(allowedWhileRunning("/queue clear"));
  assert.ok(allowedWhileRunning("  /queue pop"));
  assert.ok(!allowedWhileRunning("/model gpt"));
  assert.ok(!allowedWhileRunning("hello"));
  assert.equal(classifySubmission(true, "/queue"), "run");
  assert.equal(classifySubmission(true, "/queue ls"), "run");
  assert.equal(classifySubmission(true, "/queue clear"), "run");
});

test("running_empty_is_ignored", () => {
  assert.equal(classifySubmission(true, ""), "ignore");
  assert.equal(classifySubmission(true, "   "), "ignore");
});
