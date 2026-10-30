import type { ModelEntry } from "./provider.ts";

export interface CatalogModelEntry {
  id: string;
  display: string;
  contextLength?: number;
  kind?: string;
  inputPrice?: number;
  outputPrice?: number;
}

const CATALOG: Record<string, CatalogModelEntry[]> = {
  "anthropic": [
    {
      "id": "claude-fable-5",
      "display": "Claude Fable 5",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 10,
      "outputPrice": 50
    },
    {
      "id": "claude-fable-5-1",
      "display": "Claude Fable 5.1",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 10,
      "outputPrice": 50
    },
    {
      "id": "claude-haiku-4-5",
      "display": "Claude Haiku 4.5 (latest)",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": 1,
      "outputPrice": 5
    },
    {
      "id": "claude-haiku-4-5-20251001",
      "display": "Claude Haiku 4.5",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": 1,
      "outputPrice": 5
    },
    {
      "id": "claude-haiku-5-5",
      "display": "Claude Haiku 5.5",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 0.1,
      "outputPrice": 0.5
    },
    {
      "id": "claude-opus-4-5",
      "display": "Claude Opus 4.5 (latest)",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": 5,
      "outputPrice": 25
    },
    {
      "id": "claude-opus-4-5-20251101",
      "display": "Claude Opus 4.5",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": 5,
      "outputPrice": 25
    },
    {
      "id": "claude-opus-4-6",
      "display": "Claude Opus 4.6",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 5,
      "outputPrice": 25
    },
    {
      "id": "claude-opus-4-7",
      "display": "Claude Opus 4.7",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 5,
      "outputPrice": 25
    },
    {
      "id": "claude-opus-4-8",
      "display": "Claude Opus 4.8",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 5,
      "outputPrice": 25
    },
    {
      "id": "claude-opus-5",
      "display": "Claude Opus 5",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 5,
      "outputPrice": 25
    },
    {
      "id": "claude-opus-5-5",
      "display": "Claude Opus 5.5",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 4,
      "outputPrice": 20
    },
    {
      "id": "claude-sonnet-4-5",
      "display": "Claude Sonnet 4.5 (latest)",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": 3,
      "outputPrice": 15
    },
    {
      "id": "claude-sonnet-4-5-20250929",
      "display": "Claude Sonnet 4.5",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": 3,
      "outputPrice": 15
    },
    {
      "id": "claude-sonnet-4-6",
      "display": "Claude Sonnet 4.6",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 3,
      "outputPrice": 15
    },
    {
      "id": "claude-sonnet-5",
      "display": "Claude Sonnet 5",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 2,
      "outputPrice": 10
    },
    {
      "id": "claude-sonnet-5-5",
      "display": "Claude Sonnet 5.5",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 2,
      "outputPrice": 10
    }
  ],
  "openai": [
    {
      "id": "gpt-3.5-turbo",
      "display": "GPT-3.5-turbo",
      "contextLength": 16385,
      "kind": null,
      "inputPrice": 0.5,
      "outputPrice": 1.5
    },
    {
      "id": "gpt-4",
      "display": "GPT-4",
      "contextLength": 8192,
      "kind": null,
      "inputPrice": 30,
      "outputPrice": 60
    },
    {
      "id": "gpt-4-turbo",
      "display": "GPT-4 Turbo",
      "contextLength": 128000,
      "kind": null,
      "inputPrice": 10,
      "outputPrice": 30
    },
    {
      "id": "gpt-4.1",
      "display": "GPT-4.1",
      "contextLength": 1047576,
      "kind": null,
      "inputPrice": 2,
      "outputPrice": 8
    },
    {
      "id": "gpt-4.1-mini",
      "display": "GPT-4.1 mini",
      "contextLength": 1047576,
      "kind": null,
      "inputPrice": 0.4,
      "outputPrice": 1.6
    },
    {
      "id": "gpt-4.1-nano",
      "display": "GPT-4.1 nano",
      "contextLength": 1047576,
      "kind": null,
      "inputPrice": 0.1,
      "outputPrice": 0.4
    },
    {
      "id": "gpt-4o",
      "display": "GPT-4o",
      "contextLength": 128000,
      "kind": null,
      "inputPrice": 2.5,
      "outputPrice": 10
    },
    {
      "id": "gpt-4o-2024-05-13",
      "display": "GPT-4o (2024-05-13)",
      "contextLength": 128000,
      "kind": null,
      "inputPrice": 5,
      "outputPrice": 15
    },
    {
      "id": "gpt-4o-2024-08-06",
      "display": "GPT-4o (2024-08-06)",
      "contextLength": 128000,
      "kind": null,
      "inputPrice": 2.5,
      "outputPrice": 10
    },
    {
      "id": "gpt-4o-2024-11-20",
      "display": "GPT-4o (2024-11-20)",
      "contextLength": 128000,
      "kind": null,
      "inputPrice": 2.5,
      "outputPrice": 10
    },
    {
      "id": "gpt-4o-mini",
      "display": "GPT-4o mini",
      "contextLength": 128000,
      "kind": null,
      "inputPrice": 0.15,
      "outputPrice": 0.6
    },
    {
      "id": "gpt-5",
      "display": "GPT-5",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": 1.25,
      "outputPrice": 10
    },
    {
      "id": "gpt-5-mini",
      "display": "GPT-5 Mini",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": 0.25,
      "outputPrice": 2
    },
    {
      "id": "gpt-5-nano",
      "display": "GPT-5 Nano",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": 0.05,
      "outputPrice": 0.4
    },
    {
      "id": "gpt-5-pro",
      "display": "GPT-5 Pro",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": 15,
      "outputPrice": 120
    },
    {
      "id": "gpt-5.1",
      "display": "GPT-5.1",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": 1.25,
      "outputPrice": 10
    },
    {
      "id": "gpt-5.2",
      "display": "GPT-5.2",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": 1.75,
      "outputPrice": 14
    },
    {
      "id": "gpt-5.2-pro",
      "display": "GPT-5.2 Pro",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": 21,
      "outputPrice": 168
    },
    {
      "id": "gpt-5.3-codex",
      "display": "GPT-5.3 Codex",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": 1.75,
      "outputPrice": 14
    },
    {
      "id": "gpt-5.3-codex-spark",
      "display": "GPT-5.3 Codex Spark",
      "contextLength": 128000,
      "kind": null,
      "inputPrice": 1.75,
      "outputPrice": 14
    },
    {
      "id": "gpt-5.4",
      "display": "GPT-5.4",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": 2.5,
      "outputPrice": 15
    },
    {
      "id": "gpt-5.4-mini",
      "display": "GPT-5.4 mini",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": 0.75,
      "outputPrice": 4.5
    },
    {
      "id": "gpt-5.4-nano",
      "display": "GPT-5.4 nano",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": 0.2,
      "outputPrice": 1.25
    },
    {
      "id": "gpt-5.4-pro",
      "display": "GPT-5.4 Pro",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": 30,
      "outputPrice": 180
    },
    {
      "id": "gpt-5.5",
      "display": "GPT-5.5",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": 5,
      "outputPrice": 30
    },
    {
      "id": "gpt-5.5-pro",
      "display": "GPT-5.5 Pro",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": 30,
      "outputPrice": 180
    },
    {
      "id": "gpt-5.6",
      "display": "GPT-5.6",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": 4,
      "outputPrice": 20
    },
    {
      "id": "gpt-5.6-luna",
      "display": "GPT-5.6 Luna",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": 0.2,
      "outputPrice": 1.2
    },
    {
      "id": "gpt-5.6-sol",
      "display": "GPT-5.6 Sol",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": 4,
      "outputPrice": 20
    },
    {
      "id": "gpt-5.6-terra",
      "display": "GPT-5.6 Terra",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": 2,
      "outputPrice": 12
    },
    {
      "id": "gpt-6-astra",
      "display": "GPT-6 Astra",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": 10,
      "outputPrice": 50
    },
    {
      "id": "gpt-6-luna",
      "display": "GPT-6 Luna",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": 0.1,
      "outputPrice": 0.5
    },
    {
      "id": "gpt-6-sol",
      "display": "GPT-6 Sol",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": 2,
      "outputPrice": 10
    },
    {
      "id": "gpt-6.1-sol",
      "display": "GPT-6.1 Sol",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": 2,
      "outputPrice": 10
    },
    {
      "id": "gpt-daybreak-blue-latest",
      "display": "Daybreak Blue",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": 4,
      "outputPrice": 20
    },
    {
      "id": "gpt-daybreak-red-latest",
      "display": "Daybreak Red",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": 12.5,
      "outputPrice": 75
    },
    {
      "id": "o1",
      "display": "o1",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": 15,
      "outputPrice": 60
    },
    {
      "id": "o1-pro",
      "display": "o1-pro",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": 150,
      "outputPrice": 600
    },
    {
      "id": "o3",
      "display": "o3",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": 2,
      "outputPrice": 8
    },
    {
      "id": "o3-mini",
      "display": "o3-mini",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": 1.1,
      "outputPrice": 4.4
    },
    {
      "id": "o3-pro",
      "display": "o3-pro",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": 20,
      "outputPrice": 80
    },
    {
      "id": "o4-mini",
      "display": "o4-mini",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": 1.1,
      "outputPrice": 4.4
    }
  ],
  "gemini": [
    {
      "id": "deep-research-max-preview-04-2026",
      "display": "Deep Research Max Preview (Apr-21-2026)",
      "contextLength": 131072,
      "kind": null,
      "inputPrice": 2,
      "outputPrice": 12
    },
    {
      "id": "deep-research-preview-04-2026",
      "display": "Deep Research Preview (Apr-21-2026)",
      "contextLength": 131072,
      "kind": null,
      "inputPrice": 2,
      "outputPrice": 12
    },
    {
      "id": "gemini-2.5-computer-use-preview-10-2025",
      "display": "Gemini 2.5 Computer Use Preview 10-2025",
      "contextLength": 128000,
      "kind": null,
      "inputPrice": 1.25,
      "outputPrice": 10
    },
    {
      "id": "gemini-2.5-flash",
      "display": "Gemini 2.5 Flash",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 0.3,
      "outputPrice": 2.5
    },
    {
      "id": "gemini-2.5-flash-image",
      "display": "Nano Banana",
      "contextLength": 32768,
      "kind": null,
      "inputPrice": 0.3,
      "outputPrice": 30
    },
    {
      "id": "gemini-2.5-flash-lite",
      "display": "Gemini 2.5 Flash-Lite",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 0.1,
      "outputPrice": 0.4
    },
    {
      "id": "gemini-2.5-pro",
      "display": "Gemini 2.5 Pro",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 1.25,
      "outputPrice": 10
    },
    {
      "id": "gemini-3-flash-preview",
      "display": "Gemini 3 Flash Preview",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 0.5,
      "outputPrice": 3
    },
    {
      "id": "gemini-3-pro-image",
      "display": "Nano Banana Pro",
      "contextLength": 65536,
      "kind": null,
      "inputPrice": 2,
      "outputPrice": 120
    },
    {
      "id": "gemini-3-pro-image-preview",
      "display": "Nano Banana Pro",
      "contextLength": 131072,
      "kind": null,
      "inputPrice": 2,
      "outputPrice": 120
    },
    {
      "id": "gemini-3.1-flash-image",
      "display": "Nano Banana 2",
      "contextLength": 131072,
      "kind": null,
      "inputPrice": 0.5,
      "outputPrice": 60
    },
    {
      "id": "gemini-3.1-flash-image-preview",
      "display": "Nano Banana 2",
      "contextLength": 65536,
      "kind": null,
      "inputPrice": 0.5,
      "outputPrice": 60
    },
    {
      "id": "gemini-3.1-flash-lite",
      "display": "Gemini 3.1 Flash Lite",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 0.25,
      "outputPrice": 1.5
    },
    {
      "id": "gemini-3.1-flash-lite-image",
      "display": "Nano Banana 2 Lite",
      "contextLength": 65536,
      "kind": null,
      "inputPrice": 0.25,
      "outputPrice": 30
    },
    {
      "id": "gemini-3.1-flash-lite-preview",
      "display": "Gemini 3.1 Flash Lite Preview",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 0.25,
      "outputPrice": 1.5
    },
    {
      "id": "gemini-3.1-flash-live-preview",
      "display": "Gemini 3.1 Flash Live Preview",
      "contextLength": 131072,
      "kind": null,
      "inputPrice": 0.75,
      "outputPrice": 4.5
    },
    {
      "id": "gemini-3.1-pro-preview",
      "display": "Gemini 3.1 Pro Preview",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 2,
      "outputPrice": 12
    },
    {
      "id": "gemini-3.1-pro-preview-customtools",
      "display": "Gemini 3.1 Pro Preview Custom Tools",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 2,
      "outputPrice": 12
    },
    {
      "id": "gemini-3.5-flash",
      "display": "Gemini 3.5 Flash",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 1.5,
      "outputPrice": 9
    },
    {
      "id": "gemini-3.5-flash-lite",
      "display": "Gemini 3.5 Flash Lite",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 0.3,
      "outputPrice": 2.5
    },
    {
      "id": "gemini-3.5-live-translate-preview",
      "display": "Gemini 3.5 Live Translate Preview",
      "contextLength": 16384,
      "kind": null,
      "inputPrice": 3.5,
      "outputPrice": 21
    },
    {
      "id": "gemini-3.6-flash",
      "display": "Gemini 3.6 Flash",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 0.75,
      "outputPrice": 3.75
    },
    {
      "id": "gemini-3.7-flash",
      "display": "Gemini 3.7 Flash",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 0.75,
      "outputPrice": 3.75
    },
    {
      "id": "gemini-3.8-flash",
      "display": "Gemini 3.8 Flash",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 0.75,
      "outputPrice": 3.75
    },
    {
      "id": "gemini-4-argon",
      "display": "Gemini 4 Argon",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 2,
      "outputPrice": 10
    },
    {
      "id": "gemini-flash-latest",
      "display": "Gemini Flash Latest",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 0.75,
      "outputPrice": 3.75
    },
    {
      "id": "gemini-flash-lite-latest",
      "display": "Gemini Flash-Lite Latest",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 0.3,
      "outputPrice": 2.5
    },
    {
      "id": "gemini-pro-latest",
      "display": "Gemini Pro Latest",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 2,
      "outputPrice": 12
    },
    {
      "id": "gemma-4-26b-a4b-it",
      "display": "Gemma 4 26B A4B IT",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "gemma-4-31b-it",
      "display": "Gemma 4 31B IT",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "lyria-3-clip-preview",
      "display": "Lyria 3 Clip Preview",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 0,
      "outputPrice": 0
    },
    {
      "id": "lyria-3-pro-preview",
      "display": "Lyria 3 Pro Preview",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 0,
      "outputPrice": 0
    }
  ],
  "openrouter": [
    {
      "id": "anthropic/claude-fable-5",
      "display": "Claude Fable 5",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "anthropic/claude-fable-5.1",
      "display": "Claude Fable 5.1",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "anthropic/claude-haiku-4.5",
      "display": "Claude Haiku 4.5 (latest)",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "anthropic/claude-haiku-5.5",
      "display": "Claude Haiku 5.5",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "anthropic/claude-opus-4.1",
      "display": "Claude Opus 4.1 (latest)",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "anthropic/claude-opus-4.5",
      "display": "Claude Opus 4.5 (latest)",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "anthropic/claude-opus-4.6",
      "display": "Claude Opus 4.6",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "anthropic/claude-opus-4.7",
      "display": "Claude Opus 4.7",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "anthropic/claude-opus-4.8",
      "display": "Claude Opus 4.8",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "anthropic/claude-opus-5",
      "display": "Claude Opus 5",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "anthropic/claude-opus-5.5",
      "display": "Claude Opus 5.5",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "anthropic/claude-sonnet-4.5",
      "display": "Claude Sonnet 4.5 (latest)",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "anthropic/claude-sonnet-4.6",
      "display": "Claude Sonnet 4.6",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "anthropic/claude-sonnet-5",
      "display": "Claude Sonnet 5",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "anthropic/claude-sonnet-5.5",
      "display": "Claude Sonnet 5.5",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "deepseek/deepseek-chat",
      "display": "DeepSeek Chat",
      "contextLength": 163840,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "deepseek/deepseek-chat-v3-0324",
      "display": "DeepSeek V3 0324",
      "contextLength": 163840,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "deepseek/deepseek-chat-v3.1",
      "display": "DeepSeek V3.1",
      "contextLength": 163840,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "deepseek/deepseek-r1-0528",
      "display": "DeepSeek R1 0528",
      "contextLength": 163840,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "deepseek/deepseek-v3.1-terminus",
      "display": "DeepSeek V3.1 Terminus",
      "contextLength": 163840,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "deepseek/deepseek-v3.2",
      "display": "DeepSeek V3.2",
      "contextLength": 163840,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "deepseek/deepseek-v3.2-exp",
      "display": "DeepSeek V3.2 Exp",
      "contextLength": 163840,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "deepseek/deepseek-v4-flash",
      "display": "DeepSeek V4 Flash",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "deepseek/deepseek-v4-flash-0731",
      "display": "DeepSeek V4 Flash 0731",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "deepseek/deepseek-v4-flash-vision-exp",
      "display": "DeepSeek V4 Flash Vision Exp",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "deepseek/deepseek-v4-pro",
      "display": "DeepSeek V4 Pro",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "deepseek/deepseek-v4-pro-0813",
      "display": "DeepSeek V4 Pro 0813",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "deepseek/deepseek-v4.1-flash",
      "display": "DeepSeek V4.1 Flash",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "deepseek/deepseek-v4.1-flash-1017",
      "display": "DeepSeek V4.1 Flash 1017",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemini-2.5-flash",
      "display": "Gemini 2.5 Flash",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemini-2.5-flash-image",
      "display": "Nano Banana",
      "contextLength": 32768,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemini-2.5-flash-lite",
      "display": "Gemini 2.5 Flash-Lite",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemini-2.5-pro",
      "display": "Gemini 2.5 Pro",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemini-2.5-pro-preview",
      "display": "Gemini 2.5 Pro Preview 06-05",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemini-3-flash-preview",
      "display": "Gemini 3 Flash Preview",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemini-3-pro-image",
      "display": "Nano Banana Pro",
      "contextLength": 131072,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemini-3-pro-image-preview",
      "display": "Nano Banana Pro Preview",
      "contextLength": 65536,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemini-3.1-flash-image",
      "display": "Nano Banana 2",
      "contextLength": 131072,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemini-3.1-flash-image-preview",
      "display": "Nano Banana 2 Preview",
      "contextLength": 65536,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemini-3.1-flash-lite",
      "display": "Gemini 3.1 Flash Lite",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemini-3.1-flash-lite-image",
      "display": "Nano Banana 2 Lite",
      "contextLength": 65536,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemini-3.1-flash-lite-preview",
      "display": "Gemini 3.1 Flash Lite Preview",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemini-3.1-pro-preview",
      "display": "Gemini 3.1 Pro Preview",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemini-3.1-pro-preview-customtools",
      "display": "Gemini 3.1 Pro Preview Custom Tools",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemini-3.5-flash",
      "display": "Gemini 3.5 Flash",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemini-3.5-flash-lite",
      "display": "Gemini 3.5 Flash Lite",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemini-3.6-flash",
      "display": "Gemini 3.6 Flash",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemini-3.7-flash",
      "display": "Gemini 3.7 Flash",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemini-3.8-flash",
      "display": "Gemini 3.8 Flash",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemini-4-argon",
      "display": "Gemini 4 Argon",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemini-nano-banana-2.1",
      "display": "Nano Banana 2.1",
      "contextLength": 65536,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemma-2-27b-it",
      "display": "Gemma 2 27B",
      "contextLength": 8192,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemma-3-12b-it",
      "display": "Gemma 3 12B IT",
      "contextLength": 131072,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemma-3-27b-it",
      "display": "Gemma 3 27B IT",
      "contextLength": 131072,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemma-3-4b-it",
      "display": "Gemma 3 4B IT",
      "contextLength": 131072,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemma-4-26b-a4b-it",
      "display": "Gemma 4 26B A4B IT",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemma-4-26b-a4b-it:free",
      "display": "Gemma 4 26B A4B  (free)",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemma-4-31b-it",
      "display": "Gemma 4 31B IT",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/gemma-4-31b-it:free",
      "display": "Gemma 4 31B (free)",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/lyria-3-clip-preview",
      "display": "Lyria 3 Clip Preview",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "google/lyria-3-pro-preview",
      "display": "Lyria 3 Pro Preview",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "meta-llama/llama-3.1-70b-instruct",
      "display": "Llama-3.1-70B-Instruct",
      "contextLength": 131072,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "meta-llama/llama-3.1-8b-instruct",
      "display": "Llama-3.1-8B-Instruct",
      "contextLength": 131072,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "meta-llama/llama-3.2-1b-instruct",
      "display": "Llama 3.2 1B Instruct",
      "contextLength": 60000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "meta-llama/llama-3.2-3b-instruct",
      "display": "Llama 3.2 3B Instruct",
      "contextLength": 131072,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "meta-llama/llama-3.3-70b-instruct",
      "display": "Llama-3.3-70B-Instruct",
      "contextLength": 131072,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "meta-llama/llama-4-maverick",
      "display": "Llama 4 Maverick",
      "contextLength": 524288,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "meta-llama/llama-4-scout",
      "display": "Llama 4 Scout",
      "contextLength": 1310720,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "meta-llama/llama-guard-4-12b",
      "display": "Llama Guard 4 12B",
      "contextLength": 163840,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "mistralai/codestral-2508",
      "display": "Codestral 25.08",
      "contextLength": 256000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "mistralai/devstral-2512",
      "display": "Devstral 2",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "mistralai/ministral-14b-2512",
      "display": "Ministral 3 14B 2512",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "mistralai/ministral-3b-2512",
      "display": "Ministral 3 3B 2512",
      "contextLength": 131072,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "mistralai/ministral-8b-2512",
      "display": "Ministral 3 8B 2512",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "mistralai/mistral-large",
      "display": "Mistral Large",
      "contextLength": 128000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "mistralai/mistral-large-2407",
      "display": "Mistral Large 2407",
      "contextLength": 131072,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "mistralai/mistral-large-2512",
      "display": "Mistral Large 3",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "mistralai/mistral-large-4-0",
      "display": "Mistral Large 4",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "mistralai/mistral-medium-3",
      "display": "Mistral Medium 3",
      "contextLength": 131072,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "mistralai/mistral-medium-3-5",
      "display": "Mistral Medium 3.5",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "mistralai/mistral-medium-3.1",
      "display": "Mistral Medium 3.1",
      "contextLength": 131072,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "mistralai/mistral-nemo",
      "display": "Mistral Nemo",
      "contextLength": 131072,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "mistralai/mistral-saba",
      "display": "Saba",
      "contextLength": 32768,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "mistralai/mistral-small-24b-instruct-2501",
      "display": "Mistral Small 3",
      "contextLength": 32768,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "mistralai/mistral-small-2603",
      "display": "Mistral Small 4",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "mistralai/mistral-small-3.1-24b-instruct",
      "display": "Mistral Small 3.1 24B",
      "contextLength": 128000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "mistralai/mistral-small-3.2-24b-instruct",
      "display": "Mistral Small 3.2 24B",
      "contextLength": 256000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "mistralai/mixtral-8x22b-instruct",
      "display": "Mixtral 8x22B Instruct",
      "contextLength": 65536,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "mistralai/voxtral-small-24b-2507",
      "display": "Voxtral Small 24B 2507",
      "contextLength": 32768,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "moonshotai/kimi-k2",
      "display": "Kimi K2 0711",
      "contextLength": 131072,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "moonshotai/kimi-k2-0905",
      "display": "Kimi K2 Instruct 0905",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "moonshotai/kimi-k2-thinking",
      "display": "Kimi K2 Thinking",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "moonshotai/kimi-k2.5",
      "display": "Kimi K2.5",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "moonshotai/kimi-k2.6",
      "display": "Kimi K2.6",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "moonshotai/kimi-k2.7-code",
      "display": "Kimi K2.7 Code",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "moonshotai/kimi-k3",
      "display": "Kimi K3",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "moonshotai/kimi-k3.1-pro",
      "display": "Kimi K3.1 Pro",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-3.5-turbo-0613",
      "display": "GPT-3.5 Turbo (older v0613)",
      "contextLength": 4095,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-3.5-turbo-16k",
      "display": "GPT-3.5 Turbo 16k",
      "contextLength": 16385,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-4",
      "display": "GPT-4",
      "contextLength": 8191,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-4-turbo",
      "display": "GPT-4 Turbo",
      "contextLength": 128000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-4.1",
      "display": "GPT-4.1",
      "contextLength": 1047576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-4.1-mini",
      "display": "GPT-4.1 mini",
      "contextLength": 1047576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-4.1-nano",
      "display": "GPT-4.1 nano",
      "contextLength": 1047576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-4o",
      "display": "GPT-4o",
      "contextLength": 128000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-4o-2024-05-13",
      "display": "GPT-4o (2024-05-13)",
      "contextLength": 128000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-4o-2024-08-06",
      "display": "GPT-4o (2024-08-06)",
      "contextLength": 128000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-4o-2024-11-20",
      "display": "GPT-4o (2024-11-20)",
      "contextLength": 128000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-4o-mini",
      "display": "GPT-4o mini",
      "contextLength": 128000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-4o-mini-2024-07-18",
      "display": "GPT-4o-mini (2024-07-18)",
      "contextLength": 128000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-5",
      "display": "GPT-5",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-5-image",
      "display": "GPT-5 Image",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-5-image-mini",
      "display": "GPT-5 Image Mini",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-5-mini",
      "display": "GPT-5 Mini",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-5-nano",
      "display": "GPT-5 Nano",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-5-pro",
      "display": "GPT-5 Pro",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-5.1",
      "display": "GPT-5.1",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-5.1-codex",
      "display": "GPT-5.1 Codex",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-5.1-codex-max",
      "display": "GPT-5.1 Codex Max",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-5.1-codex-mini",
      "display": "GPT-5.1 Codex mini",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-5.2",
      "display": "GPT-5.2",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-5.2-chat",
      "display": "GPT-5.2 Chat",
      "contextLength": 128000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-5.2-codex",
      "display": "GPT-5.2 Codex",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-5.2-pro",
      "display": "GPT-5.2 Pro",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-5.3-codex",
      "display": "GPT-5.3 Codex",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-5.4",
      "display": "GPT-5.4",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-5.4-image-2",
      "display": "GPT-5.4 Image 2",
      "contextLength": 272000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-5.4-mini",
      "display": "GPT-5.4 mini",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-5.4-nano",
      "display": "GPT-5.4 nano",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-5.4-pro",
      "display": "GPT-5.4 Pro",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-5.5",
      "display": "GPT-5.5",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-5.5-pro",
      "display": "GPT-5.5 Pro",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-5.6-luna",
      "display": "GPT-5.6 Luna",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-5.6-luna-pro",
      "display": "GPT-5.6 Luna Pro",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-5.6-sol",
      "display": "GPT-5.6 Sol",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-5.6-sol-pro",
      "display": "GPT-5.6 Sol Pro",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-5.6-terra",
      "display": "GPT-5.6 Terra",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-5.6-terra-pro",
      "display": "GPT-5.6 Terra Pro",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-6-astra",
      "display": "GPT-6 Astra",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-6-astra-pro",
      "display": "GPT-6 Astra Pro",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-6-luna",
      "display": "GPT-6 Luna",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-6-luna-pro",
      "display": "GPT-6 Luna Pro",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-6-sol",
      "display": "GPT-6 Sol",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-6-sol-pro",
      "display": "GPT-6 Sol Pro",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-6.1-sol",
      "display": "GPT-6.1 Sol",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-6.1-sol-pro",
      "display": "GPT-6.1 Sol Pro",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-chat-latest",
      "display": "GPT Chat Latest",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-oss-120b",
      "display": "GPT OSS 120B",
      "contextLength": 131072,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-oss-20b",
      "display": "GPT OSS 20B",
      "contextLength": 131072,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/gpt-oss-safeguard-20b",
      "display": "GPT OSS Safeguard 20B",
      "contextLength": 131072,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/o1",
      "display": "o1",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/o1-pro",
      "display": "o1-pro",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/o3",
      "display": "o3",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/o3-mini",
      "display": "o3-mini",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/o3-mini-high",
      "display": "o3 Mini High",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/o3-pro",
      "display": "o3-pro",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/o4-mini",
      "display": "o4-mini",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "openai/o4-mini-high",
      "display": "o4 Mini High",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen-2.5-72b-instruct",
      "display": "Qwen2.5 72B Instruct",
      "contextLength": 32768,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen-2.5-7b-instruct",
      "display": "Qwen2.5 7B Instruct",
      "contextLength": 32768,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen-2.5-coder-32b-instruct",
      "display": "Qwen2.5-Coder-32B-Instruct",
      "contextLength": 32768,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen-plus",
      "display": "Qwen Plus",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen2.5-vl-72b-instruct",
      "display": "Qwen2.5-VL 72B Instruct",
      "contextLength": 128000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3-14b",
      "display": "Qwen3 14B",
      "contextLength": 40960,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3-235b-a22b-2507",
      "display": "Qwen3 235B A22B Instruct 2507",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3-235b-a22b-thinking-2507",
      "display": "Qwen3 235B-A22B Thinking 2507",
      "contextLength": 128000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3-30b-a3b",
      "display": "Qwen3 30B A3B",
      "contextLength": 40960,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3-30b-a3b-instruct-2507",
      "display": "Qwen3 30B-A3B Instruct 2507",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3-32b",
      "display": "Qwen3 32B",
      "contextLength": 131072,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3-coder",
      "display": "Qwen3 Coder 480B A35B",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3-coder-30b-a3b-instruct",
      "display": "Qwen3-Coder 30B-A3B Instruct",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3-coder-flash",
      "display": "Qwen3 Coder Flash",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3-coder-next",
      "display": "Qwen3 Coder Next",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3-next-80b-a3b-instruct",
      "display": "Qwen3-Next 80B-A3B Instruct",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3-next-80b-a3b-thinking",
      "display": "Qwen3-Next 80B-A3B (Thinking)",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3-vl-235b-a22b-instruct",
      "display": "Qwen3 VL 235B A22B Instruct",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3-vl-30b-a3b-instruct",
      "display": "Qwen3 VL 30B A3B Instruct",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3-vl-30b-a3b-thinking",
      "display": "Qwen3 VL 30B A3B Thinking",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3-vl-8b-instruct",
      "display": "Qwen3 VL 8B Instruct",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3.5-122b-a10b",
      "display": "Qwen3.5 122B-A10B",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3.5-27b",
      "display": "Qwen3.5 27B",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3.5-35b-a3b",
      "display": "Qwen3.5 35B-A3B",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3.5-397b-a17b",
      "display": "Qwen3.5 397B-A17B",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3.5-9b",
      "display": "Qwen3.5 9B",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3.5-flash-02-23",
      "display": "Qwen3.5-Flash",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3.5-plus-02-15",
      "display": "Qwen3.5 Plus 2026-02-15",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3.5-plus-20260420",
      "display": "Qwen3.5 Plus 2026-04-20",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3.6-27b",
      "display": "Qwen3.6 27B",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3.6-35b-a3b",
      "display": "Qwen3.6 35B-A3B",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3.6-flash",
      "display": "Qwen3.6 Flash",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3.6-plus",
      "display": "Qwen3.6 Plus",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3.7-flash",
      "display": "Qwen3.7 Flash",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3.7-max",
      "display": "Qwen3.7 Max",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3.7-plus",
      "display": "Qwen3.7 Plus",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3.8-2.4t-a95b",
      "display": "Qwen3.8 2.4T A95B",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3.8-27b",
      "display": "Qwen3.8 27B",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3.8-flash",
      "display": "Qwen3.8 Flash",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3.8-max-0902",
      "display": "Qwen3.8 Max 0902",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3.8-max-prime",
      "display": "Qwen 3.8 Max Prime",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "qwen/qwen3.8-omni-flash",
      "display": "Qwen3.8 Omni Flash",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "x-ai/grok-4.20",
      "display": "Grok 4.20",
      "contextLength": 2000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "x-ai/grok-4.20-multi-agent",
      "display": "Grok 4.20 Multi-Agent",
      "contextLength": 2000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "x-ai/grok-4.3",
      "display": "Grok 4.3",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "x-ai/grok-4.5",
      "display": "Grok 4.5",
      "contextLength": 500000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "x-ai/grok-4.6",
      "display": "Grok 4.6",
      "contextLength": 500000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "x-ai/grok-4.7",
      "display": "Grok 4.7",
      "contextLength": 500000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "x-ai/grok-build-0.1",
      "display": "Grok Build 0.1",
      "contextLength": 256000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "z-ai/glm-4.5",
      "display": "GLM-4.5",
      "contextLength": 131072,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "z-ai/glm-4.5-air",
      "display": "GLM-4.5-Air",
      "contextLength": 131072,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "z-ai/glm-4.5v",
      "display": "GLM-4.5V",
      "contextLength": 65536,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "z-ai/glm-4.6",
      "display": "GLM-4.6",
      "contextLength": 204800,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "z-ai/glm-4.6v",
      "display": "GLM-4.6V",
      "contextLength": 131072,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "z-ai/glm-4.7",
      "display": "GLM-4.7",
      "contextLength": 204800,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "z-ai/glm-4.7-flash",
      "display": "GLM-4.7-Flash",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "z-ai/glm-5",
      "display": "GLM-5",
      "contextLength": 204800,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "z-ai/glm-5-turbo",
      "display": "GLM-5-Turbo",
      "contextLength": 202752,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "z-ai/glm-5.1",
      "display": "GLM-5.1",
      "contextLength": 204800,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "z-ai/glm-5.2",
      "display": "GLM-5.2",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "z-ai/glm-5.3",
      "display": "GLM-5.3",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "z-ai/glm-5.3-flash",
      "display": "GLM-5.3-Flash",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "z-ai/glm-5.3-flashx",
      "display": "GLM 5.3 FlashX",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "z-ai/glm-5.3-prime",
      "display": "GLM 5.3 Prime",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    },
    {
      "id": "z-ai/glm-5v-turbo",
      "display": "GLM-5V-Turbo",
      "contextLength": 202752,
      "kind": null,
      "inputPrice": null,
      "outputPrice": null
    }
  ],
  "opencode-go": [
    {
      "id": "beam-free",
      "display": "Beam Free",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 0,
      "outputPrice": 0
    },
    {
      "id": "claude-haiku-5-5",
      "display": "Claude Haiku 5.5",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 0.1,
      "outputPrice": 0.5
    },
    {
      "id": "deepseek-v4-pro",
      "display": "DeepSeek V4 Pro (New)",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 0.66,
      "outputPrice": 1.98
    },
    {
      "id": "deepseek-v4.1-flash",
      "display": "DeepSeek V4.1 Flash",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 0.15,
      "outputPrice": 0.6
    },
    {
      "id": "glm-5.2",
      "display": "GLM-5.2",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 1.4,
      "outputPrice": 4.4
    },
    {
      "id": "glm-5.3",
      "display": "GLM-5.3",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 1.4,
      "outputPrice": 4.4
    },
    {
      "id": "glm-5.3-flash",
      "display": "GLM-5.3-Flash",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 0.15,
      "outputPrice": 0.5
    },
    {
      "id": "gpt-5.6-luna",
      "display": "GPT-5.6 Luna",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": 0.2,
      "outputPrice": 1.2
    },
    {
      "id": "gpt-6-luna",
      "display": "GPT-6 Luna",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": 0.1,
      "outputPrice": 0.5
    },
    {
      "id": "grok-4.7",
      "display": "Grok 4.7",
      "contextLength": 500000,
      "kind": null,
      "inputPrice": 2,
      "outputPrice": 6
    },
    {
      "id": "hy3",
      "display": "Hy3",
      "contextLength": 256000,
      "kind": null,
      "inputPrice": 0.14,
      "outputPrice": 0.58
    },
    {
      "id": "hy4-preview",
      "display": "Hy4 preview",
      "contextLength": 1024000,
      "kind": null,
      "inputPrice": 0.834,
      "outputPrice": 2.501
    },
    {
      "id": "iceman-contributor-free",
      "display": "Iceman Contributor Free",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": 0,
      "outputPrice": 0
    },
    {
      "id": "kimi-k2.7-code",
      "display": "Kimi K2.7 Code",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": 0.95,
      "outputPrice": 4
    },
    {
      "id": "kimi-k3",
      "display": "Kimi K3",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 3,
      "outputPrice": 15
    },
    {
      "id": "kimi-k3.1-pro",
      "display": "Kimi K3.1 Pro",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 2,
      "outputPrice": 10
    },
    {
      "id": "longcat-2.0",
      "display": "LongCat-2.0",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 0.3,
      "outputPrice": 1.2
    },
    {
      "id": "mimo-v2.5",
      "display": "MiMo V2.5",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 0.14,
      "outputPrice": 0.28
    },
    {
      "id": "mimo-v2.5-pro",
      "display": "MiMo V2.5 Pro",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 0.435,
      "outputPrice": 0.87
    },
    {
      "id": "mimo-v2.6-flash",
      "display": "MiMo-V2.6-Flash",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 0.14,
      "outputPrice": 0.28
    },
    {
      "id": "mimo-v2.6-pro",
      "display": "MiMo-V2.6-Pro",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 0.435,
      "outputPrice": 0.87
    },
    {
      "id": "minimax-m3",
      "display": "MiniMax-M3",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 0.3,
      "outputPrice": 1.2
    },
    {
      "id": "minimax-m3.1-flash",
      "display": "MiniMax M3.1 Flash",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 0.15,
      "outputPrice": 0.6
    },
    {
      "id": "muse-spark-1.2-contributor",
      "display": "Muse Spark 1.2 Contributor",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 0.1,
      "outputPrice": 0.2
    },
    {
      "id": "muse-spark-1.3-contributor",
      "display": "Muse Spark 1.3 Contributor",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 0.1,
      "outputPrice": 0.2
    },
    {
      "id": "qwen3.7-plus",
      "display": "Qwen3.7 Plus",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 0.4,
      "outputPrice": 1.6
    },
    {
      "id": "qwen3.8-flash",
      "display": "Qwen3.8 Flash",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 0.15,
      "outputPrice": 0.47
    },
    {
      "id": "qwen3.8-max",
      "display": "Qwen3.8 Max",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 2,
      "outputPrice": 6
    },
    {
      "id": "step-5-preview",
      "display": "Step 5 Preview",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 1,
      "outputPrice": 2.7
    }
  ],
  "opencode-zen": [
    {
      "id": "beam-free",
      "display": "Beam Free",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 0,
      "outputPrice": 0
    },
    {
      "id": "big-pickle",
      "display": "Big Pickle",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": 0,
      "outputPrice": 0
    },
    {
      "id": "claude-fable-5",
      "display": "Claude Fable 5",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 10,
      "outputPrice": 50
    },
    {
      "id": "claude-fable-5-1",
      "display": "Claude Fable 5.1",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 10,
      "outputPrice": 50
    },
    {
      "id": "claude-haiku-4-5",
      "display": "Claude Haiku 4.5",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": 1,
      "outputPrice": 5
    },
    {
      "id": "claude-haiku-5-5",
      "display": "Claude Haiku 5.5",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 0.1,
      "outputPrice": 0.5
    },
    {
      "id": "claude-opus-4-5",
      "display": "Claude Opus 4.5",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": 5,
      "outputPrice": 25
    },
    {
      "id": "claude-opus-4-6",
      "display": "Claude Opus 4.6",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 5,
      "outputPrice": 25
    },
    {
      "id": "claude-opus-4-7",
      "display": "Claude Opus 4.7",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 5,
      "outputPrice": 25
    },
    {
      "id": "claude-opus-4-8",
      "display": "Claude Opus 4.8",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 5,
      "outputPrice": 25
    },
    {
      "id": "claude-opus-5",
      "display": "Claude Opus 5",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 5,
      "outputPrice": 25
    },
    {
      "id": "claude-opus-5-5",
      "display": "Claude Opus 5.5",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 4,
      "outputPrice": 20
    },
    {
      "id": "claude-sonnet-4-5",
      "display": "Claude Sonnet 4.5",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 3,
      "outputPrice": 15
    },
    {
      "id": "claude-sonnet-4-6",
      "display": "Claude Sonnet 4.6",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 3,
      "outputPrice": 15
    },
    {
      "id": "claude-sonnet-5",
      "display": "Claude Sonnet 5",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 2,
      "outputPrice": 10
    },
    {
      "id": "claude-sonnet-5-5",
      "display": "Claude Sonnet 5.5",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 2,
      "outputPrice": 10
    },
    {
      "id": "deepseek-v4-flash",
      "display": "DeepSeek V4 Flash",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 0.14,
      "outputPrice": 0.28
    },
    {
      "id": "deepseek-v4-pro",
      "display": "DeepSeek V4 Pro",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 1.74,
      "outputPrice": 3.48
    },
    {
      "id": "deepseek-v4.1-flash",
      "display": "DeepSeek V4.1 Flash",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 0.3,
      "outputPrice": 1.2
    },
    {
      "id": "deepseek-v4.1-flash-free",
      "display": "DeepSeek V4.1 Flash Free",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": 0,
      "outputPrice": 0
    },
    {
      "id": "flint-40b-free",
      "display": "Flint 40B Free",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": 0,
      "outputPrice": 0
    },
    {
      "id": "glm-5",
      "display": "GLM-5",
      "contextLength": 204800,
      "kind": null,
      "inputPrice": 1,
      "outputPrice": 3.2
    },
    {
      "id": "glm-5.1",
      "display": "GLM-5.1",
      "contextLength": 204800,
      "kind": null,
      "inputPrice": 1.4,
      "outputPrice": 4.4
    },
    {
      "id": "glm-5.2",
      "display": "GLM-5.2",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 1.4,
      "outputPrice": 4.4
    },
    {
      "id": "glm-5.3",
      "display": "GLM-5.3",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 1.4,
      "outputPrice": 4.4
    },
    {
      "id": "glm-5.3-flash",
      "display": "GLM-5.3-Flash",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 0.15,
      "outputPrice": 0.5
    },
    {
      "id": "glm-5.3-flash-free",
      "display": "GLM-5.3-Flash Free",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": 0,
      "outputPrice": 0
    },
    {
      "id": "gpt-5",
      "display": "GPT-5",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": 1.07,
      "outputPrice": 8.5
    },
    {
      "id": "gpt-5-codex",
      "display": "GPT-5 Codex",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": 1.07,
      "outputPrice": 8.5
    },
    {
      "id": "gpt-5-nano",
      "display": "GPT-5 Nano",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": 0.05,
      "outputPrice": 0.4
    },
    {
      "id": "gpt-5.1",
      "display": "GPT-5.1",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": 1.07,
      "outputPrice": 8.5
    },
    {
      "id": "gpt-5.1-codex",
      "display": "GPT-5.1 Codex",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": 1.07,
      "outputPrice": 8.5
    },
    {
      "id": "gpt-5.1-codex-max",
      "display": "GPT-5.1 Codex Max",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": 1.25,
      "outputPrice": 10
    },
    {
      "id": "gpt-5.1-codex-mini",
      "display": "GPT-5.1 Codex Mini",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": 0.25,
      "outputPrice": 2
    },
    {
      "id": "gpt-5.2",
      "display": "GPT-5.2",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": 1.75,
      "outputPrice": 14
    },
    {
      "id": "gpt-5.2-codex",
      "display": "GPT-5.2 Codex",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": 1.75,
      "outputPrice": 14
    },
    {
      "id": "gpt-5.3-codex",
      "display": "GPT-5.3 Codex",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": 1.75,
      "outputPrice": 14
    },
    {
      "id": "gpt-5.3-codex-spark",
      "display": "GPT-5.3 Codex Spark",
      "contextLength": 128000,
      "kind": null,
      "inputPrice": 1.75,
      "outputPrice": 14
    },
    {
      "id": "gpt-5.4",
      "display": "GPT-5.4",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": 2.5,
      "outputPrice": 15
    },
    {
      "id": "gpt-5.4-mini",
      "display": "GPT-5.4 Mini",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": 0.75,
      "outputPrice": 4.5
    },
    {
      "id": "gpt-5.4-nano",
      "display": "GPT-5.4 Nano",
      "contextLength": 400000,
      "kind": null,
      "inputPrice": 0.2,
      "outputPrice": 1.25
    },
    {
      "id": "gpt-5.4-pro",
      "display": "GPT-5.4 Pro",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": 30,
      "outputPrice": 180
    },
    {
      "id": "gpt-5.5",
      "display": "GPT-5.5",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": 5,
      "outputPrice": 30
    },
    {
      "id": "gpt-5.5-pro",
      "display": "GPT-5.5 Pro",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": 30,
      "outputPrice": 180
    },
    {
      "id": "gpt-5.6-luna",
      "display": "GPT-5.6 Luna",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": 0.2,
      "outputPrice": 1.2
    },
    {
      "id": "gpt-5.6-sol",
      "display": "GPT-5.6 Sol",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": 4,
      "outputPrice": 20
    },
    {
      "id": "gpt-5.6-terra",
      "display": "GPT-5.6 Terra",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": 2,
      "outputPrice": 12
    },
    {
      "id": "gpt-6-astra",
      "display": "GPT-6 Astra",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": 10,
      "outputPrice": 50
    },
    {
      "id": "gpt-6-luna",
      "display": "GPT-6 Luna",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": 0.1,
      "outputPrice": 0.5
    },
    {
      "id": "gpt-6-sol",
      "display": "GPT-6 Sol",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": 2,
      "outputPrice": 10
    },
    {
      "id": "gpt-6.1-sol",
      "display": "GPT-6.1 Sol",
      "contextLength": 1050000,
      "kind": null,
      "inputPrice": 2,
      "outputPrice": 10
    },
    {
      "id": "grok-4.5",
      "display": "Grok 4.5",
      "contextLength": 500000,
      "kind": null,
      "inputPrice": 2,
      "outputPrice": 6
    },
    {
      "id": "grok-4.6",
      "display": "Grok 4.6",
      "contextLength": 500000,
      "kind": null,
      "inputPrice": 2,
      "outputPrice": 6
    },
    {
      "id": "grok-4.7",
      "display": "Grok 4.7",
      "contextLength": 500000,
      "kind": null,
      "inputPrice": 2,
      "outputPrice": 6
    },
    {
      "id": "grok-build-0.1",
      "display": "Grok Build 0.1",
      "contextLength": 256000,
      "kind": null,
      "inputPrice": 1,
      "outputPrice": 2
    },
    {
      "id": "kimi-k2.5",
      "display": "Kimi K2.5",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": 0.6,
      "outputPrice": 3
    },
    {
      "id": "kimi-k2.6",
      "display": "Kimi K2.6",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": 0.95,
      "outputPrice": 4
    },
    {
      "id": "kimi-k2.7-code",
      "display": "Kimi K2.7 Code",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": 0.95,
      "outputPrice": 4
    },
    {
      "id": "kimi-k3",
      "display": "Kimi K3",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 3,
      "outputPrice": 15
    },
    {
      "id": "mimo-v2.6-flash-free",
      "display": "MiMo-V2.6-Flash Free",
      "contextLength": 200000,
      "kind": null,
      "inputPrice": 0,
      "outputPrice": 0
    },
    {
      "id": "minimax-m2.5",
      "display": "MiniMax-M2.5",
      "contextLength": 204800,
      "kind": null,
      "inputPrice": 0.3,
      "outputPrice": 1.2
    },
    {
      "id": "minimax-m2.7",
      "display": "MiniMax-M2.7",
      "contextLength": 204800,
      "kind": null,
      "inputPrice": 0.3,
      "outputPrice": 1.2
    },
    {
      "id": "minimax-m3",
      "display": "MiniMax-M3",
      "contextLength": 512000,
      "kind": null,
      "inputPrice": 0.3,
      "outputPrice": 1.2
    },
    {
      "id": "mistral-large-4",
      "display": "Mistral Large 4",
      "contextLength": 524288,
      "kind": null,
      "inputPrice": 0.68,
      "outputPrice": 2.09
    },
    {
      "id": "muse-spark-1.2",
      "display": "Muse Spark 1.2",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 1.25,
      "outputPrice": 4.25
    },
    {
      "id": "muse-spark-1.3",
      "display": "Muse Spark 1.3",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 1.25,
      "outputPrice": 4.25
    },
    {
      "id": "muse-wonder-1.0",
      "display": "Muse Wonder",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 4,
      "outputPrice": 20
    },
    {
      "id": "nemotron-3-ultra-free",
      "display": "Nemotron 3 Ultra Free",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 0,
      "outputPrice": 0
    },
    {
      "id": "nemotron-3.5-lightning-free",
      "display": "Nemotron 3.5 Lightning Free",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": 0,
      "outputPrice": 0
    },
    {
      "id": "nemotron-3.5-super-vl-free",
      "display": "Nemotron 3.5 Super VL Free",
      "contextLength": 1048576,
      "kind": null,
      "inputPrice": 0,
      "outputPrice": 0
    },
    {
      "id": "qwen3.5-plus",
      "display": "Qwen3.5 Plus",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": 0.2,
      "outputPrice": 1.2
    },
    {
      "id": "qwen3.6-plus",
      "display": "Qwen3.6 Plus",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": 0.5,
      "outputPrice": 3
    },
    {
      "id": "qwen3.8-flash",
      "display": "Qwen3.8 Flash",
      "contextLength": 1000000,
      "kind": null,
      "inputPrice": 0.15,
      "outputPrice": 0.47
    },
    {
      "id": "qwen3.8-max",
      "display": "Qwen3.8 Max",
      "contextLength": 262144,
      "kind": null,
      "inputPrice": 2,
      "outputPrice": 6
    }
  ]
} as unknown as Record<string, CatalogModelEntry[]>;

export function catalogEntries(provider: string): readonly ModelEntry[] | undefined {
  return CATALOG[provider] as unknown as readonly ModelEntry[] | undefined;
}

export function catalogContextWindow(provider: string, modelId: string): number | undefined {
  const entries = CATALOG[provider];
  if (!entries) return undefined;
  const entry = entries.find((e) => e.id === modelId);
  return entry?.contextLength ?? undefined;
}

export function catalogInputOutputCost(
  provider: string,
  modelId: string,
): [number, number] | undefined {
  const entries = CATALOG[provider];
  if (!entries) return undefined;
  const entry = entries.find((e) => e.id === modelId);
  if (!entry || entry.inputPrice === undefined || entry.outputPrice === undefined) return undefined;
  return [entry.inputPrice, entry.outputPrice];
}
