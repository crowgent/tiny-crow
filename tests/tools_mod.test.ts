import test from "node:test";
import assert from "node:assert/strict";
import {
  denyRepeatedReads,
  isSkipDir,
  setDenyRepeatedReads,
  trackRead,
  untrackReadPath,
} from "../src/agent/tools/mod.ts";
import { FindFilesTool } from "../src/agent/tools/find_files.ts";
import { SYSTEM_PROMPT } from "../src/agent/prompt.ts";
import { EXPLORE_PROMPT } from "../src/extras/subagents/prompt.ts";

// Tests touching the global deny-repeated-reads flag / read tracker share
// process-wide state, so they run sequentially within this file.
test("skip_node_modules", () => {
  assert.ok(isSkipDir("node_modules"));
});

test("skip_target", () => {
  assert.ok(isSkipDir("target"));
});

test("skip_case_sensitive", () => {
  assert.ok(!isSkipDir("Node_Modules"));
  assert.ok(!isSkipDir("TARGET"));
});

test("skip_other_dirs", () => {
  assert.ok(!isSkipDir("src"));
  assert.ok(!isSkipDir(""));
  assert.ok(!isSkipDir("node_modules_extra"));
});

test("track_read_returns_none_when_deny_disabled", () => {
  setDenyRepeatedReads(false);
  untrackReadPath("test_path");
  assert.equal(trackRead("test_path", 0, 10), undefined);
  setDenyRepeatedReads(true);
});

test("track_read_first_call_returns_none", () => {
  setDenyRepeatedReads(true);
  untrackReadPath("test_path");
  assert.equal(trackRead("test_path", 1, 100), undefined);
});

test("track_read_duplicate_returns_blocking_message", () => {
  setDenyRepeatedReads(true);
  untrackReadPath("dup_path");
  assert.equal(trackRead("dup_path", 5, 50), undefined);
  const second = trackRead("dup_path", 5, 50);
  assert.ok(second !== undefined);
  assert.ok(second.includes("already read"));
  assert.ok(second.includes("dup_path"));
});

test("track_read_different_offset_not_duplicate", () => {
  setDenyRepeatedReads(true);
  untrackReadPath("diff_path");
  assert.equal(trackRead("diff_path", 0, 100), undefined);
  assert.equal(trackRead("diff_path", 10, 100), undefined);
});

test("track_read_different_limit_not_duplicate", () => {
  setDenyRepeatedReads(true);
  untrackReadPath("diff_path2");
  assert.equal(trackRead("diff_path2", 0, 100), undefined);
  assert.equal(trackRead("diff_path2", 0, 200), undefined);
});

test("untrack_removes_matching_path", () => {
  setDenyRepeatedReads(true);
  trackRead("remove_me", 0, 10);
  untrackReadPath("remove_me");
  assert.equal(trackRead("remove_me", 0, 10), undefined);
});

test("untrack_does_not_affect_other_paths", () => {
  setDenyRepeatedReads(true);
  trackRead("keep_me", 0, 10);
  trackRead("unrelated", 0, 10);
  untrackReadPath("unrelated");
  assert.ok(trackRead("keep_me", 0, 10) !== undefined);
});

test("deny_repeated_reads_default", () => {
  setDenyRepeatedReads(true);
  assert.ok(denyRepeatedReads());
});

test("set_deny_repeated_reads_toggle", () => {
  setDenyRepeatedReads(false);
  assert.ok(!denyRepeatedReads());
  setDenyRepeatedReads(true);
  assert.ok(denyRepeatedReads());
});

test("find_files_descriptors_say_regex_not_glob", () => {
  const tool = new FindFilesTool(null, null, 100);
  const desc = tool.description();
  assert.ok(desc.includes("regex"), `find_files description should say regex, got: ${desc}`);
  assert.ok(!desc.toLowerCase().includes("glob"), `find_files description must not say glob, got: ${desc}`);
  const params = tool.parameters() as Record<string, unknown>;
  const props = params["properties"] as Record<string, Record<string, unknown>>;
  const patternDesc = String(props["pattern"]?.["description"] ?? "");
  assert.ok(patternDesc.includes("Regex"), `find_files pattern param should say Regex, got: ${patternDesc}`);
});

test("system_and_explore_prompts_describe_find_files_as_regex", () => {
  for (const prompt of [SYSTEM_PROMPT, EXPLORE_PROMPT]) {
    const line = prompt.split("\n").find((l) => l.includes("**find_files**")) ?? "";
    assert.ok(line.includes("regex"), `prompt find_files line should say regex, got: ${line}`);
    assert.ok(!line.toLowerCase().includes("glob pattern"), `prompt find_files line must not say glob pattern, got: ${line}`);
  }
});
