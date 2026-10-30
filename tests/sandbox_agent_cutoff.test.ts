import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { essentialEnvFrom } from "../src/sandbox.ts";
import { bwrapSandbox, pairAt, scratchDir, tripleAt } from "./sandbox_support.ts";

function dir(name: string): string {
  return scratchDir("agent-cutoff", name);
}

test("test_essential_env_excludes_ssh_agent_vars_even_when_set", () => {
  const env = new Map([
    ["SSH_AUTH_SOCK", "/tmp/zerostack-test-agent.sock"],
    ["SSH_AGENT_PID", "12345"],
    ["PATH", "/usr/bin:/bin"],
  ]);
  const vars = essentialEnvFrom((name) => env.get(name));
  assert.ok(
    vars.some(([k, v]) => k === "PATH" && v === "/usr/bin:/bin"),
    `sanity: the seam forwards what is on the list, or the assertions below are vacuous: ${JSON.stringify(vars)}`,
  );
  assert.ok(!vars.some(([k]) => k === "SSH_AUTH_SOCK"), `SSH_AUTH_SOCK must never reach the sandbox environment: ${JSON.stringify(vars)}`);
  assert.ok(!vars.some(([k]) => k === "SSH_AGENT_PID"), `SSH_AGENT_PID must never reach the sandbox environment: ${JSON.stringify(vars)}`);
});

function touchSocket(dirPath: string, name: string): string {
  fs.mkdirSync(dirPath, { recursive: true });
  const sock = path.join(dirPath, name);
  fs.writeFileSync(sock, "");
  return sock;
}

test("test_ssh_auth_sock_seam_emits_dev_null_bind_after_root_bind", () => {
  const sockDir = dir("sock");
  const sock = touchSocket(sockDir, "agent.sock");
  const cacheDir = dir("sock-cache");
  try {
    const sandbox = bwrapSandbox([], cacheDir).withSshAuthSock(sock);
    const args = sandbox.wrapCommand("echo hello").args;
    const rootBind = pairAt(args, "--ro-bind", "/");
    assert.ok(rootBind !== undefined, "`/` should be ro-bound");
    const agentBind = tripleAt(args, "--ro-bind-try", "/dev/null", sock);
    assert.ok(agentBind !== undefined, `expected /dev/null bound over the agent socket: ${JSON.stringify(args)}`);
    assert.ok(rootBind < agentBind, "the agent socket mask must come after the `/` ro-bind");
  } finally {
    fs.rmSync(sockDir, { recursive: true, force: true });
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("test_stale_ssh_auth_sock_emits_no_dev_null_bind", () => {
  const sock = path.join(dir("stale"), "agent.sock");
  fs.rmSync(dir("stale"), { recursive: true, force: true });
  const cacheDir = dir("stale-cache");
  try {
    const sandbox = bwrapSandbox([], cacheDir).withSshAuthSock(sock);
    const args = sandbox.wrapCommand("echo hello").args;
    assert.equal(
      tripleAt(args, "--ro-bind-try", "/dev/null", sock),
      undefined,
      `a socket path missing on the host must not be bound over: ${JSON.stringify(args)}`,
    );
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("test_empty_ssh_auth_sock_emits_no_dev_null_bind", () => {
  const cacheDir = dir("empty-cache");
  try {
    const sandbox = bwrapSandbox([], cacheDir).withSshAuthSock("");
    const args = sandbox.wrapCommand("echo hello").args;
    assert.ok(!args.some((a) => a === "/dev/null"), "an empty SSH_AUTH_SOCK names no socket, so no bind should be emitted");
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("test_agent_socket_mask_survives_exposing_the_directory_holding_it", () => {
  const gnupg = dir("gnupg");
  const sock = touchSocket(gnupg, "S.gpg-agent.ssh");
  const cacheDir = dir("gnupg-cache");
  try {
    const sandbox = bwrapSandbox([gnupg], cacheDir)
      .withExpose([gnupg])
      .withSshAuthSock(sock);
    const args = sandbox.wrapCommand("echo hello").args;
    const expose = tripleAt(args, "--ro-bind-try", gnupg, gnupg);
    assert.ok(expose !== undefined, `expected the exposed directory to be re-bound: ${JSON.stringify(args)}`);
    const agentBind = tripleAt(args, "--ro-bind-try", "/dev/null", sock);
    assert.ok(agentBind !== undefined, `expected /dev/null bound over the agent socket: ${JSON.stringify(args)}`);
    assert.ok(expose < agentBind, "the agent socket mask must be the last word, after the expose bind");
  } finally {
    fs.rmSync(gnupg, { recursive: true, force: true });
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("test_no_host_ssh_auth_sock_emits_no_dev_null_bind", () => {
  const cacheDir = dir("none-cache");
  try {
    const sandbox = bwrapSandbox([], cacheDir).withSshAuthSock(undefined);
    const args = sandbox.wrapCommand("echo hello").args;
    assert.ok(!args.some((a) => a === "/dev/null"), "no host SSH_AUTH_SOCK, so no /dev/null bind should be emitted");
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});
