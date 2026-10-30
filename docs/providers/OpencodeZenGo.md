---
description: "Use OpenCode Zen and Go models with tiny-crow, including keyless free models."
---

# OpenCode Zen / Go

[OpenCode Zen](https://opencode.ai/docs/zen) (pay-as-you-go) and
[OpenCode Go](https://opencode.ai/docs/go) ($10/month subscription) are
curated gateways of models benchmarked for coding agents. Both are built
into tiny-crow as first-class providers sharing a single
`OPENCODE_API_KEY` environment variable.

## Your API key

Set the key in your shell rather than storing it in the tiny-crow
config:

```bash
export OPENCODE_API_KEY="your-api-key"
```

Zen also serves free models (e.g. `mimo-v2.5-free`, `big-pickle`) with
no key at all: when `opencode-zen` has no configured key, tiny-crow
sends the public credential, which only the free models accept. Paid
models reject it server-side, so add a real key for anything else. Go
has no free tier and always requires a key.

Every request carries a stable per-conversation session id
(`x-opencode-session`, the tiny-crow session id) that the gateways use
for routing and prompt-cache affinity. The free tier rejects requests
without it, so tiny-crow always sends it — no configuration needed.

```bash
tiny-crow --provider opencode-zen --model mimo-v2.5-free
tiny-crow --provider opencode-zen --model kimi-k2.6
tiny-crow --provider opencode-go --model kimi-k2.6
```

## Picking the right transport per model

One provider id covers three API shapes, and tiny-crow picks the right
one per model automatically (chat completions, responses, or
Anthropic-native messages), following each model's documented endpoint.
The mapping is baked into the program and refreshed weekly from
models.dev; run `/models refresh` for the live list.

```toml
[quick_models.kimi-zen]
provider = "opencode-zen"
model = "kimi-k2.6"

[quick_models.sonnet-zen]
provider = "opencode-zen"
model = "claude-sonnet-4-6"
```

Switch with `--quick-model kimi-zen` or `/provider opencode-zen`
followed by `/model kimi-k2.6`.

## Known limitations

- Gemini models served through Zen (`gemini-*-flash`) are not in the
  baked catalog: tiny-crow only speaks the chat/responses/messages
  transports, not the Gemini-native endpoint. Use the direct `gemini`
  provider for those.
- A model added after the last catalog refresh falls back to chat
  completions with a warning. If the fallback transport is wrong the
  request fails loudly; point a manual `custom_providers` entry at the
  same base URL with an explicit `provider_type`/`api_style` as an
  escape hatch until the catalog refreshes.
