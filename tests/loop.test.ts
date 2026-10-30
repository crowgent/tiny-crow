import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  DEFAULT_PLAN_FILENAME,
  LoopState,
  SUMMARY_TRUNCATION_CHARS,
} from "../src/extras/loop/mod.ts";
import {
  deletePlan,
  handleStartup,
  planExists,
  readPlan,
} from "../src/extras/loop/plan.ts";
import {
  saveIteration,
  transcriptDir,
} from "../src/extras/loop/transcript.ts";

function loopTestDataDir(): string {
  const dir = path.join(os.tmpdir(), `zerostack-loop-tests-${process.pid}`);
  fs.mkdirSync(dir, { recursive: true });
  process.env.ZS_DATA_DIR = dir;
  return dir;
}

test("test_loop_state_new_defaults", () => {
  const ls = LoopState.new("fix bugs", "plan.md", null, null);
  assert.ok(ls.active);
  assert.equal(ls.prompt, "fix bugs");
  assert.equal(ls.planFile, "plan.md");
  assert.equal(ls.iteration, 0);
  assert.equal(ls.maxIterations, null);
  assert.equal(ls.lastSummary, null);
  assert.equal(ls.runCmd, null);
  assert.equal(ls.lastRunOutput, null);
});

test("test_loop_state_new_with_max", () => {
  const ls = LoopState.new("test", "p.md", 5, "make check");
  assert.equal(ls.maxIterations, 5);
  assert.equal(ls.runCmd, "make check");
});

test("test_should_stop_no_max", () => {
  const ls = LoopState.new("x", "p.md", null, null);
  assert.ok(!ls.shouldStop());
});

test("test_should_stop_with_max_not_reached", () => {
  const ls = LoopState.new("x", "p.md", 3, null);
  ls.iteration = 2;
  assert.ok(!ls.shouldStop());
});

test("test_should_stop_with_max_exactly_reached_still_runs", () => {
  const ls = LoopState.new("x", "p.md", 3, null);
  ls.iteration = 3;
  assert.ok(!ls.shouldStop());
});

test("test_should_stop_with_max_exceeded", () => {
  const ls = LoopState.new("x", "p.md", 3, null);
  ls.iteration = 4;
  assert.ok(ls.shouldStop());
});

test("test_iteration_label_no_max", () => {
  const ls = LoopState.new("x", "p.md", null, null);
  ls.iteration = 5;
  assert.equal(ls.iterationLabel(), "LOOP 5/∞");
});

test("test_iteration_label_with_max", () => {
  const ls = LoopState.new("x", "p.md", 10, null);
  ls.iteration = 3;
  assert.equal(ls.iterationLabel(), "LOOP 3/10");
});

test("test_build_prompt_contains_key_parts", () => {
  const ls = LoopState.new("implement feature X", DEFAULT_PLAN_FILENAME, 5, "cargo test");
  ls.iteration = 2;
  ls.lastSummary = "fixed parser bug";
  ls.lastRunOutput = "all tests passed";
  const prompt = ls.buildPrompt();
  assert.ok(prompt.includes("implement feature X"));
  assert.ok(prompt.includes("Iteration 2/5"));
  assert.ok(prompt.includes(DEFAULT_PLAN_FILENAME));
  assert.ok(prompt.includes("fixed parser bug"));
  assert.ok(prompt.includes("all tests passed"));
  assert.ok(prompt.includes("Choose ONE task from the plan"));
});

test("test_build_prompt_starting_fresh", () => {
  const ls = LoopState.new("task", "plan.md", null, null);
  const prompt = ls.buildPrompt();
  assert.ok(prompt.includes("starting fresh"));
  assert.ok(prompt.includes("(none)"));
  assert.ok(prompt.includes("Iteration 0/∞"));
});

test("test_summary_truncation_constant", () => {
  assert.ok(SUMMARY_TRUNCATION_CHARS > 0);
});

test("test_plan_exists_on_nonexistent", () => {
  const tmp = path.join(os.tmpdir(), "zerostack_test_plan_nonexistent.md");
  fs.rmSync(tmp, { force: true });
  assert.ok(!planExists(tmp));
});

test("test_plan_exists_on_existing", () => {
  const tmp = path.join(os.tmpdir(), "zerostack_test_plan_exists.md");
  try {
    fs.writeFileSync(tmp, "# Test plan");
    assert.ok(planExists(tmp));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

test("test_read_plan_returns_content", () => {
  const tmp = path.join(os.tmpdir(), "zerostack_test_read_plan.md");
  try {
    fs.writeFileSync(tmp, "item 1\nitem 2");
    assert.equal(readPlan(tmp), "item 1\nitem 2");
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

test("test_read_plan_nonexistent_returns_none", () => {
  const tmp = path.join(os.tmpdir(), "zerostack_test_read_nonexistent.md");
  fs.rmSync(tmp, { force: true });
  assert.equal(readPlan(tmp), null);
});

test("test_delete_plan_removes_file", () => {
  const tmp = path.join(os.tmpdir(), "zerostack_test_delete_plan.md");
  fs.writeFileSync(tmp, "data");
  assert.ok(fs.existsSync(tmp));
  deletePlan(tmp);
  assert.ok(!fs.existsSync(tmp));
});

test("test_delete_plan_nonexistent_does_not_panic", () => {
  const tmp = path.join(os.tmpdir(), "zerostack_test_delete_nonexistent.md");
  fs.rmSync(tmp, { force: true });
  deletePlan(tmp);
});

test("test_handle_startup_no_plan_returns_false", async () => {
  const tmp = path.join(os.tmpdir(), "zerostack_test_startup_nonexistent.md");
  fs.rmSync(tmp, { force: true });
  assert.ok(!(await handleStartup(tmp)));
});

test("test_transcript_dir_contains_session_id", () => {
  const dir = transcriptDir("test-session-123", "/tmp/zerostack-data");
  assert.ok(dir.endsWith("test-session-123"));
  assert.ok(dir.includes(path.join("loops", "test-session-123")));
});

test("test_save_iteration_creates_file", () => {
  const prev = process.env.ZS_DATA_DIR;
  const base = loopTestDataDir();
  const sessionId = "test-save-iteration";
  const dir = path.join(base, "loops", sessionId);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    saveIteration(sessionId, 1, "test prompt", "test response", "validation ok", "summary");
    const iterFile = path.join(dir, "iter-0001.json");
    assert.ok(fs.existsSync(iterFile));
    const content = fs.readFileSync(iterFile, "utf8");
    assert.ok(content.includes("test prompt"));
    assert.ok(content.includes("test response"));
    assert.ok(content.includes("validation ok"));
    assert.ok(content.includes("summary"));
    assert.ok(content.includes('"iteration": 1'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    if (prev === undefined) delete process.env.ZS_DATA_DIR;
    else process.env.ZS_DATA_DIR = prev;
  }
});

test("test_save_iteration_without_validation_output", () => {
  const prev = process.env.ZS_DATA_DIR;
  const base = loopTestDataDir();
  const sessionId = "test-save-no-validation";
  const dir = path.join(base, "loops", sessionId);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    saveIteration(sessionId, 2, "p", "r", null, "s");
    const content = fs.readFileSync(path.join(dir, "iter-0002.json"), "utf8");
    // TS serialises the field in camelCase (Rust: validation_output).
    assert.ok(content.includes('"validationOutput": null'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    if (prev === undefined) delete process.env.ZS_DATA_DIR;
    else process.env.ZS_DATA_DIR = prev;
  }
});
