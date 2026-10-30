import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { BashTool } from "../src/agent/tools/bash.ts";
import {
  defaultCli,
  resolveSandbox,
  resolveSandboxRequired,
  sandboxSettingConflict,
} from "../src/cli.ts";
import { defaultConfig } from "../src/config/mod.ts";
import { PermissionChecker } from "../src/permission/checker.ts";
import { SecurityMode } from "../src/permission/mod.ts";
import { Sandbox } from "../src/sandbox.ts";

function missingBackend(backend: string): Sandbox {
  return new Sandbox(true, backend)
    .withRequired(true)
    .withBackendAvailable(false);
}

function scratchCacheDir(name: string): string {
  return path.join(os.tmpdir(), `zerostack-sandbox-${name}-${process.pid}`);
}

test("test_required_backend_missing_refuses_wrap_command", () => {
  const sandbox = missingBackend("bwrap");
  assert.throws(
    () => sandbox.wrapCommand("echo hello"),
    (e: unknown) => {
      const msg = String((e as Error).message);
      assert.ok(msg.includes("bwrap"), `message should name the backend: ${msg}`);
      assert.ok(msg.includes("sandbox-required"), `message should name the config key: ${msg}`);
      return true;
    },
  );
});

test("test_required_zerobox_missing_names_zerobox", () => {
  const sandbox = missingBackend("zerobox");
  assert.throws(
    () => sandbox.wrapCommand("echo hello"),
    (e: unknown) => {
      const msg = String((e as Error).message);
      assert.ok(msg.includes("zerobox"), `message should name the backend: ${msg}`);
      assert.ok(msg.includes("sandbox-required"), `message should name the config key: ${msg}`);
      return true;
    },
  );
});

test("test_refusal_names_the_configured_backend_verbatim", () => {
  const sandbox = missingBackend("bubblewrap");
  assert.throws(
    () => sandbox.wrapCommand("echo hello"),
    (e: unknown) => {
      const msg = String((e as Error).message);
      assert.ok(msg.includes("'bubblewrap'"), `message should name the configured backend: ${msg}`);
      assert.ok(!msg.includes("bwrap"), `message should not invent a backend: ${msg}`);
      return true;
    },
  );
});

test("test_required_backend_missing_refuses_output_command", async () => {
  const sandbox = missingBackend("bwrap");
  await assert.rejects(sandbox.outputCommand("echo hello"), (e: unknown) =>
    String((e as Error).message).includes("sandbox-required"),
  );
});

test("test_not_required_backend_missing_runs_unsandboxed", async () => {
  const sandbox = new Sandbox(true, "bwrap").withBackendAvailable(false);
  const output = await sandbox.outputCommand("echo hello");
  assert.equal(output.stdout.toString().trim(), "hello");
});

test("test_required_backend_present_wraps_command", () => {
  const cacheDir = scratchCacheDir("present");
  try {
    const sandbox = new Sandbox(true, "bwrap")
      .withRequired(true)
      .withBackendAvailable(true)
      .withCacheDir(cacheDir);
    const cmd = sandbox.wrapCommand("echo hello");
    assert.equal(cmd.program, "bwrap");
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("test_backend_installed_after_cached_probe_lifts_the_refusal", () => {
  const cacheDir = scratchCacheDir("installed-later");
  try {
    const sandbox = new Sandbox(true, "bwrap")
      .withRequired(true)
      .withBackendAvailable(false)
      .withBackendInstalledNow(true)
      .withCacheDir(cacheDir);
    assert.equal(sandbox.refusalReason(), undefined);
    const cmd = sandbox.wrapCommand("echo hello");
    assert.equal(cmd.program, "bwrap");
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("test_required_zerobox_present_wraps_command", () => {
  const sandbox = new Sandbox(true, "zerobox")
    .withRequired(true)
    .withBackendAvailable(true);
  const cmd = sandbox.wrapCommand("echo hello");
  assert.equal(cmd.program, "zerobox");
});

test("test_disabled_sandbox_ignores_required", () => {
  const sandbox = new Sandbox(false, "bwrap")
    .withRequired(true)
    .withBackendAvailable(false);
  assert.equal(sandbox.refusalReason(), undefined);
  const cmd = sandbox.wrapCommand("echo hello");
  assert.equal(cmd.program, "bash");
});

test("test_bash_tool_surfaces_refusal_to_the_model", async () => {
  const tool = new BashTool(null, null, missingBackend("bwrap") as never, null, null);
  await assert.rejects(tool.call({ command: "echo hello" }), (e: unknown) => {
    const msg = String((e as Error).message);
    assert.ok(msg.includes("bwrap"), `tool error should name the backend: ${msg}`);
    assert.ok(msg.includes("sandbox-required"), `tool error should name the config key: ${msg}`);
    return true;
  });
});

test("test_bash_tool_refuses_before_checking_permissions", async () => {
  const permission = new PermissionChecker({ glob: {}, regex: {} }, SecurityMode.ReadOnly);
  const deniedTool = new BashTool(permission as never, null, new Sandbox(false, "bwrap") as never, null, null);
  await assert.rejects(deniedTool.call({ command: "echo hello" }), (e: unknown) => {
    const msg = String((e as Error).message);
    assert.ok(msg.includes("Permission denied"), `the checker must deny bash for this test to mean anything: ${msg}`);
    return true;
  });
  const tool = new BashTool(permission as never, null, missingBackend("bwrap") as never, null, null);
  await assert.rejects(tool.call({ command: "echo hello" }), (e: unknown) => {
    const msg = String((e as Error).message);
    assert.ok(msg.includes("sandbox-required"), `sandbox refusal should come before the permission check: ${msg}`);
    return true;
  });
});

test("test_resolve_sandbox_required_defaults_to_false", () => {
  const cli = defaultCli();
  const cfg = defaultConfig();
  assert.ok(!resolveSandboxRequired(cli, cfg));
  assert.ok(!resolveSandbox(cli, cfg));
  assert.ok(!sandboxSettingConflict(cli, cfg));
});

test("test_resolve_sandbox_required_from_config", () => {
  const cfg = { ...defaultConfig(), sandboxRequired: true };
  assert.ok(resolveSandboxRequired(defaultCli(), cfg));
  assert.ok(resolveSandbox(defaultCli(), cfg));
  assert.ok(!sandboxSettingConflict(defaultCli(), cfg));
});

test("test_resolve_sandbox_required_cli_overrides_config", () => {
  const cli = { ...defaultCli(), sandboxRequired: true };
  const cfg = { ...defaultConfig(), sandboxRequired: false };
  assert.ok(resolveSandboxRequired(cli, cfg));
});

test("test_required_wins_over_disabled_sandbox", () => {
  const cfg = { ...defaultConfig(), sandbox: false, sandboxRequired: true };
  assert.ok(resolveSandbox(defaultCli(), cfg));
  assert.ok(resolveSandboxRequired(defaultCli(), cfg));
  assert.ok(sandboxSettingConflict(defaultCli(), cfg));
});
