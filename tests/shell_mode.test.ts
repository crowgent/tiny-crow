import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Sandbox } from "../src/sandbox.ts";

function runBuilt(sb: Sandbox, command: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const built = sb.wrapCommand(command);
  return new Promise((resolve, reject) => {
    const child = spawn(built.program, built.args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout?.on("data", (d: Buffer) => out.push(d));
    child.stderr?.on("data", (d: Buffer) => err.push(d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ status: code, stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString() }));
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("test_shell_mode_runs_command", async () => {
  const sandbox = new Sandbox(false, "bwrap");
  const output = await runBuilt(sandbox, "echo hello");
  assert.equal(output.stdout.trim(), "hello");
});

test("test_shell_mode_strips_bang_prefix", async () => {
  const sandbox = new Sandbox(false, "bwrap");
  const output = await runBuilt(sandbox, "echo shell_mode_works");
  assert.equal(output.stdout.trim(), "shell_mode_works");
});

test("test_shell_mode_failing_command", async () => {
  const sandbox = new Sandbox(false, "bwrap");
  const output = await runBuilt(sandbox, "exit 42");
  assert.notEqual(output.status, 0);
  assert.equal(output.status, 42);
});

test("test_shell_mode_stderr_included", async () => {
  const sandbox = new Sandbox(false, "bwrap");
  const output = await runBuilt(sandbox, "echo stderr_output >&2");
  assert.equal(output.stderr.trim(), "stderr_output");
});

test("test_output_command_returns_output_when_descendant_holds_pipe", async () => {
  const sandbox = new Sandbox(false, "bwrap");
  const t0 = Date.now();
  const output = await sandbox.outputCommand("printf ok; sleep 2 &");
  assert.ok(Date.now() - t0 < 1000, `output_command should return within 1s, took ${Date.now() - t0}ms`);
  assert.equal(output.stdout.toString(), "ok");
});

test("test_shell_mode_timeout_kills_descendants", async () => {
  const marker = path.join(os.tmpdir(), `zerostack-abort-descendant-${process.pid}`);
  await fs.rm(marker, { force: true });
  const sandbox = new Sandbox(false, "bwrap");
  const command = `sh -c 'sleep 2; printf leaked > ${marker}' & wait`;
  const pending = sandbox.outputCommand(command);
  // Dropping a timed-out future kills the group in Rust; the TS
  // equivalent is killActive() once the caller gives up waiting.
  const timedOut = await Promise.race([
    pending.then(() => false),
    sleep(100).then(() => true),
  ]);
  assert.ok(timedOut);
  sandbox.killActive();
  await Promise.race([pending, sleep(1000)]);
  await sleep(2300);
  assert.ok(!(await fs.stat(marker).then(() => true).catch(() => false)));
});

test("test_shell_mode_explicit_kill_active_kills_running_descendants", async () => {
  const marker = path.join(os.tmpdir(), `zerostack-abort-active-descendant-${process.pid}`);
  await fs.rm(marker, { force: true });
  const sandbox = new Sandbox(false, "bwrap");
  const command = `sh -c 'sleep 2; printf leaked > ${marker}' & wait`;
  const handle = sandbox.outputCommand(command);
  const deadline = Date.now() + 2000;
  while (sandbox.activeGroupCount() !== 1) {
    assert.ok(Date.now() < deadline);
    await sleep(10);
  }
  sandbox.killActive();
  await Promise.race([handle, sleep(1000)]);
  await sleep(2300);
  assert.ok(!(await fs.stat(marker).then(() => true).catch(() => false)));
  assert.equal(sandbox.activeGroupCount(), 0);
});
