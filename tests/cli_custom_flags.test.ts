import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeCliMcp,
  parseCliArgs,
  resolvePromptsDirs,
  type Cli,
} from "../src/cli.ts";
import { configFromJson, defaultConfig } from "../src/config/mod.ts";

function cliWith(args: string[]): Cli {
  // TS parseCliArgs takes the argument list without the program name.
  return parseCliArgs(args);
}

test("custom_mcp_stdio_merges_over_config", () => {
  const cli = cliWith(["--custom-mcp", "fs=npx -y server-fs ."]);
  const cfg = defaultConfig();
  mergeCliMcp(cli, cfg);
  const servers = cfg.mcpServers!;
  assert.equal(Object.keys(servers).length, 1);
  const srv = servers["fs"] as unknown as { command: string; args: string[] };
  assert.equal(srv.command, "npx");
  assert.deepEqual(srv.args, ["-y", "server-fs", "."]);
});

test("custom_mcp_http_merges_over_config", () => {
  const cli = cliWith(["--custom-mcp-http", "exa=https://mcp.exa.ai/mcp"]);
  const cfg = defaultConfig();
  mergeCliMcp(cli, cfg);
  const servers = cfg.mcpServers!;
  const srv = servers["exa"] as unknown as { url: string };
  assert.ok(typeof srv.url === "string" && srv.url.length > 0);
});

test("custom_mcp_cli_overrides_same_named_config_entry", () => {
  const cli = cliWith(["--custom-mcp-http", "srv=https://cli.example/mcp"]);
  const cfg = configFromJson({ mcp_servers: { srv: { command: "old-cmd" } } });
  mergeCliMcp(cli, cfg);
  const srv = cfg.mcpServers!["srv"] as unknown as { url: string };
  assert.equal(srv.url, "https://cli.example/mcp");
});

test("custom_mcp_later_flag_wins_for_same_name", () => {
  const cli = cliWith(["--custom-mcp", "srv=first-cmd", "--custom-mcp", "srv=second-cmd --flag"]);
  const cfg = defaultConfig();
  mergeCliMcp(cli, cfg);
  const srv = cfg.mcpServers!["srv"] as unknown as { command: string; args: string[] };
  assert.equal(srv.command, "second-cmd");
  assert.deepEqual(srv.args, ["--flag"]);
});

test("custom_mcp_invalid_entry_is_an_error", () => {
  const cli = cliWith(["--custom-mcp", "no-equals-here"]);
  const cfg = defaultConfig();
  assert.throws(() => mergeCliMcp(cli, cfg));
  assert.equal(cfg.mcpServers, undefined);
});

test("custom_mcp_no_flags_leaves_config_untouched", () => {
  const cli = cliWith([]);
  const cfg = defaultConfig();
  mergeCliMcp(cli, cfg);
  assert.equal(cfg.mcpServers, undefined);
});

test("prompts_dir_flag_is_repeatable_and_ordered", () => {
  const prev = process.env["TC_PROMPTS_DIR"];
  delete process.env["TC_PROMPTS_DIR"];
  try {
    const cli = cliWith(["--prompts-dir", "a", "--prompts-dir", "b"]);
    assert.deepEqual(resolvePromptsDirs(cli), ["a", "b"]);
  } finally {
    if (prev !== undefined) process.env["TC_PROMPTS_DIR"] = prev;
  }
});

test("prompts_dir_env_appends_after_flags", () => {
  const prev = process.env["TC_PROMPTS_DIR"];
  process.env["TC_PROMPTS_DIR"] = "env-a:env-b";
  try {
    const cli = cliWith(["--prompts-dir", "flag"]);
    assert.deepEqual(resolvePromptsDirs(cli), ["flag", "env-a", "env-b"]);
  } finally {
    if (prev !== undefined) process.env["TC_PROMPTS_DIR"] = prev;
    else delete process.env["TC_PROMPTS_DIR"];
  }
});

test("prompts_dir_empty_by_default", () => {
  const prev = process.env["TC_PROMPTS_DIR"];
  delete process.env["TC_PROMPTS_DIR"];
  try {
    const cli = cliWith([]);
    assert.deepEqual(resolvePromptsDirs(cli), []);
  } finally {
    if (prev !== undefined) process.env["TC_PROMPTS_DIR"] = prev;
  }
});
