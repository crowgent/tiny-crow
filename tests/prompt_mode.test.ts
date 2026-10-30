import test from "node:test";
import assert from "node:assert/strict";
import { applyPromptMode } from "../src/ui/mod.ts";
import type { ContextFiles, PermCheck } from "../src/ui/state.ts";
import { PermissionChecker } from "../src/permission/checker.ts";
import { SecurityMode } from "../src/permission/mod.ts";
import { Session } from "../src/session/mod.ts";

function makeSession(): Session {
  return Session.create("openai", "gpt-4", 128000, "");
}

function makeContext(prompts: [string, string][]): ContextFiles {
  return {
    prompts: new Map(prompts),
    extraPromptsDirs: [],
    themes: new Map(),
    chainDeclined: [],
    reload: () => {},
  } as unknown as ContextFiles;
}

function makePerm(mode: string): PermissionChecker {
  return new PermissionChecker({ glob: {}, regex: {} }, mode as never);
}
function currentMode(perm: PermissionChecker): string {
  return perm.mode();
}
function asPerm(perm: PermissionChecker): PermCheck {
  return perm as unknown as PermCheck;
}

test("prompt_without_directive_keeps_content_and_mode_untouched", () => {
  const context = makeContext([["code", "You are a coder."]]);
  const session = makeSession();
  const perm = makePerm(SecurityMode.Standard);
  const outcome = applyPromptMode("code", context, session as never, asPerm(perm));
  assert.deepEqual(outcome, { kind: "none" });
  assert.equal(context.currentPrompt, "You are a coder.");
  assert.equal(context.currentPromptName, "code");
  assert.equal(currentMode(perm), SecurityMode.Standard);
  assert.equal((session.prompt as { name: string } | undefined)?.name, "code");
});

test("mode_directive_is_stripped_and_applied", () => {
  const context = makeContext([["review", "%%mode=readonly\nReview the code."]]);
  const session = makeSession();
  const perm = makePerm(SecurityMode.Standard);
  const outcome = applyPromptMode("review", context, session as never, asPerm(perm));
  assert.deepEqual(outcome, { kind: "applied", mode: SecurityMode.ReadOnly });
  assert.equal(context.currentPrompt, "Review the code.");
  assert.equal(context.currentPromptName, "review");
  assert.equal(currentMode(perm), SecurityMode.ReadOnly);
  assert.equal((session.prompt as { name: string } | undefined)?.name, "review");
});

test("last_user_mode_restores_the_user_selected_mode", () => {
  const context = makeContext([
    ["review", "%%mode=readonly\nReview the code."],
    ["code", "%%mode=last_user_mode\nYou are a coder."],
  ]);
  const session = makeSession();
  const perm = makePerm(SecurityMode.Guarded);
  applyPromptMode("review", context, session as never, asPerm(perm));
  assert.equal(currentMode(perm), SecurityMode.ReadOnly);
  assert.equal((session.prompt as { name: string } | undefined)?.name, "review");
  const outcome = applyPromptMode("code", context, session as never, asPerm(perm));
  assert.deepEqual(outcome, { kind: "restored_user_mode" });
  assert.equal(currentMode(perm), SecurityMode.Guarded);
  assert.equal(context.currentPrompt, "You are a coder.");
  assert.equal(context.currentPromptName, "code");
  assert.equal((session.prompt as { name: string } | undefined)?.name, "code");
});

test("unknown_prompt_is_a_noop", () => {
  const context = makeContext([["code", "You are a coder."]]);
  const session = makeSession();
  const perm = makePerm(SecurityMode.Standard);
  const outcome = applyPromptMode("missing", context, session as never, asPerm(perm));
  assert.deepEqual(outcome, { kind: "none" });
  assert.equal(context.currentPrompt, undefined);
  assert.equal(context.currentPromptName, undefined);
  assert.equal(currentMode(perm), SecurityMode.Standard);
  assert.equal(session.prompt, undefined);
});

test("unrecognized_mode_strips_directive_but_keeps_current_mode", () => {
  const context = makeContext([["weird", "%%mode=bogus\nBody."]]);
  const session = makeSession();
  const perm = makePerm(SecurityMode.Standard);
  const outcome = applyPromptMode("weird", context, session as never, asPerm(perm));
  assert.deepEqual(outcome, { kind: "none" });
  assert.equal(context.currentPrompt, "Body.");
  assert.equal(context.currentPromptName, "weird");
  assert.equal(currentMode(perm), SecurityMode.Standard);
});

test("without_permission_checker_prompt_is_still_selected", () => {
  const context = makeContext([["review", "%%mode=readonly\nReview the code."]]);
  const session = makeSession();
  const outcome = applyPromptMode("review", context, session as never, null);
  assert.deepEqual(outcome, { kind: "none" });
  assert.equal(context.currentPrompt, "Review the code.");
  assert.equal(context.currentPromptName, "review");
});

test("unknown_prompt_leaves_the_previous_record_untouched", () => {
  const context = makeContext([["code", "You are a coder."]]);
  const session = makeSession();
  const perm = makePerm(SecurityMode.Standard);
  applyPromptMode("code", context, session as never, asPerm(perm));
  applyPromptMode("missing", context, session as never, asPerm(perm));
  assert.equal((session.prompt as { name: string } | undefined)?.name, "code");
});
