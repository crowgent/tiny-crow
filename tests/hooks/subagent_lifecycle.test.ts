import test from "node:test";
import assert from "node:assert/strict";
import { HookDispatcher, gateSubagentStart, gateSubagentStop } from "../../src/extras/hooks/mod.ts";
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

function dispatcherWith(event: string, matcher: string | null, handlers: HookHandler[]): HookDispatcher {
  const config: HooksConfig = {
    [event]: [{ matcher: matcher ?? undefined, hooks: handlers }],
  };
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

test("subagent_start_with_no_hooks_returns_no_context", async () => {
  const dispatcher = HookDispatcher.fromConfig({});
  const extra = await gateSubagentStart(dispatcher, ctx(), "explore");
  assert.equal(extra, null);
});

test("subagent_start_matches_cc_style_agent_type_name", async () => {
  const dispatcher = dispatcherWith("SubagentStart", "Explore", [
    handler(`echo '{"additionalContext":"extra background"}'`),
  ]);
  const extra = await gateSubagentStart(dispatcher, ctx(), "explore");
  assert.equal(extra, "extra background");
});

test("subagent_start_no_decision_returns_no_context", async () => {
  const dispatcher = dispatcherWith("SubagentStart", null, [handler("true")]);
  const extra = await gateSubagentStart(dispatcher, ctx(), "explore");
  assert.equal(extra, null);
});

test("subagent_stop_no_hooks_releases", async () => {
  const dispatcher = HookDispatcher.fromConfig({});
  const gate = await gateSubagentStop(dispatcher, ctx(), "explore", false);
  assert.deepEqual(gate, { kind: "Release" });
});

test("subagent_stop_block_forces_continuation_with_reason", async () => {
  const dispatcher = dispatcherWith("SubagentStop", null, [
    handler(`echo '{"decision":"block","reason":"keep digging"}'`),
  ]);
  const gate = await gateSubagentStop(dispatcher, ctx(), "explore", false);
  assert.deepEqual(gate, { kind: "Continue", reason: "keep digging" });
});
