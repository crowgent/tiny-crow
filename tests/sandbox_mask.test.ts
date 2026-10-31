import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { maskRootsFor, Sandbox } from "../src/sandbox.ts";
import { bwrapSandbox, pairAt, scratchDir } from "./sandbox_support.ts";

function dir(name: string): string {
  return scratchDir("mask", name);
}

function cwdScratchDir(name: string): string {
  return path.join(process.cwd(), "target", `tiny-crow-mask-${name}-${process.pid}`);
}

function mountsAt(args: string[], dst: string): [number, string][] {
  const mounts: [number, string][] = [];
  let i = 0;
  while (i < args.length) {
    const arity =
      args[i] === "--tmpfs" || args[i] === "--dev" || args[i] === "--proc" || args[i] === "--dir"
        ? 2
        : args[i] === "--bind" || args[i] === "--bind-try" || args[i] === "--ro-bind" || args[i] === "--ro-bind-try" || args[i] === "--dev-bind"
          ? 3
          : 0;
    if (arity === 0) {
      i += 1;
      continue;
    }
    if (args[i + arity - 1] === dst) mounts.push([i, args[i]!]);
    i += arity;
  }
  return mounts;
}

function lastMountAt(args: string[], dst: string): [number, string] {
  const mounts = mountsAt(args, dst);
  assert.ok(mounts.length > 0, `expected something mounted at ${dst}: ${JSON.stringify(args)}`);
  return mounts[mounts.length - 1]!;
}

function cleanup(...dirs: string[]): void {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}

test("test_existing_mask_root_is_masked_between_root_bind_and_cwd_bind", () => {
  const root = dir("existing");
  fs.mkdirSync(root, { recursive: true });
  const cacheDir = dir("existing-cache");
  try {
    const sandbox = bwrapSandbox([root], cacheDir);
    const args = sandbox.wrapCommand("echo hello").args;
    const cwd = process.cwd();
    const rootBind = pairAt(args, "--ro-bind", "/");
    assert.ok(rootBind !== undefined, "`/` should be ro-bound");
    const mask = pairAt(args, "--tmpfs", root);
    assert.ok(mask !== undefined, `existing mask root should be tmpfs-masked: ${JSON.stringify(args)}`);
    const cwdBind = pairAt(args, "--bind", cwd);
    assert.ok(cwdBind !== undefined, "the working directory should be bound");
    assert.ok(rootBind < mask, `the mask must shadow the \`/\` ro-bind, so it comes after it: ${JSON.stringify(args)}`);
    assert.ok(mask < cwdBind, `the cwd bind must shadow the mask, so it comes after it: ${JSON.stringify(args)}`);
  } finally {
    cleanup(root, cacheDir);
  }
});

test("test_nonexistent_mask_root_emits_no_tmpfs", () => {
  const root = dir("missing");
  fs.rmSync(root, { recursive: true, force: true });
  const cacheDir = dir("missing-cache");
  try {
    const sandbox = bwrapSandbox([root], cacheDir);
    const args = sandbox.wrapCommand("echo hello").args;
    assert.equal(pairAt(args, "--tmpfs", root), undefined, `a mask root missing on the host must not be mounted: ${JSON.stringify(args)}`);
    assert.ok(pairAt(args, "--tmpfs", "/tmp") !== undefined, "the `/tmp` tmpfs should still be there, or the assertion above is vacuous");
    assert.deepEqual(sandbox.maskedRoots(), [], "a mask root missing on the host is not a masked path");
  } finally {
    cleanup(cacheDir);
  }
});

test("test_zerobox_invocation_is_unchanged_by_masks", () => {
  const root = dir("zerobox");
  fs.mkdirSync(root, { recursive: true });
  try {
    const sandbox = new Sandbox(true, "zerobox")
      .withBackendAvailable(true)
      .withMaskRoots([root]);
    const cmd = sandbox.wrapCommand("echo hello");
    assert.equal(cmd.program, "zerobox");
    const cwd = process.cwd();
    assert.deepEqual(cmd.args, ["--allow-write", cwd, "--", "bash", "-c", "echo hello"], "zerobox exposes no mount policy, so masking must not touch its invocation");
  } finally {
    cleanup(root);
  }
});

test("test_cwd_under_a_mask_root_reports_that_root", () => {
  const root = dir("shadowed");
  const cwd = path.join(root, "nvim", "lua");
  fs.mkdirSync(cwd, { recursive: true });
  try {
    const sandbox = new Sandbox(true, "bwrap")
      .withBackendAvailable(true)
      .withMaskRoots([root]);
    assert.equal(sandbox.shadowedMaskRoot(cwd), root);
    assert.equal(sandbox.shadowedMaskRoot(root), root, "a cwd that is the mask root itself is shadowed too");
  } finally {
    cleanup(root);
  }
});

test("test_sibling_of_a_mask_root_is_not_shadowed", () => {
  const base = dir("sibling");
  const root = path.join(base, ".ssh");
  const sibling = path.join(base, ".ssh2");
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(sibling, { recursive: true });
  try {
    const sandbox = new Sandbox(true, "bwrap")
      .withBackendAvailable(true)
      .withMaskRoots([root]);
    assert.equal(sandbox.shadowedMaskRoot(sibling), undefined);
    assert.equal(sandbox.shadowedMaskRoot(base), undefined);
  } finally {
    cleanup(base);
  }
});

test("test_cwd_reached_through_a_symlinked_home_is_shadowed", () => {
  const base = dir("symlinked-home-shadow");
  fs.rmSync(base, { recursive: true, force: true });
  const realHome = path.join(base, "data", "home", "tester");
  const project = path.join(realHome, ".gnupg", "notes");
  fs.mkdirSync(project, { recursive: true });
  const elsewhere = path.join(realHome, "notes");
  fs.mkdirSync(elsewhere, { recursive: true });
  fs.symlinkSync(path.join(base, "data", "home"), path.join(base, "home"));
  const root = path.join(base, "home", "tester", ".gnupg");
  try {
    const sandbox = new Sandbox(true, "bwrap")
      .withBackendAvailable(true)
      .withMaskRoots([root]);
    assert.equal(
      sandbox.shadowedMaskRoot(fs.realpathSync(project)),
      root,
      "a project inside the mask root's target is shadowed by the project bind, however the root is spelled",
    );
    assert.equal(
      sandbox.shadowedMaskRoot(fs.realpathSync(elsewhere)),
      undefined,
      "resolving the paths must not turn the containment test into a blanket yes",
    );
  } finally {
    cleanup(base);
  }
});

test("test_mask_root_under_the_cwd_is_remasked_after_the_project_bind", () => {
  const root = cwdScratchDir("under-cwd");
  fs.mkdirSync(root, { recursive: true });
  const cacheDir = dir("under-cwd-cache");
  try {
    const sandbox = bwrapSandbox([root], cacheDir);
    const args = sandbox.wrapCommand("echo hello").args;
    const cwd = process.cwd();
    const cwdBind = pairAt(args, "--bind", cwd);
    assert.ok(cwdBind !== undefined, "the working directory should be bound");
    const [index, flag] = lastMountAt(args, root);
    assert.equal(flag, "--tmpfs", `the tmpfs must be the last mount at a mask root the project bind swallows, or the sandbox gets a writable credential directory: ${JSON.stringify(args)}`);
    assert.ok(index > cwdBind, "the re-mask must come after the project bind to shadow it");
  } finally {
    cleanup(root, cacheDir);
  }
});

test("test_mask_root_under_the_cache_bind_is_remasked", () => {
  const cacheDir = dir("cache-swallow");
  const root = path.join(cacheDir, ".aws");
  fs.mkdirSync(root, { recursive: true });
  try {
    const sandbox = bwrapSandbox([root], cacheDir);
    const args = sandbox.wrapCommand("echo hello").args;
    const cacheBind = pairAt(args, "--bind", cacheDir);
    assert.ok(cacheBind !== undefined, "the cache directory should be bound");
    const [index, flag] = lastMountAt(args, root);
    assert.equal(flag, "--tmpfs", `the tmpfs must be the last mount at a mask root the cache bind swallows: ${JSON.stringify(args)}`);
    assert.ok(index > cacheBind, "the re-mask must come after the cache bind to shadow it");
  } finally {
    cleanup(cacheDir);
  }
});

test("test_mask_root_symlinked_into_the_project_is_remasked", () => {
  const real = cwdScratchDir("dotfiles");
  fs.mkdirSync(path.join(real, "ssh"), { recursive: true });
  const home = dir("symlinked-ssh");
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
  const root = path.join(home, ".ssh");
  fs.symlinkSync(path.join(real, "ssh"), root);
  const cacheDir = dir("symlinked-ssh-cache");
  try {
    const sandbox = bwrapSandbox([root], cacheDir);
    const args = sandbox.wrapCommand("echo hello").args;
    const cwd = process.cwd();
    const cwdBind = pairAt(args, "--bind", cwd);
    assert.ok(cwdBind !== undefined, "the working directory should be bound");
    const [index, flag] = lastMountAt(args, root);
    assert.equal(flag, "--tmpfs", `a mask root whose target the project bind swallows must end up masked: ${JSON.stringify(args)}`);
    assert.ok(index > cwdBind, "the re-mask must come after the project bind, or the symlinked credential directory is writable inside the sandbox");
  } finally {
    cleanup(home, real, cacheDir);
  }
});

test("test_mask_root_under_a_symlinked_home_is_remasked", () => {
  const base = dir("symlinked-home");
  fs.rmSync(base, { recursive: true, force: true });
  const realHome = path.join(base, "data", "home", "tester");
  fs.mkdirSync(path.join(realHome, ".aws"), { recursive: true });
  fs.symlinkSync(path.join(base, "data", "home"), path.join(base, "home"));
  const root = path.join(base, "home", "tester", ".aws");
  try {
    const sandbox = bwrapSandbox([root], realHome);
    const args = sandbox.wrapCommand("echo hello").args;
    const cacheBind = pairAt(args, "--bind", realHome);
    assert.ok(cacheBind !== undefined, "the cache directory should be bound");
    const [index, flag] = lastMountAt(args, root);
    assert.equal(flag, "--tmpfs", `a mask root reached through a symlinked home must end up masked: ${JSON.stringify(args)}`);
    assert.ok(index > cacheBind, "the re-mask must come after the read-write bind that contains the resolved root");
  } finally {
    cleanup(base);
  }
});

test("test_expose_under_a_remasked_root_stays_visible_read_only", () => {
  const root = cwdScratchDir("under-cwd-expose");
  fs.mkdirSync(root, { recursive: true });
  const exposed = path.join(root, "known_hosts");
  fs.writeFileSync(exposed, "");
  const cacheDir = dir("under-cwd-expose-cache");
  try {
    const sandbox = bwrapSandbox([root], cacheDir).withExpose([exposed]);
    const args = sandbox.wrapCommand("echo hello").args;
    const cwd = process.cwd();
    const cwdBind = pairAt(args, "--bind", cwd);
    assert.ok(cwdBind !== undefined, "the working directory should be bound");
    const [mask, maskFlag] = lastMountAt(args, root);
    const [expose, exposeFlag] = lastMountAt(args, exposed);
    assert.equal(maskFlag, "--tmpfs");
    assert.equal(exposeFlag, "--ro-bind-try", `an exposed subpath must stay restored, and read-only: ${JSON.stringify(args)}`);
    assert.ok(cwdBind < mask && mask < expose, "the re-mask lands after the project bind, so the exposed subpath has to be restored after it in turn");
  } finally {
    cleanup(root, cacheDir);
  }
});

test("test_mask_root_containing_the_cwd_keeps_the_project_bind_as_the_last_word", () => {
  const cwd = process.cwd();
  const root = path.dirname(cwd);
  const cacheDir = dir("contains-cwd-cache");
  try {
    const sandbox = bwrapSandbox([root], cacheDir);
    const args = sandbox.wrapCommand("echo hello").args;
    const mounts = mountsAt(args, root);
    const cwdBind = pairAt(args, "--bind", cwd);
    assert.ok(cwdBind !== undefined, "the working directory should be bound");
    assert.equal(mounts.length, 1, `a mask root containing the working directory must be masked exactly once: ${JSON.stringify(args)}`);
    assert.ok(mounts[0]![0] < cwdBind, "the mask comes first so the project bind can shadow it");
    assert.equal(lastMountAt(args, cwd)[1], "--bind", "the project bind must stay the last word on its own subtree");
  } finally {
    cleanup(cacheDir);
  }
});

test("test_mask_root_outside_every_read_write_bind_is_masked_once", () => {
  const root = dir("outside-binds");
  fs.mkdirSync(root, { recursive: true });
  const cacheDir = dir("outside-binds-cache");
  try {
    const sandbox = bwrapSandbox([root], cacheDir);
    const args = sandbox.wrapCommand("echo hello").args;
    assert.equal(mountsAt(args, root).length, 1, `nothing re-opens this root, so a second mask layer would be dead weight: ${JSON.stringify(args)}`);
  } finally {
    cleanup(root, cacheDir);
  }
});

test("test_optional_sandbox_falling_back_to_bare_masks_nothing", () => {
  const root = dir("probe");
  fs.mkdirSync(root, { recursive: true });
  try {
    const sandbox = new Sandbox(true, "bwrap")
      .withBackendAvailable(false)
      .withBackendInstalledNow(true)
      .withMaskRoots([root]);
    const cmd = sandbox.wrapCommand("echo hello");
    assert.equal(cmd.program, "bash", "sanity: the cached probe says the backend is missing, so the command runs unsandboxed");
    assert.deepEqual(sandbox.maskedRoots(), [], "an unsandboxed command masks nothing");
    const sandboxed = new Sandbox(true, "bwrap")
      .withBackendAvailable(true)
      .withMaskRoots([root]);
    assert.deepEqual(sandboxed.maskedRoots(), [root], "sanity: the same root is masked once the backend actually runs");
  } finally {
    cleanup(root);
  }
});

test("test_required_sandbox_masks_on_the_fresh_probe_that_launches_it", () => {
  const root = dir("required-probe");
  fs.mkdirSync(root, { recursive: true });
  const cacheDir = dir("required-probe-cache");
  try {
    const sandbox = new Sandbox(true, "bwrap")
      .withRequired(true)
      .withBackendAvailable(false)
      .withBackendInstalledNow(true)
      .withCacheDir(cacheDir)
      .withMaskRoots([root]);
    const cmd = sandbox.wrapCommand("echo hello");
    assert.equal(cmd.program, "bwrap", "sanity: a required sandbox launches on the fresh probe, so this command is sandboxed");
    assert.deepEqual(sandbox.maskedRoots(), [root], "a sandboxed command must mask, whichever probe let it launch");
    assert.ok(pairAt(cmd.args, "--tmpfs", root) !== undefined, "the mask has to reach the bwrap invocation, not just masked_roots()");
  } finally {
    cleanup(root, cacheDir);
  }
});

test("test_shadowed_mask_warning_is_computed_against_the_bound_working_directory", () => {
  const cwd = process.cwd();
  const sandbox = new Sandbox(true, "bwrap")
    .withBackendAvailable(true)
    .withMaskRoots([cwd]);
  const warning = sandbox.shadowedMaskWarning();
  assert.ok(warning !== undefined, "a mask root containing the bound working directory must warn");
  assert.ok(warning.includes(cwd), `the warning should name the shadowed root: ${warning}`);
  const elsewhere = dir("elsewhere");
  fs.mkdirSync(elsewhere, { recursive: true });
  try {
    const other = new Sandbox(true, "bwrap")
      .withBackendAvailable(true)
      .withMaskRoots([elsewhere]);
    assert.equal(other.shadowedMaskWarning(), undefined, "a mask root the bound working directory is not inside must stay quiet");
    assert.equal(other.shadowedMaskRoot(path.join(elsewhere, "project")), elsewhere, "sanity: that root would warn if some other directory decided the answer");
  } finally {
    cleanup(elsewhere);
  }
});

test("test_mask_roots_follow_xdg_config_home_when_set", () => {
  const home = "/home/tester";
  const xdg = "/home/tester/cfg";
  assert.deepEqual(maskRootsFor(home, xdg), [
    path.join(home, ".ssh"),
    path.join(home, ".aws"),
    path.join(home, ".gnupg"),
    path.join(home, ".kube"),
    path.join(home, ".docker"),
    path.join(xdg, "gh"),
    path.join(xdg, "gcloud"),
    path.join(xdg, "op"),
    path.join(xdg, "sops", "age"),
  ]);
});

test("test_mask_roots_default_to_dot_config", () => {
  const home = "/home/tester";
  assert.deepEqual(maskRootsFor(home, undefined), [
    path.join(home, ".ssh"),
    path.join(home, ".aws"),
    path.join(home, ".gnupg"),
    path.join(home, ".kube"),
    path.join(home, ".docker"),
    path.join(home, ".config", "gh"),
    path.join(home, ".config", "gcloud"),
    path.join(home, ".config", "op"),
    path.join(home, ".config", "sops", "age"),
  ]);
});

test("test_relative_xdg_config_home_is_ignored", () => {
  const home = "/home/tester";
  assert.deepEqual(maskRootsFor(home, "cfg"), maskRootsFor(home, undefined));
});

test("test_disabled_sandbox_masks_nothing", () => {
  const root = dir("disabled");
  fs.mkdirSync(root, { recursive: true });
  try {
    const sandbox = new Sandbox(false, "bwrap")
      .withBackendAvailable(true)
      .withMaskRoots([root]);
    assert.deepEqual(sandbox.maskedRoots(), []);
    assert.equal(sandbox.shadowedMaskRoot(root), undefined);
  } finally {
    cleanup(root);
  }
});
