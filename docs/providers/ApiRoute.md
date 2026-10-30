---
description: "Use API Route models with zerostack-ts through an OpenAI-compatible custom provider."
---

# API Route

[API Route](https://api-route.com) provides access to multiple model families
through an OpenAI-compatible API. Use zerostack-ts's custom provider configuration
to connect to its global Chat Completions endpoint.

## Credentials

Create an API key in your [API Route account](https://api-route.com), then set
it in your shell instead of storing it in the config:

```bash
export API_ROUTE_API_KEY="your-api-key"
```

## Provider Configuration

Add this table to your zerostack-ts config. See [Configuration](../CONFIG.md)
for config locations and project-local overrides.

```toml
[custom_providers.api-route]
provider_type = "openai"
base_url = "https://global.api-route.com/v1"
api_key_env = "API_ROUTE_API_KEY"
api_style = "completions"
model = "gpt-6.1-sol"
```

Keep `base_url` ending in `/v1`. The client appends `/chat/completions`, so
do not include that suffix in the configured URL. `api_style = "completions"`
explicitly selects Chat Completions rather than the Responses API.

Start a session with:

```bash
zerostack-ts --provider api-route --model gpt-6.1-sol
```

For a short text-only connectivity check:

```bash
zerostack-ts --provider api-route --model gpt-6.1-sol --no-tools --max-tokens 32 -p "Reply with exactly pong."
```

## Model IDs and Metadata

The example uses the exact model ID `gpt-6.1-sol`. To see the models available
to your account:

```bash
curl https://global.api-route.com/v1/models \
  -H "Authorization: Bearer $API_ROUTE_API_KEY"
```

Use a returned ID unchanged with `--model`. Catalog availability can differ
from inference availability.

API Route's model list does not currently include the OpenRouter-style
`context_length` and `pricing` fields that zerostack-ts reads. Do not interpret
zerostack-ts's fallback context window or zero cost estimate as provider metadata.
Configure a context budget appropriate for your selected model and account;
see [Live context window and pricing](../PROVIDERS.md#live-context-window-and-pricing).

For example, this optional quick model uses a conservative 32,768-token local
budget. This is a configuration choice, not a claim about the model's maximum
context length:

```toml
[quick_models.api-route-sol]
provider = "api-route"
model = "gpt-6.1-sol"
context_window = 32768
```

Select it with `zerostack-ts --quick-model api-route-sol --max-tokens 4096`.
A global `context_window` setting takes precedence over the quick model's value.
