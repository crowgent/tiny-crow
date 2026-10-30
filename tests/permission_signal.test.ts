import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { defaultCli } from "../src/cli.ts";
import { defaultConfig } from "../src/config/mod.ts";
import { StatusSignals } from "../src/extras/status_signals.ts";
import type { UserDecision } from "../src/permission/ask.ts";
import { Sandbox } from "../src/sandbox.ts";
import { Session } from "../src/session/mod.ts";
import { handlePermissionRequest } from "../src/ui/permission_handler.ts";
import { Renderer, StringBackend, type RenderBackend } from "../src/ui/renderer.ts";
import { AgentRunState, EventQueue, makeKeyEvent, UiContext, type UserEvent } from "../src/ui/state.ts";

const BRACKET = ["blocked:permission", "state:working"];

// A listening status socket in a temp dir, plus the collector that turns
// the stream of per-message connections into a flat list of lines.
class SignalListener {
  dir: string;
  sockPath: string;
  lines: string[] = [];
  private server: net.Server;

  private constructor(dir: string, sockPath: string, server: net.Server) {
    this.dir = dir;
    this.sockPath = sockPath;
    this.server = server;
  }

  static bind(name: string): SignalListener {
    const dir = path.join(os.tmpdir(), `tc_sig_${process.pid}_${name}`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const sockPath = path.join(dir, "status.sock");
    assert.ok(sockPath.length < 100, `socket path ${sockPath} is too close to the sun_path limit`);
    const listener = new SignalListener(dir, sockPath, null as unknown as net.Server);
    const server = net.createServer((socket) => {
      let buf = "";
      socket.on("data", (chunk) => {
        buf += chunk.toString();
      });
      socket.on("end", () => {
        listener.lines.push(...buf.split("\n").filter((l) => l !== ""));
      });
      socket.on("error", () => {});
    });
    server.listen(sockPath);
    listener.server = server;
    return listener;
  }

  signals(): StatusSignals {
    return new StatusSignals(this.sockPath);
  }

  async settle(expected: number): Promise<string[]> {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && this.lines.length < expected) {
      await new Promise((r) => setTimeout(r, 5));
    }
    await new Promise((r) => setTimeout(r, 100));
    return [...this.lines];
  }

  dispose(): void {
    try {
      this.server.close();
    } catch { /* best effort */ }
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
}

// Render backend that throws on every write once `marker` has appeared in
// the bytes written so far.
class FailOnMarkerBackend implements RenderBackend {
  readonly headless = true;
  private buf = "";
  private failed = false;

  private marker: string;

  constructor(marker: string) {
    this.marker = marker;
  }

  write(s: string): void {
    this.buf += s;
    if (this.failed || this.buf.includes(this.marker)) {
      this.failed = true;
      throw new Error("backend write failed");
    }
  }

  size(): [number, number] {
    return [80, 24];
  }

  captured(): string | null {
    return this.buf;
  }
}

function makeUi(signals: StatusSignals | null): UiContext {
  return new UiContext({
    cli: { ...defaultCli(), noSession: true, noColor: true },
    cfg: defaultConfig() as never,
    session: Session.create("anthropic", "claude-sonnet-4-5", 200000, "permission-signal-test") as never,
    context: {
      prompts: new Map<string, string>(),
      extraPromptsDirs: [],
      themes: new Map<string, string>(),
      chainDeclined: [],
      reload() {},
    } as never,
    client: {
      completionModel: () => ({ id: "claude-sonnet-4-5" }),
      buildAgent: async () => null as never,
    } as never,
    sandbox: new Sandbox(false, "bwrap"),
    statusSignals: signals,
  });
}

async function runPrompt(
  key: { code: "char"; ch: string } | { code: "esc" },
  signals: StatusSignals | null,
  backend: RenderBackend,
): Promise<{ error: Error | null; decision: UserDecision | null }> {
  const ui = makeUi(signals);
  const renderer = Renderer.withBackend(backend);
  const run = new AgentRunState();
  const userEvents = new EventQueue<UserEvent>();
  userEvents.push({
    type: "key",
    key: key.code === "esc" ? makeKeyEvent("esc") : makeKeyEvent("char", { ch: key.ch }),
  });
  // The handler consumes the state.ts AskRequest shape (reply.send),
  // not the ask slice's class (reply method + decision promise).
  let resolveDecision!: (d: UserDecision) => void;
  const decisionPromise = new Promise<UserDecision>((r) => {
    resolveDecision = r;
  });
  const askReq = { tool: "bash", input: "ls -la", reply: { send: (d: UserDecision) => resolveDecision(d) } };
  let error: Error | null = null;
  const done = handlePermissionRequest(askReq as never, renderer, ui, run, userEvents).catch((e) => {
    error = e instanceof Error ? e : new Error(String(e));
  });
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000));
  const decision = await Promise.race([decisionPromise.then((d) => d), timeout]);
  await done;
  return { error, decision };
}

test("allow_once_brackets_wait", async () => {
  const listener = SignalListener.bind("allow_once");
  try {
    const { error, decision } = await runPrompt({ code: "char", ch: "y" }, listener.signals(), new StringBackend(80, 24));
    assert.equal(error, null, "prompt path succeeded");
    assert.deepEqual(decision, { kind: "allow_once" });
    assert.deepEqual(await listener.settle(2), BRACKET);
  } finally {
    listener.dispose();
  }
});

test("allow_always_brackets_wait", async () => {
  const listener = SignalListener.bind("allow_always");
  try {
    const { error, decision } = await runPrompt({ code: "char", ch: "a" }, listener.signals(), new StringBackend(80, 24));
    assert.equal(error, null, "prompt path succeeded");
    assert.ok(decision !== null && (decision as unknown as { kind: string }).kind === "allow_always", `expected AllowAlways, got ${JSON.stringify(decision)}`);
    assert.deepEqual(await listener.settle(2), BRACKET);
  } finally {
    listener.dispose();
  }
});

test("deny_brackets_wait", async () => {
  const listener = SignalListener.bind("deny");
  try {
    const { error, decision } = await runPrompt({ code: "char", ch: "n" }, listener.signals(), new StringBackend(80, 24));
    assert.equal(error, null, "prompt path succeeded");
    assert.deepEqual(decision, { kind: "deny" });
    assert.deepEqual(await listener.settle(2), BRACKET);
  } finally {
    listener.dispose();
  }
});

test("esc_brackets_wait", async () => {
  const listener = SignalListener.bind("esc");
  try {
    const { error, decision } = await runPrompt({ code: "esc" }, listener.signals(), new StringBackend(80, 24));
    assert.equal(error, null, "prompt path succeeded");
    assert.deepEqual(decision, { kind: "deny" });
    assert.deepEqual(await listener.settle(2), BRACKET);
  } finally {
    listener.dispose();
  }
});

test("no_socket_emits_nothing", async () => {
  const listener = SignalListener.bind("no_socket");
  try {
    const { error, decision } = await runPrompt({ code: "char", ch: "y" }, null, new StringBackend(80, 24));
    assert.equal(error, null, "prompt path succeeded");
    assert.deepEqual(decision, { kind: "allow_once" });
    assert.deepEqual(await listener.settle(0), []);
  } finally {
    listener.dispose();
  }
});

test("error_after_prompt_still_releases", async () => {
  const listener = SignalListener.bind("error_path");
  try {
    const { error, decision } = await runPrompt(
      { code: "char", ch: "a" },
      listener.signals(),
      new FailOnMarkerBackend("-> will allow"),
    );
    assert.ok(error !== null, "expected the prompt path to fail");
    assert.equal(decision, null, "no decision should reach the tool");
    assert.deepEqual(await listener.settle(2), BRACKET);
  } finally {
    listener.dispose();
  }
});

test("state_working_reaches_the_wire_before_the_decision", async () => {
  const listener = SignalListener.bind("order");
  try {
    const signals = listener.signals();
    // Spy on the send order: the handler must send state:working before
    // the decision promise resolves, not merely by the time it returns.
    const order: string[] = [];
    const origBlocked = signals.sendBlocked.bind(signals);
    const origState = signals.sendState.bind(signals);
    signals.sendBlocked = (reason) => {
      order.push("blocked");
      origBlocked(reason);
    };
    signals.sendState = (state) => {
      order.push("state");
      origState(state);
    };
    const ui = makeUi(signals);
    const renderer = Renderer.withBackend(new StringBackend(80, 24));
    const run = new AgentRunState();
    const userEvents = new EventQueue<UserEvent>();
    userEvents.push({ type: "key", key: makeKeyEvent("char", { ch: "y" }) });
    let resolveDecision!: (d: UserDecision) => void;
    const decisionPromise = new Promise<UserDecision>((r) => {
      resolveDecision = r;
    });
    const askReq = { tool: "bash", input: "ls -la", reply: { send: (d: UserDecision) => resolveDecision(d) } };
    void decisionPromise.then(() => {
      order.push("decision");
    });
    await handlePermissionRequest(askReq as never, renderer, ui, run, userEvents);
    assert.deepEqual(order, ["blocked", "state", "decision"], "state:working must already be sent when the decision reaches the tool");
    assert.deepEqual(await listener.settle(2), BRACKET);
    const decision = await decisionPromise;
    assert.deepEqual(decision, { kind: "allow_once" });
  } finally {
    listener.dispose();
  }
});
