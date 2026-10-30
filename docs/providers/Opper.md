---
description: "Using Opper's EU-hosted gateway from tiny-crow over its OpenAI and Anthropic transports."
---

# Configure Opper as a model gateway

Opper fronts more than 700 models from over 50 providers behind a
single OpenAI-compatible API, and it is hosted in the EU.
Tiny-crow reaches it only through custom provider entries, with the
transport kept explicit and one `OPPER_API_KEY` variable shared
between the two routes.

## Model IDs and routing pools

A bare name such as `claude-sonnet-4-6` does not point at one
provider's deployment. It names a pool, and Opper picks the route
for each individual request. To pin a request to one provider's
route, write the id as `provider/model`, for instance
`anthropic/claude-sonnet-4-6`. The complete catalogue of ids sits
at https://opper.ai/models, and the price list, which is simply the
underlying providers' rates with no markup added, sits at
https://opper.ai/pricing.

Two models with pinned local context windows are worth knowing:

- `claude-sonnet-4-6` with a 1,000,000-token window.
- `gemini-3.8-flash` with a 1,048,576-token window.

## Configure the API key and routes

Create a key at https://platform.opper.ai and export it in your
shell, keeping it out of the config file:

```bash
export OPPER_API_KEY="paste-key-here"
```

Add the routes you need to `~/.config/tiny-crow/config.toml`:

```toml
[custom_providers.opper] # OpenAI shape
provider_type="openai"
base_url="https://api.opper.ai/v3/compat"
api_key_env="OPPER_API_KEY"
api_style="completions"
model="claude-sonnet-4-6"

[custom_providers.opper-anthropic] # Anthropic shape
provider_type="anthropic"
base_url="https://api.opper.ai/v3/compat"
api_key_env="OPPER_API_KEY"
model="claude-sonnet-4-6"
```

Both URLs stop at `/v3/compat` deliberately. The OpenAI client
appends `/chat/completions` and the Anthropic client appends
`/v1/messages` when a request goes out, so adding `/v1` yourself
would corrupt the finished path.

Pick a route and a model with the standard flags:

```bash
tiny-crow --provider opper --model gemini-3.8-flash
tiny-crow --provider opper --model claude-sonnet-4-6
tiny-crow --provider opper-anthropic --model gemini-3.8-flash
```

## Quick models and context windows

These entries fix the window for each model so tiny-crow does not
have to guess it:

```toml
[quick_models.opper-sonnet] # Sonnet shortcut
provider="opper"
model="claude-sonnet-4-6"
context_window=1000000

[quick_models.opper-flash] # Flash shortcut
provider="opper"
model="gemini-3.8-flash"
context_window=1048576
```

Reach them with `--quick-model opper-sonnet` or
`--quick-model opper-flash`. Changing the `provider` value inside
a shortcut entry moves it onto the other route above.
