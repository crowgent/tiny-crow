import test from "node:test";
import assert from "node:assert/strict";
import {
  charKey,
  charsOf,
  charCount,
  insertAt,
  removeAt,
  insertCharAt,
  keyChar,
  isCharKey,
  isBackspaceAlias,
  makeKeyEvent,
} from "../src/ui/input/cursor.ts";

test("cursor_insert_and_remove_ascii", () => {
  assert.equal(insertAt("ac", 1, "b"), "abc");
  assert.equal(removeAt("abc", 1), "ac");
  assert.equal(insertCharAt("ab", 2, "c"), "abc");
});

test("cursor_multibyte_chars_count_as_one", () => {
  assert.deepEqual(charsOf("aé中"), ["a", "é", "中"]);
  assert.equal(charCount("aé中"), 3);
  assert.equal(insertAt("a中", 1, "é"), "aé中");
  assert.equal(removeAt("aé中", 1), "a中");
});

test("cursor_char_key_round_trip", () => {
  const key = charKey("x");
  assert.equal(keyChar(key), "x");
  assert.ok(isCharKey(key, "x"));
  assert.ok(!isCharKey(key, "y"));
});

test("cursor_backspace_alias_and_plain_key", () => {
  assert.ok(isBackspaceAlias(charKey("\x08")));
  assert.ok(!isBackspaceAlias(charKey("h")));
  assert.equal(keyChar(makeKeyEvent({ kind: "enter" }, {})), undefined);
});
