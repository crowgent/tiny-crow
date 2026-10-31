import test from "node:test";
import assert from "node:assert/strict";
import { centerText, crowBannerLines, centeredBanner } from "../src/crowtui/banner.ts";
import { parseKeys } from "../src/crowtui/keys.ts";
import { LineInput } from "../src/crowtui/input.ts";
import { slashCandidates, pickerWindow, SLASH_COMMANDS, PROVIDER_NAMES, slashDescription } from "../src/crowtui/slash.ts";
import { windowPanelRows } from "../src/crowtui/panel.ts";
import { Screen, wrapLine } from "../src/crowtui/screen.ts";

test("crow_banner_has_big_crow_art", () => {
  const lines = crowBannerLines();
  assert.equal(lines.length, 8);
  assert.ok(lines[0]!.includes("█"));
  assert.ok(lines.join("\n").includes("tiny crow"));
});

test("center_text_pads_and_passes_through", () => {
  assert.equal(centerText("hi", 10), "    hi");
  assert.equal(centerText("long text here", 5), "long text here");
});

test("centered_banner_width", () => {
  const lines = centeredBanner(80);
  assert.equal(lines.length, 8);
  for (const line of lines) assert.ok(line.length <= 80);
});

test("parse_keys_basic", () => {
  const keys = parseKeys(Buffer.from("a\r\x03\x7f"));
  assert.equal(keys.length, 4);
  assert.deepEqual(keys[0], { kind: "char", ch: "a", ctrl: false, alt: false });
  assert.equal(keys[1]!.kind, "enter");
  assert.equal(keys[2]!.kind, "ctrlc");
  assert.equal(keys[3]!.kind, "backspace");
});

test("parse_keys_arrows_and_tab", () => {
  const keys = parseKeys(Buffer.from("\x1b[A\x1b[B\t"));
  assert.equal(keys[0]!.kind, "up");
  assert.equal(keys[1]!.kind, "down");
  assert.equal(keys[2]!.kind, "tab");
});

test("line_input_edit_and_history", () => {
  const input = new LineInput();
  input.insert("hello");
  input.backspace();
  assert.equal(input.value(), "hell");
  input.pushHistory("hell");
  input.clear();
  assert.equal(input.historyUp(), true);
  assert.equal(input.value(), "hell");
  assert.equal(input.historyDown(), true);
  assert.equal(input.value(), "");
});

test("line_input_slash_picker", () => {
  const input = new LineInput();
  input.setValue("/mod");
  const candidates = input.pickerCandidates();
  assert.ok(candidates.includes("model"));
  assert.ok(candidates.includes("models"));
  assert.equal(input.applyPicker(), true);
  assert.ok(input.value().startsWith("/model"));
});

test("slash_candidates_filter", () => {
  assert.ok(slashCandidates("").length > 40);
  assert.deepEqual(slashCandidates("qu"), ["quit", "queue"]);
});

test("wrap_line_splits_long_lines", () => {
  assert.deepEqual(wrapLine("abcdefghij", 4), ["abcd", "efgh", "ij"]);
  assert.deepEqual(wrapLine("", 10), [""]);
});

test("line_input_picker_dismiss_and_reopen", () => {
  const input = new LineInput();
  input.setValue("/mod");
  assert.ok(input.pickerCandidates().length > 0);
  input.dismissPicker();
  assert.deepEqual(input.pickerCandidates(), []);
  input.insert("e");
  assert.ok(input.pickerCandidates().length > 0);
});

test("screen_renders_header_once_with_erased_rows", () => {
  const screen = new Screen();
  screen.setHeader(
    centeredBanner(80).map((line) => ({ text: line, color: "" })),
  );
  screen.writeLine("hello world", "");
  const captured: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: (chunk: string) => boolean }).write = (chunk: string) => {
    captured.push(chunk);
    return true;
  };
  try {
    screen.render("/mod", 4, ["  /model", "  /models"], 0, "ready");
    screen.render("/mod", 4, ["  /model", "  /models"], 0, "ready");
  } finally {
    (process.stdout as unknown as { write: (chunk: string) => boolean }).write = originalWrite as (chunk: string) => boolean;
  }
  const painted = captured.join("");
  const bannerFirstLine = "██████  ██████   ██████  ██      ██";
  const occurrences = painted.split(bannerFirstLine).length - 1;
  assert.equal(occurrences, 2);
  assert.ok(painted.includes("\x1b[K"));
  assert.ok(painted.includes("> /mod"));
  assert.ok(painted.includes("  /model"));
  assert.ok(painted.includes("ready"));
});

test("screen_clips_header_to_terminal_width", () => {
  const screen = new Screen();
  screen.setHeader([{ text: "x".repeat(200), color: "" }]);
  const captured: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: (chunk: string) => boolean }).write = (chunk: string) => {
    captured.push(chunk);
    return true;
  };
  try {
    screen.render("", 0, [], 0, "ready");
  } finally {
    (process.stdout as unknown as { write: (chunk: string) => boolean }).write = originalWrite as (chunk: string) => boolean;
  }
  const stripped = captured.join("").replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
  for (const row of stripped.split("\r\n")) {
    assert.ok(row.length <= screen.cols, `row too long: ${row.length}`);
  }
});

test("picker_window_empty_and_short", () => {
  assert.deepEqual(pickerWindow([], 0, 8), { rows: [], selected: 0 });
  const short = pickerWindow(["model", "quit", "help"], 2, 8);
  assert.deepEqual(short.rows, ["  /model", "  /quit", "  /help"]);
  assert.equal(short.selected, 2);
});

test("picker_window_first_page_has_below_indicator", () => {
  const win = pickerWindow(SLASH_COMMANDS, 0, 8);
  assert.equal(win.rows.length, 9);
  assert.equal(win.rows[0], "  /provider");
  assert.equal(win.rows[7], "  /theme");
  assert.equal(win.rows[8], `  ↓ ${SLASH_COMMANDS.length - 8} more below`);
  assert.equal(win.selected, 0);
});

test("picker_window_follows_selection_down", () => {
  const win = pickerWindow(SLASH_COMMANDS, 10, 8);
  assert.equal(win.rows[0], "  ↑ 3 more above");
  assert.equal(win.rows[8], "  /reasoning");
  assert.equal(win.rows[9], `  ↓ ${SLASH_COMMANDS.length - 11} more below`);
  assert.equal(win.selected, 8);
});

test("picker_window_last_page_has_no_below_indicator", () => {
  const last = SLASH_COMMANDS.length - 1;
  const win = pickerWindow(SLASH_COMMANDS, last, 8);
  assert.equal(win.rows[0], `  ↑ ${SLASH_COMMANDS.length - 8} more above`);
  assert.equal(win.rows[win.rows.length - 1], "  /queue");
  assert.equal(win.selected, win.rows.length - 1);
  assert.ok(!win.rows.some((row) => row.includes("more below")));
});

test("enter_slash_applies_partial_token", () => {
  const input = new LineInput();
  input.setValue("/pro");
  input.pickerIndex = 0;
  assert.equal(input.enterSlash(), "/provider");
  assert.equal(input.value(), "/provider ");
});

test("enter_slash_keeps_exact_and_arg_commands", () => {
  const input = new LineInput();
  input.setValue("/provider");
  assert.equal(input.enterSlash(), null);
  input.setValue("/model foo");
  assert.equal(input.enterSlash(), null);
  input.setValue("hello");
  assert.equal(input.enterSlash(), null);
});

test("enter_slash_follows_highlighted_index", () => {
  const input = new LineInput();
  input.setValue("/pro");
  input.pickerIndex = 1;
  assert.equal(input.enterSlash(), "/prompt");
});

test("provider_names_and_descriptions", () => {
  assert.equal(PROVIDER_NAMES.length, 7);
  assert.ok(PROVIDER_NAMES.includes("openrouter"));
  assert.ok(PROVIDER_NAMES.includes("ollama"));
  assert.equal(slashDescription("provider"), "show or switch provider");
  assert.equal(slashDescription("quit"), "leave the TUI");
  assert.equal(slashDescription("nosuchcommand"), "");
});

test("panel_window_follows_selection", () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ label: `item${i}` }));
  const first = windowPanelRows(items, 0, 8);
  assert.equal(first.rows[0], "  item0");
  assert.equal(first.rows[8], "  ↓ 12 more below");
  assert.equal(first.selected, 0);
  const deep = windowPanelRows(items, 15, 8);
  assert.equal(deep.rows[0], "  ↑ 8 more above");
  assert.equal(deep.rows[8], "  item15");
  assert.equal(deep.rows[9], "  ↓ 4 more below");
  assert.equal(deep.selected, 8);
  const empty = windowPanelRows([], 0, 8);
  assert.deepEqual(empty.rows, ["  (none)"]);
});
