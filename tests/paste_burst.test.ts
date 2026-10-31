import test from "node:test";
import assert from "node:assert/strict";
import { isPasteNewlineKey, PasteBurst } from "../src/ui/mod.ts";
import type { KeyEvent } from "../src/ui/state.ts";

const key = (code: KeyEvent["code"], opts: Partial<KeyEvent> = {}): KeyEvent => ({
  code,
  ctrl: false,
  alt: false,
  shift: false,
  ...opts,
});

test("paste_newline_keys", () => {
  assert.ok(isPasteNewlineKey(key("enter")));
  assert.ok(isPasteNewlineKey(key("char", { ch: "j", ctrl: true })));
  assert.ok(!isPasteNewlineKey(key("enter", { shift: true })));
  assert.ok(!isPasteNewlineKey(key("enter", { alt: true })));
  assert.ok(!isPasteNewlineKey(key("char", { ch: "j" })));
  assert.ok(!isPasteNewlineKey(key("char", { ch: "a", ctrl: true })));
  assert.ok(!isPasteNewlineKey(key("char", { ch: "j", ctrl: true, shift: true })));
});

test("genuine_enter_is_submit", () => {
  const burst = new PasteBurst();
  assert.equal(burst.onEnter(false), "submit");
  assert.equal(burst.onEnter(false), "submit");
});

test("enter_with_pending_input_starts_burst", () => {
  const burst = new PasteBurst();
  assert.equal(burst.onEnter(true), "newline");
  assert.equal(burst.onEnter(false), "newline");
  assert.equal(burst.onEnter(false), "newline");
});

test("burst_ends_after_input_goes_quiet", () => {
  const burst = new PasteBurst();
  assert.equal(burst.onEnter(true), "newline");
  burst.onTimeout();
  assert.equal(burst.onEnter(false), "submit");
});

test("wait_timeout_shortens_during_burst", () => {
  const burst = new PasteBurst();
  const idle = burst.waitTimeoutMs();
  assert.equal(burst.onEnter(true), "newline");
  const active = burst.waitTimeoutMs();
  assert.ok(active < idle);
  burst.onTimeout();
  assert.equal(burst.waitTimeoutMs(), idle);
});
