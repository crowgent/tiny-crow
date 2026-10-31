import test from "node:test";
import assert from "node:assert/strict";
import { parseCliArgs } from "../src/cli.ts";
import {
  buildStderrFilter,
  crashLogDir,
  resolveCrashLogPath,
  resolveLogPath,
} from "../src/logging.ts";

function parseCli(args: string[]) {
  return parseCliArgs(args);
}

test("test_resolve_log_path_default_no_verbose", () => {
  const cli = parseCli([]);
  assert.equal(resolveLogPath(cli), undefined);
});

test("test_resolve_log_path_verbose", () => {
  const cli = parseCli(["-v"]);
  const logPath = resolveLogPath(cli);
  assert.ok(logPath !== undefined);
  assert.ok(logPath.includes("tiny-crow-"));
  assert.ok(logPath.endsWith(".log"));
  assert.ok(logPath.includes(String(process.pid)));
});

test("test_resolve_log_path_cli_override", () => {
  const cli = parseCli(["--log-file", "/tmp/test-tiny-crow.log"]);
  assert.equal(resolveLogPath(cli), "/tmp/test-tiny-crow.log");
});

test("test_resolve_log_path_cli_overrides_verbose", () => {
  const cli = parseCli(["-v", "--log-file", "/tmp/override.log"]);
  assert.equal(resolveLogPath(cli), "/tmp/override.log");
});

test("test_build_stderr_filter_default", () => {
  const cli = parseCli([]);
  assert.equal(buildStderrFilter(cli), "warn");
});

test("test_build_stderr_filter_log_level", () => {
  const cli = parseCli(["--log-level", "info"]);
  assert.equal(buildStderrFilter(cli), "info");
});

test("test_build_stderr_filter_invalid_log_level_does_not_panic", () => {
  const cli = parseCli(["--log-level", "invalid"]);
  const filter = buildStderrFilter(cli);
  assert.ok(typeof filter === "string");
});

test("test_verbose_flag_is_false_by_default", () => {
  assert.ok(!parseCli([]).verbose);
});

test("test_verbose_flag_set", () => {
  assert.ok(parseCli(["-v"]).verbose);
});

test("test_verbose_flag_long_form", () => {
  assert.ok(parseCli(["--verbose"]).verbose);
});

test("test_crash_log_path_format", () => {
  const s = resolveCrashLogPath();
  assert.ok(s.includes("crashes"));
  
  assert.ok(s.includes("tiny-crow-crash-"));
  assert.ok(s.endsWith(".log"));
  assert.ok(s.includes(String(process.pid)));
});

test("test_crash_log_dir_is_under_data_logs", () => {
  const dir = crashLogDir();
  assert.ok(dir.includes("logs"));
  assert.ok(dir.endsWith("crashes"));
});
