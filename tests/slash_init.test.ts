import test from "node:test";
import assert from "node:assert/strict";
import { AGENTS_CREATION_PROMPT } from "../src/ui/slash/init.ts";

test("test_prompt_is_non_empty", () => {
  assert.ok(AGENTS_CREATION_PROMPT.length > 0);
});

test("test_prompt_contains_key_phrases", () => {
  assert.ok(AGENTS_CREATION_PROMPT.includes("AGENTS.md"));
  assert.ok(AGENTS_CREATION_PROMPT.includes("build"));
  assert.ok(AGENTS_CREATION_PROMPT.includes("test"));
  assert.ok(AGENTS_CREATION_PROMPT.includes("coding agent"));
});

test("test_prompt_starts_with_create", () => {
  assert.ok(AGENTS_CREATION_PROMPT.startsWith("Create an AGENTS.md"));
});
