import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildSandbox, partitionExpose } from "../src/sandbox.ts";
import { defaultCli, resolveSandboxExpose } from "../src/cli.ts";
import { defaultConfig } from "../src/config/mod.ts";
import { bwrapSandbox, pairAt, scratchDir, tripleAt } from "./sandbox_support.ts";

function dir(name: string): string {
  return scratchDir("expose", name);
}

test("test_resolve_sandbox_expose_cli_replaces_config_wholesale", () => {
  const cli = { ...defaultCli(), sandboxExpose: ["~/.ssh"] };
  const cfg = { ...defaultConfig(), sandboxExpose: ["~/.aws"] };
  assert.deepEqual(
    resolveSandboxExpose(cli, cfg),
    ["~/.ssh"],
    "a non-empty CLI list must replace the config list wholesale, not merge with it",
  );
});

test("test_resolve_sandbox_expose_falls_back_to_config", () => {
  const cli = defaultCli();
  const cfg = { ...defaultConfig(), sandboxExpose: ["~/.aws"] };
  assert.deepEqual(resolveSandboxExpose(cli, cfg), ["~/.aws"]);
});

test("test_resolve_sandbox_expose_defaults_to_empty", () => {
  assert.deepEqual(resolveSandboxExpose(defaultCli(), defaultConfig()), []);
});

test("test_partition_accepts_exact_mask_root", () => {
  const home = dir("home-exact");
  const ssh = path.join(home, ".ssh");
  const [valid, rejected] = partitionExpose(["~/.ssh"], [ssh], home);
  assert.deepEqual(valid, [ssh]);
  assert.deepEqual(rejected, [], `exact mask root must be accepted: ${rejected}`);
});

test("test_partition_accepts_subpath_of_mask_root", () => {
  const home = dir("home-subpath");
  const ssh = path.join(home, ".ssh");
  const [valid, rejected] = partitionExpose(["~/.ssh/known_hosts"], [ssh], home);
  assert.deepEqual(valid, [path.join(home, ".ssh", "known_hosts")]);
  assert.deepEqual(rejected, [], `a subpath of a mask root must be accepted: ${rejected}`);
});

test("test_partition_rejects_path_outside_mask_list", () => {
  const home = dir("home-outside");
  const ssh = path.join(home, ".ssh");
  const [valid, rejected] = partitionExpose(["/etc"], [ssh], home);
  assert.deepEqual(valid, [], `a path outside the mask list must not be exposed: ${valid}`);
  assert.deepEqual(rejected, ["/etc"]);
});

test("test_partition_rejects_sibling_component_trap", () => {
  const home = dir("home-sibling");
  const ssh = path.join(home, ".ssh");
  const [valid, rejected] = partitionExpose(["~/.ssh2"], [ssh], home);
  assert.deepEqual(valid, [], "`~/.ssh2` must not pass as a subpath of `~/.ssh`: " + JSON.stringify(valid));
  assert.deepEqual(rejected, ["~/.ssh2"]);
});

test("test_partition_accepts_dollar_home_spelling", () => {
  const home = dir("home-dollar");
  const ssh = path.join(home, ".ssh");
  const [valid, rejected] = partitionExpose(["$HOME/.ssh"], [ssh], home);
  assert.deepEqual(valid, [ssh]);
  assert.deepEqual(rejected, [], "`$HOME/.ssh` names the same directory as `~/.ssh`: " + JSON.stringify(rejected));
});

test("test_partition_rejects_parent_dir_escape_to_home", () => {
  const home = dir("home-escape");
  const ssh = path.join(home, ".ssh");
  const raw = ["~/.ssh/.."];
  const [valid, rejected] = partitionExpose(raw, [ssh], home);
  assert.deepEqual(valid, [], "a `..` component must never be exposed: " + JSON.stringify(valid));
  assert.deepEqual(rejected, raw);
});

test("test_partition_rejects_parent_dir_escape_into_a_sibling_mask", () => {
  const home = dir("home-escape-sibling");
  const ssh = path.join(home, ".ssh");
  const aws = path.join(home, ".aws");
  const raw = ["~/.ssh/../.aws"];
  const [valid, rejected] = partitionExpose(raw, [ssh, aws], home);
  assert.deepEqual(valid, [], "the direct spelling is the way to expose another mask root: " + JSON.stringify(valid));
  assert.deepEqual(rejected, raw);
});

test("test_partition_rejects_parent_dir_escape_out_of_home", () => {
  const home = dir("home-escape-out");
  const ssh = path.join(home, ".ssh");
  const raw = ["~/.ssh/../../../etc"];
  const [valid, rejected] = partitionExpose(raw, [ssh], home);
  assert.deepEqual(valid, [], "climbing out of the mask list must be rejected like any other outside value: " + JSON.stringify(valid));
  assert.deepEqual(rejected, raw);
});

test("test_partition_expose_with_no_home_leaves_tilde_form_unexpanded", () => {
  const ssh = "/nonexistent-home/.ssh";
  const raw = ["~/.ssh"];
  const [valid, rejected] = partitionExpose(raw, [ssh], undefined);
  assert.deepEqual(valid, [], "a `~` form must not expand against a missing home: " + JSON.stringify(valid));
  assert.deepEqual(rejected, raw);
});

test("test_partition_expose_with_no_home_still_accepts_an_absolute_mask_root", () => {
  const root = "/nonexistent-home/.ssh";
  const raw = ["/nonexistent-home/.ssh"];
  const [valid, rejected] = partitionExpose(raw, [root], undefined);
  assert.deepEqual(valid, [root]);
  assert.deepEqual(rejected, [], "an absolute path needs no home to validate: " + JSON.stringify(rejected));
});

test("test_build_sandbox_returns_the_rejected_value_warning", () => {
  const setup = buildSandbox({ enabled: true, required: false, backend: "bwrap", shell: "bash", expose: ["/etc"], network: true });
  assert.ok(
    setup.warnings.some((w) => w.includes("sandbox-expose value '/etc'")),
    `the out-of-list value must be reported verbatim to whoever logs it: ${JSON.stringify(setup.warnings)}`,
  );
});

test("test_build_sandbox_is_quiet_without_expose_values", () => {
  const setup = buildSandbox({ enabled: true, required: false, backend: "bwrap", shell: "bash", expose: [], network: true });
  assert.ok(
    !setup.warnings.some((w) => w.includes("sandbox-expose value")),
    `no expose values, so nothing to warn about: ${JSON.stringify(setup.warnings)}`,
  );
});

test("test_expose_emits_ro_bind_try_between_masks_and_cwd_bind", () => {
  const root = dir("expose-arg-assembly");
  fs.mkdirSync(root, { recursive: true });
  const cacheDir = dir("expose-arg-assembly-cache");
  try {
    const sandbox = bwrapSandbox([root], cacheDir).withExpose([root]);
    const args = sandbox.wrapCommand("echo hello").args;
    const cwd = process.cwd();
    const mask = pairAt(args, "--tmpfs", root);
    assert.ok(mask !== undefined, `expected the mask tmpfs to still be emitted: ${JSON.stringify(args)}`);
    const expose = tripleAt(args, "--ro-bind-try", root, root);
    assert.ok(expose !== undefined, `expected --ro-bind-try for the exposed path: ${JSON.stringify(args)}`);
    const cwdBind = pairAt(args, "--bind", cwd);
    assert.ok(cwdBind !== undefined, "the working directory should be bound");
    assert.ok(mask < expose, `expose must come after the mask tmpfs: ${JSON.stringify(args)}`);
    assert.ok(expose < cwdBind, `expose must come before the cwd bind: ${JSON.stringify(args)}`);
    assert.equal(pairAt(args, "--bind", root), undefined, `expose must never grant write access via plain --bind: ${JSON.stringify(args)}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("test_no_expose_emits_no_ro_bind_try", () => {
  const root = dir("no-expose");
  fs.mkdirSync(root, { recursive: true });
  const cacheDir = dir("no-expose-cache");
  try {
    const sandbox = bwrapSandbox([root], cacheDir);
    const args = sandbox.wrapCommand("echo hello").args;
    assert.equal(
      tripleAt(args, "--ro-bind-try", root, root),
      undefined,
      `no expose configured, so no --ro-bind-try for the mask root should appear: ${JSON.stringify(args)}`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});
