import test from "node:test";
import assert from "node:assert/strict";
import { buildEnvelope } from "../../src/extras/hooks/mod.ts";
import type { HookCtx } from "../../src/extras/hooks/envelope.ts";

function ctx(): HookCtx {
  return {
    sessionId: "sess-1",
    sessionPath: "/tmp/sess.json",
    cwd: "/repo",
    permissionMode: "yolo",
  };
}

test("pre_tool_use_envelope_carries_tool_fields_and_common_fields", () => {
  const envelope = buildEnvelope(ctx(), "PreToolUse", {
    kind: "PreToolUse",
    toolName: "bash",
    toolInput: { command: "ls" },
  });
  assert.equal(envelope.hook_event_name, "PreToolUse");
  assert.equal(envelope.session_id, "sess-1");
  assert.equal(envelope.session_path, "/tmp/sess.json");
  assert.equal(envelope.cwd, "/repo");
  assert.equal(envelope.permission_mode, "yolo");
  assert.equal(envelope.tool_name, "bash");
  assert.equal((envelope.tool_input as { command: string }).command, "ls");
});

test("envelope_never_contains_transcript_path", () => {
  const variants = [
    { kind: "PreToolUse", toolName: "bash", toolInput: {} },
    { kind: "UserPromptSubmit", prompt: "hi" },
    { kind: "SessionStart", source: "startup" },
  ] as const;
  for (const fields of variants) {
    const envelope = buildEnvelope(ctx(), "SomeEvent", fields as never);
    assert.equal("transcript_path" in envelope, false);
    assert.ok("session_path" in envelope);
  }
});

test("stop_envelope_in_loop_mode_carries_loop_fields", () => {
  const envelope = buildEnvelope(ctx(), "Stop", {
    kind: "Stop",
    stopHookActive: true,
    loopIteration: 3,
    loopActive: true,
  });
  assert.equal(envelope.stop_hook_active, true);
  assert.equal(envelope.loop_iteration, 3);
  assert.equal(envelope.loop_active, true);
});

test("stop_envelope_outside_loop_mode_has_null_loop_fields", () => {
  const envelope = buildEnvelope(ctx(), "Stop", {
    kind: "Stop",
    stopHookActive: false,
    loopIteration: null,
    loopActive: null,
  });
  assert.equal(envelope.loop_iteration, null);
  assert.equal(envelope.loop_active, null);
});

test("subagent_stop_envelope_carries_agent_type_and_stop_hook_active", () => {
  const envelope = buildEnvelope(ctx(), "SubagentStop", {
    kind: "SubagentStop",
    stopHookActive: false,
    agentType: "explore",
  });
  assert.equal(envelope.agent_type, "explore");
  assert.equal(envelope.stop_hook_active, false);
});
