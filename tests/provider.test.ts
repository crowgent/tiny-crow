import test from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import {
  buildHttpClient,
  createClient,
  DEFAULT_METADATA_TIMEOUT_MS,
  expandEnv,
  httpTotalTimeout,
  isAgentModel,
  mergeExtraBody,
  openrouterAnthropicRouting,
  opencodeSessionHeader,
  opencodeSessionHeaderValue,
  opencodeTransport,
  parseManualModels,
  parseModelInfos,
  resolveApiStyle,
  resolveOpencodeTransport,
  resolveProviderConfig,
  serializeConversation,
  setOpencodeSessionId,
  type CustomProviderConfig,
  type ModelEntry,
  type SessionMessage,
} from "../src/provider.ts";

function cfg(apiStyle: "responses" | "completions" | undefined): CustomProviderConfig {
  return {
    providerType: "openai",
    baseUrl: "https://gw.example/v1",
    apiStyle,
    headers: {},
  };
}

test("defaults_to_responses_without_base_url", () => {
  assert.equal(resolveApiStyle(null, null), "responses");
});

test("defaults_to_completions_with_base_url", () => {
  assert.equal(resolveApiStyle("https://gw.example/v1", null), "completions");
});

test("explicit_style_overrides_base_url_heuristic", () => {
  assert.equal(resolveApiStyle("https://gw.example/v1", cfg("responses")), "responses");
});

test("explicit_completions_overrides_no_base_url", () => {
  assert.equal(resolveApiStyle(null, cfg("completions")), "completions");
});

test("expand_env_passthrough", () => {
  assert.equal(expandEnv("Bearer <redacted>"), "Bearer <redacted>");
});

test("expand_env_reads_var", () => {
  process.env.TC_TEST_HDR = "secret-value";
  try {
    assert.equal(expandEnv("${TC_TEST_HDR}"), "secret-value");
  } finally {
    delete process.env.TC_TEST_HDR;
  }
});

test("expand_env_missing_var_errors", () => {
  assert.throws(() => expandEnv("${TC_DEFINITELY_NOT_SET_98237}"));
});

function model(id: string, kind: string | null): ModelEntry {
  return { id, display: id, contextLength: null, kind, inputPrice: null, outputPrice: null };
}

test("agent_model_plain_chat", () => {
  assert.ok(isAgentModel(model("gpt-4", null)));
  assert.ok(isAgentModel(model("claude-sonnet", null)));
});

test("non_agent_embedding_kind", () => {
  assert.ok(!isAgentModel(model("text-embedding-3", "embed")));
});

test("non_agent_image_kind", () => {
  assert.ok(!isAgentModel(model("dall-e-3", "image")));
});

test("non_agent_audio_kind", () => {
  assert.ok(!isAgentModel(model("whisper-1", "audio")));
});

test("non_agent_speech_kind", () => {
  assert.ok(!isAgentModel(model("tts-1", "speech")));
});

test("non_agent_by_id_deny_list", () => {
  assert.ok(!isAgentModel(model("text-embedding-ada-002", null)));
  assert.ok(!isAgentModel(model("whisper-large", null)));
  assert.ok(!isAgentModel(model("dall-e-3", null)));
  assert.ok(!isAgentModel(model("imagen-3", null)));
});

test("non_agent_by_id_deny_list_partial_match", () => {
  assert.ok(!isAgentModel(model("some-embed-model", null)));
  assert.ok(!isAgentModel(model("tts-model-v2", null)));
  assert.ok(!isAgentModel(model("veo-video-gen", null)));
});

test("serialize_empty", () => {
  assert.equal(serializeConversation([]), "");
});

test("serialize_single_user_message", () => {
  const msgs: SessionMessage[] = [{ role: "user", content: "hello" }];
  assert.ok(serializeConversation(msgs).includes("[User]: hello"));
});

test("serialize_multiple_roles", () => {
  const msgs: SessionMessage[] = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hey" },
    { role: "system", content: "note" },
  ];
  const result = serializeConversation(msgs);
  assert.ok(result.includes("[User]: hi"));
  assert.ok(result.includes("[Assistant]: hey"));
  assert.ok(result.includes("[System]: note"));
});

test("resolve_builtin_openai", () => {
  const c = resolveProviderConfig("openai", {});
  assert.equal(c.kind, "openai");
  assert.equal(c.baseUrl, null);
});

test("resolve_builtin_anthropic", () => {
  assert.equal(resolveProviderConfig("anthropic", {}).kind, "anthropic");
});

test("resolve_builtin_gemini", () => {
  assert.equal(resolveProviderConfig("gemini", {}).kind, "gemini");
});

test("resolve_builtin_google_alias", () => {
  assert.equal(resolveProviderConfig("google", {}).kind, "gemini");
});

test("resolve_builtin_ollama", () => {
  assert.equal(resolveProviderConfig("ollama", {}).kind, "ollama");
});

test("resolve_builtin_openrouter", () => {
  assert.equal(resolveProviderConfig("openrouter", {}).kind, "openrouter");
});

test("resolve_builtin_opencode_zen", () => {
  const c = resolveProviderConfig("opencode-zen", {});
  assert.equal(c.kind, "opencode-zen");
  assert.equal(c.baseUrl, "https://opencode.ai/zen/v1");
});

test("resolve_builtin_opencode_go", () => {
  const c = resolveProviderConfig("opencode-go", {});
  assert.equal(c.kind, "opencode-go");
  assert.equal(c.baseUrl, "https://opencode.ai/zen/go/v1");
});

test("opencode_transport_matches_gateway_endpoints", () => {
  assert.equal(opencodeTransport("opencode-zen", "kimi-k2.6"), "chat");
  assert.equal(opencodeTransport("opencode-zen", "gpt-5.5"), "responses");
  assert.equal(opencodeTransport("opencode-zen", "claude-opus-4-6"), "messages");
  assert.equal(opencodeTransport("opencode-go", "kimi-k2.6"), "chat");
  assert.equal(opencodeTransport("opencode-go", "gpt-5.6-luna"), "responses");
  assert.equal(opencodeTransport("opencode-go", "minimax-m2.7"), "messages");
  assert.equal(opencodeTransport("opencode-zen", "mimo-v2.5-free"), "chat");
  assert.equal(opencodeTransport("opencode-zen", "muse-spark-1.3-contributor-free"), "responses");
  assert.equal(opencodeTransport("opencode-zen", "no-such-model"), null);
  assert.equal(opencodeTransport("openai", "gpt-5.5"), null);
});

test("opencode_transport_falls_back_to_chat", () => {
  assert.equal(resolveOpencodeTransport("opencode-zen", "no-such-model"), "chat");
});

test("opencode_session_header_is_stable_and_present", () => {
  assert.equal(opencodeSessionHeaderValue("test-conversation-id"), "test-conversation-id");
  setOpencodeSessionId("test-conversation-id");
  const live = opencodeSessionHeader();
  assert.ok(live.length > 0);
  assert.equal(opencodeSessionHeader(), live);
});

test("opencode_client_dispatches_per_model_transport", () => {
  const client = createClient("opencode-zen", null, {}, null);
  assert.ok("provider" in client);
  if ("provider" in client) {
    assert.equal(client.provider, "opencode-zen");
    const kimi = client.completionModel("kimi-k2.6");
    assert.equal(kimi.kind, "openai");
    if (kimi.kind === "openai") assert.equal(kimi.value.route, "completions");
    const gpt = client.completionModel("gpt-5.5");
    assert.equal(gpt.kind, "openai");
    if (gpt.kind === "openai") assert.equal(gpt.value.route, "responses");
    const claude = client.completionModel("claude-opus-4-6");
    assert.equal(claude.kind, "anthropic");
  }
  const go = createClient("opencode-go", "sk-test", {}, null);
  if ("provider" in go) {
    assert.equal(go.provider, "opencode-go");
    const kimi = go.completionModel("kimi-k2.6");
    assert.equal(kimi.kind, "openai");
    if (kimi.kind === "openai") assert.equal(kimi.value.route, "completions");
  }
});

test("resolve_unknown_provider_errors", () => {
  assert.throws(() => resolveProviderConfig("nonexistent_provider_xyz", {}));
});

test("resolve_custom_provider", () => {
  const custom: Record<string, CustomProviderConfig> = {
    "my-gw": { providerType: "openai", baseUrl: "https://mygw.example/v1", headers: {} },
  };
  const c = resolveProviderConfig("my-gw", custom);
  assert.equal(c.kind, "openai");
  assert.equal(c.baseUrl, "https://mygw.example/v1");
});

test("anthropic_custom_base_appends_v1_messages", async () => {
  let requestLine = "";
  const server = http.createServer((req, res) => {
    requestLine = `${req.method} ${req.url} HTTP/1.1`;
    res.writeHead(400, { "Content-Length": "0", Connection: "close" });
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const custom: Record<string, CustomProviderConfig> = {
      "anthropic-capture": {
        providerType: "anthropic",
        baseUrl: `http://127.0.0.1:${(address as { port: number }).port}/anthropic`,
        headers: {},
      },
    };
    const client = createClient("anthropic-capture", "test-key", custom, null);
    assert.ok("completionModel" in client);
    const model = (client as { completionModel: (n: string) => { kind: string; value: unknown } }).completionModel("MiniMax-M3");
    assert.equal(model.kind, "anthropic");
    const providerModel = model.value as { complete: (msgs: unknown[], opts: unknown) => Promise<string> };
    await assert.rejects(providerModel.complete([{ role: "user", content: "hello" }], { maxTokens: 16 }));
    assert.equal(requestLine, "POST /anthropic/v1/messages HTTP/1.1");
  } finally {
    server.close();
  }
});

test("merge_extra_body_combines_routing_and_user_keys", () => {
  const routing = { provider: { order: ["Anthropic"], allow_fallbacks: true } };
  const user = { plugins: { preset: "general-budget" } };
  const merged = mergeExtraBody(routing, user)!;
  assert.deepEqual((merged["provider"] as Record<string, unknown>)["order"], ["Anthropic"]);
  assert.equal((merged["plugins"] as Record<string, unknown>)["preset"], "general-budget");
});

test("merge_extra_body_user_key_overrides_base", () => {
  const base = { provider: { order: ["Anthropic"] } };
  const user = { provider: { order: ["OpenAI"] } };
  const merged = mergeExtraBody(base, user)!;
  assert.deepEqual((merged["provider"] as Record<string, unknown>)["order"], ["OpenAI"]);
});

test("merge_extra_body_handles_absent_sides", () => {
  const val = { plugins: { preset: "quality" } };
  assert.deepEqual(mergeExtraBody(null, val), val);
  assert.deepEqual(mergeExtraBody(val, null), val);
  assert.equal(mergeExtraBody(null, null), null);
});

test("pins_anthropic_namespaced_openrouter_models", () => {
  for (const id of ["anthropic/claude-sonnet-4.6", "anthropic/claude-opus-4.8", "anthropic/claude-3.5-haiku"]) {
    const extra = openrouterAnthropicRouting(id);
    assert.ok(extra !== null, `should pin ${id}`);
    assert.deepEqual((extra!["provider"] as Record<string, unknown>)["order"], ["Anthropic"]);
    assert.equal((extra!["provider"] as Record<string, unknown>)["allow_fallbacks"], true);
  }
});

test("pins_tilde_prefixed_latest_aliases", () => {
  for (const id of ["~anthropic/claude-sonnet-latest", "~anthropic/claude-opus-latest", "~anthropic/claude-haiku-latest"]) {
    assert.ok(openrouterAnthropicRouting(id) !== null, `${id} should be pinned`);
  }
});

test("leaves_non_anthropic_openrouter_models_untouched", () => {
  for (const id of ["openai/gpt-4o", "deepseek/deepseek-chat", "google/gemini-2.5-pro", "openrouter/auto", "somegateway/not-claude"]) {
    assert.equal(openrouterAnthropicRouting(id), null, `${id} should not be pinned`);
  }
});

test("parses_openrouter_string_pricing", () => {
  const body = `{
    "data": [
      {
        "id": "openai/gpt-4o",
        "pricing": { "prompt": "0.0000025", "completion": "0.00001" },
        "context_length": 128000
      }
    ]
  }`;
  const infos = parseModelInfos(body);
  const info = infos.get("openai/gpt-4o")!;
  assert.equal(info.inputCost, 2.5);
  assert.equal(info.outputCost, 10.0);
  assert.equal(info.contextLength, 128000);
});

test("parses_numeric_pricing_from_compatible_gateways", () => {
  const body = `{
    "data": [
      {
        "id": "moonshotai/kimi-k2.6",
        "pricing": { "prompt": 0.000000646, "completion": 0.00000272, "request": 0 },
        "context_length": 262144
      }
    ]
  }`;
  const infos = parseModelInfos(body);
  const info = infos.get("moonshotai/kimi-k2.6")!;
  assert.ok(Math.abs(info.inputCost - 0.646) < 1e-9);
  assert.ok(Math.abs(info.outputCost - 2.72) < 1e-9);
  assert.equal(info.contextLength, 262144);
});

test("keeps_context_length_only_entries_and_skips_empty_ones", () => {
  const body = `{
    "data": [
      { "id": "ctx-only", "context_length": 1048576 },
      { "id": "free", "pricing": { "prompt": 0, "completion": 0 } },
      { "id": "empty" }
    ]
  }`;
  const infos = parseModelInfos(body);
  assert.equal(infos.get("ctx-only")!.contextLength, 1048576);
  assert.ok(!infos.has("free"), "zero pricing without context_length is skipped");
  assert.ok(!infos.has("empty"));
});

test("manual_models_pick_up_context_length_when_reported", () => {
  const body = `{
    "object": "list",
    "data": [
      { "id": "deepseek/deepseek-v4-flash", "object": "model", "context_length": 1048576 },
      { "id": "plain-model", "object": "model" }
    ]
  }`;
  const models = parseManualModels(body);
  assert.equal(models.length, 2);
  assert.equal(models[0]!.id, "deepseek/deepseek-v4-flash");
  assert.equal(models[0]!.contextLength, 1048576);
  assert.equal(models[1]!.id, "plain-model");
  assert.equal(models[1]!.contextLength, null);
});

test("completion_client_has_no_default_deadline", () => {
  assert.equal(httpTotalTimeout("completion", undefined), null);
  assert.equal(httpTotalTimeout("completion", cfg(undefined)), null);
});

test("metadata_client_defaults_to_the_metadata_deadline", () => {
  assert.equal(httpTotalTimeout("metadata", undefined), DEFAULT_METADATA_TIMEOUT_MS);
  assert.equal(httpTotalTimeout("metadata", cfg(undefined)), DEFAULT_METADATA_TIMEOUT_MS);
});

test("explicit_timeout_secs_applies_to_both_purposes", () => {
  const custom = cfg(undefined);
  custom.timeoutSecs = 42;
  for (const purpose of ["completion", "metadata"] as const) {
    assert.equal(httpTotalTimeout(purpose, custom), 42000);
  }
});

test("completion_client_survives_stream_longer_than_metadata_deadline", async () => {
  // The TS port expresses the deadline as httpTotalTimeout + fetch's
  // AbortSignal.timeout; this pins the same boundary: a stream longer
  // than the metadata deadline completes for completion clients and
  // aborts for metadata clients.
  const chunks = Math.floor(DEFAULT_METADATA_TIMEOUT_MS / 1000) + 1;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Transfer-Encoding": "chunked" });
    let index = 0;
    const timer = setInterval(() => {
      if (index >= chunks) {
        clearInterval(timer);
        res.write("0\r\n\r\n");
        res.end();
        return;
      }
      const frame = `data: tok${index}\n\n`;
      res.write(`${frame.length.toString(16)}\r\n${frame}\r\n`);
      index += 1;
    }, 1000);
    req.on("close", () => clearInterval(timer));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as { port: number };
    const base = `http://127.0.0.1:${address.port}`;
    const completionTimeout = buildHttpClient("slow", false, null, base, "completion").timeoutMs;
    const metadataTimeout = buildHttpClient("slow", false, null, base, "metadata").timeoutMs;
    assert.equal(completionTimeout, null);
    assert.equal(metadataTimeout, DEFAULT_METADATA_TIMEOUT_MS);
    const streamed = await fetch(base, completionTimeout === null ? {} : { signal: AbortSignal.timeout(completionTimeout) }).then((r) => r.text());
    assert.equal((streamed.match(/data: tok/g) ?? []).length, chunks);
    await assert.rejects(
      fetch(base, { signal: AbortSignal.timeout(metadataTimeout!) }).then((r) => r.text()),
      (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || /abort/i.test(e.message)),
    );
  } finally {
    server.close();
  }
});
