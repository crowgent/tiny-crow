import test from "node:test";
import assert from "node:assert/strict";
import {
  parseJsonlImport,
  sessionToHtml,
  sessionToJsonl,
} from "../src/extras/export.ts";
import { MessageRole, Session } from "../src/session/mod.ts";

function sampleSession(): Session {
  const session = Session.create("openrouter", "test-model", 128000, "demo session");
  session.addMessage(MessageRole.User, "hello there");
  session.addMessage(MessageRole.Assistant, "hi! **how** can I help?");
  session.addMessage(MessageRole.ToolCall, "bash: ls -la");
  session.addMessage(MessageRole.ToolResult, "bash:\ntotal 0");
  return session;
}

test("jsonl_round_trip_preserves_messages", () => {
  const session = sampleSession();
  const jsonl = sessionToJsonl(session as never);
  const messages = parseJsonlImport(jsonl);
  assert.equal(messages.length, session.messages.length);
  messages.forEach((imported, i) => {
    assert.equal(imported.role, session.messages[i]!.role);
    assert.equal(imported.content, session.messages[i]!.content);
  });
});

test("jsonl_first_line_is_session_metadata", () => {
  const session = sampleSession();
  const jsonl = sessionToJsonl(session as never);
  const header = JSON.parse(jsonl.split("\n")[0]!);
  assert.equal(header.type, "session");
  assert.equal(header.name, "demo session");
  assert.equal(header.model, "test-model");
});

test("jsonl_import_accepts_bare_lines_without_metadata", () => {
  const jsonl = `{"role":"user","content":"hi"}\n{"role":"assistant","content":"yo"}\n`;
  const messages = parseJsonlImport(jsonl);
  assert.equal(messages.length, 2);
  assert.equal(messages[0]!.role, "user");
  assert.equal(messages[0]!.content, "hi");
  assert.equal(messages[1]!.role, "assistant");
});

test("jsonl_import_errors_with_line_number_on_bad_json", () => {
  const jsonl = `{"role":"user","content":"ok"}\nnot json\n`;
  assert.throws(() => parseJsonlImport(jsonl), /line 2/);
});

test("jsonl_import_errors_when_no_messages", () => {
  assert.throws(() => parseJsonlImport(`{"type":"session"}\n`), /no messages/);
});

test("html_escapes_verbatim_content", () => {
  const session = Session.create("p", "m", 128000, "x");
  session.addMessage(MessageRole.User, "show me <script>alert(1)</script> & go");
  const html = sessionToHtml(session as never);
  assert.ok(html.includes("&lt;script&gt;"), "user HTML must be escaped");
  assert.ok(html.includes("&amp;"), "ampersand must be escaped");
  assert.ok(!html.includes("<script>alert"));
});

test("html_renders_assistant_markdown", () => {
  const html = sessionToHtml(sampleSession() as never);
  assert.ok(html.includes("<strong>how</strong>"), `assistant markdown should render: ${html}`);
});

test("html_contains_session_metadata", () => {
  const html = sessionToHtml(sampleSession() as never);
  assert.ok(html.includes("demo session"));
  assert.ok(html.includes("openrouter / test-model"));
  assert.ok(html.includes("<!DOCTYPE html>"));
});

test("html_title_falls_back_to_session_id", () => {
  const session = Session.create("p", "m", 128000, "");
  const html = sessionToHtml(session as never);
  // TS title is "zerostack-ts session <id>" (Rust: "zerostack session <id>").
  assert.ok(html.includes("zerostack-ts session"), `unnamed sessions get an id-based title: ${html}`);
});
