import test from "node:test";
import assert from "node:assert/strict";
import { InputEditor } from "../src/ui/input/mod.ts";
import {
  charKey,
  makeKeyEvent,
  plainKey,
} from "../src/ui/input/cursor.ts";

function typeStr(editor: InputEditor, s: string): void {
  for (const c of s) editor.handleKey(charKey(c));
}

test("typing_ascii_keeps_cursor_in_sync", () => {
  const editor = new InputEditor();
  typeStr(editor, "hello");
  assert.equal(editor.buffer, "hello");
  assert.equal(editor.cursor, 5);
});

test("typing_multibyte_chars_does_not_panic", () => {
  const editor = new InputEditor();
  typeStr(editor, "på ");
  assert.equal(editor.buffer, "på ");
  assert.equal(editor.cursor, [...editor.buffer].length);
});

test("typing_mixed_ascii_and_multibyte", () => {
  const editor = new InputEditor();
  typeStr(editor, "hei på deg så fin dag æøå");
  assert.equal(editor.buffer, "hei på deg så fin dag æøå");
  assert.equal(editor.cursor, [...editor.buffer].length);
});

test("backspace_after_multibyte_does_not_panic", () => {
  const editor = new InputEditor();
  typeStr(editor, "å");
  editor.handleKey(plainKey("backspace"));
  assert.equal(editor.buffer, "");
  assert.equal(editor.cursor, 0);
});

test("left_arrow_steps_one_char_not_one_byte", () => {
  const editor = new InputEditor();
  typeStr(editor, "aåb");
  assert.equal(editor.cursor, 3);
  editor.handleKey(plainKey("left"));
  assert.equal(editor.cursor, 2);
  editor.handleKey(plainKey("left"));
  assert.equal(editor.cursor, 1);
});

test("right_arrow_steps_one_char_not_one_byte", () => {
  const editor = new InputEditor();
  typeStr(editor, "aåb");
  editor.cursor = 0;
  editor.handleKey(plainKey("right"));
  assert.equal(editor.cursor, 1);
  editor.handleKey(plainKey("right"));
  assert.equal(editor.cursor, 2);
});

test("enter_returns_buffer_and_resets", () => {
  const editor = new InputEditor();
  typeStr(editor, "hei på");
  const out = editor.handleKey(plainKey("enter"));
  assert.equal(out, "hei på");
  assert.equal(editor.cursor, 0);
  assert.equal(editor.buffer, "");
});

test("ctrl_left_jumps_to_prev_word_start", () => {
  const editor = new InputEditor();
  typeStr(editor, "hello world");
  editor.handleKey(plainKey("left", { control: true }));
  assert.equal(editor.cursor, 6);
  editor.handleKey(plainKey("left", { control: true }));
  assert.equal(editor.cursor, 0);
});

test("ctrl_right_jumps_to_next_word_end", () => {
  const editor = new InputEditor();
  typeStr(editor, "hello world");
  editor.cursor = 0;
  editor.handleKey(plainKey("right", { control: true }));
  assert.equal(editor.cursor, 5);
  editor.handleKey(plainKey("right", { control: true }));
  assert.equal(editor.cursor, 11);
});

void makeKeyEvent;
