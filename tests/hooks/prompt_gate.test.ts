import test from "node:test";
import assert from "node:assert/strict";
import { HookDispatcher, gateUserPrompt } from "../../src/extras/hooks/mod.ts";
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
  const config: HooksConfig = { UserPromptSubmit: [{ hooks: handlers }] };
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

test("no_hooks_configured_proceeds_unchanged", async () => {
  const dispatcher = HookDispatcher.fromConfig({});
  const gate = await gateUserPrompt(dispatcher, ctx(), "hello");
  assert.deepEqual(gate, { kind: "Proceed", prompt: "hello" });
});

test("exit_zero_no_decision_proceeds_unchanged", async () => {
  const dispatcher = dispatcherWith([handler("true")]);
  const gate = await gateUserPrompt(dispatcher, ctx(), "hello");
  assert.deepEqual(gate, { kind: "Proceed", prompt: "hello" });
});

test("decision_block_blocks_the_prompt", async () => {
  const dispatcher = dispatcherWith([
    handler(`echo '{"decision":"block","reason":"not now"}'`),
  ]);
  const gate = await gateUserPrompt(dispatcher, ctx(), "hello");
  assert.deepEqual(gate, { kind: "Blocked", reason: "not now" });
});

test("additional_context_is_prepended_to_the_prompt", async () => {
  const dispatcher = dispatcherWith([
    handler(`echo '{"additionalContext":"extra info"}'`),
  ]);
  const gate = await gateUserPrompt(dispatcher, ctx(), "hello");
  assert.deepEqual(gate, { kind: "Proceed", prompt: "extra info\n\nhello" });
});
