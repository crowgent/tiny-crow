import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { McpClientHandle } from "../src/extras/mcp/client.ts";
import {
  DEFAULT_CONNECT_RETRIES,
  DEFAULT_CONNECT_TIMEOUT_SECS,
  DEFAULT_TOOL_TIMEOUT_SECS,
  mcpConnectRetries,
  mcpConnectTimeoutMs,
  mcpServerConfigToJson,
  mcpToolTimeoutMs,
  parseMcpServerConfig,
  type McpServerConfig,
} from "../src/extras/mcp/config.ts";
import { mcpDynamicTool } from "../src/extras/mcp/tool.ts";

function commandConfig(
  command: string,
  args: string[],
  connectTimeoutSecs: number | null,
  toolTimeoutSecs: number | null,
  connectRetries: number | null,
): McpServerConfig {
  return {
    kind: "command",
    command,
    args,
    env: {},
    connectTimeoutSecs,
    toolTimeoutSecs,
    connectRetries,
  };
}

test("timeout_defaults_apply_when_unset", () => {
  const cfg = commandConfig("true", [], null, null, null);
  assert.equal(mcpConnectTimeoutMs(cfg), DEFAULT_CONNECT_TIMEOUT_SECS * 1000);
  assert.equal(mcpToolTimeoutMs(cfg), DEFAULT_TOOL_TIMEOUT_SECS * 1000);
  assert.equal(mcpConnectRetries(cfg), DEFAULT_CONNECT_RETRIES);
  assert.equal(DEFAULT_CONNECT_TIMEOUT_SECS, 10);
  assert.equal(DEFAULT_TOOL_TIMEOUT_SECS, 20);
  assert.equal(DEFAULT_CONNECT_RETRIES, 1);
});

test("timeout_overrides_apply_when_set", () => {
  const cfg = commandConfig("true", [], 3, 7, 5);
  assert.equal(mcpConnectTimeoutMs(cfg), 3000);
  assert.equal(mcpToolTimeoutMs(cfg), 7000);
  assert.equal(mcpConnectRetries(cfg), 5);
});

test("timeout_fields_parse_from_toml", () => {
  
  const cfg = parseMcpServerConfig({
    command: "npx",
    args: ["-y", "some-mcp-server"],
    connect_timeout_secs: 4,
    tool_timeout_secs: 9,
    connect_retries: 2,
  });
  assert.equal(mcpConnectTimeoutMs(cfg), 4000);
  assert.equal(mcpToolTimeoutMs(cfg), 9000);
  assert.equal(mcpConnectRetries(cfg), 2);
});

test("timeout_fields_optional_in_toml_for_url_servers", () => {
  const cfg = parseMcpServerConfig({ url: "https://example.com/mcp" });
  assert.equal(mcpConnectTimeoutMs(cfg), DEFAULT_CONNECT_TIMEOUT_SECS * 1000);
  assert.equal(mcpToolTimeoutMs(cfg), DEFAULT_TOOL_TIMEOUT_SECS * 1000);
  assert.equal(mcpConnectRetries(cfg), DEFAULT_CONNECT_RETRIES);
});

test("timeout_fields_survive_serde_round_trip", () => {
  const cfg = commandConfig("true", [], 2, 8, 3);
  const back = parseMcpServerConfig(mcpServerConfigToJson(cfg));
  assert.equal(mcpConnectTimeoutMs(back), 2000);
  assert.equal(mcpToolTimeoutMs(back), 8000);
  assert.equal(mcpConnectRetries(back), 3);
});

test("connect_times_out_on_unresponsive_server", async () => {
  const cfg = commandConfig("sleep", ["60"], 1, null, 0);
  const start = Date.now();
  await assert.rejects(McpClientHandle.connect("slow-server", cfg), /timed out/);
  assert.ok(Date.now() - start < 10000, "timeout took too long");
});

test("connect_retries_failed_attempts", async () => {
  const dir = path.join(os.tmpdir(), `tiny-crow-mcp-retry-${process.pid}`);
  fs.mkdirSync(dir, { recursive: true });
  const marker = path.join(dir, "attempts");
  fs.rmSync(marker, { force: true });
  try {
    const cfg = commandConfig("sh", ["-c", `echo attempt >> '${marker}'; exit 1`], 1, null, 1);
    await assert.rejects(McpClientHandle.connect("flaky-server", cfg));
    const attempts = fs.readFileSync(marker, "utf8").split("\n").filter(Boolean).length;
    assert.equal(attempts, 2, "expected 1 initial attempt + 1 retry");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("connect_retries_zero_means_single_attempt", async () => {
  const dir = path.join(os.tmpdir(), `tiny-crow-mcp-noretry-${process.pid}`);
  fs.mkdirSync(dir, { recursive: true });
  const marker = path.join(dir, "attempts");
  fs.rmSync(marker, { force: true });
  try {
    const cfg = commandConfig("sh", ["-c", `echo attempt >> '${marker}'`], 1, null, 0);
    await assert.rejects(McpClientHandle.connect("one-shot-server", cfg));
    const attempts = fs.readFileSync(marker, "utf8").split("\n").filter(Boolean).length;
    assert.equal(attempts, 1, "connect_retries = 0 means a single attempt");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("tool_call_on_dead_server_reports_reconnect_failure", async () => {
  const cfg = commandConfig("sh", ["-c", "exit 0"], 2, 1, 0);
  let handle: McpClientHandle;
  try {
    handle = await McpClientHandle.connect("dead-server", cfg);
  } catch {

    return;
  }
  await new Promise((r) => setTimeout(r, 300));
  let current: McpClientHandle = handle;
  const handleRef = {
    getHandle: () => current,
    reconnect: async () => {
      current = await McpClientHandle.connect("dead-server", cfg);
      return current;
    },
  };
  const tool = mcpDynamicTool("dead-server", { name: "noop", description: "noop", inputSchema: { type: "object", properties: {} } }, handleRef, null, null);
  await assert.rejects(tool.call({}), /dead-server/);
});
