import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildShellInvocation, runHook } from "../../src/extras/hooks/subprocess.ts";

test("build_shell_invocation_wraps_command_in_sh_c", () => {
  const [program, args] = buildShellInvocation("echo hi", undefined);
  assert.equal(program, "sh");
  assert.deepEqual(args, ["-c", "echo hi"]);
});

test("build_shell_invocation_uses_exec_form_when_args_present", () => {
  const [program, args] = buildShellInvocation("echo", ["hello", "world"]);
  assert.equal(program, "echo");
  assert.deepEqual(args, ["hello", "world"]);
});

test("build_shell_invocation_uses_shell_form_when_args_absent", () => {
  const [program, args] = buildShellInvocation("echo hi");
  assert.equal(program, "sh");
  assert.deepEqual(args, ["-c", "echo hi"]);
});

test("run_hook_echoes_stdin_and_completes", async () => {
  const output = await runHook("cat", undefined, Buffer.from("hello"), 2000, "/repo");
  assert.equal(output.exitCode, 0);
  assert.deepEqual(output.stdout, Buffer.from("hello"));
  assert.equal(output.timedOut, false);
});

test("run_hook_reports_nonzero_exit_code", async () => {
  const output = await runHook("exit 7", undefined, Buffer.alloc(0), 2000, "/repo");
  assert.equal(output.exitCode, 7);
  assert.equal(output.timedOut, false);
});

test("run_hook_times_out_and_kills_group", async () => {
  const marker = join(tmpdir(), `zerostack-hook-subprocess-timeout-${process.pid}`);
  rmSync(marker, { force: true });
  const command = `sh -c 'sleep 2; printf leaked > ${marker}' & wait`;
  const output = await runHook(command, undefined, Buffer.alloc(0), 100, "/repo");
  assert.equal(output.timedOut, true);
  await new Promise((resolve) => setTimeout(resolve, 2300));
  assert.equal(existsSync(marker), false);
  rmSync(marker, { force: true });
});

test("run_hook_exposes_zerostack_project_dir_env_var", async () => {
  const output = await runHook(
    'echo "$ZEROSTACK_PROJECT_DIR"',
    undefined,
    Buffer.alloc(0),
    2000,
    "/repo/project",
  );
  assert.equal(output.exitCode, 0);
  assert.equal(output.stdout.toString("utf8").trim(), "/repo/project");
});

test("run_hook_exec_form_bypasses_the_shell", async () => {
  // In exec form the arg is passed literally to the program, with no shell
  // metacharacter expansion (a shell would expand "$HOME" or "*").
  const output = await runHook("echo", ["$HOME literally"], Buffer.alloc(0), 2000, "/repo");
  assert.equal(output.exitCode, 0);
  assert.equal(output.stdout.toString("utf8").trim(), "$HOME literally");
});
