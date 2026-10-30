import test from "node:test";
import assert from "node:assert/strict";
import { markdownToStyled, wordWrap } from "../src/ui/markdown.ts";
import { displayWidth } from "../src/ui/utils.ts";

const joined = (entries: { text: string }[], sep = " ") =>
  entries.map((e) => e.text).join(sep);

test("wrap_fits_within_width", () => {
  const result = wordWrap("hello world", 20);
  assert.equal(result.length, 1);
  assert.equal(result[0], "hello world");
});

test("wrap_empty", () => {
  const result = wordWrap("", 10);
  assert.equal(result.length, 1);
  assert.equal(result[0], "");
});

test("wrap_zero_width", () => {
  const result = wordWrap("hello world", 0);
  assert.equal(result.length, 1);
  assert.equal(result[0], "hello world");
});

test("wrap_at_word_boundary", () => {
  const result = wordWrap("hello world foo bar", 12);
  assert.equal(result.length, 2);
  assert.equal(result[0], "hello world");
  assert.equal(result[1], "foo bar");
});

test("wrap_long_single_word", () => {
  const result = wordWrap("supercalifragilisticexpialidocious", 10);
  assert.ok(result.length > 1);
  for (const line of result) assert.ok(displayWidth(line) <= 10);
});

test("wrap_preserves_bullet", () => {
  const result = wordWrap("  • hello world this is a test with a longer bullet", 20);
  assert.ok(result[0]!.includes("•"));
});

test("wrap_multiple_spaces", () => {
  const result = wordWrap("a  b  c", 10);
  assert.equal(result.length, 1);
  assert.equal(result[0], "a  b  c");
});

test("inline_code_styled", () => {
  const styled = markdownToStyled("Hello `code` world", 80);
  const j = joined(styled);
  assert.ok(j.includes("`code`"), `inline code should have backticks: ${j}`);
  assert.ok(j.includes("Hello"), `prose before code should be present: ${j}`);
  assert.ok(j.includes("world"), `prose after code should be present: ${j}`);
});

test("multiple_inline_codes_no_duplication", () => {
  const styled = markdownToStyled("foo `a` bar `b` baz", 80);
  const j = joined(styled, "\n");
  assert.equal(j.split("foo").length - 1, 1, `prose before first code must not duplicate: ${j}`);
  assert.equal(j.split("bar").length - 1, 1, `prose between codes must not duplicate: ${j}`);
  assert.equal(j.split("baz").length - 1, 1, `prose after last code must not duplicate: ${j}`);
});

test("inline_code_in_blockquote", () => {
  const styled = markdownToStyled("> Some `code` here", 80);
  const j = joined(styled);
  assert.ok(j.includes("`"), `inline code backticks should appear in blockquote: ${j}`);
  assert.ok(j.includes("Some"), `prose before code should appear in blockquote: ${j}`);
});

test("link_renders_url", () => {
  const styled = markdownToStyled("Click [here](https://example.com) for more", 80);
  assert.ok(styled.some((e) => e.text.includes("https://example.com")), "link URL should appear in output");
});

test("link_text_is_colored", () => {
  const styled = markdownToStyled("[link text](https://x.com)", 80);
  assert.ok(styled.some((e) => e.color === "dark_cyan"), "link text should be DarkCyan");
});

test("link_url_is_dark_grey", () => {
  const styled = markdownToStyled("[text](https://x.com)", 80);
  assert.ok(styled.some((e) => e.color === "dark_grey" && e.text.includes("↪")), "link URL should be DarkGrey with arrow");
});

test("table_renders_borders", () => {
  const styled = markdownToStyled("| A | B |\n|---|---|\n| 1 | 2 |\n", 80);
  const j = joined(styled, "");
  assert.ok(j.includes("┌"), "table should have top-left border");
  assert.ok(j.includes("┐"), "table should have top-right border");
  assert.ok(j.includes("└"), "table should have bottom-left border");
  assert.ok(j.includes("│"), "table should have vertical separators");
});

test("table_contains_content", () => {
  const styled = markdownToStyled("| Name | Age |\n|------|-----|\n| Alice | 30 |\n", 80);
  const j = joined(styled, "\n");
  assert.ok(j.includes("Name"), "table should contain header 'Name'");
  assert.ok(j.includes("Alice"), "table should contain data 'Alice'");
  assert.ok(j.includes("30"), "table should contain data '30'");
});

test("table_borders_are_dark_grey", () => {
  const styled = markdownToStyled("| X |\n|---|\n| y |\n", 80);
  assert.ok(styled.some((e) => e.color === "dark_grey" && e.text.includes("─")), "table borders should be DarkGrey");
});

test("table_content_is_white", () => {
  const styled = markdownToStyled("| X |\n|---|\n| y |\n", 80);
  assert.ok(styled.some((e) => e.color === "white" && e.text.includes("y")), "table content should be White");
});

test("table_blank_skipped", () => {
  const styled = markdownToStyled("||\n|--|\n||\n", 80);
  const content = styled.filter((e) => e.color === "white");
  assert.equal(content.length, 1, "only trailing blank separator expected");
  assert.ok(content[0]!.text === "", "trailing separator should be empty");
  assert.deepEqual(styled.filter((e) => e.color === "dark_grey"), [], "no borders for all-blank table");
});

test("table_with_inline_code", () => {
  const styled = markdownToStyled("| Cmd | Desc |\n|-----|------|\n| `ls` | list |\n", 80);
  const j = joined(styled, "\n");
  assert.ok(j.includes("`ls`"), "table should contain inline code `ls`");
});

test("table_with_alignment", () => {
  const input = "| Left | Center | Right |\n|:-----|:------:|------:|\n| a    | b      | c     |\n";
  const styled = markdownToStyled(input, 80);
  assert.ok(styled.length > 0, "aligned table should render");
  const j = joined(styled, "\n");
  const dataRow = j.split("\n").find((l) => l.includes("a") && l.includes("b") && l.includes("c"));
  assert.ok(dataRow !== undefined, "data row should exist");
  assert.ok(dataRow.includes("│ a  "), `left-aligned 'a' should have trailing padding: ${dataRow}`);
  assert.ok(dataRow.includes("  c │"), `right-aligned 'c' should have leading padding: ${dataRow}`);
  assert.ok(dataRow.includes("  b  "), `center-aligned 'b' should have padding on both sides: ${dataRow}`);
});

test("table_respects_max_width", () => {
  const input = "| Col A | Col B |\n|-------|-------|\n| alpha | beta  |\n";
  for (const width of [20, 25, 30, 40]) {
    const styled = markdownToStyled(input, width);
    for (const entry of styled) {
      const w = displayWidth(entry.text);
      assert.ok(w <= width, `line '${entry.text}' has width ${w} > max_width ${width}`);
    }
    assert.ok(styled.length > 0, `table should render at width ${width}`);
  }
});

test("empty_input_returns_empty_vec", () => {
  assert.deepEqual(markdownToStyled("", 80), []);
});

test("headings_still_work", () => {
  const styled = markdownToStyled("# Hello", 80);
  const heading = styled.find((e) => e.color === "cyan");
  assert.ok(heading !== undefined, "heading should be Cyan");
  assert.ok(heading.text.includes("Hello"));
});

test("code_blocks_still_work", () => {
  const styled = markdownToStyled("```\nlet x = 1;\n```\n", 80);
  assert.ok(styled.some((e) => e.color === "dark_yellow"), "code block should be DarkYellow");
});

test("lists_still_work", () => {
  const styled = markdownToStyled("- item one\n- item two\n", 80);
  assert.equal(styled.filter((e) => e.text.includes("•")).length, 2, "unordered list should have two bullets");
});

test("blockquotes_still_work", () => {
  const styled = markdownToStyled("> quoted text", 80);
  assert.ok(styled.some((e) => e.color === "dark_grey"), "blockquote text should be DarkGrey");
});
