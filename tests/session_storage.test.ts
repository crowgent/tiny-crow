import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  MessageRole,
  PromptSource,
  Session,
  TOOL_RESULT_HEAD_CHARS,
  TOOL_RESULT_SAVE_THRESHOLD,
  TOOL_RESULT_TAIL_CHARS,
} from "../src/session/mod.ts";
import {
  dataDir,
  deleteSession,
  findSessionsByPrefix,
  loadSuffix,
  saveSession,
  suffixPath,
} from "../src/session/storage.ts";

/** Runs `fn` with ZS_DATA_DIR pointed at a fresh temp dir, then cleans up. */
function withTestEnv(fn: (dir: string) => void): void {
  const prev = process.env.ZS_DATA_DIR;
  const dir = path.join(os.tmpdir(), `zs_test_${process.pid}_${Math.random().toString(36).slice(2)}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "sessions"), { recursive: true });
  process.env.ZS_DATA_DIR = dir;
  try {
    fn(dir);
  } finally {
    if (prev === undefined) delete process.env.ZS_DATA_DIR;
    else process.env.ZS_DATA_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("save_and_find_session_by_prefix", () => {
  withTestEnv(() => {
    const s = Session.create("openai", "gpt-4", 128000, "");
    s.addMessage(MessageRole.User, "hello");
    saveSession(s);
    const found = findSessionsByPrefix(s.id.slice(0, 8));
    assert.equal(found.length, 1, `id prefix: ${s.id.slice(0, 8)}`);
    assert.equal(found[0]!.id, s.id);
    assert.equal(found[0]!.model, "gpt-4");
  });
});

test("find_sessions_by_prefix_no_match", () => {
  withTestEnv(() => {
    assert.deepEqual(findSessionsByPrefix("nonexistent"), []);
  });
});

test("delete_session_removes_file", () => {
  withTestEnv(() => {
    const s = Session.create("openai", "gpt-4", 128000, "");
    saveSession(s);
    deleteSession(s.id);
    assert.deepEqual(findSessionsByPrefix(s.id.slice(0, 8)), []);
  });
});

test("save_session_preserves_messages", () => {
  withTestEnv(() => {
    const s = Session.create("anthropic", "claude", 200000, "");
    s.addMessage(MessageRole.User, "question");
    s.addMessage(MessageRole.Assistant, "answer");
    saveSession(s);
    const found = findSessionsByPrefix(s.id.slice(0, 8));
    assert.equal(found.length, 1);
    assert.equal(found[0]!.messages.length, 2);
    assert.equal(found[0]!.messages[0]!.content, "question");
    assert.equal(found[0]!.messages[1]!.content, "answer");
  });
});

test("save_session_round_trips_prompt_provenance", () => {
  withTestEnv(() => {
    const s = Session.create("anthropic", "claude", 200000, "");
    s.prompt = { name: "code", source: PromptSource.BuiltIn };
    saveSession(s);
    const found = findSessionsByPrefix(s.id.slice(0, 8));
    assert.equal(found.length, 1);
    assert.deepEqual(found[0]!.prompt, { name: "code", source: PromptSource.BuiltIn });
  });
});

test("old_session_file_without_prompt_field_loads_as_none", () => {
  withTestEnv(() => {
    const s = Session.create("anthropic", "claude", 200000, "");
    const value = s.toJSON() as Record<string, unknown>;
    delete value["prompt"];
    const p = path.join(dataDir(), "sessions", `${s.id}.json`);
    fs.writeFileSync(p, JSON.stringify(value));
    const found = findSessionsByPrefix(s.id.slice(0, 8));
    assert.equal(found.length, 1);
    assert.equal(found[0]!.prompt, undefined);
  });
});

test("save_session_preserves_tool_messages", () => {
  withTestEnv(() => {
    const s = Session.create("anthropic", "claude", 200000, "");
    s.addMessage(MessageRole.User, "question");
    const callId = s.addToolCall("read", { path: "src/main.rs" });
    s.addToolResult(callId, "read", "file contents");
    s.addSubagentToolCall(callId, "task", { prompts: ["find x"] });
    s.addMessage(MessageRole.Assistant, "answer");
    saveSession(s);
    const found = findSessionsByPrefix(s.id.slice(0, 8));
    assert.equal(found.length, 1);
    assert.equal(found[0]!.messages.length, 5);
    assert.equal(found[0]!.messages[1]!.role, MessageRole.ToolCall);
    assert.ok(found[0]!.messages[1]!.content.includes("read"));
    assert.equal(found[0]!.messages[2]!.role, MessageRole.ToolResult);
    assert.equal(found[0]!.messages[2]!.content, "read:\nfile contents");
    assert.equal(found[0]!.messages[3]!.role, MessageRole.SubagentToolCall);
  });
});

test("long_tool_result_is_saved_and_truncated_in_session", () => {
  withTestEnv((dir) => {
    const s = Session.create("anthropic", "claude", 200000, "");
    const head = "H".repeat(TOOL_RESULT_HEAD_CHARS);
    const omitted = "M".repeat(TOOL_RESULT_SAVE_THRESHOLD - TOOL_RESULT_HEAD_CHARS - TOOL_RESULT_TAIL_CHARS + 1);
    const tail = "T".repeat(TOOL_RESULT_TAIL_CHARS);
    const output = `${head}${omitted}${tail}`;
    const returned = s.addToolResult(0, "bash/unsafe", output);
    const content = s.messages[0]!.content;
    assert.equal(returned, content);
    assert.ok(content.startsWith(`bash/unsafe:\n${head}`));
    assert.ok(content.endsWith(tail));
    assert.ok(content.includes("[tool output truncated: 12001 characters; 1 omitted]"));
    assert.ok(!content.includes("M".repeat(80)));
    const pathLine = content.split("\n").find((line) => line.startsWith("[full output saved to: "));
    assert.ok(pathLine !== undefined);
    assert.ok(pathLine!.includes("use the read tool on this path"));
    const p = pathLine!.replace("[full output saved to: ", "").split(";")[0]!;
    assert.ok(p.startsWith(dir), p);
    assert.equal(fs.readFileSync(p, "utf8"), output);
  });
});

test("long_tool_result_save_failure_keeps_full_output", () => {
  const prev = process.env.ZS_DATA_DIR;
  const filePath = path.join(os.tmpdir(), `zs_data_file_${process.pid}`);
  fs.rmSync(filePath, { force: true });
  fs.writeFileSync(filePath, "not a directory");
  process.env.ZS_DATA_DIR = filePath;
  try {
    const s = Session.create("anthropic", "claude", 200000, "");
    const output = "x".repeat(TOOL_RESULT_SAVE_THRESHOLD + 1);
    s.addToolResult(0, "bash", output);
    const content = s.messages[0]!.content;
    assert.ok(content.includes(output));
    assert.ok(content.includes("failed to save long tool output separately"));
  } finally {
    if (prev === undefined) delete process.env.ZS_DATA_DIR;
    else process.env.ZS_DATA_DIR = prev;
    fs.rmSync(filePath, { force: true });
  }
});

test("tool_call_and_result_link_by_id", () => {
  withTestEnv(() => {
    const s = Session.create("anthropic", "claude", 200000, "");
    const callId = s.addToolCall("read", { path: "src/main.rs" });
    s.addToolResult(callId, "read", "file contents");
    const call = s.messages[0]!.tool;
    assert.ok(call && call.kind === "call");
    if (call.kind === "call") {
      assert.equal(call.id, callId);
      assert.equal(call.name, "read");
      assert.deepEqual(call.args, { path: "src/main.rs" });
    }
    const result = s.messages[1]!.tool;
    assert.ok(result && result.kind === "result");
    if (result.kind === "result") {
      assert.equal(result.callId, callId);
      assert.equal(result.name, "read");
      assert.ok(!result.truncated);
      assert.equal(result.fullOutputPath, undefined);
    }
  });
});

test("oversized_tool_result_has_truncated_record_with_overflow_path", () => {
  withTestEnv((dir) => {
    const s = Session.create("anthropic", "claude", 200000, "");
    const callId = s.addToolCall("bash", { command: "ls" });
    const output = "x".repeat(TOOL_RESULT_SAVE_THRESHOLD + 1);
    s.addToolResult(callId, "bash", output);
    const result = s.messages[1]!.tool;
    assert.ok(result && result.kind === "result");
    if (result.kind === "result") {
      assert.equal(result.callId, callId);
      assert.ok(result.truncated);
      assert.ok(result.fullOutputPath !== undefined, "overflow path recorded");
      assert.ok(result.fullOutputPath!.startsWith(dir));
      assert.equal(fs.readFileSync(result.fullOutputPath!, "utf8"), output);
    }
  });
});

test("tool_record_round_trips_through_json", () => {
  withTestEnv(() => {
    const s = Session.create("anthropic", "claude", 200000, "");
    const callId = s.addToolCall("read", { path: "a.rs" });
    s.addToolResult(callId, "read", "file contents");
    const json = s.toJSON() as { messages: Array<{ tool?: Record<string, unknown> }> };
    const callJson = json.messages[0]!.tool!;
    assert.equal(callJson["id"], callId);
    assert.equal(callJson["call_id"], undefined);
    const resultJson = json.messages[1]!.tool!;
    assert.equal(resultJson["call_id"], callId);
    assert.equal(resultJson["id"], undefined);
    // Round trip through fromJSON preserves the discriminated records.
    const back = Session.fromJSON(json);
    const backCall = back.messages[0]!.tool;
    assert.ok(backCall && backCall.kind === "call");
    if (backCall.kind === "call") {
      assert.equal(backCall.id, callId);
      assert.equal(backCall.name, "read");
      assert.deepEqual(backCall.args, { path: "a.rs" });
    }
    const backResult = back.messages[1]!.tool;
    assert.ok(backResult && backResult.kind === "result");
    if (backResult.kind === "result") {
      assert.equal(backResult.callId, callId);
      assert.ok(!backResult.truncated);
    }
  });
});

test("subagent_tool_call_links_to_the_enclosing_task_call", () => {
  withTestEnv(() => {
    const s = Session.create("anthropic", "claude", 200000, "");
    const callId = s.addToolCall("task", { prompts: ["find x"] });
    s.addSubagentToolCall(callId, "grep", { pattern: "fn x" });
    s.addToolResult(callId, "task", "found it");
    assert.equal(s.messages[1]!.role, MessageRole.SubagentToolCall);
    const sub = s.messages[1]!.tool;
    assert.ok(sub && sub.kind === "subagentCall");
    if (sub.kind === "subagentCall") {
      assert.equal(sub.parentCallId, callId);
      assert.equal(sub.name, "grep");
      assert.deepEqual(sub.args, { pattern: "fn x" });
    }
  });
});

test("subagent_tool_call_without_a_parent_records_no_structured_record", () => {
  withTestEnv(() => {
    const s = Session.create("anthropic", "claude", 200000, "");
    s.addSubagentToolCall(null, "grep", { pattern: "fn x" });
    assert.equal(s.messages[0]!.role, MessageRole.SubagentToolCall);
    assert.equal(s.messages[0]!.tool, undefined);
    assert.ok(s.messages[0]!.content.includes("grep"));
  });
});

test("subagent_tool_record_round_trips_without_colliding_with_call", () => {
  withTestEnv(() => {
    const s = Session.create("anthropic", "claude", 200000, "");
    const callId = s.addToolCall("task", { prompts: ["find x"] });
    s.addSubagentToolCall(callId, "grep", { pattern: "fn x" });
    const json = s.toJSON() as { messages: Array<{ tool?: Record<string, unknown> }> };
    const subJson = json.messages[1]!.tool!;
    assert.equal(subJson["parent_call_id"], callId);
    assert.equal(subJson["id"], undefined);
    assert.equal(subJson["call_id"], undefined);
    const back = Session.fromJSON(json);
    const sub = back.messages[1]!.tool;
    assert.ok(sub && sub.kind === "subagentCall");
    if (sub.kind === "subagentCall") {
      assert.equal(sub.parentCallId, callId);
      assert.equal(sub.name, "grep");
      assert.deepEqual(sub.args, { pattern: "fn x" });
    }
    // The reverse direction: a main-agent call must not be swallowed by
    // the subagent variant either.
    const callJson = json.messages[0]!.tool!;
    assert.equal(callJson["id"], callId);
    const backCall = back.messages[0]!.tool;
    assert.ok(backCall && backCall.kind === "call");
  });
});

test("old_session_file_without_tool_records_loads_with_tool_none", () => {
  const json = `{
    "id": "legacy-session",
    "name": "old session",
    "messages": [
      { "role": "user", "content": "hi", "estimated_tokens": 1 },
      { "role": "tool_call", "content": "read: src/main.rs", "estimated_tokens": 3 }
    ],
    "compactions": [],
    "created_at": "2026-01-01T00:00:00Z",
    "updated_at": "2026-01-01T00:00:00Z",
    "total_cost": 0.0,
    "total_estimated_tokens": 4,
    "context_window": 128000,
    "model": "gpt-4",
    "provider": "openai",
    "working_dir": "/tmp"
  }`;
  const session = Session.fromJSON(JSON.parse(json));
  assert.equal(session.messages.length, 2);
  assert.equal(session.messages[0]!.tool, undefined);
  assert.equal(session.messages[1]!.tool, undefined);
  assert.equal(session.nextToolCallId, 0);
});

test("find_all_sessions_returns_saved_sessions_newest_first", () => {
  withTestEnv(() => {
    const older = Session.create("openai", "gpt-4", 128000, "");
    older.updatedAt = "2026-01-01T00:00:00Z";
    older.addMessage(MessageRole.User, "older");
    older.updatedAt = "2026-01-01T00:00:00Z";
    saveSession(older);
    const newer = Session.create("anthropic", "claude", 200000, "");
    newer.updatedAt = "2026-01-02T00:00:00Z";
    newer.addMessage(MessageRole.User, "newer");
    newer.updatedAt = "2026-01-02T00:00:00Z";
    saveSession(newer);
    const found = findSessionsByPrefix("");
    assert.equal(found.length, 2);
    assert.equal(found[0]!.id, newer.id);
    assert.equal(found[1]!.id, older.id);
  });
});

test("save_session_preserves_cost_fields", () => {
  withTestEnv(() => {
    const s = Session.create("openai", "gpt-4", 128000, "");
    s.totalInputTokens = 100;
    s.totalOutputTokens = 50;
    s.totalCost = 0.003;
    s.inputTokenCost = 0.00001;
    s.outputTokenCost = 0.00003;
    saveSession(s);
    const found = findSessionsByPrefix(s.id.slice(0, 8));
    assert.equal(found.length, 1, `session id: ${s.id}, prefix: ${s.id.slice(0, 8)}`);
    assert.equal(found[0]!.totalInputTokens, 100);
    assert.equal(found[0]!.totalOutputTokens, 50);
    assert.equal(found[0]!.totalCost, 0.003);
  });
});

test("find_sessions_by_prefix_empty_for_nonexistent_dir", () => {
  const prev = process.env.ZS_DATA_DIR;
  const dir = path.join(os.tmpdir(), `zs_nodir_${process.pid}`);
  fs.rmSync(dir, { recursive: true, force: true });
  process.env.ZS_DATA_DIR = dir;
  try {
    assert.deepEqual(findSessionsByPrefix("anything"), []);
  } finally {
    if (prev === undefined) delete process.env.ZS_DATA_DIR;
    else process.env.ZS_DATA_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("save_session_creates_parent_dirs", () => {
  withTestEnv((dir) => {
    const sessionsDir = path.join(dir, "sessions");
    fs.rmSync(sessionsDir, { recursive: true, force: true });
    const s = Session.create("openai", "gpt-4", 128000, "");
    saveSession(s);
    assert.equal(findSessionsByPrefix(s.id.slice(0, 8)).length, 1);
  });
});

test("load_suffix_returns_none_when_file_missing", () => {
  withTestEnv(() => {
    assert.equal(loadSuffix(), null);
  });
});

test("load_suffix_returns_none_when_file_is_empty", () => {
  withTestEnv(() => {
    const p = suffixPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "");
    assert.equal(loadSuffix(), null);
  });
});

test("load_suffix_returns_none_when_file_is_whitespace_only", () => {
  withTestEnv(() => {
    const p = suffixPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "   \n  \t  \n");
    assert.equal(loadSuffix(), null);
  });
});

test("load_suffix_returns_content_when_file_has_text", () => {
  withTestEnv(() => {
    const p = suffixPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "Always respond in haiku form.");
    assert.equal(loadSuffix(), "Always respond in haiku form.");
  });
});

test("suffix_path_is_inside_config_dir", () => {
  withTestEnv(() => {
    // With no ZS_CONFIG_DIR override, the config dir is the data dir.
    assert.equal(suffixPath(), path.join(dataDir(), "SUFFIX.md"));
  });
});
