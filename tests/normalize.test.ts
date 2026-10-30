import test from "node:test";
import assert from "node:assert/strict";
import {
  levenshteinSimilarity,
  normalizeWhitespace,
} from "../src/agent/tools/normalize.ts";

test("normalize_tabs_to_spaces", () => {
  assert.equal(
    normalizeWhitespace("\tfn foo() {\n\t    bar\n\t}\n"),
    "    fn foo() {\n        bar\n    }\n",
  );
});

test("normalize_trailing_spaces", () => {
  assert.equal(normalizeWhitespace("hello   \nworld\n"), "hello\nworld\n");
});

test("normalize_collapse_blank_lines", () => {
  assert.equal(normalizeWhitespace("a\n\n\nb\n"), "a\n\nb\n");
});

test("levenshtein_identical", () => {
  assert.ok(Math.abs(levenshteinSimilarity("hello", "hello") - 1.0) < 0.001);
});

test("levenshtein_similar", () => {
  const sim = levenshteinSimilarity("hello world", "helo world");
  assert.ok(sim > 0.85, `expected >0.85, got ${sim}`);
});

test("levenshtein_different", () => {
  const sim = levenshteinSimilarity("hello", "zzzzz");
  assert.ok(sim < 0.4, `expected <0.4, got ${sim}`);
});
