---
description: "Running OpenCode Zen and Go models in tiny-crow, including Zen's keyless free tier."
---

# Configure OpenCode Zen and Go

[OpenCode Zen](https://opencode.ai/docs/zen) charges as you go,
while [OpenCode Go](https://opencode.ai/docs/go) is a $10/month
subscription. Both are curated gateways whose models are
benchmarked for coding agents, and both ship in tiny-crow as
first-class providers. They share a single
`OPENCODE_API_KEY` environment variable between them.

## Model-specific API transports

Behind a single provider id, tiny-crow speaks three API shapes
— chat completions, responses, and Anthropic-native messages —
and it chooses between them per model on its own, following
each model's documented endpoint. That mapping is compiled into
the program and refreshed weekly from models.dev; `/models
refresh` pulls the live list whenever you want it fresh.

## API key and Zen free tier

Export your key in the shell rather than embedding it in the
config:

```bash
export OPENCODE_API_KEY="paste-key-here"
```

Zen has a wrinkle worth knowing: some of its models
(`mimo-v2.5-free`, `big-pickle`, and friends) cost nothing and
need no key at all. If the `opencode-zen` provider has no key
configured, tiny-crow sends a public credential on your behalf,
and only the free models accept it — paid models turn it away
server-side, so anything beyond the free tier still needs a
real key. Go, by contrast, has no free tier and always wants
a key.

Every request also carries a steady per-conversation session
identifier in the `x-opencode-session` header (it is just the
tiny-crow session id). The gateways lean on it for routing and
for keeping prompt caches warm, and the free tier refuses
requests that arrive without it — tiny-crow therefore sends it
on every call, with nothing for you to configure:

```bash
tiny-crow --provider opencode-zen --model mimo-v2.5-free
tiny-crow --provider opencode-zen --model kimi-k2.6
tiny-crow --provider opencode-go --model kimi-k2.6
```

## Quick models

Shortcuts make the common picks one word long:

```toml
[quick_models.kimi-zen] # Kimi on Zen
provider="opencode-zen"
model="kimi-k2.6"

[quick_models.sonnet-zen] # Sonnet on Zen
provider="opencode-zen"
model="claude-sonnet-4-6"
```

Use them with `--quick-model kimi-zen`, or switch inside a
session by running `/provider opencode-zen` and then
`/model` with `kimi-k2.6` as its argument.

## Limitations

- Gemini models served through Zen (`gemini-*-flash`) do not
  appear in the compiled catalog: tiny-crow speaks the
  chat, responses, and messages transports, but not the
  Gemini-native endpoint. For those models, use the direct
  `gemini` provider instead.
- A model that arrived after the most recent catalog refresh
  falls back to chat completions and warns you about it. When
  that fallback transport is the wrong one, the request fails
  outright rather than limping along; until the next refresh,
  your escape hatch is a manual `custom_providers` entry
  pointed at the same base URL with an explicit
  `provider_type` and `api_style`.
