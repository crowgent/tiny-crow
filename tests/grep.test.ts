import test from "node:test";
import assert from "node:assert/strict";
import { globToRegex, isBinary } from "../src/agent/tools/grep.ts";

test("glob_literal_chars", () => {
  assert.equal(globToRegex("hello"), "hello");
});

test("glob_dot", () => {
  assert.equal(globToRegex("file.txt"), "file\\.txt");
});

test("glob_star", () => {
  assert.equal(globToRegex("*.rs"), ".*\\.rs");
});

test("glob_question_mark", () => {
  assert.equal(globToRegex("file.?"), "file\\..");
});

test("glob_brace_alternation", () => {
  assert.equal(globToRegex("*.{ts,tsx}"), ".*\\.(?:ts|tsx)");
});

test("glob_complex_pattern", () => {
  assert.equal(globToRegex("src/**/test_*.{rs,toml}"), "src/.*.*/test_.*\\.(?:rs|toml)");
});

test("glob_empty", () => {
  assert.equal(globToRegex(""), "");
});

test("is_binary_null_byte_in_first_8k", () => {
  const data = new Uint8Array(100).fill(0x61);
  data[50] = 0;
  assert.ok(isBinary(data));
});

test("is_binary_no_null_byte", () => {
  assert.ok(!isBinary(new Uint8Array(100).fill(0x61)));
});

test("is_binary_empty", () => {
  assert.ok(!isBinary(new Uint8Array(0)));
});

test("is_binary_null_at_start", () => {
  assert.ok(isBinary(new Uint8Array([0, 0x61, 0x62])));
});

test("is_binary_null_at_end", () => {
  const data = new Uint8Array(8192).fill(0x61);
  data[8191] = 0;
  assert.ok(isBinary(data));
});

test("is_binary_all_text", () => {
  assert.ok(!isBinary(new TextEncoder().encode("hello world\nline 2\nline 3\n")));
});

test("is_binary_non_utf8_no_null", () => {
  assert.ok(!isBinary(new Uint8Array([0xff, 0xfe, 0xfd])));
});
