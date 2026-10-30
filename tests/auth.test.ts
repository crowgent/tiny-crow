import test from "node:test";
import assert from "node:assert/strict";
import { AuthResolver, providerKindFromName } from "../src/auth.ts";

function mockEnv(vars: [string, string][]): (name: string) => string | undefined {
  const map = new Map(vars);
  return (name: string) => map.get(name);
}

test("auth_resolver_returns_cli_key_when_provided", () => {
  const resolver = new AuthResolver("openai").withCliKey("sk-test-key-123");
  assert.equal(resolver.resolve(), "sk-test-key-123");
});

test("auth_resolver_returns_env_var_when_no_cli_key", () => {
  const env = mockEnv([["OPENAI_API_KEY", "env-key-456"]]);
  const resolver = new AuthResolver("openai")
    .withCliKey(undefined)
    .withConfigKeys(undefined);
  assert.equal(resolver.resolve(env), "env-key-456");
});

test("auth_resolver_returns_config_key_when_no_env", () => {
  const env = mockEnv([]);
  const resolver = new AuthResolver("openai")
    .withCliKey(undefined)
    .withConfigKeys({ openai: "config-key-789" });
  assert.equal(resolver.resolve(env), "config-key-789");
});

test("auth_resolver_cli_key_takes_priority_over_env", () => {
  const env = mockEnv([["OPENAI_API_KEY", "env-key"]]);
  const resolver = new AuthResolver("openai")
    .withCliKey("cli-key")
    .withConfigKeys(undefined);
  assert.equal(resolver.resolve(env), "cli-key");
});

test("auth_resolver_env_takes_priority_over_config", () => {
  const env = mockEnv([["OPENAI_API_KEY", "env-key"]]);
  const resolver = new AuthResolver("openai")
    .withCliKey(undefined)
    .withConfigKeys({ openai: "config-key" });
  assert.equal(resolver.resolve(env), "env-key");
});

test("auth_resolver_falls_back_for_empty_cli_key", () => {
  const env = mockEnv([["OPENAI_API_KEY", "env-key"]]);
  const resolver = new AuthResolver("openai")
    .withCliKey("")
    .withConfigKeys(undefined);
  assert.equal(resolver.resolve(env), "env-key");
});

test("auth_resolver_falls_back_to_custom_provider_name", () => {
  const env = mockEnv([]);
  const resolver = new AuthResolver("openai")
    .withCliKey(undefined)
    .withConfigKeys({ "local-vllm": "custom-provider-key" })
    .withCustomProviderName("local-vllm");
  assert.equal(resolver.resolve(env), "custom-provider-key");
});

test("auth_resolver_ollama_returns_empty_key", () => {
  const env = mockEnv([]);
  const resolver = new AuthResolver("ollama")
    .withCliKey(undefined)
    .withEnvOverride(undefined)
    .withConfigKeys(undefined);
  assert.equal(resolver.resolve(env), "");
});

test("auth_resolver_errors_when_no_key_available", () => {
  const env = mockEnv([]);
  const resolver = new AuthResolver("openai")
    .withCliKey(undefined)
    .withConfigKeys(undefined);
  assert.throws(() => resolver.resolve(env));
});

test("provider_kind_from_name_recognizes_all", () => {
  assert.equal(providerKindFromName("openrouter"), "openrouter");
  assert.equal(providerKindFromName("openai"), "openai");
  assert.equal(providerKindFromName("anthropic"), "anthropic");
  assert.equal(providerKindFromName("gemini"), "gemini");
  assert.equal(providerKindFromName("google"), "gemini");
  assert.equal(providerKindFromName("ollama"), "ollama");
  assert.equal(providerKindFromName("custom"), "openai");
  assert.equal(providerKindFromName("opencode-zen"), "opencode-zen");
  assert.equal(providerKindFromName("opencode-go"), "opencode-go");
});

test("provider_kind_has_no_opencode_aliases", () => {
  for (const name of ["zen", "opencode", "go", "free", "opencode-free"]) {
    assert.equal(providerKindFromName(name), undefined, `${name} must not resolve`);
  }
});

test("auth_resolver_opencode_zen_reads_shared_env_var", () => {
  const env = mockEnv([["OPENCODE_API_KEY", "sk-opencode-123"]]);
  const resolver = new AuthResolver("opencode-zen")
    .withCliKey(undefined)
    .withConfigKeys(undefined);
  assert.equal(resolver.resolve(env), "sk-opencode-123");
});

test("auth_resolver_opencode_zen_falls_back_to_public_key", () => {
  const env = mockEnv([]);
  const resolver = new AuthResolver("opencode-zen")
    .withCliKey(undefined)
    .withConfigKeys(undefined);
  assert.equal(resolver.resolve(env), "public");
});

test("auth_resolver_opencode_zen_prefers_configured_key", () => {
  const env = mockEnv([["OPENCODE_API_KEY", "env-key"]]);
  const resolver = new AuthResolver("opencode-zen")
    .withCliKey(undefined)
    .withConfigKeys(undefined);
  assert.equal(resolver.resolve(env), "env-key");
});

test("auth_resolver_opencode_go_shares_env_var_but_requires_key", () => {
  const env = mockEnv([["OPENCODE_API_KEY", "sk-opencode-123"]]);
  const resolver = new AuthResolver("opencode-go")
    .withCliKey(undefined)
    .withConfigKeys(undefined);
  assert.equal(resolver.resolve(env), "sk-opencode-123");
  const empty = mockEnv([]);
  const resolver2 = new AuthResolver("opencode-go")
    .withCliKey(undefined)
    .withConfigKeys(undefined);
  assert.throws(() => resolver2.resolve(empty));
});

test("provider_kind_from_name_case_insensitive", () => {
  assert.equal(providerKindFromName("OPENAI"), "openai");
  assert.equal(providerKindFromName("OpenAi"), "openai");
});

test("provider_kind_from_name_returns_none_for_unknown", () => {
  assert.equal(providerKindFromName("unknown"), undefined);
});
