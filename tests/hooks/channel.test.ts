import test from "node:test";
import assert from "node:assert/strict";
import { interpretHookOutput } from "../../src/extras/hooks/mod.ts";
import type { HookOutput } from "../../src/extras/hooks/subprocess.ts";

function output(exitCode: number | null, stdout: string, stderr: string, timedOut = false): HookOutput {
  return {
    exitCode,
    stdout: Buffer.from(stdout),
    stderr: Buffer.from(stderr),
    timedOut,
  };
}

test("exit_zero_valid_json_is_no_objection_with_json", () => {
  const result = interpretHookOutput(output(0, '{"permissionDecision":"allow"}', ""));
  assert.equal(result.kind, "NoObjection");
  if (result.kind === "NoObjection") {
    assert.deepEqual(result.json, { permissionDecision: "allow" });
  }
});

test("exit_zero_non_json_stdout_is_no_objection_null", () => {
  const result = interpretHookOutput(output(0, "not json at all", ""));
  assert.equal(result.kind, "NoObjection");
  if (result.kind === "NoObjection") assert.equal(result.json, null);
});

test("exit_zero_empty_stdout_is_no_objection_null", () => {
  const result = interpretHookOutput(output(0, "", ""));
  assert.equal(result.kind, "NoObjection");
  if (result.kind === "NoObjection") assert.equal(result.json, null);
});

test("exit_two_is_block_with_stderr", () => {
  const result = interpretHookOutput(output(2, "", "no way\n"));
  assert.equal(result.kind, "Block");
  if (result.kind === "Block") assert.equal(result.stderr.trim(), "no way");
});

test("exit_two_with_json_also_present_ignores_json", () => {
  const result = interpretHookOutput(output(2, '{"permissionDecision":"allow"}', "blocked\n"));
  assert.equal(result.kind, "Block");
  if (result.kind === "Block") assert.equal(result.stderr.trim(), "blocked");
});

test("other_exit_code_is_error_with_code_and_stderr", () => {
  const result = interpretHookOutput(output(1, "", "boom\n"));
  assert.equal(result.kind, "Error");
  if (result.kind === "Error") {
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr.trim(), "boom");
  }
});

test("timeout_is_timed_out_regardless_of_exit_code", () => {
  const result = interpretHookOutput(output(0, "", "", true));
  assert.equal(result.kind, "TimedOut");
  const result2 = interpretHookOutput(output(null, "", "", true));
  assert.equal(result2.kind, "TimedOut");
});
