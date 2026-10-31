import test from "node:test";
import assert from "node:assert/strict";
import { HookDispatcher, Verdict, compareVerdicts, verdictName } from "../../src/extras/hooks/mod.ts";
import type { Decision } from "../../src/extras/hooks/mod.ts";
import type { HookCtx } from "../../src/extras/hooks/envelope.ts";

test("verdict_ordering_is_allow_defer_ask_deny", () => {
  assert.ok(Verdict.Allow < Verdict.Defer);
  assert.ok(Verdict.Defer < Verdict.Ask);
  assert.ok(Verdict.Ask < Verdict.Deny);
  assert.equal(compareVerdicts(Verdict.Allow, Verdict.Deny) < 0, true);
  assert.equal(compareVerdicts(Verdict.Deny, Verdict.Allow) > 0, true);
  assert.equal(compareVerdicts(Verdict.Ask, Verdict.Ask), 0);
});

test("verdict_max_of_allow_and_deny_is_deny", () => {
  const max = Math.max(Verdict.Allow, Verdict.Deny);
  assert.equal(max, Verdict.Deny);
  assert.equal(verdictName(max), "Deny");
});

test("pre_decision_defer_carries_no_rewrite", async () => {
  const decision = await HookDispatcher.empty().dispatchPreToolUse(
    {
      sessionId: "sess-1",
      sessionPath: "",
      cwd: "/repo",
      permissionMode: "standard",
    },
    "bash",
    {},
  );
  assert.equal(decision.verdict, Verdict.Defer);
  assert.equal(decision.reason, null);
  assert.equal(decision.updatedInput, null);
});

test("decision_continue_differs_from_block", () => {
  const cont: Decision = { kind: "Continue" };
  const block: Decision = { kind: "Block", reason: "nope" };
  assert.notDeepEqual(cont, block);
  assert.equal(cont.kind, "Continue");
  assert.equal(block.kind, "Block");
});

test("decision_rewrite_carries_content", () => {
  const rewrite: Decision = { kind: "Rewrite", content: "[redacted]" };
  assert.equal(rewrite.kind, "Rewrite");
  if (rewrite.kind === "Rewrite") assert.equal(rewrite.content, "[redacted]");
});

test("hook_ctx_holds_all_common_envelope_fields", () => {
  const ctx: HookCtx = {
    sessionId: "sess-1",
    sessionPath: "/tmp/sess.json",
    cwd: "/repo",
    permissionMode: "default",
  };
  assert.equal(ctx.sessionId, "sess-1");
  assert.equal(ctx.sessionPath, "/tmp/sess.json");
  assert.equal(ctx.cwd, "/repo");
  assert.equal(ctx.permissionMode, "default");
});
