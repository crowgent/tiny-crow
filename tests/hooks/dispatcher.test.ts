import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HookDispatcher, Verdict } from "../../src/extras/hooks/mod.ts";
import type { HookHandler, HooksConfig } from "../../src/extras/hooks/settings.ts";
import type { HookCtx } from "../../src/extras/hooks/envelope.ts";

function handler(command: string): HookHandler {
  return {
    type: "command",
    command,
    args: undefined,
    timeout: 5,
    async: false,
    if: undefined,
    once: false,
  };
}

function handlerWithCondition(command: string, condition: string): HookHandler {
  return { ...handler(command), if: condition };
}

function handlerOnce(command: string): HookHandler {
  return { ...handler(command), once: true };
}

function ctx(): HookCtx {
  return {
    sessionId: "sess-1",
    sessionPath: "/tmp/sess.json",
    cwd: "/repo",
    permissionMode: "default",
  };
}

function configWith(event: string, matcher: string | null, handlers: HookHandler[]): HooksConfig {
  return { [event]: [{ matcher: matcher ?? undefined, hooks: handlers }] };
}

function marker(name: string): string {
  return join(tmpdir(), `zerostack-hooks-${name}-${process.pid}`);
}

test("invalid_regex_matcher_fails_at_load_time", () => {
  const config = configWith("PreToolUse", "(unclosed", [handler("true")]);
  assert.throws(() => HookDispatcher.fromConfig(config));
});

test("wildcard_matcher_matches_every_tool", () => {
  const config = configWith("PreToolUse", null, [handler("true")]);
  const dispatcher = HookDispatcher.fromConfig(config);
  assert.notEqual(dispatcher.handlersFor("PreToolUse", "bash").length, 0);
  assert.notEqual(dispatcher.handlersFor("PreToolUse", "anything_else").length, 0);
});

test("name_list_matcher_matches_after_normalization", () => {
  // "Edit|Write" is CC-style names; the model calls zerostack's "write" tool.
  const config = configWith("PreToolUse", "Edit|Write", [handler("true")]);
  const dispatcher = HookDispatcher.fromConfig(config);
  assert.notEqual(dispatcher.handlersFor("PreToolUse", "write").length, 0);
  assert.equal(dispatcher.handlersFor("PreToolUse", "bash").length, 0);
});

test("is_empty_true_when_no_events_configured", () => {
  const dispatcher = HookDispatcher.fromConfig({});
  assert.equal(dispatcher.isEmpty(), true);
});

test("is_empty_false_when_a_handler_is_configured", () => {
  const config = configWith("PreToolUse", null, [handler("true")]);
  const dispatcher = HookDispatcher.fromConfig(config);
  assert.equal(dispatcher.isEmpty(), false);
});

test("summary_is_empty_when_no_events_configured", () => {
  const dispatcher = HookDispatcher.fromConfig({});
  assert.deepEqual(dispatcher.summary(), []);
});

test("summary_lists_events_with_handler_counts_sorted_by_event_name", () => {
  const config: HooksConfig = {
    Stop: [{ hooks: [handler("true")] }],
    PreToolUse: [{ hooks: [handler("true"), handler("false")] }],
  };
  const dispatcher = HookDispatcher.fromConfig(config);
  assert.deepEqual(dispatcher.summary(), [
    ["PreToolUse", 2],
    ["Stop", 1],
  ]);
});

test("identical_commands_are_deduplicated", () => {
  const config = configWith("PreToolUse", null, [handler("echo dup"), handler("echo dup")]);
  const dispatcher = HookDispatcher.fromConfig(config);
  assert.equal(dispatcher.handlersFor("PreToolUse", "bash").length, 1);
});

test("dispatch_returns_continue_without_running_anything_when_no_handler_matches", async () => {
  const path = marker("dispatch-nomatch");
  rmSync(path, { force: true });
  const config = configWith("PreToolUse", "Bash", [handler(`touch ${path}`)]);
  const dispatcher = HookDispatcher.fromConfig(config);
  const decision = await dispatcher.dispatchPreToolUse(ctx(), "write", {});
  assert.equal(decision.verdict, Verdict.Defer);
  assert.equal(existsSync(path), false);
  rmSync(path, { force: true });
});

test("dispatch_pre_tool_use_defers_when_hook_exits_zero_with_no_decision", async () => {
  const config = configWith("PreToolUse", null, [handler("true")]);
  const dispatcher = HookDispatcher.fromConfig(config);
  const decision = await dispatcher.dispatchPreToolUse(ctx(), "bash", { command: "ls" });
  assert.equal(decision.verdict, Verdict.Defer);
  assert.equal(decision.updatedInput, null);
});

test("dispatch_pre_tool_use_a_lone_allow_verdict_merges_as_allow", async () => {
  // Regression: Verdict ordering is Allow < Defer < Ask < Deny (least to
  // most severe), so a merge seeded from a hardcoded Defer sentinel would
  // never let a lone Allow verdict win and would silently report Defer.
  const config = configWith("PreToolUse", null, [
    handler(`echo '{"permissionDecision":"allow"}'`),
  ]);
  const dispatcher = HookDispatcher.fromConfig(config);
  const decision = await dispatcher.dispatchPreToolUse(ctx(), "bash", {});
  assert.equal(decision.verdict, Verdict.Allow);
});

test("dispatch_pre_tool_use_denies_on_exit_code_two", async () => {
  const config = configWith("PreToolUse", null, [handler("echo 'no way' 1>&2; exit 2")]);
  const dispatcher = HookDispatcher.fromConfig(config);
  const decision = await dispatcher.dispatchPreToolUse(ctx(), "bash", {});
  assert.equal(decision.verdict, Verdict.Deny);
  assert.equal((decision.reason ?? "").trim(), "no way");
});

test("dispatch_pre_tool_use_merges_most_severe_verdict", async () => {
  const config = configWith("PreToolUse", null, [
    handler(`echo '{"permissionDecision":"allow"}'`),
    handler("exit 2"),
  ]);
  const dispatcher = HookDispatcher.fromConfig(config);
  const decision = await dispatcher.dispatchPreToolUse(ctx(), "bash", {});
  assert.equal(decision.verdict, Verdict.Deny);
});

test("dispatch_pre_tool_use_folds_updated_input_in_declared_order", async () => {
  const config = configWith("PreToolUse", null, [
    handler(`echo '{"updatedInput":{"command":"first"}}'`),
    handler(`echo '{"updatedInput":{"command":"second"}}'`),
  ]);
  const dispatcher = HookDispatcher.fromConfig(config);
  const decision = await dispatcher.dispatchPreToolUse(ctx(), "bash", { command: "orig" });
  assert.deepEqual(decision.updatedInput, { command: "second" });
});

test("dispatch_generic_returns_continue_when_no_handler_matches", async () => {
  const dispatcher = HookDispatcher.fromConfig({});
  const decision = await dispatcher.dispatch("Stop", null, ctx(), {
    kind: "Stop",
    stopHookActive: false,
    loopIteration: null,
    loopActive: null,
  });
  assert.deepEqual(decision, { kind: "Continue" });
});

test("dispatch_generic_blocks_on_decision_block_json", async () => {
  const config = configWith("Stop", null, [
    handler(`echo '{"decision":"block","reason":"tests still failing"}'`),
  ]);
  const dispatcher = HookDispatcher.fromConfig(config);
  const decision = await dispatcher.dispatch("Stop", null, ctx(), {
    kind: "Stop",
    stopHookActive: false,
    loopIteration: null,
    loopActive: null,
  });
  assert.deepEqual(decision, { kind: "Block", reason: "tests still failing" });
});

test("dispatch_post_tool_use_failure_runs_but_cannot_change_outcome", async () => {
  const path = marker("posttooluse-failure");
  rmSync(path, { force: true });
  const config = configWith("PostToolUseFailure", null, [handler(`touch ${path}`)]);
  const dispatcher = HookDispatcher.fromConfig(config);
  await dispatcher.dispatchPostToolUseFailure(ctx(), "bash", {}, "boom");
  await new Promise((resolve) => setTimeout(resolve, 150));
  try {
    assert.equal(existsSync(path), true);
  } finally {
    rmSync(path, { force: true });
  }
});

test("if_condition_true_runs_the_handler", async () => {
  const config = configWith("PreToolUse", null, [
    handlerWithCondition(`echo '{"permissionDecision":"deny"}'`, "true"),
  ]);
  const dispatcher = HookDispatcher.fromConfig(config);
  const decision = await dispatcher.dispatchPreToolUse(ctx(), "bash", {});
  assert.equal(decision.verdict, Verdict.Deny);
});

test("if_condition_false_skips_the_handler", async () => {
  const config = configWith("PreToolUse", null, [
    handlerWithCondition(`echo '{"permissionDecision":"deny"}'`, "false"),
  ]);
  const dispatcher = HookDispatcher.fromConfig(config);
  const decision = await dispatcher.dispatchPreToolUse(ctx(), "bash", {});
  assert.equal(decision.verdict, Verdict.Defer);
});

test("if_condition_broken_command_fails_closed_and_runs_anyway", async () => {
  // A condition that hangs past its timeout counts as "cannot be
  // evaluated" per the fail-closed requirement: the handler still runs.
  const h: HookHandler = {
    ...handlerWithCondition(`echo '{"permissionDecision":"deny"}'`, "sleep 30"),
    timeout: 1,
  };
  const config = configWith("PreToolUse", null, [h]);
  const dispatcher = HookDispatcher.fromConfig(config);
  const decision = await dispatcher.dispatchPreToolUse(ctx(), "bash", {});
  assert.equal(decision.verdict, Verdict.Deny);
});

test("once_handler_runs_on_first_dispatch_and_is_skipped_on_second", async () => {
  const path = marker("once");
  rmSync(path, { force: true });
  const config = configWith("PreToolUse", null, [handlerOnce(`printf x >> ${path}`)]);
  const dispatcher = HookDispatcher.fromConfig(config);
  try {
    await dispatcher.dispatchPreToolUse(ctx(), "bash", {});
    await dispatcher.dispatchPreToolUse(ctx(), "bash", {});
    const contents = existsSync(path) ? readFileSync(path, "utf8") : "";
    assert.equal(contents, "x", "handler with once:true must not run twice");
  } finally {
    rmSync(path, { force: true });
  }
});
