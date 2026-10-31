import test from "node:test";
import assert from "node:assert/strict";
import { BlockStyle, blockColor, Feed } from "../src/ui/feed.ts";

test("block_style_color_mapping", () => {
  const rgb = (r: number, g: number, b: number) => ({ kind: "rgb", r, g, b });
  assert.deepEqual(blockColor(BlockStyle.User), rgb(166, 218, 149));
  assert.deepEqual(blockColor(BlockStyle.Agent), rgb(202, 211, 245));
  assert.deepEqual(blockColor(BlockStyle.Reasoning), rgb(198, 160, 246));
  assert.deepEqual(blockColor(BlockStyle.Tool), rgb(238, 212, 159));
  assert.deepEqual(blockColor(BlockStyle.ToolResult), rgb(110, 115, 141));
  assert.deepEqual(blockColor(BlockStyle.Error), rgb(237, 135, 150));
  assert.deepEqual(blockColor(BlockStyle.System), rgb(147, 154, 183));
  assert.deepEqual(blockColor(BlockStyle.Welcome), rgb(139, 213, 202));
  assert.deepEqual(blockColor(BlockStyle.Permission), rgb(245, 189, 230));
  assert.deepEqual(blockColor(BlockStyle.Plain), rgb(202, 211, 245));
});

test("lines_wrap_plain_block", () => {
  const feed = new Feed();
  feed.pushLine(BlockStyle.Plain, "hello world");
  const lines = feed.lines(20);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.text, "hello world");
  assert.deepEqual(lines[0]!.color, { kind: "rgb", r: 202, g: 211, b: 245 });
});

test("lines_wrap_narrow_width", () => {
  const feed = new Feed();
  feed.pushLine(BlockStyle.Plain, "hello world");
  const lines = feed.lines(5);
  assert.ok(lines.length > 1);
  for (const line of lines) {
    assert.ok(
      [...line.text].length <= 5 || line.text === "hello" || line.text === "world",
    );
  }
});

test("empty_block_produces_empty_line", () => {
  const feed = new Feed();
  feed.pushLine(BlockStyle.Plain, "");
  const lines = feed.lines(80);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.text, "");
});

test("agent_block_gets_prefix_and_markdown", () => {
  const feed = new Feed();
  feed.pushBlock(BlockStyle.Agent, "hello **world**");
  const lines = feed.lines(80);
  assert.ok(lines.length > 0);
  assert.ok(lines[0]!.text.startsWith("< "), `first agent line should start with '< ', got ${JSON.stringify(lines[0]!.text)}`);
  const joined = lines.map((l) => l.text).join("");
  assert.ok(joined.includes("hello "), `prose should be present: ${joined}`);
  assert.ok(joined.includes("world"), `bold text should be present: ${joined}`);
});

test("agent_empty_block_no_lines", () => {
  const feed = new Feed();
  feed.pushBlock(BlockStyle.Agent, "");
  assert.deepEqual(feed.lines(80), []);
});

test("line_count_matches_lines", () => {
  const feed = new Feed();
  feed.pushLine(BlockStyle.Plain, "one");
  feed.pushLine(BlockStyle.Plain, "two");
  feed.pushLine(BlockStyle.Plain, "three");
  assert.equal(feed.lineCount(80), 3);
});

test("visible_range_bottom_aligned_when_short", () => {
  const feed = new Feed();
  feed.pushLine(BlockStyle.Plain, "one");
  feed.pushLine(BlockStyle.Plain, "two");
  const [start, end] = feed.visibleRange(80, 0, 10);
  assert.equal(start, 0);
  assert.equal(end, 2);
});

test("visible_range_scrolled", () => {
  const feed = new Feed();
  for (let i = 0; i < 20; i++) feed.pushLine(BlockStyle.Plain, `line ${i}`);
  const [start, end] = feed.visibleRange(80, 5, 10);
  assert.equal(end - start, 10);
  assert.equal(start, 5);
});

test("line_at_visual_row_bottom_pad", () => {
  const feed = new Feed();
  feed.pushLine(BlockStyle.Plain, "one");
  assert.equal(feed.lineAtVisualRow(80, 0, 10, 0), null);
  assert.equal(feed.lineAtVisualRow(80, 0, 10, 9), 0);
});

test("line_at_visual_row_scrolled", () => {
  const feed = new Feed();
  for (let i = 0; i < 20; i++) feed.pushLine(BlockStyle.Plain, `line ${i}`);
  assert.equal(feed.lineAtVisualRow(80, 5, 10, 0), 5);
  assert.equal(feed.lineAtVisualRow(80, 5, 10, 9), 14);
});

test("selected_text_extracts_lines", () => {
  const feed = new Feed();
  feed.pushLine(BlockStyle.Plain, "alpha");
  feed.pushLine(BlockStyle.Plain, "beta");
  feed.pushLine(BlockStyle.Plain, "gamma");
  assert.equal(feed.selectedText(80, 0, 2), "alpha\nbeta\ngamma");
});

test("selected_text_reversed_range", () => {
  const feed = new Feed();
  feed.pushLine(BlockStyle.Plain, "alpha");
  feed.pushLine(BlockStyle.Plain, "beta");
  assert.equal(feed.selectedText(80, 1, 0), "alpha\nbeta");
});

test("append_to_last_extends_block", () => {
  const feed = new Feed();
  feed.pushBlock(BlockStyle.Agent, "hello");
  assert.ok(feed.appendToLast(" world"));
  const lines = feed.lines(80);
  assert.equal(lines.length, 1);
  assert.ok(lines[0]!.text.includes("hello world"));
});

test("append_to_last_returns_false_when_empty", () => {
  const feed = new Feed();
  assert.ok(!feed.appendToLast("orphan"));
});

test("replace_last_updates_final_block", () => {
  const feed = new Feed();
  feed.pushLine(BlockStyle.Plain, "first");
  feed.pushLine(BlockStyle.Plain, "second");
  feed.replaceLast(BlockStyle.Agent, "replaced");
  const lines = feed.lines(80);
  assert.equal(lines.length, 2);
  assert.equal(lines[0]!.text, "first");
  assert.equal(lines[1]!.text, "< replaced");
});

test("replace_last_pushes_when_empty", () => {
  const feed = new Feed();
  feed.replaceLast(BlockStyle.Agent, "only");
  const lines = feed.lines(80);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.text, "< only");
});

test("truncate_blocks_keeps_prefix", () => {
  const feed = new Feed();
  feed.pushLine(BlockStyle.Plain, "first");
  feed.pushLine(BlockStyle.Plain, "second");
  feed.pushLine(BlockStyle.Plain, "third");
  feed.truncateBlocks(2);
  assert.equal(feed.blockCount(), 2);
  assert.equal(feed.lines(80).length, 2);
});

test("clear_empties_feed", () => {
  const feed = new Feed();
  feed.pushLine(BlockStyle.Plain, "hello");
  feed.clear();
  assert.ok(feed.isEmpty());
  assert.equal(feed.lineCount(80), 0);
});

test("generation_starts_at_zero", () => {
  const feed = new Feed();
  assert.equal(feed.generation(), 0);
});

test("generation_bumps_on_each_mutator", () => {
  const feed = new Feed();
  feed.pushBlock(BlockStyle.Plain, "one");
  assert.equal(feed.generation(), 1);
  feed.pushLine(BlockStyle.Plain, "two");
  assert.equal(feed.generation(), 2);
  assert.ok(feed.appendToLast(" more"));
  assert.equal(feed.generation(), 3);
  feed.replaceLast(BlockStyle.Agent, "replaced");
  assert.equal(feed.generation(), 4);
  feed.truncateBlocks(1);
  assert.equal(feed.generation(), 5);
  feed.clear();
  assert.equal(feed.generation(), 6);
});

test("generation_not_bumped_by_failed_append", () => {
  const feed = new Feed();
  assert.ok(!feed.appendToLast("orphan"));
  assert.equal(feed.generation(), 0);
});

test("generation_not_bumped_by_reads", () => {
  const feed = new Feed();
  feed.pushLine(BlockStyle.Plain, "one");
  const before = feed.generation();
  feed.lines(80);
  feed.lineCount(80);
  feed.visibleRange(80, 0, 10);
  feed.lineAtVisualRow(80, 0, 10, 0);
  feed.selectedText(80, 0, 0);
  feed.isEmpty();
  feed.blockCount();
  assert.equal(feed.generation(), before);
});

test("running_agent_block_renders_tail_as_plain_text", () => {
  const feed = new Feed();
  feed.pushStreamingBlock(BlockStyle.Agent);
  assert.ok(feed.appendToLast("hello **wor"));
  const lines = feed.lines(80);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.text, "< hello **wor");
  assert.deepEqual(lines[0]!.color, { kind: "rgb", r: 202, g: 211, b: 245 });
});

test("running_agent_block_parses_only_completed_lines", () => {
  const feed = new Feed();
  feed.pushStreamingBlock(BlockStyle.Agent);
  assert.ok(feed.appendToLast("first **bold**\nsecond **par"));
  const lines = feed.lines(80);
  assert.equal(lines.length, 2);
  assert.equal(lines[0]!.text, "< first bold");
  assert.equal(lines[1]!.text, "second **par");
});

test("running_agent_block_appends_grow_tail", () => {
  const feed = new Feed();
  feed.pushStreamingBlock(BlockStyle.Agent);
  assert.ok(feed.appendToLast("hello"));
  assert.ok(feed.appendToLast(" world"));
  const lines = feed.lines(80);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.text, "< hello world");
});

test("finalize_last_parses_full_text", () => {
  const feed = new Feed();
  feed.pushStreamingBlock(BlockStyle.Agent);
  assert.ok(feed.appendToLast("hello **world**"));
  feed.finalizeLast();
  const lines = feed.lines(80);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.text, "< hello world");
});

test("finalize_last_bumps_generation_once", () => {
  const feed = new Feed();
  feed.pushStreamingBlock(BlockStyle.Agent);
  const before = feed.generation();
  feed.finalizeLast();
  assert.equal(feed.generation(), before + 1);
  feed.finalizeLast();
  assert.equal(feed.generation(), before + 1);
});

test("finalize_last_on_complete_block_is_noop", () => {
  const feed = new Feed();
  feed.pushBlock(BlockStyle.Agent, "done");
  const before = feed.generation();
  feed.finalizeLast();
  assert.equal(feed.generation(), before);
});

test("replace_last_invalidates_cached_layout", () => {
  const feed = new Feed();
  feed.pushBlock(BlockStyle.Agent, "aaaa **old**");
  feed.lines(80);
  feed.replaceLast(BlockStyle.Agent, "bbbb **new**");
  const lines = feed.lines(80);
  const joined = lines.map((l) => l.text).join("");
  assert.ok(joined.includes("new"), `expected new content: ${joined}`);
  assert.ok(!joined.includes("old"), `stale cached content: ${joined}`);
});

test("agent_layout_recomputes_on_width_change", () => {
  const feed = new Feed();
  feed.pushBlock(BlockStyle.Agent, "one two three four five six seven eight nine ten eleven twelve");
  const wide = feed.lines(120);
  const narrow = feed.lines(20);
  assert.ok(narrow.length > wide.length, `narrow width should wrap into more lines: ${narrow.length} vs ${wide.length}`);
});

test("scroll_and_selection_queries_reuse_prewrapped_rows", () => {

  const feed = new Feed();
  feed.pushLine(BlockStyle.Plain, "hello");
  assert.deepEqual(feed.lines(80).map((l) => l.text), ["hello"]);
  assert.equal(feed.lineCount(80), 1);
  assert.deepEqual(feed.visibleRange(80, 0, 10), [0, 1]);
  assert.equal(feed.selectedText(80, 0, 0), "hello");
  assert.equal(feed.lineAtVisualRow(80, 0, 10, 9), 0);
  feed.pushLine(BlockStyle.Plain, "world");
  assert.deepEqual(feed.lines(80).map((l) => l.text), ["hello", "world"]);
  assert.equal(feed.lines(40).length, 2);
  assert.deepEqual(feed.lines(80).map((l) => l.text), ["hello", "world"]);
  assert.deepEqual(feed.lines(80).map((l) => l.text), ["hello", "world"]);
});
