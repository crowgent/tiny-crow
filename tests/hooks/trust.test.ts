import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDispatcherFromPaths,
  hashHookBinding,
  loadTrustStore,
  saveTrustStore,
} from "../../src/extras/hooks/trust.ts";
import type { HookHandler } from "../../src/extras/hooks/settings.ts";

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

let counter = 0;
function uniquePath(name: string): string {
  counter += 1;
  return join(tmpdir(), `zerostack-hooks-trust-${name}-${process.pid}-${Date.now()}-${counter}`);
}

function writeSettings(path: string, json: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, json, "utf8");
}

function missingPath(name: string): string {
  return uniquePath(`missing-${name}`);
}

function projectRoot(): string {
  return "/repo/test-project";
}

test("hash_changes_when_command_changes", () => {
  const root = "/repo/a";
  const hash1 = hashHookBinding(root, "PreToolUse", "Bash", handler("echo one"));
  const hash2 = hashHookBinding(root, "PreToolUse", "Bash", handler("echo two"));
  assert.notEqual(hash1, hash2);
});

test("hash_stable_for_identical_binding", () => {
  const root = "/repo/a";
  const hash1 = hashHookBinding(root, "PreToolUse", "Bash", handler("echo one"));
  const hash2 = hashHookBinding(root, "PreToolUse", "Bash", handler("echo one"));
  assert.equal(hash1, hash2);
});

test("hash_changes_when_matcher_changes", () => {
  const h = handler("echo one");
  const hash1 = hashHookBinding("/repo/a", "PreToolUse", "Bash", h);
  const hash2 = hashHookBinding("/repo/a", "PreToolUse", "*", h);
  assert.notEqual(hash1, hash2);
});

test("hash_changes_when_project_root_changes", () => {
  const h = handler("./guard.sh");
  const hash1 = hashHookBinding("/repo/project-a", "PreToolUse", "Bash", h);
  const hash2 = hashHookBinding("/repo/project-b", "PreToolUse", "Bash", h);
  assert.notEqual(
    hash1,
    hash2,
    "trusting a binding in one project must not trust the identical binding in another",
  );
});

test("trust_store_round_trips_and_is_visible_to_a_fresh_load", () => {
  const path = uniquePath("store");
  rmSync(path, { force: true });
  assert.equal(loadTrustStore(path).has("abc123"), false);
  const store = loadTrustStore(path);
  store.add("abc123");
  saveTrustStore(path, store);
  // Simulates a child process independently loading the same trust file.
  assert.equal(loadTrustStore(path).has("abc123"), true);
  assert.equal(loadTrustStore(path).has("does-not-exist"), false);
  rmSync(path, { force: true });
});

test("global_only_settings_load_without_consulting_confirmation", () => {
  const global = uniquePath("global");
  writeSettings(
    global,
    '{"hooks": {"PreToolUse": [{"hooks": [{"type": "command", "command": "true"}]}]}}',
  );
  const project = missingPath("project");
  const managed = missingPath("managed");
  const trustPath = uniquePath("trust");
  const dispatcher = buildDispatcherFromPaths(
    global,
    project,
    managed,
    projectRoot(),
    false,
    false,
    trustPath,
    () => {
      throw new Error("global-sourced hooks must never require confirmation");
    },
  );
  assert.equal(dispatcher.isEmpty(), false);
});

test("missing_files_are_not_an_error", () => {
  const dispatcher = buildDispatcherFromPaths(
    missingPath("g"),
    missingPath("p"),
    missingPath("m"),
    projectRoot(),
    false,
    false,
    uniquePath("trust"),
    () => false,
  );
  assert.equal(dispatcher.isEmpty(), true);
});

test("disable_all_hooks_in_project_settings_disables_non_managed_but_not_managed", () => {
  const global = uniquePath("global2");
  writeSettings(
    global,
    '{"hooks": {"PreToolUse": [{"hooks": [{"type": "command", "command": "true"}]}]}}',
  );
  const project = uniquePath("project2");
  writeSettings(project, '{"disableAllHooks": true}');
  const managed = uniquePath("managed2");
  writeSettings(
    managed,
    '{"hooks": {"PreToolUse": [{"hooks": [{"type": "command", "command": "true"}]}]}}',
  );
  const dispatcher = buildDispatcherFromPaths(
    global,
    project,
    managed,
    projectRoot(),
    false,
    false,
    uniquePath("trust2"),
    () => {
      throw new Error("no project hooks to confirm here");
    },
  );
  // Managed hooks alone keep the dispatcher non-empty even though
  // disableAllHooks would otherwise suppress the global hook.
  assert.equal(dispatcher.isEmpty(), false);
  assert.equal(dispatcher.handlersFor("PreToolUse", "bash").length, 1);
});

test("headless_unconfirmed_project_hook_is_skipped_without_confirmation", () => {
  const project = uniquePath("project3");
  writeSettings(
    project,
    '{"hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "echo untrusted"}]}]}}',
  );
  const trustPath = uniquePath("trust3");
  rmSync(trustPath, { force: true });
  const dispatcher = buildDispatcherFromPaths(
    missingPath("g3"),
    project,
    missingPath("m3"),
    projectRoot(),
    false,
    true, // headless
    trustPath,
    () => {
      throw new Error("headless must never prompt for confirmation");
    },
  );
  assert.equal(dispatcher.isEmpty(), true);
});

test("interactive_confirmation_accepted_persists_trust", () => {
  const project = uniquePath("project4");
  writeSettings(
    project,
    '{"hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "echo trust-me"}]}]}}',
  );
  const trustPath = uniquePath("trust4");
  rmSync(trustPath, { force: true });
  const dispatcher = buildDispatcherFromPaths(
    missingPath("g4"),
    project,
    missingPath("m4"),
    projectRoot(),
    false,
    false,
    trustPath,
    () => true,
  );
  assert.equal(dispatcher.isEmpty(), false);
  // Re-running against the same trust store should not need confirmation
  // again (a changed/declined confirm callback would panic/return false).
  const dispatcher2 = buildDispatcherFromPaths(
    missingPath("g4"),
    project,
    missingPath("m4"),
    projectRoot(),
    false,
    false,
    trustPath,
    () => {
      throw new Error("should already be trusted from the previous run");
    },
  );
  assert.equal(dispatcher2.isEmpty(), false);
});

test("trust_from_one_project_root_does_not_carry_over_to_another", () => {
  const project = uniquePath("project4b");
  writeSettings(
    project,
    '{"hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "echo trust-me"}]}]}}',
  );
  const trustPath = uniquePath("trust4b");
  rmSync(trustPath, { force: true });
  const rootA = "/repo/project-a";
  const rootB = "/repo/project-b";
  // Trust the binding under project root A.
  const dispatcher = buildDispatcherFromPaths(
    missingPath("g4b"),
    project,
    missingPath("m4b"),
    rootA,
    false,
    false,
    trustPath,
    () => true,
  );
  assert.equal(dispatcher.isEmpty(), false);
  // The identical binding (same settings file, same command) under a
  // different project root must still require confirmation: declining it
  // must exclude the hook, proving trust did not carry over.
  const dispatcher2 = buildDispatcherFromPaths(
    missingPath("g4b"),
    project,
    missingPath("m4b"),
    rootB,
    false,
    false,
    trustPath,
    () => false,
  );
  assert.equal(dispatcher2.isEmpty(), true);
});

test("interactive_confirmation_declined_excludes_the_hook", () => {
  const project = uniquePath("project5");
  writeSettings(
    project,
    '{"hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "echo nope"}]}]}}',
  );
  const trustPath = uniquePath("trust5");
  rmSync(trustPath, { force: true });
  const dispatcher = buildDispatcherFromPaths(
    missingPath("g5"),
    project,
    missingPath("m5"),
    projectRoot(),
    false,
    false,
    trustPath,
    () => false,
  );
  assert.equal(dispatcher.isEmpty(), true);
});

test("no_hooks_flag_excludes_non_managed_but_not_managed", () => {
  const global = uniquePath("global6");
  writeSettings(
    global,
    '{"hooks": {"PreToolUse": [{"hooks": [{"type": "command", "command": "true"}]}]}}',
  );
  const managed = uniquePath("managed6");
  writeSettings(
    managed,
    '{"hooks": {"PreToolUse": [{"hooks": [{"type": "command", "command": "true"}]}]}}',
  );
  const dispatcher = buildDispatcherFromPaths(
    global,
    missingPath("p6"),
    managed,
    projectRoot(),
    true, // --no-hooks
    false,
    uniquePath("trust6"),
    () => {
      throw new Error("no project hooks here");
    },
  );
  assert.equal(dispatcher.isEmpty(), false);
  assert.equal(dispatcher.handlersFor("PreToolUse", "bash").length, 1);
});
