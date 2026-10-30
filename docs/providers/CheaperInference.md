---
description: "Use Cheaper Inference models with zerostack-ts through an OpenAI-compatible custom provider."
---

# Cheaper Inference

[Cheaper Inference](https://cheaperinference.com) is an OpenAI-compatible LLM
gateway. One API key gives access to models from several labs. Use zerostack-ts's
custom provider configuration to connect to its Chat Completions endpoint.

## Credentials

Create an API key at https://cheaperinference.com/signup, then set it in your
shell instead of storing it in the config:

```bash
export CHEAPER_INFERENCE_API_KEY="your-api-key"
```

## Provider Configuration

Add this table to your zerostack-ts config. See [Configuration](../CONFIG.md)
for config locations and project-local overrides.

```toml
[custom_providers.cheaper-inference]
provider_type = "openai"
base_url = "https://api.cheaperinference.com/v1"
api_key_env = "CHEAPER_INFERENCE_API_KEY"
api_style = "completions"
model = "gpt-5.4-mini"
```

Keep `base_url` ending in `/v1`. The client appends `/chat/completions`, so
do not include that suffix in the configured URL. `api_style = "completions"`
explicitly selects Chat Completions rather than the Responses API.

Start a session with:

```bash
zerostack-ts --provider cheaper-inference --model gpt-5.4-mini
```

For a short text-only connectivity check:

```bash
zerostack-ts --provider cheaper-inference --model gpt-5.4-mini --no-tools --max-tokens 32 -p "Reply with exactly pong."
```

## Model IDs and Metadata

The example uses the exact model ID `gpt-5.4-mini`. To see the models available
to your account:

```bash
curl https://api.cheaperinference.com/v1/models \
  -H "Authorization: Bearer $CHEAPER_INFERENCE_API_KEY"
```

Each row carries a `type` field; the `text` rows are the chat models. Use a
returned ID unchanged with `--model`.

The listing reports OpenRouter-style `context_length` and `pricing` fields, so
zerostack-ts reads the context window and token pricing live; see
[Live context window and pricing](../PROVIDERS.md#live-context-window-and-pricing).
A `context_window` set in the config (or per quick model) overrides the live
value.

An optional quick model gives the route a short name:

```toml
[quick_models.cheaper-inference-mini]
provider = "cheaper-inference"
model = "gpt-5.4-mini"
```

Select it with `zerostack-ts --quick-model cheaper-inference-mini`.
