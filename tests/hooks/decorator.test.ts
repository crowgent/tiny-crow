import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HookDispatcher } from "../../src/extras/hooks/mod.ts";
import { wrapAll } from "../../src/extras/hooks/decorator.ts";
import type { DecoratableTool } from "../../src/extras/hooks/decorator.ts";
import type { HookHandler, HooksConfig } from "../../src/extras/hooks/settings.ts";
import { PermissionChecker } from "../../src/permission/checker.ts";
import { Action, SecurityMode, permissionConfigsFromGlob } from "../../src/permission/mod.ts";
import { checkPerm } from "../../src/agent/tools/mod.ts";

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

function dispatcherWith(event: string, handlers: HookHandler[]): HookDispatcher {
  const config: HooksConfig = { [event]: [{ hooks: handlers }] };
  return HookDispatcher.fromConfig(config);
}

function echoTool(): DecoratableTool {
  return {
    name: "echo_tool",
    description: "",
    parameters: {},
    async execute(args: unknown): Promise<string> {
      return JSON.stringify(args) ?? "";
    },
  };
}

function permCheckingTool(permission: PermissionChecker): DecoratableTool {
  return {
    name: "bash",
    description: "",
    parameters: {},
    async execute(args: unknown): Promise<string> {

      const argsStr = JSON.stringify(args) ?? "";
      await checkPerm(permission as never, null, "bash", argsStr);
      return argsStr;
    },
  };
}

function jsonCommandPermCheckingTool(permission: PermissionChecker): DecoratableTool {
  return {
    name: "bash",
    description: "",
    parameters: {},
    async execute(args: unknown): Promise<string> {

      const parsed = args as { command: string };
      if (typeof parsed.command !== "string") throw new Error("missing command");
      await checkPerm(permission as never, null, "bash", parsed.command);
      return JSON.stringify(args) ?? "";
    },
  };
}

function alwaysFailsTool(): DecoratableTool {
  return {
    name: "always_fails_tool",
    description: "",
    parameters: {},
    async execute(): Promise<string> {
      throw new Error("inner tool blew up");
    },
  };
}

function permission(): PermissionChecker {
  return new PermissionChecker(
    permissionConfigsFromGlob({}),
    SecurityMode.Standard as never,
    "/repo",
  );
}

function permissionRestrictive(): PermissionChecker {
  return new PermissionChecker(
    permissionConfigsFromGlob({}),
    SecurityMode.Restrictive as never,
    "/repo",
  );
}

test("deny_blocks_the_call_with_guard_rail_message", async () => {
  const dispatcher = dispatcherWith("PreToolUse", [handler("exit 2")]);
  const wrapped = wrapAll([echoTool()], dispatcher, permission() as never, "sess-1");
  await assert.rejects(wrapped[0].execute({}), /Blocked by guard rail/);
});

test("no_matching_hook_passes_through_to_inner_tool", async () => {
  const dispatcher = dispatcherWith("PreToolUse", []);
  const wrapped = wrapAll([echoTool()], dispatcher, permission() as never, "sess-1");
  const out = await wrapped[0].execute({ a: 1 });
  assert.equal(out, '{"a":1}');
});

test("post_tool_use_failure_observes_but_cannot_change_the_outcome", async () => {
  const path = join(tmpdir(), `tiny-crow-hooks-decorator-failure-${process.pid}`);
  rmSync(path, { force: true });
  const dispatcher = dispatcherWith("PostToolUseFailure", [handler(`touch ${path}`)]);
  const wrapped = wrapAll([alwaysFailsTool()], dispatcher, permission() as never, "sess-1");
  try {
    await assert.rejects(wrapped[0].execute({}), /inner tool blew up/);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(existsSync(path), true);
  } finally {
    rmSync(path, { force: true });
  }
});

test("pre_tool_use_updated_input_is_applied_before_the_inner_call", async () => {
  const dispatcher = dispatcherWith("PreToolUse", [
    handler(`echo '{"updatedInput":{"command":"rewritten"}}'`),
  ]);
  const wrapped = wrapAll([echoTool()], dispatcher, permission() as never, "sess-1");
  const out = await wrapped[0].execute({ command: "original" });
  assert.equal(out, '{"command":"rewritten"}');
});

test("pre_tool_use_rewrite_cannot_bypass_a_permission_deny_rule", async () => {

  const dispatcher = dispatcherWith("PreToolUse", [
    handler(`echo '{"updatedInput":{"command":"rm -rf /tmp/pwned-by-hook"}}'`),
  ]);
  const perm = new PermissionChecker(
    permissionConfigsFromGlob({
      bash: {
        kind: "granular",
        rules: new Map([["rm -rf /tmp/*", Action.Deny]]),
      },
    }),
    SecurityMode.Standard as never,
    "/repo",
  );
  const wrapped = wrapAll(
    [jsonCommandPermCheckingTool(perm)],
    dispatcher,
    perm as never,
    "sess-1",
  );
  await assert.rejects(
    wrapped[0].execute({ command: "echo harmless" }),
    /Permission denied/,
  );
});

test("post_tool_use_rewrites_the_model_visible_result", async () => {
  const dispatcher = dispatcherWith("PostToolUse", [handler(`echo '{"result":"[redacted]"}'`)]);
  const wrapped = wrapAll([echoTool()], dispatcher, permission() as never, "sess-1");
  const out = await wrapped[0].execute({ secret: "abc" });
  assert.equal(out, "[redacted]");
});

test("post_tool_use_no_decision_leaves_result_unchanged", async () => {
  const dispatcher = dispatcherWith("PostToolUse", [handler("true")]);
  const wrapped = wrapAll([echoTool()], dispatcher, permission() as never, "sess-1");
  const out = await wrapped[0].execute({ a: 1 });
  assert.equal(out, '{"a":1}');
});

test("ask_verdict_escalates_to_deny_when_no_ask_tx_is_available", async () => {

  const dispatcher = dispatcherWith("PreToolUse", [
    handler(`echo '{"permissionDecision":"ask"}'`),
  ]);
  const perm = permission();
  const wrapped = wrapAll(
    [permCheckingTool(perm)],
    dispatcher,
    perm as never,
    "sess-1",
  );
  await assert.rejects(wrapped[0].execute("ls -la"), /non-interactive/);
});

test("allow_verdict_suppresses_the_prompt_for_the_inner_tools_own_check", async () => {

  const dispatcher = dispatcherWith("PreToolUse", [
    handler(`echo '{"permissionDecision":"allow"}'`),
  ]);
  const perm = permissionRestrictive();
  const wrapped = wrapAll(
    [permCheckingTool(perm)],
    dispatcher,
    perm as never,
    "sess-1",
  );
  const out = await wrapped[0].execute("ls -la");
  assert.equal(out, '"ls -la"');
});

test("wrap_all_returns_original_tools_when_dispatcher_is_empty", () => {
  const dispatcher = HookDispatcher.fromConfig({});
  const tools = [echoTool()];
  const wrapped = wrapAll(tools, dispatcher, permission() as never, "sess-1");
  assert.equal(wrapped.length, 1);
  assert.equal(wrapped[0].name, "echo_tool");
});
