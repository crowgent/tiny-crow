import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  catalogContextWindowOf,
  configFromJson,
  configToJson,
  defaultConfig,
  isAnthropicNative,
  resolveCompactEnabled,
  resolveContextWindow,
  resolveMidTurnCompactThreshold,
  resolveShowReasoning,
  type Config,
  type CustomProviderConfig,
  type QuickModelConfig,
} from "../src/config/mod.ts";
import {
  mergeConfigOverride,
  parseToml,
  parseYaml,
  pickExisting,
  saveConfig,
  toToml,
  unknownKeys,
} from "../src/config/load.ts";

function customProvider(providerType: string): CustomProviderConfig {
  return {
    providerType,
    baseUrl: "https://gateway.example.com",
    headers: {},
  };
}

test("is_anthropic_native_builtin_providers", () => {
  const cfg = defaultConfig();
  assert.ok(isAnthropicNative(cfg, "anthropic", "claude-sonnet-4-6"));
  assert.ok(isAnthropicNative(cfg, "Anthropic", "claude-sonnet-4-6")); 
  for (const p of ["openai", "gemini", "google", "openrouter", "ollama", "opencode-zen", "opencode-go"]) {
    assert.ok(!isAnthropicNative(cfg, p, "kimi-k2.6"), `${p} is not anthropic-native for chat models`);
  }
});

test("is_anthropic_native_follows_opencode_transport", () => {
  const cfg = defaultConfig();
  assert.ok(isAnthropicNative(cfg, "opencode-zen", "claude-opus-4-6"));
  assert.ok(isAnthropicNative(cfg, "opencode-go", "minimax-m2.7"));
  assert.ok(!isAnthropicNative(cfg, "opencode-zen", "gpt-5.5"));
  assert.ok(!isAnthropicNative(cfg, "opencode-go", "kimi-k2.6"));
  assert.ok(!isAnthropicNative(cfg, "opencode-zen", "no-such-model"));
});

test("is_anthropic_native_resolves_custom_provider_type", () => {
  const cfg = defaultConfig();
  cfg.customProviders = {
    "my-claude-proxy": customProvider("anthropic"),
    "my-oai-gateway": customProvider("openai"),
  };
  assert.ok(isAnthropicNative(cfg, "my-claude-proxy", "claude-sonnet-4-6"));
  assert.ok(!isAnthropicNative(cfg, "my-oai-gateway", "gpt-4o"));
  assert.ok(!isAnthropicNative(cfg, "totally-unknown", "whatever"));
});

test("mid_turn_threshold_unset_by_default", () => {
  assert.equal(resolveMidTurnCompactThreshold(defaultConfig()), undefined);
});

test("mid_turn_threshold_valid_value_passes_through", () => {
  const cfg = defaultConfig();
  cfg.midTurnCompactThreshold = 0.8;
  assert.equal(resolveMidTurnCompactThreshold(cfg), 0.8);
});

test("mid_turn_threshold_upper_bound_inclusive", () => {
  const cfg = defaultConfig();
  cfg.midTurnCompactThreshold = 1.0;
  assert.equal(resolveMidTurnCompactThreshold(cfg), 1.0);
});

test("mid_turn_threshold_out_of_range_treated_as_unset", () => {
  for (const bad of [0.0, -0.1, 1.5, 2.0]) {
    const cfg = defaultConfig();
    cfg.midTurnCompactThreshold = bad;
    assert.equal(resolveMidTurnCompactThreshold(cfg), undefined, `threshold ${bad} should be treated as unset`);
  }
});

test("compact_enabled_default_false", () => {
  assert.ok(!resolveCompactEnabled(defaultConfig()));
});

test("show_reasoning_defaults_off", () => {
  assert.ok(!resolveShowReasoning(defaultConfig()));
});

test("show_reasoning_can_be_disabled", () => {
  const cfg = defaultConfig();
  cfg.showReasoning = false;
  assert.ok(!resolveShowReasoning(cfg));
});

test("catalog_context_window_reads_known_model", () => {
  assert.ok(catalogContextWindowOf("openrouter", "deepseek/deepseek-v4-pro") !== undefined);
});

test("catalog_context_window_none_for_unknown", () => {
  assert.equal(catalogContextWindowOf("openrouter", "no/such-model"), undefined);
  assert.equal(catalogContextWindowOf("ollama", "llama3.1"), undefined);
});

test("resolve_context_window_prefers_config_pin_over_catalog", () => {
  const cfg = configFromJson({ context_window: 128000 });
  const qm: Record<string, QuickModelConfig> = {};
  assert.equal(resolveContextWindow(cfg, "openrouter", "deepseek/deepseek-v4-pro", qm), 128000);
  const cfg2 = defaultConfig();
  assert.equal(
    resolveContextWindow(cfg2, "openrouter", "deepseek/deepseek-v4-pro", qm),
    catalogContextWindowOf("openrouter", "deepseek/deepseek-v4-pro"),
  );
});

test("resolve_context_window_from_quick_model", () => {
  const qm: Record<string, QuickModelConfig> = {
    test: {
      provider: "openrouter",
      model: "deepseek/deepseek-chat",
      inputTokenCost: 0,
      outputTokenCost: 0,
      contextWindow: 64000,
    },
  };
  const cfg = defaultConfig();
  assert.equal(resolveContextWindow(cfg, "openrouter", "deepseek/deepseek-chat", qm), 64000);
  const cfg2 = configFromJson({ context_window: 32000 });
  assert.equal(resolveContextWindow(cfg2, "openrouter", "deepseek/deepseek-chat", qm), 32000);
  qm["test"]!.contextWindow = undefined;
  const cfg3 = defaultConfig();
  assert.equal(
    resolveContextWindow(cfg3, "openrouter", "deepseek/deepseek-chat", qm),
    catalogContextWindowOf("openrouter", "deepseek/deepseek-chat"),
  );
});

const YAML_DOC = `provider: openrouter
model: deepseek/deepseek-v4-flash
max_tokens: 16384
temperature: 0.7
context_window: 128000
compact_enabled: true
default_prompt: code
show_tool_details: 3
permission-modes: ["guarded", "standard", "yolo"]
mid_turn_compact_threshold: 0.80
quick_models:
  fast:
    provider: openai
    model: gpt-4o-mini
custom_providers:
  local-vllm:
    provider_type: openai
    base_url: http://localhost:8000/v1
    api_key_env: VLLM_API_KEY
permission:
  '*': ask
  read: allow
  bash:
    'cargo test': allow
    'rm **': deny
`;

test("yaml_reader_parses_config", () => {
  const cfg = configFromJson(parseYaml(YAML_DOC));
  assert.equal(cfg.provider, "openrouter");
  assert.equal(cfg.model, "deepseek/deepseek-v4-flash");
  assert.equal(cfg.maxTokens, 16384);
  assert.equal(cfg.temperature, 0.7);
  assert.equal(cfg.contextWindow, 128000);
  assert.equal(cfg.compactEnabled, true);
  assert.equal(cfg.defaultPrompt, "code");
  assert.equal(cfg.midTurnCompactThreshold, 0.8);
  assert.equal(cfg.showToolDetails, 3);
  assert.deepEqual(cfg.permissionModes, ["guarded", "standard", "yolo"]);
  const fast = cfg.quickModels!["fast"]!;
  assert.equal(fast.provider, "openai");
  assert.equal(fast.model, "gpt-4o-mini");
  const vllm = cfg.customProviders!["local-vllm"]!;
  assert.equal(vllm.baseUrl, "http://localhost:8000/v1");
  assert.equal(vllm.apiKeyEnv, "VLLM_API_KEY");
  assert.deepEqual(cfg.permission, {
    "*": "ask",
    read: "allow",
    bash: { "cargo test": "allow", "rm **": "deny" },
  });
});

test("yaml_reader_accepts_plain_json_superset", () => {
  const json = `{
    "provider": "openrouter",
    "model": "deepseek/deepseek-v4-flash",
    "max_tokens": 16384,
    "compact_enabled": true,
    "quick_models": {
      "fast": { "provider": "openai", "model": "gpt-4o-mini" }
    },
    "permission": { "*": "ask", "read": "allow" }
  }`;
  const fromJson = configFromJson(parseYaml(json));
  const yaml = `provider: openrouter
model: deepseek/deepseek-v4-flash
max_tokens: 16384
compact_enabled: true
quick_models:
  fast:
    provider: openai
    model: gpt-4o-mini
permission:
  '*': ask
  read: allow
`;
  const fromYaml = configFromJson(parseYaml(yaml));
  assert.equal(fromJson.provider, fromYaml.provider);
  assert.equal(fromJson.model, fromYaml.model);
  assert.equal(fromJson.maxTokens, fromYaml.maxTokens);
  assert.equal(fromJson.compactEnabled, fromYaml.compactEnabled);
  assert.equal(fromJson.quickModels!["fast"]!.provider, fromYaml.quickModels!["fast"]!.provider);
  assert.equal(fromJson.quickModels!["fast"]!.model, fromYaml.quickModels!["fast"]!.model);
  assert.deepEqual(fromJson.permission, fromYaml.permission);
});

test("yaml_round_trips_serde_json_value_fields", () => {
  const cfg = defaultConfig();
  cfg.provider = "openrouter";
  cfg.extraBody = { plugins: { preset: "quality" } };
  cfg.permission = { "*": "ask", read: "allow" };
  const back = configFromJson(JSON.parse(JSON.stringify(configToJson(cfg))));
  assert.equal(back.provider, cfg.provider);
  assert.deepEqual(back.extraBody, cfg.extraBody);
  assert.deepEqual(back.permission, cfg.permission);
});

test("yaml_round_trips_scalar_and_nested_fields", () => {
  const cfg = defaultConfig();
  cfg.provider = "openrouter";
  cfg.model = "deepseek/deepseek-v4-flash";
  cfg.maxTokens = 16384;
  cfg.contextWindow = 128000;
  cfg.compactEnabled = true;
  cfg.defaultPrompt = "code";

  const toml = toToml(configToJson(cfg));
  assert.ok(!toml.trimStart().startsWith("{"));
  const back = configFromJson(parseToml(toml));
  assert.equal(back.provider, cfg.provider);
  assert.equal(back.model, cfg.model);
  assert.equal(back.maxTokens, cfg.maxTokens);
  assert.equal(back.contextWindow, cfg.contextWindow);
  assert.equal(back.compactEnabled, cfg.compactEnabled);
  assert.equal(back.defaultPrompt, cfg.defaultPrompt);
});

test("config_candidate_priority_toml_yaml_yml_legacy_json", () => {
  const dir = path.join(os.tmpdir(), `tc_cfgtest_${process.pid}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  try {
    const name = (p: string) => path.basename(p);
    assert.equal(name(pickExisting(dir)), "config.toml");
    fs.writeFileSync(path.join(dir, "config.json"), "{}");
    assert.equal(name(pickExisting(dir)), "config.json");
    fs.writeFileSync(path.join(dir, "config.yml"), "");
    assert.equal(name(pickExisting(dir)), "config.yml");
    fs.rmSync(path.join(dir, "config.yml"));
    fs.writeFileSync(path.join(dir, "config.yaml"), "");
    assert.equal(name(pickExisting(dir)), "config.yaml");
    fs.writeFileSync(path.join(dir, "config.yml"), "");
    assert.equal(name(pickExisting(dir)), "config.yaml");
    fs.writeFileSync(path.join(dir, "config.toml"), "");
    assert.equal(name(pickExisting(dir)), "config.toml");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("save_config_round_trips_and_leaves_no_tmp", async () => {
  const dir = path.join(os.tmpdir(), `tc_savecfg_${process.pid}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const prev = process.env.TC_CONFIG_DIR;
  process.env.TC_CONFIG_DIR = dir;
  try {
    const cfg = defaultConfig();
    cfg.provider = "openai";
    cfg.apiKeys = { openai: "sk-test" };
    await saveConfig(cfg);
    const p = path.join(dir, "config.toml");
    assert.ok(fs.existsSync(p), "save_config should write config.toml");
    assert.ok(!fs.existsSync(path.join(dir, "config.tmp")), "atomic write must not leave .tmp behind");
    const content = fs.readFileSync(p, "utf8");
    const back = configFromJson(parseToml(content));
    assert.equal(back.provider, cfg.provider);
    assert.deepEqual(back.apiKeys, cfg.apiKeys);
  } finally {
    if (prev === undefined) delete process.env.TC_CONFIG_DIR;
    else process.env.TC_CONFIG_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("unknown_keys_flags_typo", () => {
  const file = { model: "m", modle: "typo" };
  const cfg = configFromJson(file);
  assert.deepEqual(unknownKeys(file, cfg), ["modle"]);
});

test("unknown_keys_accepts_valid_keys", () => {
  const file = { model: "m", temperature: 0.5, reserve_tokens: 1024, retry: { max_attempts: 5 } };
  const cfg = configFromJson(file);
  assert.deepEqual(unknownKeys(file, cfg), []);
});

test("unknown_keys_accepts_renamed_keys", () => {
  const file = { "enable-exa-mcp": false, "permission-allow": { bash: ["ls"] } };
  const cfg = configFromJson(file);
  assert.deepEqual(unknownKeys(file, cfg), []);
});

test("unknown_keys_non_object_file_is_empty", () => {
  assert.deepEqual(unknownKeys(["not", "a", "table"], defaultConfig()), []);
});

test("local_override_replaces_scalar", () => {
  const base = defaultConfig();
  base.model = "global-model";
  const merged = mergeConfigOverride(base, `model = "local-model"`);
  assert.equal(merged.model, "local-model");
});

test("local_override_keeps_unset_keys", () => {
  const base = defaultConfig();
  base.model = "global-model";
  base.temperature = 0.7;
  const merged = mergeConfigOverride(base, "temperature = 0.2");
  assert.equal(merged.model, "global-model");
  assert.equal(merged.temperature, 0.2);
});

test("local_override_merges_maps_per_key", () => {
  const base = defaultConfig();
  base.apiKeys = { openai: "sk-global", gemini: "gm-global" };
  const local = `
[api_keys]
gemini = "gm-local"
anthropic = "sk-ant-local"
`;
  const merged = mergeConfigOverride(base, local);
  const keys = merged.apiKeys!;
  assert.equal(keys["openai"], "sk-global");
  assert.equal(keys["gemini"], "gm-local");
  assert.equal(keys["anthropic"], "sk-ant-local");
});

test("local_override_arrays_replace", () => {
  const base = defaultConfig();
  base.permissionModes = ["a", "b"];
  const merged = mergeConfigOverride(base, `permission-modes = ["c"]`);
  assert.deepEqual(merged.permissionModes, ["c"]);
});

test("local_override_partial_retry", () => {
  const base = defaultConfig();
  const merged = mergeConfigOverride(base, "[retry]\nmax_attempts = 9");
  assert.equal(merged.retry.maxAttempts, 9);
  assert.equal(merged.retry.initialBackoffMs, 500);
  assert.equal(merged.retry.maxBackoffMs, 10000);
});

test("local_override_empty_keeps_base", () => {
  const base = defaultConfig();
  base.model = "global-model";
  const merged = mergeConfigOverride(base, "");
  assert.equal(merged.model, "global-model");
});

test("local_override_invalid_toml_errors", () => {
  assert.throws(() => mergeConfigOverride(defaultConfig(), "not [valid"));
});

test("local_override_wrong_type_errors", () => {
  assert.throws(() => mergeConfigOverride(defaultConfig(), `max_tokens = "lots"`));
});

test("local_override_merges_mcp_servers", () => {
  const base = defaultConfig();
  base.mcpServers = {
    "global-srv": { kind: "url", url: "https://global.example.com/mcp", headers: {} },
  };
  const local = `
[mcp_servers.local-fs]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "."]
`;
  const merged = mergeConfigOverride(base, local);
  const servers = merged.mcpServers!;
  assert.equal(Object.keys(servers).length, 2);

  assert.equal((servers["global-srv"] as Record<string, unknown>)["url"], "https://global.example.com/mcp");
  assert.equal((servers["local-fs"] as Record<string, unknown>)["command"], "npx");
});
