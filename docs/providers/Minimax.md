---
description: "Getting MiniMax into tiny-crow across its two regions and two API shapes, with prices and local cost shortcuts."
---

# Configure MiniMax across regions and transports

There is no built-in MiniMax entry, so you declare it yourself as a
custom provider. One key unlocks four combinations: two regions
(global and China) crossed with two transports (OpenAI-shaped and
Anthropic-shaped). Every combination below draws on the same
environment variable, so you only ever manage a single secret.

## Model capabilities and pricing

Prices here are US dollars per million tokens, and they describe
the standard tier unless a tier is named.

- MiniMax-M3 carries a 1,000,000-token window, accepts text, image,
  and video input, and thinks adaptively or not at all, at $0.60 in,
  $2.40 out, and $0.12 for cache reads; no cache-write figure is
  published.
- MiniMax-M2.7 carries a 204,800-token window, accepts text only,
  and always thinks, at $0.30 in, $1.20 out, $0.06 for cache reads,
  and $0.375 for cache writes.

MiniMax-M3 also has tiered rates that move with the size of the
context you actually use:

- Standard tier, up to 512,000 tokens: $0.30 in, $1.20 out, $0.06
  cache read.
- Standard tier, over 512,000 tokens: $0.60 in, $2.40 out, $0.12
  cache read.
- Priority tier, up to 512,000 tokens: $0.45 in, $1.80 out, $0.09
  cache read.
- Priority tier, over 512,000 tokens: $0.90 in, $3.60 out, $0.18
  cache read.

## Available routes

- Global plus OpenAI shape: endpoint `https://api.minimax.io/v1`,
  provider name `minimax-global-openai`.
- China plus OpenAI shape: endpoint `https://api.minimaxi.com/v1`,
  provider name `minimax-cn-openai`.
- Global plus Anthropic shape: endpoint
  `https://api.minimax.io/anthropic`, provider name
  `minimax-global-anthropic`.
- China plus Anthropic shape: endpoint
  `https://api.minimaxi.com/anthropic`, provider name
  `minimax-cn-anthropic`.

Note the Anthropic endpoints carefully: they stop at `/anthropic`
because the Anthropic client appends `/v1/messages` itself. If you
put `/v1` into one of those URLs, the finished path comes out
wrong and requests fail.

## Configure the API key and routes

Put the secret in the shell, never in the configuration file:

```bash
export MINIMAX_API_KEY="paste-key-here"
```

Then add whichever routes you need to
`~/.config/tiny-crow/config.toml`:

```toml
[custom_providers.minimax-global-openai] # global, OpenAI shape
provider_type="openai"
base_url="https://api.minimax.io/v1"
api_key_env="MINIMAX_API_KEY"
api_style="completions"
model="MiniMax-M3"

[custom_providers.minimax-cn-openai] # China, OpenAI shape
provider_type="openai"
base_url="https://api.minimaxi.com/v1"
api_key_env="MINIMAX_API_KEY"
api_style="completions"
model="MiniMax-M3"

[custom_providers.minimax-global-anthropic] # global, Anthropic shape
provider_type="anthropic"
base_url="https://api.minimax.io/anthropic"
api_key_env="MINIMAX_API_KEY"
model="MiniMax-M3"

[custom_providers.minimax-cn-anthropic] # China, Anthropic shape
provider_type="anthropic"
base_url="https://api.minimaxi.com/anthropic"
api_key_env="MINIMAX_API_KEY"
model="MiniMax-M3"
```

Any route pairs with either model through the usual flags:

```bash
tiny-crow --provider minimax-global-openai --model MiniMax-M2.7
tiny-crow --provider minimax-cn-openai --model MiniMax-M3
tiny-crow --provider minimax-global-anthropic --model MiniMax-M2.7
tiny-crow --provider minimax-cn-anthropic --model MiniMax-M3
```

## Quick models and local cost estimates

The entries below bake the standard tier's full-window figures
into tiny-crow's own cost estimate, so the status line and usage
totals stay meaningful without a live price lookup:

```toml
[quick_models.minimax-m3] # M3 shortcut
provider="minimax-global-openai"
model="MiniMax-M3"
context_window=1000000
input_token_cost=0.6
output_token_cost=2.4

[quick_models.minimax-m2-7] # M2.7 shortcut
provider="minimax-global-openai"
model="MiniMax-M2.7"
context_window=204800
input_token_cost=0.3
output_token_cost=1.2
```

Reach either one with `--quick-model minimax-m3` or
`--quick-model minimax-m2-7`. To run the same model over a
different route, just change the `provider` value inside the
shortcut entry to one of the four names above.
