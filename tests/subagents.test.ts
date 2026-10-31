import test from "node:test";
import assert from "node:assert/strict";
import { combineResults, TaskTool, type TaskArgs } from "../src/extras/subagents/task_tool.ts";
import { truncateCjk } from "../src/extras/truncate.ts";

test("task_args_deserializes_multiple_prompts", () => {
  const args = JSON.parse(`{"prompts": ["explore auth module", "find api routes"]}`) as TaskArgs;
  assert.equal(args.prompts.length, 2);
  assert.equal(args.prompts[0], "explore auth module");
  assert.equal(args.prompts[1], "find api routes");
});

test("task_args_single_prompt", () => {
  const args = JSON.parse(`{"prompts": ["one thing"]}`) as TaskArgs;
  assert.equal(args.prompts.length, 1);
  assert.equal(args.prompts[0], "one thing");
});

test("task_args_empty_prompts_deserializes", async () => {
  
  const args = JSON.parse(`{"prompts": []}`) as TaskArgs;
  assert.ok(args.prompts.length === 0);
  await assert.rejects(new TaskTool().call(args), /prompts must not be empty/);
});

test("task_args_missing_prompts_is_error", () => {
  const args = JSON.parse(`{}`) as Partial<TaskArgs>;
  assert.equal(args.prompts, undefined);
});

const CAP = 128 * 1024;
const MARKER = "\n…[subagent response truncated at 131072B]";

test("truncate_response_preserves_short_string", () => {
  assert.equal(truncateCjk("hello world", CAP, MARKER), "hello world");
});

test("truncate_response_caps_long_string", () => {
  const s = "x".repeat(200 * 1024);
  const result = truncateCjk(s, CAP, MARKER);
  assert.ok(Buffer.byteLength(result, "utf8") <= 128 * 1024 + 64);
  assert.ok(result.includes("[subagent response truncated"));
});

test("truncate_response_does_not_panic_on_cjk", () => {
  const cjk = "記憶".repeat(50 * 1024);
  const result = truncateCjk(cjk, CAP, MARKER);
  assert.ok(result.includes("[subagent response truncated"));
});

test("truncate_response_starts_with_prefix_of_original", () => {
  assert.ok(truncateCjk("AAAABBBBCCCCDDDD", CAP, MARKER).startsWith("AAAABB"));
});

test("combine_single_result_no_heading", () => {
  const combined = combineResults([[0, "explore auth", "Found auth module"]]);
  assert.equal(combined, "Found auth module\n");
  assert.ok(!combined.includes("Task"));
});

test("combine_multiple_results_with_headings", () => {
  const combined = combineResults([
    [0, "explore auth", "Found auth"],
    [1, "find routes", "3 routes found"],
  ]);
  assert.ok(combined.includes("## Task 1:"));
  assert.ok(combined.includes("## Task 2:"));
  assert.ok(combined.includes("Found auth"));
  assert.ok(combined.includes("3 routes found"));
});

test("combine_results_sorted_by_index", () => {
  const combined = combineResults([
    [0, "first", "A"],
    [1, "second", "B"],
  ]);
  assert.ok(combined.indexOf("A") < combined.indexOf("B"));
});

test("combine_error_result_is_preserved", () => {
  assert.ok(combineResults([[0, "prompt", "[error: something went wrong]"]]).includes("[error: something went wrong]"));
});

test("combine_timeout_result_is_preserved", () => {
  assert.ok(combineResults([[0, "prompt", "[timeout: subagent exceeded 300s]"]]).includes("[timeout: subagent exceeded 300s]"));
});

test("combine_result_ensures_trailing_newline", () => {
  assert.ok(combineResults([[0, "p", "no trailing newline"]]).endsWith("\n"));
});

test("combine_result_already_has_newline_no_double", () => {
  const combined = combineResults([[0, "p", "already has newline\n"]]);
  assert.ok(combined.endsWith("\n"));
  assert.equal(combined.trimEnd(), "already has newline");
});

test("combine_empty_outputs", () => {
  assert.equal(combineResults([]), "");
});

test("combine_long_prompt_label_truncated_to_60_chars", () => {
  const combined = combineResults([
    [0, "x".repeat(100), "result"],
    [1, "second", "B"],
  ]);
  const headingLine = combined.split("\n")[0]!;
  assert.ok(headingLine.length <= "## Task 1: ".length + 60);
});
