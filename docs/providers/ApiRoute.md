---
description: "Connecting tiny-crow to API Route's gateway as a custom OpenAI-compatible provider, including its model catalogue."
---

# Configure API Route

API Route gathers models from several families behind one
OpenAI-compatible gateway. Tiny-crow ships no built-in entry for
it, so you declare it yourself as a custom provider aimed at the
gateway's worldwide Chat Completions endpoint.

## Discover available models

The block further down names the model ID `gpt-6.1-sol` exactly as
the gateway spells it, but do not take that id on trust: ask the
gateway what your account can actually reach, with a direct call
that lists its models:

```bash
curl -H "Authorization: Bearer $API_ROUTE_API_KEY" https://global.api-route.com/v1/models
```

Pass any ID from that listing to `--model` unchanged. Appearing in
the catalogue is not a promise that the model is currently servable
for inference.

## Configure the API key and provider

Grab a key from your [API Route account](https://api-route.com)
and export it in your shell. Keeping it out of the config file
means the file stays safe to share or check in:

```bash
export API_ROUTE_API_KEY="paste-key-here"
```

Drop this block into your tiny-crow config. If you are unsure
where that file lives, or how a project-local file layers on top
of it, see [Configuration](../CONFIG.md).

```toml
[custom_providers.api-route] # API Route gateway
provider_type="openai"
base_url="https://global.api-route.com/v1"
api_key_env="API_ROUTE_API_KEY"
api_style="completions"
model="gpt-6.1-sol"
```

Two details in that block are easy to get wrong. First, stop the
URL at `/v1`: tiny-crow tacks `/chat/completions` onto it when it
sends a request, so adding that path yourself would double it.
Second, `api_style="completions"` pins the Chat Completions
transport instead of letting the client drift toward the
Responses API.

Launch a session on this route with:

```bash
tiny-crow --provider api-route --model gpt-6.1-sol
```

And prove the wiring works with a tiny, tool-free round trip:

```bash
tiny-crow --provider api-route --model gpt-6.1-sol --no-tools --max-tokens 32 -p "Reply with exactly yes."
```

## Context and pricing metadata limitation

API Route's listing does not yet carry the OpenRouter-style
`context_length` and `pricing` fields that tiny-crow normally
reads. So if tiny-crow falls back to a generic context size or
shows no cost estimate, that is the absence of provider data, not
a statement about the model. Pick a context budget that fits the
model and your account yourself; the background is in
[Providers](../PROVIDERS.md).

As an illustration, the shortcut below gives this route a short
name with a deliberately cautious 32,768-token local budget.
That number is your own configuration decision, not a claim
about the model's real ceiling:

```toml
[quick_models.api-route-sol] # API Route shortcut
provider="api-route"
model="gpt-6.1-sol"
context_window=32768
```

Call it with `tiny-crow --quick-model api-route-sol --max-tokens 4096`.
Bear in mind that a top-level `context_window` setting still
overrides the shortcut's value.
