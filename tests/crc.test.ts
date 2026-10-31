import test from "node:test";
import assert from "node:assert/strict";
import { crc32, crc32Hex } from "../src/agent/tools/crc.ts";

const enc = (s: string) => new TextEncoder().encode(s);

test("test_crc32_empty", () => {
  assert.equal(crc32(enc("")), 0x00000000);
});

test("test_crc32_hello", () => {
  assert.equal(crc32(enc("hello")), 0x3610a686);
  assert.equal(crc32Hex(enc("hello")), "3610a686");
});

test("test_crc32_deterministic", () => {
  assert.equal(crc32(enc("same string")), crc32(enc("same string")));
});

test("test_crc32_different", () => {
  assert.notEqual(crc32(enc("hello")), crc32(enc("world")));
});
