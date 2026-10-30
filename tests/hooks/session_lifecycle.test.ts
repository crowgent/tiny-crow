import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HookDispatcher,
  dispatchSessionEndWith,
  dispatchSessionStartWith,
} from "../../src/extras/hooks/mod.ts";
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

function dispatcherWith(event: string, handlers: HookHandler[]): HookDispatcher {
  const config: HooksConfig = { [event]: [{ hooks: handlers }] };
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

function marker(name: string): string {
  return join(tmpdir(), `tiny-crow-hooks-${name}-${process.pid}`);
}

test("session_start_runs_the_matching_hook_with_source", async () => {
  const path = marker("session-start");
  rmSync(path, { force: true });
  const dispatcher = dispatcherWith("SessionStart", [handler(`cat > ${path}`)]);
  try {
    await dispatchSessionStartWith(dispatcher, ctx(), "resume");
    await new Promise((resolve) => setTimeout(resolve, 150));
    const contents = readFileSync(path, "utf8");
    assert.ok(contents.includes('"source":"resume"'));
    assert.ok(contents.includes('"hook_event_name":"SessionStart"'));
  } finally {
    rmSync(path, { force: true });
  }
});

test("session_end_runs_the_matching_hook_with_reason", async () => {
  const path = marker("session-end");
  rmSync(path, { force: true });
  const dispatcher = dispatcherWith("SessionEnd", [handler(`cat > ${path}`)]);
  try {
    await dispatchSessionEndWith(dispatcher, ctx(), "clear");
    await new Promise((resolve) => setTimeout(resolve, 150));
    const contents = readFileSync(path, "utf8");
    assert.ok(contents.includes('"reason":"clear"'));
  } finally {
    rmSync(path, { force: true });
  }
});

test("no_matching_hook_does_not_panic_or_block", async () => {
  const dispatcher = HookDispatcher.fromConfig({});
  await dispatchSessionStartWith(dispatcher, ctx(), "startup");
  await dispatchSessionEndWith(dispatcher, ctx(), "exit");
  assert.equal(existsSync(marker("session-start")), false);
});
