---
description: "Configure LLM providers in tiny-crow: OpenRouter, OpenAI-compatible endpoints, Anthropic, Gemini, Ollama, custom headers, and prompt caching."
---

# Providers

Tiny Crow ships with seven built-in providers, and you can define
custom providers for any OpenAI-compatible endpoint.

## Built-in providers

| Provider     | Config name     | Default env var for API key |
| ------------ | --------------- | --------------------------- |
| OpenRouter   | `openrouter`    | `OPENROUTER_API_KEY`        |
| OpenAI       | `openai`        | `OPENAI_API_KEY`            |
| Anthropic    | `anthropic`     | `ANTHROPIC_API_KEY`         |
| Gemini       | `gemini` / `google` | `GEMINI_API_KEY`            |
| Ollama       | `ollama`        | (no key required)           |
| OpenCode Zen | `opencode-zen`  | `OPENCODE_API_KEY` (optional — without a key only the free models work) |
| OpenCode Go  | `opencode-go`   | `OPENCODE_API_KEY`          |

Pick a provider in the config file, with the `--provider` CLI flag, or
with the `TC_PROVIDER` environment variable:

```
tiny-crow --provider anthropic
```

Set the model with `--model` or `TC_MODEL`:

```
tiny-crow --provider openai --model gpt-4o
```

## Provider recipes

- [API Route](providers/ApiRoute.md)
- [Cheaper Inference](providers/CheaperInference.md)
- [MiniMax](providers/Minimax.md)
- [OpenCode Zen / Go](providers/OpencodeZenGo.md)
- [Opper](providers/Opper.md)

## Defining a custom provider

Custom providers point tiny-crow at any OpenAI-compatible API (vLLM,
LiteLLM, Ollama, local models, enterprise gateways, etc.). Define them
under the `custom_providers` key in the config file:

```json
{
  "custom_providers": {
    "local-vllm": {
      "provider_type": "openai",
      "base_url": "http://localhost:8000/v1",
      "api_key_env": "VLLM_API_KEY",
      "model": "gemma4"
    },
    "company-gateway": {
      "provider_type": "openai",
      "base_url": "https://gateway.example.com/v1",
      "model": "glm"
    }
  }
}
```

| Field                         | Type    | Description                                                                                                                                                                   |
| ----------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider_type`               | string  | Must be one of the built-in provider types (`openrouter`, `openai`, `anthropic`, `gemini`, `ollama`, `opencode-zen`, `opencode-go`). |
| `base_url`                    | string  | The API base URL.                                                                                                                                                             |
| `api_key_env`                 | string  | Optional. Name of an environment variable holding the API key. Falls back to the provider-kind default if not set.                                                            |
| `api_style`                   | string  | Optional. For OpenAI-based providers: `"responses"` (Responses API, default when no `base_url` is set) or `"completions"` (Chat Completions, default when `base_url` is set). |
| `headers`                     | object  | Optional. HTTP headers to include in every request. Values support `${ENV_VAR}` expansion.                                                                                    |
| `danger_accept_invalid_certs` | boolean | Optional. Disables TLS certificate verification (MITM risk — use with care).                                                                                                  |
| `timeout_secs`                | integer | Optional. Whole-request deadline in seconds; it covers the streamed reply, so leave it unset unless a gateway needs one. Unset: completions have no deadline (5s connect cap, request fails after 300s of silence) and `GET /models` requests are capped at 8s per attempt. Like `headers`, applies to `provider_type: openai` only. |
| `model`                       | string  | Optional. Default model name for this provider. Used when no model is specified via `--model` or `TC_MODEL`.                                                                  |

### Context window and pricing, discovered live

For custom providers, tiny-crow reads the context window and token
pricing live from `GET {base_url}/models` when the endpoint reports
OpenRouter-style `context_length` / `pricing` fields (pricing may be
strings, as on OpenRouter, or plain numbers). This drives the statusline
context meter, auto-compaction, and cost tracking. Providers whose
listing omits these fields fall back to `128000`; set `context_window`
in the config (or per quick model) to override — config values always
win over live discovery.

### Expanding variables in headers

Header values can reference environment variables with `${VAR}` syntax:

```json
{
  "custom_providers": {
    "company-gateway": {
      "provider_type": "openai",
      "base_url": "https://gateway.example.com/v1",
      "headers": {
        "cf-access-client-id": "${CF_ACCESS_CLIENT_ID}",
        "cf-access-client-secret": "${CF_ACCESS_CLIENT_SECRET}"
      }
    }
  }
}
```

## How an API key is found

The API key is resolved in this priority order:

1. **CLI flag** `--api-key` (visible in process listings — use with care)
2. **Environment variable** — either the custom one from `api_key_env`, or the
   default env var for the provider kind
3. **Config file** `api_keys` map — keyed by provider slug or custom provider name
4. **Ollama** — returns an empty string (no key required)

### Keys in the config file

```json
{
  "api_keys": {
    "openai": "sk-...",
    "anthropic": "sk-ant-..."
  }
}
```

## The two OpenAI transports

The OpenAI provider supports two API transports:

- **Responses API** (`/responses`) — the default for OpenAI's own API. Required
  for GPT-5-series models that reject `max_tokens` on Chat Completions.
- **Chat Completions API** (`/chat/completions`) — the default when a custom
  `base_url` is set, since most OpenAI-compatible gateways implement only this
  endpoint.

Override with `api_style: "responses"` or `api_style: "completions"` on a
custom provider, or set `api_style` on the built-in OpenAI provider to force
a specific transport.

## Prompt caching

Tiny Crow enables prompt caching automatically where the underlying
provider client supports it. Behaviour depends on which provider backs
the model you choose.

### Automatic — nothing for you to do

These providers cache server-side without any markers in the request:

- **OpenAI** — automatic above ~1024 tokens, 50% discount on cached input.
- **Google Gemini 2.5+** — implicit caching, 75% discount.
- **DeepSeek** — automatic, persistent across days, ~90% discount.
- **xAI / Grok** — automatic, 75% discount; benefits from setting an `x-grok-conv-id` header which tiny-crow does not currently send.
- **Moonshot, Groq (Kimi K2)** — automatic.

For these providers, tiny-crow passes through to the provider client
without additional configuration.

### Switched on by tiny-crow

These providers require `cache_control` markers; tiny-crow adds them via
prompt-caching support in the provider client:

- **Anthropic (direct API)** — marks system prompt, the final tool definition, and the last message. All three breakpoints contribute to cumulative savings as the conversation grows.
- **Claude via OpenRouter** — marks the system prompt only. Anthropic's caching is prefix-based, so the tools array in front of the system block is also captured. For `anthropic/*` model IDs, tiny-crow also pins `provider.order = ["Anthropic"]` with `allow_fallbacks: true`, because Bedrock and Vertex AI silently drop `cache_control` markers.

### What that saved in practice

Measured on Sonnet 4.6, second turn of a tool-heavy session (grep + read
across the tiny-crow repo, ~6k-token system prompt including AGENTS.md
and ARCHITECTURE.md):

| Configuration               | turn 2 cost | reduction |
| --------------------------- | ----------: | --------: |
| Baseline (no caching)       |      $0.186 |         — |
| Anthropic + caching         |      $0.024 |      -87% |
| OpenRouter Claude + caching |      $0.026 |      -86% |

Projected monthly cost at 50 such turns per working day: $204 (baseline)
→ $26 (Anthropic direct) or $29 (OpenRouter Claude). The two cached paths
are within ~$3/month of each other.

### A known OpenRouter limitation: the last message is not marked

OpenRouter's `apply_prompt_caching` marks the system message only. The
Anthropic provider also marks the last message, which means accumulated
tool results from earlier turns continue to be cached as the
conversation grows; OpenRouter does not mark this position.

On tool-heavy workloads this manifests as ~2,676 tokens running at full
input rate on OpenRouter vs ~4 tokens on Anthropic direct, a gap of ~8%
per turn. The bulk of savings comes from caching the system prompt and
tools — both paths capture that.

This is an upstream provider limitation, not tiny-crow-specific.

**Recommendation:** if you happen to have both API keys, Anthropic direct
is marginally cheaper. If you don't, OpenRouter Claude with caching
captures most of the savings.

## CLI flags

| Flag                | Env var       | Description                         |
| ------------------- | ------------- | ----------------------------------- |
| `--provider`        | `TC_PROVIDER` | Provider name                       |
| `--model`           | `TC_MODEL`    | Model name                          |
| `--quick-model`     | —             | Use a named quick model from config |
| `--api-key`         | —             | API key (visible in `ps`)           |
| `--max-tokens`      | —             | Maximum response tokens             |
| `--temperature`     | —             | Model temperature (0.0–2.0)         |
| `--max-agent-turns` | —             | Maximum agent turns per response    |
