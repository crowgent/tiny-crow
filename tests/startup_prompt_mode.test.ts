import test from "node:test";
import assert from "node:assert/strict";
import { resolveStartupPromptMode, SecurityMode } from "../src/permission/mod.ts";

function prompts(entries: Array<[string, string]>): Map<string, string> {
  return new Map(entries);
}

test("mode_directive_resolves_to_security_mode", () => {
  const map = prompts([
    ["review", "%%mode=readonly\nReview the code."],
    ["plan", "%%mode=planwrite\nPlan the work."],
  ]);
  assert.equal(resolveStartupPromptMode(map, "review"), SecurityMode.ReadOnly);
  assert.equal(resolveStartupPromptMode(map, "plan"), SecurityMode.PlanWrite);
});

test("last_user_mode_yields_none_at_startup", () => {
  const map = prompts([["code", "%%mode=last_user_mode\nYou are a coder."]]);
  assert.equal(resolveStartupPromptMode(map, "code"), null);
});

test("prompt_without_directive_yields_none", () => {
  const map = prompts([["code", "You are a coder."]]);
  assert.equal(resolveStartupPromptMode(map, "code"), null);
});

test("unknown_prompt_yields_none", () => {
  const map = prompts([["code", "%%mode=readonly\nYou are a coder."]]);
  assert.equal(resolveStartupPromptMode(map, "missing"), null);
});

test("unrecognized_mode_name_yields_none", () => {
  const map = prompts([["weird", "%%mode=bogus\nBody."]]);
  assert.equal(resolveStartupPromptMode(map, "weird"), null);
});

test("directive_is_only_read_from_the_first_line", () => {
  const map = prompts([["code", "You are a coder.\n%%mode=readonly"]]);
  assert.equal(resolveStartupPromptMode(map, "code"), null);
});
