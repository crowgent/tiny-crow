import test from "node:test";
import assert from "node:assert/strict";
import { PermissionChecker, type CheckResult } from "../src/permission/checker.ts";
import {
  Action,
  SecurityMode,
  permissionConfigsFromGlob,
  type PermissionConfig,
  type PermissionConfigs,
  type ToolPerm,
} from "../src/permission/mod.ts";
import { suggestPattern } from "../src/ui/helpers.ts";
import { checkPerm, checkPermPath } from "../src/agent/tools/mod.ts";

function defaultModes(): string[] {
  return ["guarded", "standard", "yolo"];
}

function makeChecker(mode: string): PermissionChecker {
  return new PermissionChecker(
    permissionConfigsFromGlob({}),
    mode as never,
    "/home/user/project",
    defaultModes(),
  );
}

function makeCheckerWithModes(mode: string, modes: string[] | undefined): PermissionChecker {
  return new PermissionChecker(
    permissionConfigsFromGlob({}),
    mode as never,
    "/home/user/project",
    modes,
  );
}

function configsFrom(config: PermissionConfig): PermissionConfigs {
  return permissionConfigsFromGlob(config);
}

function granular(entries: Array<[string, string]>): ToolPerm {
  return { kind: "granular", rules: new Map(entries.map(([k, v]) => [k, v as never])) };
}

function simple(action: string): ToolPerm {
  return { kind: "simple", action: action as never };
}

function kindOf(result: CheckResult): string {
  return result.kind;
}

function isAllowed(result: CheckResult): boolean {
  return result.kind === "allowed";
}
function isDenied(result: CheckResult): boolean {
  return result.kind === "denied";
}
function isAsk(result: CheckResult): boolean {
  return result.kind === "ask";
}
function isCoaching(result: CheckResult): boolean {
  return result.kind === "allowedWithCoaching";
}

test("readonly_denies_write_bash_and_edit", () => {
  const checker = makeChecker(SecurityMode.ReadOnly);
  assert.ok(isDenied(checker.check("write", "/etc/passwd")));
  assert.ok(isDenied(checker.check("edit", "src/main.rs")));
  assert.ok(isDenied(checker.check("bash", "ls")));
  assert.ok(isDenied(checker.check("bash", "rm -rf /")));
});

test("yolo_denies_destructive_bash", () => {
  const checker = makeChecker(SecurityMode.Yolo);
  const result = checker.check("bash", "rm -rf /");
  assert.ok(isDenied(result), `expected Denied for rm -rf / in YOLO, got ${JSON.stringify(result)}`);
});

test("yolo_denies_destructive_bash_with_pattern", () => {
  const checker = makeChecker(SecurityMode.Yolo);
  const result = checker.check("bash", "dd if=/dev/zero of=/dev/sda");
  assert.ok(isDenied(result), `expected Denied for dd in YOLO, got ${JSON.stringify(result)}`);
});

test("restrictive_makes_unconfigured_tool_ask", () => {
  const checker = makeChecker(SecurityMode.Restrictive);
  assert.ok(isAsk(checker.check("some_tool", "any input")));
});

test("standard_allows_unknown_tool_with_default", () => {
  const checker = makeChecker(SecurityMode.Standard);
  assert.ok(isAllowed(checker.check("some_tool", "any input")));
});

test("readonly_allows_read_tools", () => {
  const checker = makeChecker(SecurityMode.ReadOnly);
  assert.ok(isAllowed(checker.check("read", "/etc/passwd")));
  assert.ok(isAllowed(checker.check("grep", "pattern")));
  assert.ok(isAllowed(checker.check("find_files", "*.rs")));
  assert.ok(isAllowed(checker.check("list_dir", "/home/user")));
});

test("readonly_denies_path_tools_outside_read", () => {
  const checker = makeChecker(SecurityMode.ReadOnly);
  assert.ok(isDenied(checker.checkPath("write", "/home/user/project/new.rs")));
  assert.ok(isDenied(checker.checkPath("edit", "/home/user/project/src/main.rs")));
});

test("guarded_allows_read_tools", () => {
  const checker = makeChecker(SecurityMode.Guarded);
  assert.ok(isAllowed(checker.check("read", "/etc/passwd")));
  assert.ok(isAllowed(checker.check("grep", "pattern")));
  assert.ok(isAllowed(checker.check("list_dir", "/home/user")));
});

test("guarded_asks_for_write_and_bash", () => {
  const checker = makeChecker(SecurityMode.Guarded);
  assert.ok(isAsk(checker.check("write", "/etc/passwd")));
  assert.ok(isAsk(checker.check("edit", "src/main.rs")));
  assert.ok(isAsk(checker.check("bash", "wget")));
  assert.ok(isAllowed(checker.check("bash", "ls -la")));
});

test("deny_rule_blocks_regardless_of_mode", () => {
  const checker = makeChecker(SecurityMode.Standard);
  assert.ok(isDenied(checker.check("bash", "rm -rf /home/user/project")));
});

test("deny_rule_is_denied_in_yolo", () => {
  const checker = makeChecker(SecurityMode.Yolo);
  const result = checker.check("bash", "rm -rf /home/user/project");
  assert.ok(isDenied(result), `expected Denied for destructive bash in YOLO, got ${JSON.stringify(result)}`);
});

test("doom_loop_triggers_after_five_repeated_calls", () => {
  const checker = makeChecker(SecurityMode.Standard);
  for (let i = 0; i < 4; i++) checker.check("bash", "ls");
  const result = checker.check("bash", "ls");
  assert.ok(isCoaching(result), `expected AllowedWithCoaching from doom loop in Standard, got ${JSON.stringify(result)}`);
});

test("doom_loop_does_not_trigger_before_five", () => {
  const checker = makeChecker(SecurityMode.Standard);
  for (let i = 0; i < 4; i++) {
    const result = checker.check("bash", "ls");
    assert.ok(isAllowed(result), `got ${JSON.stringify(result)}`);
  }
});

test("doom_loop_resets_for_different_inputs", () => {
  const checker = makeChecker(SecurityMode.Standard);
  checker.check("bash", "ls");
  checker.check("bash", "ls");
  checker.check("bash", "pwd");
  assert.ok(isAllowed(checker.check("bash", "pwd")));
});

test("doom_loop_detects_consecutive_repeats", () => {
  const checker = makeChecker(SecurityMode.Standard);
  for (let i = 0; i < 4; i++) checker.check("bash", "ls");
  const result = checker.check("bash", "ls");
  assert.ok(isCoaching(result), `five consecutive identical calls should trigger doom loop coaching, got ${JSON.stringify(result)}`);
});

test("record_blocked_feeds_doom_loop_detection", () => {
  const checker = makeChecker(SecurityMode.Standard);
  for (let i = 0; i < 4; i++) checker.recordBlocked("bash", "ls -la");
  const result = checker.check("bash", "ls -la");
  assert.ok(isCoaching(result), `a hook-denied call repeated via record_blocked should still count toward doom-loop detection, got ${JSON.stringify(result)}`);
});

test("force_ask_once_forces_ask_for_the_next_call_regardless_of_mode", () => {
  const checker = makeChecker(SecurityMode.Yolo);
  checker.forceAskOnce("bash");
  assert.ok(isAsk(checker.check("bash", "ls -la")));
});

test("force_ask_once_is_consumed_after_one_call", () => {
  const checker = makeChecker(SecurityMode.Yolo);
  checker.forceAskOnce("bash");
  checker.check("bash", "ls -la");
  assert.ok(isAllowed(checker.check("bash", "ls -la")));
});

test("force_ask_once_never_overrides_a_deny_rule", () => {
  const config: PermissionConfig = {
    bash: granular([["rm -rf important", Action.Deny]]),
  };
  const checker = new PermissionChecker(configsFrom(config), SecurityMode.Yolo, "/home/user/project", defaultModes());
  checker.forceAskOnce("bash");
  assert.ok(isDenied(checker.check("bash", "rm -rf important")));
});

test("allow_once_suppresses_the_prompt_for_the_next_call", () => {
  const checker = makeChecker(SecurityMode.Restrictive);
  checker.allowOnce("bash");
  assert.ok(isAllowed(checker.check("bash", "ls -la")));
});

test("allow_once_is_consumed_after_one_call", () => {
  const checker = makeChecker(SecurityMode.Restrictive);
  checker.allowOnce("bash");
  checker.check("bash", "ls -la");
  assert.ok(isAsk(checker.check("bash", "ls -la")));
});

test("allow_once_never_overrides_a_deny_rule", () => {
  const config: PermissionConfig = {
    bash: granular([["rm -rf important", Action.Deny]]),
  };
  const checker = new PermissionChecker(configsFrom(config), SecurityMode.Yolo, "/home/user/project", defaultModes());
  checker.allowOnce("bash");
  assert.ok(isDenied(checker.check("bash", "rm -rf important")));
});

test("session_allowlist_bypasses_rules", () => {
  const checker = makeChecker(SecurityMode.Restrictive);
  checker.addSessionAllowlist("bash", "cargo test **");
  assert.ok(isAllowed(checker.check("bash", "cargo test --all")));
});

test("session_allowlist_cannot_bypass_deny_rules", () => {
  const config: PermissionConfig = {
    bash: granular([["rm *", Action.Deny]]),
  };
  const checker = new PermissionChecker(configsFrom(config), SecurityMode.Standard, undefined, defaultModes());
  checker.addSessionAllowlist("bash", "rm *");
  const result = checker.check("bash", "rm -rf important");
  assert.ok(isDenied(result), `deny rule must not be bypassed by session allowlist, got ${JSON.stringify(result)}`);
});

test("session_allowlist_covers_a_bash_command_with_a_path_argument", () => {
  const cmd = "pytest tests/test_login.py";
  const checker = makeChecker(SecurityMode.Guarded);
  checker.addSessionAllowlist("bash", suggestPattern("bash", cmd));
  assert.ok(isAllowed(checker.check("bash", cmd)));
});

test("session_allowlist_is_tool_specific", () => {
  const checker = makeChecker(SecurityMode.Restrictive);
  checker.addSessionAllowlist("read", "**");
  assert.ok(isAllowed(checker.check("read", "/etc/passwd")));
  assert.ok(isAsk(checker.check("write", "some/file.txt")));
});

test("external_absolute_path_outside_cwd_is_detected", () => {
  const checker = makeChecker(SecurityMode.Standard);
  const result = checker.checkPath("write", "/etc/shadow");
  assert.ok(isAsk(result), `expected Ask, got ${JSON.stringify(result)}`);
});

test("relative_path_is_not_external", () => {
  const checker = makeChecker(SecurityMode.Standard);
  assert.ok(isAllowed(checker.checkPath("read", "src/lib.rs")));
});

test("explicit_granular_rules_take_effect", () => {
  const config: PermissionConfig = {
    read: granular([["*.md", Action.Allow], ["*.rs", Action.Ask]]),
  };
  const checker = new PermissionChecker(configsFrom(config), SecurityMode.Standard, undefined, defaultModes());
  assert.deepEqual(checker.check("read", "README.md"), { kind: "allowed" });
  assert.deepEqual(checker.check("read", "main.rs"), { kind: "ask" });
});

test("standard_path_tools_in_cwd_without_rules_are_allowed", () => {
  const checker = makeChecker(SecurityMode.Standard);
  assert.ok(isAllowed(checker.checkPath("read", "/home/user/project/src/main.rs")));
  assert.ok(isAllowed(checker.checkPath("write", "/home/user/project/new_file.rs")));
  assert.ok(isAllowed(checker.checkPath("list_dir", "/home/user/project/src")));
});

test("standard_respects_deny_rules_for_path_tools_in_cwd", () => {
  const config: PermissionConfig = {
    read: granular([["**", Action.Deny]]),
  };
  const checker = new PermissionChecker(configsFrom(config), SecurityMode.Standard, "/home/user/project", defaultModes());
  const result = checker.checkPath("read", "/home/user/project/src/main.rs");
  assert.ok(isDenied(result), `expected Denied for CWD path with explicit deny rule, got ${JSON.stringify(result)}`);
});

test("standard_respects_deny_rules_for_write_in_cwd", () => {
  const config: PermissionConfig = {
    write: granular([["**", Action.Deny]]),
  };
  const checker = new PermissionChecker(configsFrom(config), SecurityMode.Standard, "/home/user/project", defaultModes());
  const result = checker.checkPath("write", "/home/user/project/new_file.rs");
  assert.ok(isDenied(result), `expected Denied for CWD write with explicit deny rule, got ${JSON.stringify(result)}`);
});

test("standard_asks_external_path_even_for_path_tools", () => {
  const checker = makeChecker(SecurityMode.Standard);
  const result = checker.checkPath("read", "/etc/config.conf");
  assert.ok(isAsk(result), `expected Ask for external path, got ${JSON.stringify(result)}`);
});

test("standard_deny_still_works_for_non_path_tools", () => {
  const checker = makeChecker(SecurityMode.Standard);
  const result = checker.check("bash", "rm -rf /home/user/project");
  assert.ok(isDenied(result), `expected Denied for bash deny rule, got ${JSON.stringify(result)}`);
});

test("standard_allows_configured_bash_commands", () => {
  const checker = makeChecker(SecurityMode.Standard);
  assert.ok(isAllowed(checker.check("bash", "ls -la")));
  assert.ok(isAllowed(checker.check("bash", "git status")));
  assert.ok(isAllowed(checker.check("bash", "cargo build")));
});

test("standard_asks_for_sudo_but_denies_destructive_sudo", () => {
  const checker = makeChecker(SecurityMode.Standard);
  assert.ok(isAsk(checker.check("bash", "sudo")), "expected Ask for bare sudo");
  assert.ok(isAsk(checker.check("bash", "sudo ls")), "expected Ask for sudo ls");
  assert.ok(isDenied(checker.check("bash", "sudo rm -rf /home/user/project")), "expected Denied for sudo rm -rf");
});

test("standard_allows_readonly_git_commands", () => {
  const checker = makeChecker(SecurityMode.Standard);
  for (const cmd of [
    "git status", "git status --short", "git log", "git log --oneline", "git diff", "git diff HEAD",
    "git show HEAD", "git branch -a", "git ls-files", "git remote -v", "git rev-parse HEAD",
    "git ls-tree HEAD", "git ls-remote", "git cat-file -p HEAD", "git blame src/main.rs",
    "git reflog", "git tag", "git tag -l", "git stash list", "git config --get user.name",
  ]) {
    assert.ok(isAllowed(checker.check("bash", cmd)), `expected Allowed for ${cmd}`);
  }
});

test("standard_darcs_commands", () => {
  const checker = makeChecker(SecurityMode.Standard);
  for (const cmd of [
    "darcs annotate README.rst", "darcs diff", "darcs diff ./lib", "darcs diff --last 3",
    "darcs show authors", "darcs show contents README.rst", "darcs show files", "darcs show index",
    "darcs show pristine", "darcs show tags", "darcs whatsnew", "darcs whatsnew --look-for-adds",
  ]) {
    assert.ok(isAllowed(checker.check("bash", cmd)), `expected Allowed for ${cmd}`);
  }
});

test("restricted_darcs_commands", () => {
  const checker = makeChecker(SecurityMode.Standard);
  for (const cmd of [
    `darcs diff --diff-command "sh -c 'rm -rf /' x %1 %2"`,
    `darcs log --prehook="sudo rm -rf /"`,
    `darcs test --posthook="sudo rm -rf /"`,
  ]) {
    assert.ok(isDenied(checker.check("bash", cmd)), `expected Denied for ${cmd}`);
  }
});

test("standard_pijul_commands", () => {
  const checker = makeChecker(SecurityMode.Standard);
  for (const cmd of [
    "pijul diff", "pijul diff --short", "pijul log", "pijul log --hash-only", "pijul change ABC123",
    "pijul credit src/main.rs", "pijul list", "pijul ls", "pijul channel", "pijul channel --help",
    "pijul remote", "pijul remote --help",
  ]) {
    assert.ok(isAllowed(checker.check("bash", cmd)), `expected Allowed for ${cmd}`);
  }
});

test("restricted_pijul_commands", () => {
  const checker = makeChecker(SecurityMode.Standard);
  for (const cmd of [
    "pijul record -am 'x'", "pijul record --channel foo", "pijul hooks approve", "pijul hooks show",
    "pijul channel switch foo", "pijul channel new foo", "pijul channel rename a b",
    "pijul channel delete foo", "pijul remote delete origin",
  ]) {
    assert.ok(isDenied(checker.check("bash", cmd)), `expected Denied for ${cmd}`);
  }
});

test("standard_allows_pixi_run", () => {
  const checker = makeChecker(SecurityMode.Standard);
  assert.ok(isAllowed(checker.check("bash", "pixi run test")));
});

test("regex_granular_rules_take_effect", () => {
  const configs: PermissionConfigs = {
    glob: {},
    regex: { read: granular([["\\.md$", Action.Allow], ["\\.rs$", Action.Ask]]) },
  };
  const checker = new PermissionChecker(configs, SecurityMode.Standard, undefined, defaultModes());
  assert.deepEqual(checker.check("read", "README.md"), { kind: "allowed" });
  assert.deepEqual(checker.check("read", "main.rs"), { kind: "ask" });
  assert.deepEqual(checker.check("read", "main.py"), { kind: "allowed" });
});

test("regex_simple_action", () => {
  const configs: PermissionConfigs = {
    glob: {},
    regex: { bash: simple(Action.Ask) },
  };
  const checker = new PermissionChecker(configs, SecurityMode.Standard, undefined, defaultModes());
  assert.ok(isAsk(checker.check("bash", "anything")));
});

test("regex_and_glob_rules_merge", () => {
  const configs: PermissionConfigs = {
    glob: { read: granular([["*.md", Action.Allow]]) },
    regex: { read: granular([["\\.rs$", Action.Ask]]) },
  };
  const checker = new PermissionChecker(configs, SecurityMode.Standard, undefined, defaultModes());
  assert.deepEqual(checker.check("read", "README.md"), { kind: "allowed" });
  assert.deepEqual(checker.check("read", "main.rs"), { kind: "ask" });
});

test("regex_default_action_used_when_no_glob_default", () => {
  const configs: PermissionConfigs = {
    glob: {},
    regex: { default: Action.Ask },
  };
  const checker = new PermissionChecker(configs, SecurityMode.Standard, undefined, defaultModes());
  assert.ok(isAsk(checker.check("unknown_tool", "anything")));
});

test("regex_glob_default_precedence", () => {
  const configs: PermissionConfigs = {
    glob: { default: Action.Allow },
    regex: { default: Action.Ask },
  };
  const checker = new PermissionChecker(configs, SecurityMode.Standard, undefined, defaultModes());
  assert.ok(isAllowed(checker.check("unknown_tool", "anything")));
});

test("path_traversal_with_dotdot_is_detected_as_external", () => {
  const checker = makeChecker(SecurityMode.Standard);
  const result = checker.checkPath("read", "/home/user/project/../etc/shadow");
  assert.ok(isAsk(result), `expected Ask for traversal path, got ${JSON.stringify(result)}`);
});

test("dot_components_are_normalized_away", () => {
  const checker = makeChecker(SecurityMode.Standard);
  const result = checker.checkPath("read", "/home/user/project/./src/main.rs");
  assert.ok(isAllowed(result), `expected Allowed for dot-normalized CWD path, got ${JSON.stringify(result)}`);
});

test("nested_dotdot_traverses_to_root", () => {
  const checker = makeChecker(SecurityMode.Standard);
  const result = checker.checkPath("read", "/home/user/project/../../../etc/passwd");
  assert.ok(isAsk(result), `expected Ask for deep traversal path, got ${JSON.stringify(result)}`);
});

test("relative_dotdot_traversal_is_detected_as_external", () => {
  const checker = makeChecker(SecurityMode.Standard);
  const result = checker.checkPath("read", "../../../etc/passwd");
  assert.ok(isAsk(result), `expected Ask for relative traversal path, got ${JSON.stringify(result)}`);
});

test("relative_dotdot_in_cwd_stays_allowed", () => {
  const checker = makeChecker(SecurityMode.Standard);
  const result = checker.checkPath("read", "../project/src/main.rs");
  assert.ok(isAllowed(result), `expected Allowed for relative path staying in CWD, got ${JSON.stringify(result)}`);
});

test("session_allowlist_matches_absolute_path_when_stored_as_relative", () => {
  const checker = makeChecker(SecurityMode.Restrictive);
  checker.addSessionAllowlist("read", "src/*");
  const result = checker.checkPath("read", "/home/user/project/src/main.rs");
  assert.ok(isAllowed(result), `expected Allowed for absolute path matching relative allowlist, got ${JSON.stringify(result)}`);
});

test("session_allowlist_matches_relative_path_when_stored_as_absolute", () => {
  const checker = makeChecker(SecurityMode.Restrictive);
  checker.addSessionAllowlist("read", "/home/user/project/src/*");
  const result = checker.checkPath("read", "src/main.rs");
  assert.ok(isAllowed(result), `expected Allowed for relative path matching absolute allowlist, got ${JSON.stringify(result)}`);
});

test("mcp_tool_simple_rule_is_respected", () => {
  const config: PermissionConfig = { mcpTool: simple(Action.Deny) };
  const checker = new PermissionChecker(configsFrom(config), SecurityMode.Standard, undefined, defaultModes());
  const result = checker.check("mcp_tool", "mcp_tool:filesystem:read_file");
  assert.ok(isDenied(result), `expected Denied for MCP tool, got ${JSON.stringify(result)}`);
});

test("mcp_tool_granular_rules_respected", () => {
  const config: PermissionConfig = {
    mcpTool: granular([["mcp_tool:fs:allow_*", Action.Allow], ["mcp_tool:fs:deny_*", Action.Deny]]),
  };
  const checker = new PermissionChecker(configsFrom(config), SecurityMode.Standard, undefined, defaultModes());
  assert.deepEqual(checker.check("mcp_tool", "mcp_tool:fs:allow_read"), { kind: "allowed" });
  assert.ok(isDenied(checker.check("mcp_tool", "mcp_tool:fs:deny_write")));
});

test("mcp_tool_default_action_when_no_rules", () => {
  const checker = makeChecker(SecurityMode.Standard);
  const result = checker.check("mcp_tool", "mcp_tool:some_server:some_tool");
  assert.ok(isAllowed(result), `expected Allowed for MCP tool with no rules (default), got ${JSON.stringify(result)}`);
});

test("restrictive_asks_for_everything", () => {
  const checker = makeChecker(SecurityMode.Restrictive);
  assert.ok(isAsk(checker.check("read", "anything")));
  assert.ok(isAsk(checker.check("write", "anything")));
  assert.ok(isAsk(checker.check("bash", "ls")));
  assert.ok(isAsk(checker.check("bash", "rm -rf /")));
});

test("restrictive_with_rules_in_permission_modes_respects_matched", () => {
  const config: PermissionConfig = {
    read: granular([["**", Action.Allow]]),
  };
  const checker = new PermissionChecker(
    configsFrom(config),
    SecurityMode.Restrictive,
    "/home/user/project",
    ["restrictive", "standard"],
  );
  assert.ok(isAllowed(checker.check("read", "/etc/passwd")));
  assert.ok(isAsk(checker.check("write", "anything")));
});

test("apply_rules_skipped_when_mode_not_in_permission_modes", () => {
  const config: PermissionConfig = {
    bash: granular([["safe-*", Action.Allow]]),
  };
  const checker = new PermissionChecker(configsFrom(config), SecurityMode.Guarded, "/home/user/project", ["standard"]);
  const result = checker.check("bash", "safe-command");
  assert.ok(isAsk(result), `expected Ask when rules are skipped by permission_modes, got ${JSON.stringify(result)}`);
});

test("apply_rules_applied_when_mode_in_permission_modes", () => {
  const config: PermissionConfig = {
    bash: granular([["safe-*", Action.Allow]]),
  };
  const checker = new PermissionChecker(configsFrom(config), SecurityMode.Standard, "/home/user/project", ["standard"]);
  const result = checker.check("bash", "safe-command");
  assert.ok(isAllowed(result), `expected Allowed when rules apply via permission_modes, got ${JSON.stringify(result)}`);
});

test("guarded_respects_explicit_config_allow", () => {
  const config: PermissionConfig = {
    bash: granular([["wget **", Action.Allow]]),
  };
  const checker = new PermissionChecker(configsFrom(config), SecurityMode.Guarded, "/home/user/project", defaultModes());
  assert.ok(isAllowed(checker.check("bash", "wget http://example.com")));
  assert.ok(isAsk(checker.check("bash", "unknown-cmd")));
});

test("guarded_respects_explicit_config_deny", () => {
  const config: PermissionConfig = {
    read: granular([["*.secret", Action.Deny]]),
  };
  const checker = new PermissionChecker(configsFrom(config), SecurityMode.Guarded, "/home/user/project", defaultModes());
  assert.ok(isDenied(checker.check("read", "private.secret")));
  assert.ok(isAllowed(checker.check("read", "README.md")));
});

test("standard_external_path_with_default_allow_asks", () => {
  const checker = makeChecker(SecurityMode.Standard);
  assert.ok(isAsk(checker.checkPath("write", "/tmp/outside.txt")));
});

test("yolo_unknown_bash_is_allowed", () => {
  const checker = makeChecker(SecurityMode.Yolo);
  assert.ok(isAllowed(checker.check("bash", "ed somefile")));
});

test("yolo_allows_todo_write", () => {
  const checker = makeChecker(SecurityMode.Yolo);
  assert.ok(isAllowed(checker.check("todo_write", "")));
});

test("allow_all_mcp_does_not_override_deny_rules", () => {
  const config: PermissionConfig = { mcpTool: simple(Action.Deny) };
  const checker = new PermissionChecker(configsFrom(config), SecurityMode.Standard, undefined, defaultModes());
  checker.setAllowAllMcpCalls(true);
  const result = checker.check("mcp_tool", "mcp_tool:filesystem:read_file");
  assert.ok(isDenied(result), `expected Denied for MCP tool with deny rule even when allow_all_mcp_calls is set, got ${JSON.stringify(result)}`);
});

test("allow_all_mcp_does_not_affect_non_mcp_tools", () => {
  const config: PermissionConfig = { bash: simple(Action.Deny) };
  const checker = new PermissionChecker(configsFrom(config), SecurityMode.Standard, undefined, defaultModes());
  checker.setAllowAllMcpCalls(true);
  const result = checker.check("bash", "ls");
  assert.ok(isDenied(result), `expected Denied for bash even with allow_all_mcp_calls, got ${JSON.stringify(result)}`);
});

test("todo_write_always_allowed_in_restrictive", () => {
  assert.ok(isAllowed(makeChecker(SecurityMode.Restrictive).check("todo_write", "")));
});

test("todo_write_always_allowed_in_readonly", () => {
  assert.ok(isAllowed(makeChecker(SecurityMode.ReadOnly).check("todo_write", "")));
});

test("todo_write_always_allowed_in_guarded", () => {
  assert.ok(isAllowed(makeChecker(SecurityMode.Guarded).check("todo_write", "")));
});

test("todo_write_always_allowed_in_yolo", () => {
  assert.ok(isAllowed(makeChecker(SecurityMode.Yolo).check("todo_write", "")));
});

test("todo_write_path_check_always_allowed", () => {
  assert.ok(isAllowed(makeChecker(SecurityMode.Restrictive).checkPath("todo_write", "/any/path")));
});

test("empty_permission_modes_skips_rules_for_all_modes", () => {
  const config: PermissionConfig = { read: simple(Action.Allow) };
  const checker = new PermissionChecker(configsFrom(config), SecurityMode.Standard, "/home/user/project", []);
  assert.ok(isAllowed(checker.checkPath("read", "/home/user/project/src/main.rs")));
  assert.ok(isAllowed(checker.check("bash", "some_command")));
});

test("standard_external_dir_allow_rule_overrides_default_ask", () => {
  const allowConfig: PermissionConfig = {
    externalDirectory: new Map([["/tmp/work/**", Action.Allow]]),
  };
  const checker = new PermissionChecker(configsFrom(allowConfig), SecurityMode.Standard, "/home/user/project", defaultModes());
  const result = checker.checkPath("write", "/tmp/work/notes.txt");
  assert.ok(isAllowed(result), `expected Allowed for external path covered by allow rule, got ${JSON.stringify(result)}`);
});

test("standard_external_dir_deny_rule_overrides_default_ask", () => {
  const config: PermissionConfig = {
    externalDirectory: new Map([["/etc/**", Action.Deny]]),
  };
  const checker = new PermissionChecker(configsFrom(config), SecurityMode.Standard, "/home/user/project", defaultModes());
  const result = checker.checkPath("write", "/etc/config.conf");
  assert.ok(isDenied(result), `expected Denied for external path with deny rule, got ${JSON.stringify(result)}`);
});

test("readonly_respects_explicit_config_allow", () => {
  const config: PermissionConfig = {
    write: granular([["**", Action.Allow]]),
  };
  const checker = new PermissionChecker(configsFrom(config), SecurityMode.ReadOnly, "/home/user/project", ["readonly"]);
  assert.ok(isAllowed(checker.check("write", "/etc/passwd")));
});

test("guarded_asks_for_external_path_write", () => {
  const checker = makeChecker(SecurityMode.Guarded);
  const result = checker.checkPath("write", "/etc/config.conf");
  assert.ok(isAsk(result), `expected Ask for external write in Guarded, got ${JSON.stringify(result)}`);
});

test("guarded_allows_internal_path_read", () => {
  const checker = makeChecker(SecurityMode.Guarded);
  assert.ok(isAllowed(checker.checkPath("read", "/home/user/project/src/main.rs")));
});

test("doom_loop_triggers_in_guarded", () => {
  const checker = makeChecker(SecurityMode.Guarded);
  for (let i = 0; i < 4; i++) checker.check("bash", "echo test");
  const result = checker.check("bash", "echo test");
  assert.ok(isCoaching(result), `expected AllowedWithCoaching from doom loop in Guarded, got ${JSON.stringify(result)}`);
});

test("doom_loop_still_asks_for_read_tool_in_restrictive", () => {
  const checker = makeChecker(SecurityMode.Restrictive);
  for (let i = 0; i < 4; i++) checker.check("read", "some_file");
  const result = checker.check("read", "some_file");
  assert.ok(isAsk(result), `expected Ask from doom loop in Restrictive, got ${JSON.stringify(result)}`);
});

test("doom_loop_path_coaches_in_standard_auto_allow", () => {
  const checker = makeChecker(SecurityMode.Standard);
  for (let i = 0; i < 4; i++) {
    assert.ok(isAllowed(checker.checkPath("edit", "src/main.rs")));
  }
  const result = checker.checkPath("edit", "src/main.rs");
  assert.ok(isCoaching(result), `expected AllowedWithCoaching for path doom loop in Standard, got ${JSON.stringify(result)}`);
});

test("check_path_with_relative_is_not_external_in_standard", () => {
  const checker = makeChecker(SecurityMode.Standard);
  assert.ok(isAllowed(checker.checkPath("read", "src/main.rs")));
});

test("check_path_with_tilde_expansion_internal", () => {

  const checker = makeChecker(SecurityMode.Standard);
  const result = checker.checkPath("write", "~/outside.txt");
  assert.ok(isAsk(result), `expected Ask for ~ path outside CWD in Standard, got ${JSON.stringify(result)}`);
});

test("yolo_destructive_patterns_are_denied", () => {
  const checker = makeChecker(SecurityMode.Yolo);
  assert.ok(isDenied(checker.check("bash", "rm -rf /sensitive/data")));
});

test("yolo_deny_rules_for_mcp_are_denied", () => {
  const config: PermissionConfig = {
    mcpTool: granular([["mcp_tool:fs:delete_*", Action.Deny]]),
  };
  const checker = new PermissionChecker(configsFrom(config), SecurityMode.Yolo, undefined, defaultModes());
  assert.ok(isDenied(checker.check("mcp_tool", "mcp_tool:fs:delete_file")));
  assert.ok(isAllowed(checker.check("mcp_tool", "mcp_tool:fs:read_file")));
});

test("check_perm_skipped_when_permission_is_none", async () => {
  const result = await checkPerm(null, null, "bash", "rm -rf /");
  assert.equal(result, undefined);
});

test("check_perm_path_skipped_when_permission_is_none", async () => {
  const result = await checkPermPath(null, null, "write", "/etc/passwd");
  assert.equal(result, undefined);
});

test("guarded_mcp_tool_asks_when_no_rule", () => {
  const checker = makeChecker(SecurityMode.Guarded);
  assert.ok(isAsk(checker.check("mcp_tool", "mcp_tool:fs:write_file")));
});

test("readonly_allows_exa_mcp_tools", () => {
  const checker = makeChecker(SecurityMode.ReadOnly);
  assert.ok(isAllowed(checker.check("mcp_tool", "mcp_tool:Exa Web Search:websearch")));
  assert.ok(isAllowed(checker.check("mcp_tool", "mcp_tool:Exa Web Search:webfetch")));
});

test("planwrite_allows_exa_mcp_tools", () => {
  const checker = makeChecker(SecurityMode.PlanWrite);
  assert.ok(isAllowed(checker.check("mcp_tool", "mcp_tool:Exa Web Search:websearch")));
  assert.ok(isAllowed(checker.check("mcp_tool", "mcp_tool:Exa Web Search:webfetch")));
});

test("readonly_allows_context7_mcp_tools", () => {
  const checker = makeChecker(SecurityMode.ReadOnly);
  assert.ok(isAllowed(checker.check("mcp_tool", "mcp_tool:Context7:get_context")));
  assert.ok(isAllowed(checker.check("mcp_tool", "mcp_tool:Context7:search_docs")));
});

test("planwrite_allows_context7_mcp_tools", () => {
  const checker = makeChecker(SecurityMode.PlanWrite);
  assert.ok(isAllowed(checker.check("mcp_tool", "mcp_tool:Context7:get_context")));
  assert.ok(isAllowed(checker.check("mcp_tool", "mcp_tool:Context7:search_docs")));
});

test("readonly_allows_grepapp_mcp_tools", () => {
  const checker = makeChecker(SecurityMode.ReadOnly);
  assert.ok(isAllowed(checker.check("mcp_tool", "mcp_tool:Grep.app:search_code")));
  assert.ok(isAllowed(checker.check("mcp_tool", "mcp_tool:Grep.app:search_repos")));
});

test("planwrite_allows_grepapp_mcp_tools", () => {
  const checker = makeChecker(SecurityMode.PlanWrite);
  assert.ok(isAllowed(checker.check("mcp_tool", "mcp_tool:Grep.app:search_code")));
  assert.ok(isAllowed(checker.check("mcp_tool", "mcp_tool:Grep.app:search_repos")));
});

test("readonly_case_insensitive_mcp_prefix_match", () => {
  const checker = makeChecker(SecurityMode.ReadOnly);
  assert.ok(isAllowed(checker.check("mcp_tool", "mcp_tool:exa web search:websearch")));
  assert.ok(isAllowed(checker.check("mcp_tool", "mcp_tool:CONTEXT7:some_tool")));
});

test("readonly_denies_non_read_equivalent_mcp_tools", () => {
  const checker = makeChecker(SecurityMode.ReadOnly);
  assert.ok(isDenied(checker.check("mcp_tool", "mcp_tool:filesystem:write_file")));
  assert.ok(isDenied(checker.check("mcp_tool", "mcp_tool:other_server:some_tool")));
});

test("readonly_denies_unrelated_prefix", () => {
  const checker = makeChecker(SecurityMode.ReadOnly);
  assert.ok(isDenied(checker.check("mcp_tool", "mcp_tool:exa:websearch")));
  assert.ok(isDenied(checker.check("mcp_tool", "mcp_tool:context7extra:some_tool")));
});

test("standard_mode_still_allows_exa_mcp_via_default", () => {
  const checker = makeChecker(SecurityMode.Standard);
  assert.ok(isAllowed(checker.check("mcp_tool", "mcp_tool:Exa Web Search:websearch")));
});

test("standard_respects_config_allow_over_cwd_auto_allow", () => {
  const config: PermissionConfig = {
    bash: granular([["pip install **", Action.Allow]]),
  };
  const checker = new PermissionChecker(configsFrom(config), SecurityMode.Standard, "/home/user/project", defaultModes());
  assert.ok(isAllowed(checker.check("bash", "pip install requests")));
});

test("check_perm_denies_non_interactively_when_ask_tx_is_none_and_verdict_is_ask", async () => {
  const checker = makeChecker(SecurityMode.Guarded);
  await assert.rejects(
    checkPerm(checker as never, null, "write", "/etc/passwd"),
    (e: unknown) => e instanceof Error && e.message === "Permission denied (non-interactive mode)",
  );
});
