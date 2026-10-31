import test from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { MessageRole, Session } from "../src/session/mod.ts";
import { gitStatusIsDirty } from "../src/ui/state.ts";
import { billableInputTokens } from "../src/pricing.ts";

test("estimate_tokens_empty", () => {
  assert.equal(Session.estimateTokens(""), 1);
});

test("estimate_tokens_short", () => {
  assert.equal(Session.estimateTokens("abc"), 1);
});

test("estimate_tokens_exact_divisible", () => {
  assert.equal(Session.estimateTokens("abcd"), 1);
});

test("estimate_tokens_rounds_down", () => {
  assert.equal(Session.estimateTokens("abcde"), 1);
});

test("estimate_tokens_long", () => {
  assert.equal(Session.estimateTokens("x".repeat(100)), 25);
});

test("estimate_tokens_cjk_not_undercounted_like_chars_div4", () => {
  const text = "今天天氣很好真開心"; 
  const est = Session.estimateTokens(text);
  assert.equal(est, 8); 
  assert.ok(est > Math.floor([...text].length / 4));
});

test("estimate_tokens_mixed_cjk_and_latin", () => {
  const text = "請幫我 refactor this function 好嗎";
  const wide = [...text].filter((c) => {
    const o = c.codePointAt(0)!;
    return o >= 0x2e80 && o <= 0x9fff;
  }).length;
  const est = Session.estimateTokens(text);
  assert.ok(est >= Math.floor((wide * 9) / 10));
});

test("estimate_tokens_pure_ascii_matches_old_formula", () => {
  const text = "the quick brown fox jumps over the lazy dog";
  assert.equal(Session.estimateTokens(text), Math.floor(text.length / 4));
});

test("effective_context_falls_back_without_calibration", () => {
  const s = Session.create("openai", "gpt-4", 128000, "");
  s.addMessage(MessageRole.User, "hello world this is a test message");
  assert.equal(s.effectiveContextTokens(), s.totalEstimatedTokens);
});

test("effective_context_uses_calibration_anchor_plus_delta", () => {
  const s = Session.create("openai", "gpt-4", 128000, "");
  s.addMessage(MessageRole.User, "first user message");
  s.addMessage(MessageRole.Assistant, "assistant reply");
  s.setCalibration(5000, 200); 
  assert.equal(s.calibratedMsgCount, 2);
  s.addMessage(MessageRole.User, "a follow up question");
  const delta = Session.estimateTokens("a follow up question");
  assert.equal(s.effectiveContextTokens(), 5200 + delta);
});

test("calibration_ignores_zero_usage", () => {
  const s = Session.create("openai", "gpt-4", 128000, "");
  s.addMessage(MessageRole.User, "msg");
  s.setCalibration(0, 0);
  assert.equal(s.calibratedTokens, 0);
  assert.equal(s.effectiveContextTokens(), s.totalEstimatedTokens);
});

test("real_input_tokens_native_route_adds_cache_fields", () => {
  assert.equal(Session.realInputTokens(true, 10, 7000, 0), 7010);
  assert.equal(Session.realInputTokens(true, 0, 7000, 0), 7000);
  assert.equal(Session.realInputTokens(true, 50, 0, 6000), 6050);
});

test("real_input_tokens_non_native_uses_input_only", () => {
  assert.equal(Session.realInputTokens(false, 7000, 5600, 0), 7000);
});

test("billable_input_tokens_native_prices_cache_tiers", () => {
  assert.equal(billableInputTokens(true, 100, 0, 6000), 7600);
  assert.equal(billableInputTokens(true, 100, 7000, 0), 800);
  assert.equal(billableInputTokens(true, 4, 6003, 6089), 8216);
});

test("billable_input_tokens_non_native_uses_input_only", () => {
  assert.equal(billableInputTokens(false, 7000, 5600, 4000), 7000);
});

function sessionWithMessages(n: number, len: number): Session {
  const s = Session.create("openai", "gpt-4", 128000, "");
  for (let i = 0; i < n; i++) s.addMessage(MessageRole.User, "x".repeat(len));
  return s;
}

test("compaction_cut_keeps_recent_within_budget", () => {
  const s = sessionWithMessages(4, 40);
  assert.equal(s.messages[0]!.estimatedTokens, 10);
  assert.equal(Session.selectCompactionCut(s.messages, 15), 2);
});

test("compaction_cut_oversized_keep_recent_summarizes_nothing", () => {
  const s = sessionWithMessages(4, 40);
  assert.equal(Session.selectCompactionCut(s.messages, 100), 0);
});

test("compaction_cut_zero_keep_recent_summarizes_all", () => {
  const s = sessionWithMessages(4, 40);
  assert.equal(Session.selectCompactionCut(s.messages, 0), 4);
});

test("compaction_cut_single_message_is_kept", () => {
  const s = sessionWithMessages(1, 40);
  assert.equal(Session.selectCompactionCut(s.messages, 5), 0);
});

test("new_session_has_id", () => {
  assert.ok(Session.create("openai", "gpt-4", 128000, "").id.length > 0);
});

test("new_session_sets_provider_and_model", () => {
  const s = Session.create("anthropic", "claude-sonnet", 200000, "");
  assert.equal(s.provider, "anthropic");
  assert.equal(s.model, "claude-sonnet");
});

test("new_session_sets_context_window", () => {
  assert.equal(Session.create("openai", "gpt-4", 128000, "").contextWindow, 128000);
});

test("new_session_sets_working_dir", () => {
  assert.ok(Session.create("openai", "gpt-4", 128000, "").workingDir.length > 0);
});

test("new_session_has_timestamps", () => {
  const s = Session.create("openai", "gpt-4", 128000, "");
  assert.ok(s.createdAt.length > 0);
  assert.ok(s.updatedAt.length > 0);
});

test("new_session_starts_empty", () => {
  const s = Session.create("openai", "gpt-4", 128000, "");
  assert.equal(s.messages.length, 0);
  assert.equal(s.compactions.length, 0);
  assert.equal(s.totalEstimatedTokens, 0);
  assert.equal(s.totalInputTokens, 0);
  assert.equal(s.totalOutputTokens, 0);
  assert.equal(s.totalCost, 0);
});

test("add_message_appends", () => {
  const s = Session.create("openai", "gpt-4", 128000, "");
  s.addMessage(MessageRole.User, "hello");
  assert.equal(s.messages.length, 1);
  assert.equal(s.messages[0]!.role, MessageRole.User);
  assert.equal(s.messages[0]!.content, "hello");
});

test("add_message_increments_estimated_tokens", () => {
  const s = Session.create("openai", "gpt-4", 128000, "");
  const before = s.totalEstimatedTokens;
  s.addMessage(MessageRole.Assistant, "hello world, this is a test");
  assert.ok(s.totalEstimatedTokens > before);
});

test("add_message_updates_updated_at", async () => {
  const s = Session.create("openai", "gpt-4", 128000, "");
  const before = s.updatedAt;
  await new Promise((r) => setTimeout(r, 5));
  s.addMessage(MessageRole.User, "hi");
  assert.notEqual(s.updatedAt, before);
});

test("needs_compaction_when_over_threshold", () => {
  const s = Session.create("openai", "gpt-4", 1000, "");
  s.addMessage(MessageRole.User, "x".repeat(900 * 4));
  assert.ok(s.needsCompaction(200));
});

test("needs_compaction_when_under_threshold", () => {
  const s = Session.create("openai", "gpt-4", 1000, "");
  s.addMessage(MessageRole.User, "short");
  assert.ok(!s.needsCompaction(200));
});

test("needs_compaction_zero_context_window", () => {
  const s = Session.create("openai", "gpt-4", 0, "");
  assert.ok(!s.needsCompaction(200));
});

test("update_context_window_changes_value", () => {
  const s = Session.create("openai", "gpt-4", 128000, "");
  s.updateContextWindow(256000);
  assert.equal(s.contextWindow, 256000);
});

test("compacted_context_returns_none_without_compactions", () => {
  const s = Session.create("openai", "gpt-4", 128000, "");
  const [summary, index] = s.compactedContext();
  assert.equal(summary, null);
  assert.equal(index, 0);
});

test("compress_adds_compaction_entry", () => {
  const s = Session.create("openai", "gpt-4", 128000, "");
  s.addMessage(MessageRole.User, "msg1");
  s.addMessage(MessageRole.Assistant, "msg2");
  s.addMessage(MessageRole.User, "msg3");
  s.addMessage(MessageRole.Assistant, "msg4");
  s.compress("summary text", 2, 50);
  assert.equal(s.compactions.length, 1);
  assert.equal(s.compactions[0]!.summary, "summary text");
});

test("compress_inserts_summary_as_system_message", () => {
  const s = Session.create("openai", "gpt-4", 128000, "");
  s.addMessage(MessageRole.User, "msg1");
  s.addMessage(MessageRole.Assistant, "msg2");
  s.addMessage(MessageRole.User, "msg3");
  s.compress("compressed summary", 2, 30);
  assert.equal(s.messages[0]!.role, MessageRole.System);
  assert.equal(s.messages[0]!.content, "compressed summary");
});

test("compress_drains_messages_before_first_kept_index", () => {
  const s = Session.create("openai", "gpt-4", 128000, "");
  s.addMessage(MessageRole.User, "msg1");
  s.addMessage(MessageRole.Assistant, "msg2");
  s.addMessage(MessageRole.User, "msg3");
  s.addMessage(MessageRole.Assistant, "msg4");
  s.compress("summary", 2, 30);
  assert.equal(s.messages.length, 3);
  assert.equal(s.messages[0]!.role, MessageRole.System);
  assert.equal(s.messages[1]!.content, "msg3");
  assert.equal(s.messages[2]!.content, "msg4");
});

test("compacted_context_returns_summary_after_compress", () => {
  const s = Session.create("openai", "gpt-4", 128000, "");
  s.addMessage(MessageRole.User, "msg1");
  s.addMessage(MessageRole.Assistant, "msg2");
  s.compress("the summary", 1, 20);
  const [summary, index] = s.compactedContext();
  assert.equal(summary, "the summary");
  assert.equal(index, 1);
});

test("detect_git_branch_in_repo_returns_nonempty", () => {
  const b = Session.detectGitBranch(process.cwd());
  assert.ok(b !== null, "repo root should resolve a branch or commit");
  assert.ok(b!.length > 0);
});

test("detect_git_branch_outside_repo_is_none", () => {
  const p = path.join(os.tmpdir(), "tiny-crow-definitely-not-a-repo-xyz123");
  assert.equal(Session.detectGitBranch(p), null);
});

test("parse_porcelain_counts_changes_and_sync", () => {
  const out =
    "# branch.oid abc123\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n" +
    "1 M. N... 100644 100644 100644 aaa bbb staged.rs\n" +
    "1 .M N... 100644 100644 100644 aaa bbb modified.rs\n" +
    "1 .D N... 100644 100644 000000 aaa bbb deleted.rs\n" +
    "? untracked.rs\n";
  const g = Session.parsePorcelain(out);
  assert.equal(g.staged, 1);
  assert.equal(g.modified, 1);
  assert.equal(g.deleted, 1);
  assert.equal(g.untracked, 1);
  assert.equal(g.ahead, 2);
  assert.equal(g.behind, 1);
  assert.ok(gitStatusIsDirty(g));
});

test("rewind_to_truncates_and_records_restore_point", () => {
  const s = Session.create("openai", "gpt-4", 128000, "");
  s.addMessage(MessageRole.User, "first");
  s.addMessage(MessageRole.Assistant, "reply");
  s.addMessage(MessageRole.User, "second");
  s.addMessage(MessageRole.Assistant, "reply2");
  const removed = s.rewindTo(2);
  assert.equal(removed, 2);
  assert.equal(s.messages.length, 2);
  assert.equal(s.messages[0]!.content, "first");
  assert.equal(s.messages[1]!.content, "reply");
  assert.ok(s.rewindUndo !== null);
  assert.equal(
    s.totalEstimatedTokens,
    s.messages.reduce((sum, m) => sum + m.estimatedTokens, 0),
  );
});

test("rewind_to_at_or_past_end_is_a_noop", () => {
  const s = Session.create("openai", "gpt-4", 128000, "");
  s.addMessage(MessageRole.User, "only");
  assert.equal(s.rewindTo(1), 0);
  assert.equal(s.rewindTo(5), 0);
  assert.equal(s.messages.length, 1);
  assert.equal(s.rewindUndo, null);
});

test("redo_restores_the_messages_a_rewind_removed", () => {
  const s = Session.create("openai", "gpt-4", 128000, "");
  s.addMessage(MessageRole.User, "first");
  s.addMessage(MessageRole.Assistant, "reply");
  s.addMessage(MessageRole.User, "second");
  const before = s.messages.map((m) => m.content);
  const estBefore = s.totalEstimatedTokens;
  s.rewindTo(1);
  assert.equal(s.messages.length, 1);
  assert.ok(s.redo());
  assert.deepEqual(s.messages.map((m) => m.content), before);
  assert.equal(s.totalEstimatedTokens, estBefore);
  assert.ok(!s.redo());
});

test("adding_a_message_invalidates_the_redo_point", () => {
  const s = Session.create("openai", "gpt-4", 128000, "");
  s.addMessage(MessageRole.User, "first");
  s.addMessage(MessageRole.Assistant, "reply");
  s.addMessage(MessageRole.User, "second");
  s.rewindTo(1);
  assert.ok(s.rewindUndo !== null);
  s.addMessage(MessageRole.User, "a fresh direction");
  assert.equal(s.rewindUndo, null);
  assert.ok(!s.redo());
});
