import test from "node:test";
import assert from "node:assert/strict";
import {
  formatConversation,
  type AdvisorSessionMessage,
} from "../src/extras/advisor/mod.ts";

function msg(role: AdvisorSessionMessage["role"], content: string): AdvisorSessionMessage {
  return { role, content };
}

test("format_conversation_empty", () => {
  assert.equal(formatConversation([], 1), "");
});

test("format_conversation_single_message", () => {
  assert.equal(formatConversation([msg("user", "hello")], 1024), "[User]: hello");
});

test("format_conversation_two_messages", () => {
  const msgs = [msg("user", "hello"), msg("assistant", "hi there")];
  assert.equal(formatConversation(msgs, 1024), "[User]: hello\n\n[Assistant]: hi there");
});

test("format_conversation_nothing_fits_returns_omission_only", () => {
  const msgs = [
    msg("user", "aaaaaaaaaa"),
    msg("assistant", "bbbbbbbbbb"),
    msg("user", "cccccccccc"),
    msg("assistant", "dddddddddd"),
  ];
  const result = formatConversation(msgs, 0);
  assert.ok(result.includes("[... conversation omitted ...]"));
  assert.ok(!result.includes("[User]:"));
  assert.ok(!result.includes("[Assistant]:"));
});

test("format_conversation_head_with_tail_gap", () => {
  const short = "aa";
  const msgs = [
    msg("user", short),
    msg("assistant", short),
    msg("user", "a much longer message that takes more space"),
    msg("assistant", "another fairly long message here too"),
    msg("user", "a third long message that pushes the limit"),
    msg("assistant", short),
    msg("user", short),
  ];
  const result = formatConversation(msgs, 0);
  assert.ok(result.includes("[... conversation omitted ...]"));
});

test("format_conversation_small_limit_head_tail_with_gap", () => {
  const msgs = [msg("user", "x"), msg("assistant", "y"), msg("user", "z")];
  const result = formatConversation(msgs, 0);
  assert.ok(result.includes("[... conversation omitted ...]"));
});

test("format_conversation_no_gap", () => {
  const msgs = [msg("user", "hello"), msg("assistant", "world")];
  const result = formatConversation(msgs, 1024);
  assert.ok(!result.includes("[... conversation omitted ...]"));
});

test("format_conversation_no_duplicate_when_head_covers_all", () => {
  const msgs = [msg("user", "short"), msg("assistant", "msg")];
  const result = formatConversation(msgs, 1024);
  assert.equal(result.split("[User]:").length - 1, 1);
  assert.equal(result.split("[Assistant]:").length - 1, 1);
});

test("omission_marker_not_on_same_line_as_tail", () => {
  const msgs = [
    msg("user", "first"),
    msg("assistant", "second"),
    msg("user", "third"),
    msg("assistant", "fourth"),
    msg("user", "fifth"),
  ];
  const result = formatConversation(msgs, 0);
  const marker = "[... conversation omitted ...]";
  const markerPos = result.indexOf(marker);
  assert.ok(markerPos >= 0);
  const afterMarker = result.slice(markerPos + marker.length);
  assert.ok(afterMarker.startsWith("\n\n"), `marker must be separated from next message by \\n\\n, got: ${JSON.stringify(afterMarker)}`);
});
