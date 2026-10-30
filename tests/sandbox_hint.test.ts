import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { maskHint, Sandbox } from "../src/sandbox.ts";
import { maskHintForExit } from "../src/agent/tools/bash.ts";

const home = () => "/home/tester";
const sshRoot = () => path.join(home(), ".ssh");
const awsRoot = () => path.join(home(), ".aws");

test("test_masked_file_read_failure_hints", () => {
  const hint = maskHint(
    "cat ~/.ssh/id_ed25519",
    "cat: /home/tester/.ssh/id_ed25519: No such file or directory",
    [sshRoot()],
    home(),
  );
  assert.equal(hint, "note: ~/.ssh is masked by the sandbox; ask the user whether it should be exposed");
});

test("test_absolute_path_only_in_stderr_hints", () => {
  const hint = maskHint(
    "cat $CRED_FILE",
    "cat: /home/tester/.aws/credentials: No such file or directory",
    [awsRoot()],
    home(),
  );
  assert.equal(hint, "note: ~/.aws is masked by the sandbox; ask the user whether it should be exposed");
});

test("test_multiple_hits_name_each_root_once", () => {
  const hint = maskHint(
    "cat ~/.ssh/id_ed25519 ~/.ssh/id_rsa ~/.aws/credentials",
    "",
    [sshRoot(), awsRoot()],
    home(),
  );
  assert.equal(
    hint,
    "note: ~/.ssh is masked by the sandbox; ask the user whether it should be exposed\n" +
      "note: ~/.aws is masked by the sandbox; ask the user whether it should be exposed",
  );
});

test("test_unrelated_failure_never_hints", () => {
  const hint = maskHint(
    "cat missing.txt",
    "cat: missing.txt: No such file or directory",
    [sshRoot(), awsRoot()],
    home(),
  );
  assert.equal(hint, undefined);
});

function maskingSandbox(root: string): Sandbox {
  return new Sandbox(true, "bwrap")
    .withBackendAvailable(true)
    .withMaskRoots([root]);
}

test("test_exit_zero_never_hints_even_when_masked_path_is_mentioned", () => {
  const root = path.join(os.tmpdir(), `zerostack-hint-${process.pid}`, ".ssh");
  fs.mkdirSync(root, { recursive: true });
  try {
    const sandbox = maskingSandbox(root);
    const command = `cat ${path.join(root, "id_ed25519")}`;
    assert.equal(
      maskHintForExit(0, command, "", sandbox as never),
      undefined,
      "exit code 0 must never produce a hint",
    );
    const hint = maskHintForExit(1, command, "", sandbox as never);
    assert.ok(hint !== undefined, "a failed command naming a masked root must hint");
    assert.ok(
      hint.includes(root) && hint.includes("ask the user"),
      `the hint should name the masked root and route the decision to the user: ${hint}`,
    );
  } finally {
    fs.rmSync(path.join(os.tmpdir(), `zerostack-hint-${process.pid}`), { recursive: true, force: true });
  }
});

test("test_unsandboxed_command_never_hints", () => {
  const root = path.join(os.tmpdir(), `zerostack-hint-bare-${process.pid}`, ".ssh");
  fs.mkdirSync(root, { recursive: true });
  try {
    const sandbox = new Sandbox(true, "bwrap")
      .withBackendAvailable(false)
      .withMaskRoots([root]);
    const command = `cat ${path.join(root, "id_ed25519")}`;
    assert.equal(
      maskHintForExit(1, command, "", sandbox as never),
      undefined,
      "a command that ran unsandboxed read the real file, so a mask hint would be a lie",
    );
  } finally {
    fs.rmSync(path.join(os.tmpdir(), `zerostack-hint-bare-${process.pid}`), { recursive: true, force: true });
  }
});
