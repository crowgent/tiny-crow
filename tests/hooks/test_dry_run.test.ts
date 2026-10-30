import test from "node:test";
import assert from "node:assert/strict";
import { HookDispatcher, hooksTestDryRunWith } from "../../src/extras/hooks/mod.ts";
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

function dispatcherWith(handlers: HookHandler[]): HookDispatcher {
  const config: HooksConfig = { PreToolUse: [{ hooks: handlers }] };
  return HookDispatcher.fromConfig(config);
}

function ctx(): HookCtx {
  return {
    sessionId: "sess",
    sessionPath: "",
    cwd: "/repo",
    permissionMode: "standard",
  };
}

test("report_shows_defer_when_no_hook_matches", async () => {
  const dispatcher = HookDispatcher.fromConfig({});
  const report = await hooksTestDryRunWith(dispatcher, ctx(), "bash", {});
  assert.ok(report.includes("Defer"));
});

test("report_shows_deny_and_reason_on_block", async () => {
  const dispatcher = dispatcherWith([handler("echo 'no pushes allowed' 1>&2; exit 2")]);
  const report = await hooksTestDryRunWith(dispatcher, ctx(), "bash", { command: "git push" });
  assert.ok(report.includes("Deny"));
  assert.ok(report.includes("no pushes allowed"));
});

test("report_shows_updated_input_when_present", async () => {
  const dispatcher = dispatcherWith([
    handler(`echo '{"updatedInput":{"command":"rewritten"}}'`),
  ]);
  const report = await hooksTestDryRunWith(dispatcher, ctx(), "bash", { command: "orig" });
  assert.ok(report.includes("rewritten"));
});
