import test from "node:test";
import assert from "node:assert/strict";
import {
  filterToolsByAllowlist,
  type DynamicTool,
} from "../src/agent/builder.ts";

function makeTools(names: string[]): DynamicTool[] {
  return names.map((name) => ({ name, description: "", parameters: {}, call: async () => "" }));
}
function toolNames(tools: DynamicTool[]): string[] {
  return tools.map((t) => t.name);
}

test("empty_allowlist_passes_all_tools_through", () => {
  const tools = makeTools(["read", "write", "bash"]);
  assert.deepEqual(toolNames(filterToolsByAllowlist(tools, [])), ["read", "write", "bash"]);
});

test("allowlist_retains_only_matching_tools", () => {
  const tools = makeTools(["read", "write", "bash", "grep"]);
  assert.deepEqual(toolNames(filterToolsByAllowlist(tools, ["read", "grep"])), ["read", "grep"]);
});

test("unknown_names_in_allowlist_are_ignored", () => {
  const tools = makeTools(["read", "write"]);
  assert.deepEqual(toolNames(filterToolsByAllowlist(tools, ["read", "bogus"])), ["read"]);
});

test("allowlist_with_no_matches_returns_empty", () => {
  const tools = makeTools(["read", "write"]);
  assert.deepEqual(filterToolsByAllowlist(tools, ["bash", "grep"]), []);
});

test("single_tool_allowlist", () => {
  const tools = makeTools(["read", "write", "bash"]);
  assert.deepEqual(toolNames(filterToolsByAllowlist(tools, ["bash"])), ["bash"]);
});
