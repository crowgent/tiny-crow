import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { StatusSignals } from "../src/extras/status_signals.ts";

function tempSocketPath(name: string): { dir: string; socketPath: string } {
  const dir = path.join(os.tmpdir(), `tc_status_test_${process.pid}_${name}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return { dir, socketPath: path.join(dir, "status.sock") };
}

async function waitFor(received: string[], n: number, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (received.length < n) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${n} messages, got ${received.length}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function withListener(name: string) {
  const { dir, socketPath } = tempSocketPath(name);
  const received: string[] = [];
  const server = net.createServer((socket) => {
    let buf = "";
    socket.on("data", (chunk) => { buf += chunk.toString(); });
    socket.on("end", () => { received.push(buf); });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  const cleanup = () => {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { socketPath, received, cleanup };
}

test("send_start_writes_expected_message", async () => {
  const { socketPath, received, cleanup } = await withListener("start");
  try {
    new StatusSignals(socketPath).sendStart();
    await waitFor(received, 1);
    assert.equal(received[0], "start\n");
  } finally { cleanup(); }
});

test("send_stop_writes_expected_message", async () => {
  const { socketPath, received, cleanup } = await withListener("stop");
  try {
    new StatusSignals(socketPath).sendStop();
    await waitFor(received, 1);
    assert.equal(received[0], "stop\n");
  } finally { cleanup(); }
});

test("nonexistent_socket_does_not_panic", () => {
  const ss = new StatusSignals("/tmp/definitely_nonexistent_status_socket_12345");
  ss.sendStart();
  ss.sendStop();
  ss.sendGitConflict();
  ss.sendBlocked("permission");
  ss.sendState("working");
  const guard = ss.blockedScope("permission");
  guard.dispose();
});

test("send_git_conflict_writes_expected_message", async () => {
  const { socketPath, received, cleanup } = await withListener("conflict");
  try {
    new StatusSignals(socketPath).sendGitConflict();
    await waitFor(received, 1);
    assert.equal(received[0], "git-conflict\n");
  } finally { cleanup(); }
});

test("send_blocked_writes_expected_message", async () => {
  const { socketPath, received, cleanup } = await withListener("blocked");
  try {
    new StatusSignals(socketPath).sendBlocked("permission");
    await waitFor(received, 1);
    assert.equal(received[0], "blocked:permission\n");
  } finally { cleanup(); }
});

test("send_state_writes_expected_message", async () => {
  const { socketPath, received, cleanup } = await withListener("state");
  try {
    new StatusSignals(socketPath).sendState("working");
    await waitFor(received, 1);
    assert.equal(received[0], "state:working\n");
  } finally { cleanup(); }
});

test("blocked_scope_sends_pair_in_order", async () => {
  const { socketPath, received, cleanup } = await withListener("scope_order");
  try {
    const ss = new StatusSignals(socketPath);
    const guard = ss.blockedScope("permission");
    guard.dispose();
    await waitFor(received, 2);
    assert.deepEqual(received.map((b) => b.trimEnd()), ["blocked:permission", "state:working"]);
  } finally { cleanup(); }
});

test("blocked_scope_releases_on_error_path", async () => {
  const { socketPath, received, cleanup } = await withListener("scope_error");
  try {
    const ss = new StatusSignals(socketPath);
    const guard = ss.blockedScope("permission");
    try {
      throw new Error("boom");
    } catch {

    } finally {
      guard.dispose();
    }
    await waitFor(received, 2);
    assert.deepEqual(received.map((b) => b.trimEnd()), ["blocked:permission", "state:working"]);
  } finally { cleanup(); }
});
