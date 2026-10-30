import test from "node:test";
import assert from "node:assert/strict";
import { canonicalToolName } from "../../src/extras/hooks/mod.ts";

test("bash_lowercase_is_idempotent", () => {
  assert.equal(canonicalToolName("Bash"), "bash");
  assert.equal(canonicalToolName("bash"), "bash");
});

test("glob_maps_to_find_files", () => {
  assert.equal(canonicalToolName("Glob"), "find_files");
  assert.equal(canonicalToolName("find_files"), "find_files");
});

test("task_lowercase_is_idempotent", () => {
  assert.equal(canonicalToolName("Task"), "task");
  assert.equal(canonicalToolName("task"), "task");
});

test("todo_write_maps_from_todo_write_camel", () => {
  assert.equal(canonicalToolName("TodoWrite"), "todo_write");
  assert.equal(canonicalToolName("todo_write"), "todo_write");
});

test("web_fetch_maps_from_camel", () => {
  assert.equal(canonicalToolName("WebFetch"), "web_fetch");
});

test("web_search_maps_from_camel", () => {
  assert.equal(canonicalToolName("WebSearch"), "web_search");
});

test("edit_and_write_lowercase_are_idempotent", () => {
  assert.equal(canonicalToolName("Edit"), "edit");
  assert.equal(canonicalToolName("Write"), "write");
});

test("unknown_tool_names_pass_through_lowercased", () => {
  assert.equal(canonicalToolName("Read"), "read");
  assert.equal(canonicalToolName("grep"), "grep");
});
