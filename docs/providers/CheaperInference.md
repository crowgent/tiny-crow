---
description: "Connecting tiny-crow to Cheaper Inference's multi-lab gateway as an OpenAI-compatible custom provider."
---

# Configure Cheaper Inference

Cheaper Inference is a gateway: one key opens models from a range
of labs through an OpenAI-compatible interface. Tiny-crow connects
to its Chat Completions endpoint by treating it as a custom
provider.

## Configure the API key and provider

Sign up and create a key at https://cheaperinference.com/signup,
then export it in your shell instead of writing it into the
config:

```bash
export CHEAPER_INFERENCE_API_KEY="paste-key-here"
```

Add this block to your tiny-crow config. Config locations and
the way a project-local file overrides the global one are covered
in [Configuration](../CONFIG.md).

```toml
[custom_providers.cheaper-inference] # Cheaper Inference gateway
provider_type="openai"
base_url="https://api.cheaperinference.com/v1"
api_key_env="CHEAPER_INFERENCE_API_KEY"
api_style="completions"
model="gpt-5.4-mini"
```

Stop the URL at `/v1` — tiny-crow appends `/chat/completions`
itself, so including that suffix would duplicate it. And
`api_style="completions"` makes the Chat Completions choice
explicit rather than leaving it to the Responses API.

Start a session on this route with:

```bash
tiny-crow --provider cheaper-inference --model gpt-5.4-mini
```

A quick, tool-free smoke test looks like this:

```bash
tiny-crow --provider cheaper-inference --model gpt-5.4-mini --no-tools --max-tokens 32 -p "Reply with exactly yes."
```

## Discover available models and metadata

The example names the model ID `gpt-5.4-mini` exactly as the
gateway spells it. List what your account can reach with:

```bash
curl -H "Authorization: Bearer $CHEAPER_INFERENCE_API_KEY" https://api.cheaperinference.com/v1/models
```

Every row in that listing carries a `type` field, and the rows
marked `text` are the chat models. Hand any returned ID to
`--model` verbatim.

Unlike some gateways, this listing does report OpenRouter-style
`context_length` and `pricing` fields, so tiny-crow picks up the
context window and per-token pricing live from it; see
[Providers](../PROVIDERS.md) for how that works. A
`context_window` you set yourself, either globally or inside a
quick model, still wins over the live value.

For convenience, give the route a short name:

```toml
[quick_models.cheaper-inference-mini] # Cheaper Inference shortcut
provider="cheaper-inference"
model="gpt-5.4-mini"
```

Then reach it with `tiny-crow --quick-model cheaper-inference-mini`.
