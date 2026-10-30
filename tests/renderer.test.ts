import test from "node:test";
import assert from "node:assert/strict";
import { showWelcome } from "../src/ui/events.ts";
import { BlockStyle } from "../src/ui/feed.ts";
import {
  base64Encode,
  BottomRedrawPlan,
  copyToClipboard,
  isSafeUrl,
  Renderer,
  StringBackend,
  type BottomSnapshot,
} from "../src/ui/renderer.ts";
import type { StatusSpan } from "../src/ui/statusline.ts";

const enc = new TextEncoder();

test("base64_encode_empty", () => {
  assert.equal(base64Encode(new Uint8Array(0)), "");
});

test("base64_encode_single_byte", () => {
  assert.equal(base64Encode(enc.encode("f")), "Zg==");
});

test("base64_encode_two_bytes", () => {
  assert.equal(base64Encode(enc.encode("fo")), "Zm8=");
});

test("base64_encode_three_bytes", () => {
  assert.equal(base64Encode(enc.encode("foo")), "Zm9v");
});

test("base64_encode_known_values", () => {
  assert.equal(base64Encode(enc.encode("Hello")), "SGVsbG8=");
  assert.equal(base64Encode(enc.encode("Hi!")), "SGkh");
  assert.equal(base64Encode(enc.encode("ab")), "YWI=");
  assert.equal(base64Encode(enc.encode("abc")), "YWJj");
  assert.equal(base64Encode(enc.encode("Man")), "TWFu");
});

test("base64_encode_long_input", () => {
  const input = "The quick brown fox jumps over the lazy dog. ".repeat(10);
  const encoded = base64Encode(enc.encode(input));
  assert.ok(encoded.length > input.length);
  assert.ok(encoded.endsWith("=") || !encoded.includes("="));
});

test("copy_to_clipboard_does_not_panic", () => {
  // Succeeds via an external tool or the OSC 52 fallback; must not throw.
  copyToClipboard("test text");
});

test("copy_to_clipboard_empty_string", () => {
  copyToClipboard("");
});

test("safe_url_accepts_http_and_https", () => {
  assert.ok(isSafeUrl("https://example.com"));
  assert.ok(isSafeUrl("http://example.com/path?q=1#frag"));
  assert.ok(isSafeUrl("https://user@example.com:8080/x"));
});

test("safe_url_rejects_non_http_schemes", () => {
  assert.ok(!isSafeUrl("file:///etc/passwd"));
  assert.ok(!isSafeUrl("javascript:alert(1)"));
  assert.ok(!isSafeUrl("ftp://example.com"));
  assert.ok(!isSafeUrl("example.com/no-scheme"));
  assert.ok(!isSafeUrl(""));
});

test("safe_url_rejects_missing_host", () => {
  assert.ok(!isSafeUrl("https://"));
  assert.ok(!isSafeUrl("http:///path"));
});

test("safe_url_rejects_whitespace_and_control_chars", () => {
  assert.ok(!isSafeUrl("https://example.com/a b"));
  assert.ok(!isSafeUrl("https://example.com/\nevil"));
  assert.ok(!isSafeUrl("https://example.com/\x07"));
});

test("safe_url_rejects_overlong_urls", () => {
  const long = `https://example.com/${"a".repeat(2100)}`;
  assert.ok(!isSafeUrl(long));
});

test("chat_margin_reduces_content_width", () => {
  const r = Renderer.new();
  const full = r.lineWidth();
  r.setChatMargin(4);
  assert.equal(r.lineWidth(), Math.max(0, full - 4));
  r.setChatMargin(0);
  assert.equal(r.lineWidth(), full);
});

function bottomSnapshot(): BottomSnapshot {
  return {
    cols: 80,
    rows: 24,
    statuslineHeight: 1,
    input: "",
    cursorPos: 0,
    isRunning: false,
    spinnerFrame: 0,
    inputVscrollOffset: 0,
    prompt: { kind: "input" },
    statusline: [[{ kind: "text", text: "model", fg: null, bg: null } as StatusSpan]],
    scrollIndicator: false,
    monochrome: false,
    inputBg: null,
    statusBg: null,
  };
}

test("fresh_renderer_needs_chat_redraw", () => {
  const r = Renderer.new();
  assert.ok(r.chatNeedsRedraw());
});

test("chat_clean_after_mark_clean", () => {
  const r = Renderer.new();
  r.markChatClean();
  assert.ok(!r.chatNeedsRedraw());
});

test("feed_mut_mutation_triggers_chat_redraw", () => {
  const r = Renderer.new();
  r.markChatClean();
  r.feedMut().pushBlock(BlockStyle.Plain, "hello");
  assert.ok(r.chatNeedsRedraw());
});

test("scroll_triggers_chat_redraw", () => {
  const r = Renderer.new();
  for (let i = 0; i < 40; i++) {
    r.feedMut().pushLine(BlockStyle.Plain, `line ${i}`);
  }
  r.markChatClean();
  assert.ok(!r.chatNeedsRedraw());
  r.scrollLineUp();
  assert.ok(r.chatNeedsRedraw());
});

test("resize_marks_chat_dirty", () => {
  const r = Renderer.new();
  r.markChatClean();
  r.resize();
  assert.ok(r.chatNeedsRedraw());
});

test("selection_change_triggers_chat_redraw", () => {
  const r = Renderer.new();
  r.feedMut().pushLine(BlockStyle.Plain, "selectable");
  r.markChatClean();
  assert.ok(!r.chatNeedsRedraw());
  r.selectionActive = true;
  r.selectionStart = 0;
  r.selectionEnd = 0;
  assert.ok(r.chatNeedsRedraw());
  r.markChatClean();
  r.clearSelection();
  assert.ok(r.chatNeedsRedraw());
});

test("invalidate_marks_chat_dirty", () => {
  const r = Renderer.new();
  r.markChatClean();
  r.invalidate();
  assert.ok(r.chatNeedsRedraw());
});

test("bottom_plan_full_when_no_previous", () => {
  const next = bottomSnapshot();
  assert.equal(Renderer.bottomRedrawPlan(null, next, false), BottomRedrawPlan.Full);
});

test("bottom_plan_skip_when_unchanged", () => {
  const prev = bottomSnapshot();
  const next = bottomSnapshot();
  assert.equal(Renderer.bottomRedrawPlan(prev, next, false), BottomRedrawPlan.Skip);
});

test("bottom_plan_force_full", () => {
  const prev = bottomSnapshot();
  const next = bottomSnapshot();
  assert.equal(Renderer.bottomRedrawPlan(prev, next, true), BottomRedrawPlan.Full);
});

test("bottom_plan_statusline_only_on_statusline_change", () => {
  const prev = bottomSnapshot();
  const next = bottomSnapshot();
  next.statusline = [[{ kind: "text", text: "other model", fg: null, bg: null } as StatusSpan]];
  assert.equal(Renderer.bottomRedrawPlan(prev, next, false), BottomRedrawPlan.StatuslineOnly);
});

test("bottom_plan_statusline_only_on_scroll_indicator_change", () => {
  const prev = bottomSnapshot();
  const next = bottomSnapshot();
  next.scrollIndicator = true;
  assert.equal(Renderer.bottomRedrawPlan(prev, next, false), BottomRedrawPlan.StatuslineOnly);
});

test("bottom_plan_full_on_input_change", () => {
  const prev = bottomSnapshot();
  const next = bottomSnapshot();
  next.input = "typed";
  assert.equal(Renderer.bottomRedrawPlan(prev, next, false), BottomRedrawPlan.Full);
});

test("bottom_plan_full_on_cursor_change", () => {
  const prev = bottomSnapshot();
  const next = bottomSnapshot();
  next.cursorPos = 3;
  assert.equal(Renderer.bottomRedrawPlan(prev, next, false), BottomRedrawPlan.Full);
});

test("bottom_plan_full_on_prompt_mode_change", () => {
  const prev = bottomSnapshot();
  const next = bottomSnapshot();
  next.prompt = { kind: "chain", question: "continue?", butMode: false };
  assert.equal(Renderer.bottomRedrawPlan(prev, next, false), BottomRedrawPlan.Full);
});

test("bottom_plan_full_on_geometry_change", () => {
  const prev = bottomSnapshot();
  const next = bottomSnapshot();
  next.rows = 40;
  assert.equal(Renderer.bottomRedrawPlan(prev, next, false), BottomRedrawPlan.Full);
});

test("bottom_plan_full_on_spinner_frame_change", () => {
  const prev = bottomSnapshot();
  const next = bottomSnapshot();
  next.isRunning = true;
  next.spinnerFrame = 1;
  assert.equal(Renderer.bottomRedrawPlan(prev, next, false), BottomRedrawPlan.Full);
});

test("bottom_plan_full_on_input_scroll_change", () => {
  const prev = bottomSnapshot();
  const next = bottomSnapshot();
  next.inputVscrollOffset = 1;
  assert.equal(Renderer.bottomRedrawPlan(prev, next, false), BottomRedrawPlan.Full);
});

test("bottom_plan_full_when_statusline_and_input_change", () => {
  const prev = bottomSnapshot();
  const next = bottomSnapshot();
  next.input = "typed";
  next.statusline = [];
  assert.equal(Renderer.bottomRedrawPlan(prev, next, false), BottomRedrawPlan.Full);
});

const COLS = 80;
const PROMPT_WIDTH = 2;
const VISIBLE_WIDTH = COLS - PROMPT_WIDTH;

function emittedCursor(input: string, cursor: number): [number, number] {
  const r = Renderer.withBackend(new StringBackend(COLS, 24));
  r.setStatuslineHeight(1);
  r.drawBottom(input, cursor, [], false);
  const out = r.capturedOutput();
  const matches = [...out.matchAll(/\x1b\[(\d+);(\d+)H/g)];
  assert.ok(matches.length > 0, "renderer must emit a cursor MoveTo");
  const last = matches[matches.length - 1]!;
  return [Number(last[1]) - 1, Number(last[2]) - 1];
}

test("empty_buffer_cursor_after_prompt", () => {
  assert.equal(emittedCursor("", 0)[1], 2);
});

test("cursor_after_one_ascii_char", () => {
  assert.equal(emittedCursor("a", 1)[1], 3);
});

test("cursor_after_three_ascii_chars", () => {
  assert.equal(emittedCursor("abc", 3)[1], 5);
});

test("cursor_mid_line", () => {
  assert.equal(emittedCursor("abc", 1)[1], 3);
});

test("cursor_at_end_of_short_line", () => {
  const line = "a".repeat(5);
  assert.equal(emittedCursor(line, 5)[1], PROMPT_WIDTH + 5);
});

test("cursor_at_end_of_full_width_line", () => {
  const line = "a".repeat(VISIBLE_WIDTH);
  assert.equal(emittedCursor(line, VISIBLE_WIDTH)[1], COLS - 1);
});

test("cursor_at_end_of_overflowing_line", () => {
  const line = "a".repeat(VISIBLE_WIDTH + 12);
  assert.equal(emittedCursor(line, VISIBLE_WIDTH + 12)[1], COLS - 1);
});

test("show_welcome_toggles_lazygit_shortcut", () => {
  const welcomeText = (showLazygit: boolean): string => {
    const r = Renderer.withBackend(new StringBackend(80, 24));
    showWelcome(r, showLazygit);
    return r.feed().lines(80).map((l) => l.text).join("\n");
  };
  const enabled = welcomeText(true);
  assert.ok(enabled.includes("Ctrl+H     Launch lazygit"), `welcome should advertise Ctrl+H when enabled: ${enabled}`);
  const disabled = welcomeText(false);
  assert.ok(!disabled.includes("Launch lazygit"), `welcome should hide Ctrl+H when --disable-lazygit is set: ${disabled}`);
});
