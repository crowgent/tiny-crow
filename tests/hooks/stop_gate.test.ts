import test from "node:test";
import assert from "node:assert/strict";
import { HookDispatcher, gateStop } from "../../src/extras/hooks/mod.ts";
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
  const config: HooksConfig = { Stop: [{ hooks: handlers }] };
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

test("no_hooks_configured_releases", async () => {
  const dispatcher = HookDispatcher.fromConfig({});
  const gate = await gateStop(dispatcher, ctx(), false, null, null);
  assert.deepEqual(gate, { kind: "Release" });
});

test("exit_zero_no_decision_releases", async () => {
  const dispatcher = dispatcherWith([handler("true")]);
  const gate = await gateStop(dispatcher, ctx(), false, null, null);
  assert.deepEqual(gate, { kind: "Release" });
});

test("decision_block_forces_continuation_with_reason", async () => {
  const dispatcher = dispatcherWith([
    handler(`echo '{"decision":"block","reason":"tests still failing"}'`),
  ]);
  const gate = await gateStop(dispatcher, ctx(), false, null, null);
  assert.deepEqual(gate, { kind: "Continue", reason: "tests still failing" });
});

test("exit_two_also_forces_continuation", async () => {
  const dispatcher = dispatcherWith([handler("echo 'not done yet' 1>&2; exit 2")]);
  const gate = await gateStop(dispatcher, ctx(), false, null, null);
  assert.equal(gate.kind, "Continue");
  if (gate.kind === "Continue") assert.equal(gate.reason.trim(), "not done yet");
});
