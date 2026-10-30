---
description: "Choosing and configuring a tiny-crow model backend: built-ins, custom OpenAI-compatible endpoints, key lookup, transports, and caching."
---

# Model providers

Use this guide to select a built-in backend or configure a custom OpenAI-compatible endpoint. Provider-specific setup is collected in the [provider recipes](#provider-recipes).

Tiny Crow can talk to seven backends out of the box, and anything
else that speaks the OpenAI wire format can be added as a custom
provider. This page covers choosing one, pointing the agent at your
own endpoint, how a key is found, the two OpenAI transports, and
how prompt caching behaves on each backend.

## Select a provider and model

Three routes lead to the same choice: a line in the config file, a
command-line flag, or an environment variable. The flag and the
variable look like this:

```
tiny-crow --provider anthropic
```

```
tiny-crow --provider openai --model gpt-5.4-mini
```

The second example also picks a model, which can equally be done
with `--model` on its own or with `TC_MODEL`. The provider flag
has a matching variable, `TC_PROVIDER`.

The full set, as flags paired with variables and meanings:

- `--provider` / `TC_PROVIDER` — provider name.
- `--model` / `TC_MODEL` — model name.
- `--quick-model` — a named quick model from config.
- `--api-key` — API key (visible in `ps`).
- `--max-tokens` — maximum response tokens.
- `--temperature` — model temperature (0.0–2.0).
- `--max-agent-turns` — maximum agent turns per response.

## Built-in providers

- OpenRouter, config name `openrouter`, key variable
  `OPENROUTER_API_KEY` by default.
- OpenAI, config name `openai`, key variable `OPENAI_API_KEY`.
- Anthropic, config name `anthropic`, key variable
  `ANTHROPIC_API_KEY`.
- Gemini, config names `gemini` / `google`, key variable
  `GEMINI_API_KEY`.
- Ollama, config name `ollama`, no key required.
- OpenCode Zen, config name `opencode-zen`, key variable
  `OPENCODE_API_KEY`, optional — without a key only the free
  models work.
- OpenCode Go, config name `opencode-go`, key variable
  `OPENCODE_API_KEY`.

## Provider recipes

Some services need more than a key and a name. Step-by-step
recipes live in their own pages: ApiRoute in
providers/ApiRoute.md, Cheaper Inference in
providers/CheaperInference.md, MiniMax in providers/Minimax.md,
OpenCode Zen / Go in providers/OpencodeZenGo.md, and Opper in
providers/Opper.md.

## Configure a custom endpoint

A custom provider is how you reach a vLLM server, a LiteLLM proxy,
a local model, an enterprise gateway, or any other OpenAI-compatible
API. Custom providers live under the `custom_providers` key in the
config file:

```json
{"custom_providers":{"local-llm":{"provider_type":"openai","base_url":"http://localhost:9000/v1","api_key_env":"LOCAL_LLM_API_KEY","model":"mistral-small"},"office-gateway":{"provider_type":"openai","base_url":"https://gateway.internal.example/v2","model":"glm"}}}
```

Every field you can set on a custom provider, and what it means:

- `provider_type`, a string: one of the built-in provider types —
  `openrouter`, `openai`, `anthropic`, `gemini`, `ollama`,
  `opencode-zen`, or `opencode-go`.
- `base_url`, a string: the base URL of the API.
- `api_key_env`, a string, optional: the environment variable that
  holds the API key. If absent, the default for the provider kind
  is used.
- `api_style`, a string, optional: for OpenAI-based providers,
  `"responses"` (Responses API, the default when no `base_url` is
  set) or `"completions"` (Chat Completions, the default when a
  `base_url` is set).
- `headers`, an object, optional: HTTP headers sent with every
  request. Values may expand `${ENV_VAR}` references.
- `danger_accept_invalid_certs`, a boolean, optional: turns off TLS
  certificate verification, which exposes you to
  man-in-the-middle risk — use with care.
- `timeout_secs`, an integer, optional: a deadline in seconds for
  the whole request, covering the streamed reply, so leave it
  unset unless a gateway demands one. Unset, completions have no
  deadline (a 5s connect cap, and failure after 300s of silence)
  and `GET /models` calls are capped at 8s per attempt. Like
  `headers`, this applies to `provider_type: openai` only.
- `model`, a string, optional: the default model for this
  provider, used when no model is given through `--model` or
  `TC_MODEL`.

## Context limits and pricing discovery

For a custom provider, tiny-crow asks the endpoint itself what it
supports. It reads `GET {base_url}/models` and, when the listing
carries OpenRouter-style `context_length` and `pricing` fields
(pricing may arrive as strings, as on OpenRouter, or as plain
numbers), uses them to drive the statusline context meter,
automatic compaction, and cost tracking. An endpoint whose listing
leaves those fields out falls back to `128000`. You can override
the discovered value by setting `context_window` in the config (or
on a single quick model); a configured value always beats live
discovery.

## Expand environment variables in headers

Header values can pull in environment variables with `${VAR}`
syntax, so a secret never has to sit in the config file itself.
For example, a gateway entry can carry two access headers whose
values come from the environment: the header
`cf-access-client-id` taking `${CF_ACCESS_CLIENT_ID}`, and the
header `cf-access-client-secret` taking
`${CF_ACCESS_CLIENT_SECRET}`. In JSON form that headers object is
written as:

```json
{"headers":{"cf-access-client-id":"${CF_ACCESS_CLIENT_ID}","cf-access-client-secret":"${CF_ACCESS_CLIENT_SECRET}"}}
```

## API key lookup order

When tiny-crow needs an API key, it looks in this order, taking the
first value it finds:

1. The `--api-key` flag — handy, but the value shows up in process
   listings, so use it with care.
2. An environment variable — the custom one named by
   `api_key_env`, or the default variable for the provider kind.
3. The config file's `api_keys` map — keyed by provider slug or by
   custom provider name.
4. Ollama — supplies an empty string, since no key is required.

Keys kept in the config file look like this:

```json
{"api_keys":{"openai":"sk-...","anthropic":"sk-ant-..."}}
```

## OpenAI API transports

The OpenAI provider can speak two transports:

- Responses API (`/responses`) — the default against OpenAI's own
  API. GPT-5-series models need it, because they reject
  `max_tokens` on Chat Completions.
- Chat Completions API (`/chat/completions`) — the default once a
  custom `base_url` is set, since most OpenAI-compatible gateways
  implement only this endpoint.

To force one or the other, set `api_style: "responses"` or
`api_style: "completions"` on a custom provider, or set `api_style`
on the built-in OpenAI provider.

## Prompt caching by backend

Tiny Crow turns prompt caching on automatically wherever the
underlying provider client can do it. What happens next depends on
the backend behind the model you picked.

### One OpenRouter gap worth knowing about first

OpenRouter's `apply_prompt_caching` marks the system message only.
The Anthropic provider also marks the last message, so tool results
accumulated from earlier turns stay cached as the conversation
grows; OpenRouter leaves that position unmarked.

On tool-heavy work this shows up as roughly 2,676 tokens billed at
full input rate on OpenRouter against roughly 4 tokens on Anthropic
direct — a gap of about 8% per turn. Most of the saving comes from
caching the system prompt and the tools, and both routes capture
that part.

This is a limitation on the provider's side, not something specific
to tiny-crow.

### Backends that cache with no extra work from you

These cache on the server side with no markers in the request:

- OpenAI — kicks in automatically above about 1024 tokens, with a
  50% discount on cached input.
- Google Gemini 2.5 and later — implicit caching, 75% discount.
- DeepSeek — automatic, persists across days, about 90% discount.
- xAI / Grok — automatic, 75% discount; it benefits from an
  `x-grok-conv-id` header, which tiny-crow does not currently
  send.
- Moonshot and Groq (Kimi K2) — automatic.

For these backends tiny-crow simply hands through to the provider
client, with no extra configuration.

### Backends where tiny-crow adds the markers

These need `cache_control` markers in the request, and the provider
client in tiny-crow adds them:

- Anthropic (direct API) — marks the system prompt, the final tool
  definition, and the last message. All three breakpoints add up to
  cumulative savings as a conversation lengthens.
- Claude via OpenRouter — marks the system prompt only. Anthropic
  caching works on prefixes, so the tools array sitting in front of
  the system block is captured too. For `anthropic/*` model IDs,
  tiny-crow also fixes `provider.order = ["Anthropic"]` with
  `allow_fallbacks: true`, because Bedrock and Vertex AI quietly
  drop `cache_control` markers.

### What caching actually saved in a real session

Measured on Sonnet 4.6, on the second turn of a tool-heavy session
(grep plus read across the tiny-crow repo, with a system prompt of
roughly 6k tokens including AGENTS.md and ARCHITECTURE.md):

- No caching at all: second-turn cost $0.186, no saving.
- Anthropic, with caching: second-turn cost $0.024, a saving of
  87%.
- OpenRouter Claude, caching: second-turn cost $0.026, a saving of
  86%.

At 50 such turns per working day, the projected monthly bill falls
from $204 with no caching to $26 on Anthropic direct or $29 through
OpenRouter Claude. The two cached routes land within about $3 a
month of each other.

**Bottom line:** if you hold both keys, Anthropic direct is slightly
cheaper. If you hold only one, OpenRouter Claude with caching still
captures most of the saving.
