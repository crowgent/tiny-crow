import test from "node:test";
import assert from "node:assert/strict";
import {
  chainPhaseFromPromptName,
  isChainPhaseEnabled,
  nextPromptName,
  parseChainDecision,
  transitionMessage,
  type ChainConfig,
} from "../src/extras/chain/mod.ts";
import { defaultChainConfig } from "../src/config/types.ts";

test("test_phase_from_prompt_name", () => {
  assert.equal(chainPhaseFromPromptName("brainstorm"), "brainstorm");
  assert.equal(chainPhaseFromPromptName("plan"), "plan");
  assert.equal(chainPhaseFromPromptName("code"), "code");
  assert.equal(chainPhaseFromPromptName("review"), null);
  assert.equal(chainPhaseFromPromptName("ask"), null);
  assert.equal(chainPhaseFromPromptName(""), null);
});

test("test_next_prompt_name", () => {
  assert.equal(nextPromptName("brainstorm"), "plan");
  assert.equal(nextPromptName("plan"), "code");
  assert.equal(nextPromptName("code"), "review");
});

test("test_transition_messages_are_not_empty", () => {
  assert.ok(transitionMessage("brainstorm").length > 0);
  assert.ok(transitionMessage("plan").length > 0);
  assert.ok(transitionMessage("code").length > 0);
});

test("test_parse_decision_yes", () => {
  assert.deepEqual(parseChainDecision("y"), { kind: "Accept", extra: null });
  assert.deepEqual(parseChainDecision("Y"), { kind: "Accept", extra: null });
  assert.deepEqual(parseChainDecision("yes"), { kind: "Accept", extra: null });
  assert.deepEqual(parseChainDecision("YES"), { kind: "Accept", extra: null });
});

test("test_parse_decision_no", () => {
  assert.deepEqual(parseChainDecision("n"), { kind: "Decline" });
  assert.deepEqual(parseChainDecision("no"), { kind: "Decline" });
  assert.deepEqual(parseChainDecision("N"), { kind: "Decline" });
  assert.deepEqual(parseChainDecision("NO"), { kind: "Decline" });
});

test("test_parse_decision_but", () => {
  assert.deepEqual(parseChainDecision("but add tests"), { kind: "Accept", extra: "add tests" });
  assert.deepEqual(parseChainDecision("b add tests"), { kind: "Accept", extra: "add tests" });
  assert.deepEqual(parseChainDecision("yes but add tests"), { kind: "Accept", extra: "add tests" });
  assert.deepEqual(parseChainDecision("y but add tests"), { kind: "Accept", extra: "add tests" });
  assert.deepEqual(parseChainDecision("BUT skip step 3"), { kind: "Accept", extra: "skip step 3" });
});

test("test_parse_decision_not_chain", () => {
  assert.deepEqual(parseChainDecision("what about testing?"), { kind: "NotChain" });
  assert.deepEqual(parseChainDecision("maybe"), { kind: "NotChain" });
  assert.deepEqual(parseChainDecision(""), { kind: "NotChain" });
});

test("test_parse_decision_but_empty_is_not_chain", () => {
  assert.deepEqual(parseChainDecision("but "), { kind: "NotChain" });
});

test("test_chain_config_defaults", () => {
  const cfg = defaultChainConfig();
  assert.ok(cfg.brainstormToPlan);
  assert.ok(cfg.planToCode);
  assert.ok(!cfg.codeToReview);
});

test("test_is_enabled_default_config", () => {
  const cfg = defaultChainConfig();
  assert.ok(isChainPhaseEnabled("brainstorm", cfg));
  assert.ok(isChainPhaseEnabled("plan", cfg));
  assert.ok(!isChainPhaseEnabled("code", cfg));
});

test("test_is_enabled_all_off", () => {
  const cfg: ChainConfig = { brainstormToPlan: false, planToCode: false, codeToReview: false };
  assert.ok(!isChainPhaseEnabled("brainstorm", cfg));
  assert.ok(!isChainPhaseEnabled("plan", cfg));
  assert.ok(!isChainPhaseEnabled("code", cfg));
});

test("test_is_enabled_all_on", () => {
  const cfg: ChainConfig = { brainstormToPlan: true, planToCode: true, codeToReview: true };
  assert.ok(isChainPhaseEnabled("brainstorm", cfg));
  assert.ok(isChainPhaseEnabled("plan", cfg));
  assert.ok(isChainPhaseEnabled("code", cfg));
});

test("test_is_enabled_only_review", () => {
  const cfg: ChainConfig = { brainstormToPlan: false, planToCode: false, codeToReview: true };
  assert.ok(!isChainPhaseEnabled("brainstorm", cfg));
  assert.ok(!isChainPhaseEnabled("plan", cfg));
  assert.ok(isChainPhaseEnabled("code", cfg));
});

test("test_full_progression_default_config", () => {
  const cfg = defaultChainConfig();
  const b = chainPhaseFromPromptName("brainstorm");
  assert.equal(b, "brainstorm");
  assert.ok(isChainPhaseEnabled(b!, cfg));
  assert.equal(nextPromptName(b!), "plan");
  const p = chainPhaseFromPromptName("plan");
  assert.equal(p, "plan");
  assert.ok(isChainPhaseEnabled(p!, cfg));
  assert.equal(nextPromptName(p!), "code");
  const c = chainPhaseFromPromptName("code");
  assert.equal(c, "code");
  assert.ok(!isChainPhaseEnabled(c!, cfg));
  assert.equal(nextPromptName(c!), "review");
});

test("test_full_progression_all_enabled", () => {
  const cfg: ChainConfig = { brainstormToPlan: true, planToCode: true, codeToReview: true };
  for (const name of ["brainstorm", "plan", "code"] as const) {
    const phase = chainPhaseFromPromptName(name);
    assert.ok(phase !== null);
    assert.ok(isChainPhaseEnabled(phase, cfg));
  }
});

test("test_parse_decision_but_variants_empty_is_not_chain", () => {
  assert.deepEqual(parseChainDecision("b "), { kind: "NotChain" });
  assert.deepEqual(parseChainDecision("yes but "), { kind: "NotChain" });
  assert.deepEqual(parseChainDecision("y but "), { kind: "NotChain" });
  assert.deepEqual(parseChainDecision("BUT "), { kind: "NotChain" });
});
