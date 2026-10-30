// Regenerates data/models.json — the static model catalog baked into the
// TS port (see src/models_catalog.ts) — and data/tiny-crow-transports.json —
// the per-model transport map for the OpenCode Zen/Go gateways (see the
// transport handling in src/provider.ts). Source: https://models.dev/api.json,
// which lists every provider's model ids.
//
// The committed JSON files are the single build-time source of truth, so the
// program stays offline and reproducible. Run this (or let a scheduled
// workflow run it) to refresh the snapshot.
//
// Usage: node scripts/gen-models-catalog.ts [--source <url>] [--out-dir <dir>]
// Requires: Node >= 24 (global fetch only; no extra dependencies).
//
// The transformation below mirrors the original shell pipeline exactly:
// denied id substrings, text-output-only filtering, per-provider date
// cutoffs, the curated OpenRouter vendor subset, priced entries for the
// direct-API providers and the OpenCode gateways, plain entries for
// OpenRouter, and the npm-package-to-transport mapping for the gateways.
import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const MODELS_DEV_URL = "https://models.dev/api.json";
export const FETCH_TIMEOUT_MS = 120_000;

// Vendors kept for the curated OpenRouter subset (its full list is large;
// the rest are reachable on demand via `/models refresh`).
export const OPENROUTER_VENDORS: readonly string[] = [
  "anthropic",
  "openai",
  "google",
  "deepseek",
  "x-ai",
  "meta-llama",
  "mistralai",
  "qwen",
  "moonshotai",
  "z-ai",
];

// models.dev keeps the FULL history of each provider, including retired
// model ids the provider's API now rejects. We cannot read "retired" from
// the data, so we drop ids whose last_updated/release_date is older than
// a per-provider cutoff. Cutoffs were derived by cross-checking models.dev
// against each provider's LIVE /models API on 2026-06-04:
//   anthropic — retires aggressively; models.dev still lists the 2024
//     line that the API rejects. 2025-04-01 drops those and keeps the
//     newer line plus aliases.
//   openai/gemini/openrouter — ZERO stale ids found, so NO cutoff: a
//     cutoff would only delete still-valid models. Keys are by tiny-crow
//     provider name; "0000-00-00" = keep all.
// This is a heuristic snapshot — the authoritative list is always the
// provider's live API, reachable via `/models refresh`. Re-tune when a
// vendor retires a line.
export const CUTOFFS: Readonly<Record<string, string>> = {
  anthropic: "2025-04-01",
};

export const DENIED_SUBSTRINGS: readonly string[] = [
  "embedding",
  "embed-",
  "text-embedding",
  "gemini-embedding",
  "whisper",
  "transcribe",
  "tts",
  "-audio",
  "realtime",
  "speech",
  "dall-e",
  "gpt-image",
  "image-generation",
  "imagen",
  "sora",
  "veo",
  "moderation",
  "rerank",
  "aqa",
  "davinci-002",
  "babbage-002",
  "stable-diffusion",
  "flux",
];

export interface ModelsDevModel {
  id?: string;
  name?: string;
  limit?: { context?: number | null };
  cost?: { input?: number | null; output?: number | null };
  modalities?: { output?: string[] };
  status?: string;
  provider?: { npm?: string };
  last_updated?: string;
  release_date?: string;
}

export interface ModelsDevProvider {
  models?: Record<string, ModelsDevModel>;
}

export type ModelsDevApi = Record<string, ModelsDevProvider | undefined>;

export interface CatalogEntry {
  id: string;
  name: string;
  context: number | null;
  input_price?: number | null;
  output_price?: number | null;
}

export type Catalog = Record<string, CatalogEntry[]>;
export type Transports = Record<string, Record<string, string>>;

function byId(a: CatalogEntry, b: CatalogEntry): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function byKey(a: [string, string], b: [string, string]): number {
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
}

// ISO date strings compare correctly lexicographically.
export function isChatModel(
  key: string,
  model: ModelsDevModel,
  cutoff: string,
): boolean {
  const outputs = model.modalities?.output ?? [];
  if (!outputs.includes("text")) return false;
  const lowered = key.toLowerCase();
  if (DENIED_SUBSTRINGS.some((d) => lowered.includes(d))) return false;
  // A model with no date at all is treated as the earliest date, so the
  // keep-all cutoff "0000-00-00" keeps it and any real cutoff drops it.
  const date = model.last_updated ?? model.release_date ?? "0000-00-00";
  return date >= cutoff;
}

export function toEntry(key: string, model: ModelsDevModel): CatalogEntry {
  return {
    id: model.id ?? key,
    name: model.name ?? key,
    context: model.limit?.context ?? null,
  };
}

export function toPricedEntry(
  key: string,
  model: ModelsDevModel,
): CatalogEntry {
  return {
    ...toEntry(key, model),
    input_price: model.cost?.input ?? null,
    output_price: model.cost?.output ?? null,
  };
}

function entriesOf(
  provider: ModelsDevProvider | undefined,
): [string, ModelsDevModel][] {
  return Object.entries(provider?.models ?? {});
}

export function modelsOf(
  provider: ModelsDevProvider | undefined,
  cutoff: string,
  priced: boolean,
): CatalogEntry[] {
  return entriesOf(provider)
    .filter(([key, model]) => isChatModel(key, model, cutoff))
    .map(([key, model]) =>
      priced ? toPricedEntry(key, model) : toEntry(key, model),
    )
    .sort(byId);
}

// OpenCode Zen/Go slices: priced entries like the direct-API providers (the
// gateway /models listings carry no pricing). Retired ids are dropped via
// `status` (OpenCode marks them, unlike the date-cutoff providers above),
// and `@ai-sdk/google` models are skipped — this port only speaks the
// chat/responses/messages transports, not the Gemini-native endpoint.
export function opencodeModels(
  provider: ModelsDevProvider | undefined,
): CatalogEntry[] {
  return entriesOf(provider)
    .filter(([, model]) => model.status !== "deprecated")
    .filter(([, model]) => (model.provider?.npm ?? "") !== "@ai-sdk/google")
    .filter(([key, model]) => isChatModel(key, model, "0000-00-00"))
    .map(([key, model]) => toPricedEntry(key, model))
    .sort(byId);
}

export function buildCatalog(api: ModelsDevApi): Catalog {
  const openrouter = entriesOf(api["openrouter"])
    .filter(([key, model]) =>
      isChatModel(key, model, CUTOFFS["openrouter"] ?? "0000-00-00"),
    )
    .filter(([key]) => {
      const vendor = key.split("/")[0] ?? "";
      return OPENROUTER_VENDORS.includes(vendor);
    })
    .map(([key, model]) => toEntry(key, model))
    .sort(byId);
  return {
    anthropic: modelsOf(api["anthropic"], CUTOFFS["anthropic"] ?? "0000-00-00", true),
    openai: modelsOf(api["openai"], CUTOFFS["openai"] ?? "0000-00-00", true),
    gemini: modelsOf(api["google"], CUTOFFS["gemini"] ?? "0000-00-00", true),
    openrouter,
    "opencode-go": opencodeModels(api["opencode-go"]),
    "opencode-zen": opencodeModels(api["opencode"]),
  };
}

function transportFor(model: ModelsDevModel): string {
  const npm = model.provider?.npm ?? "";
  if (npm === "@ai-sdk/openai") return "responses";
  if (npm === "@ai-sdk/anthropic") return "messages";
  return "chat";
}

// Per-model transport for the OpenCode gateways: one provider id serves
// three API shapes, and the live /models listing says nothing about which
// model needs which. models.dev records the AI SDK package per model,
// which maps 1:1 onto the transport (`@ai-sdk/openai` hits /responses,
// `@ai-sdk/anthropic` hits /messages, everything else hits
// /chat/completions). Same filters as the slices above; models absent
// here fall back to chat at runtime with a warning.
export function opencodeTransports(
  provider: ModelsDevProvider | undefined,
): Record<string, string> {
  const pairs = entriesOf(provider)
    .filter(([, model]) => model.status !== "deprecated")
    .filter(([, model]) => (model.provider?.npm ?? "") !== "@ai-sdk/google")
    .filter(([key, model]) => isChatModel(key, model, "0000-00-00"))
    .map(([key, model]) => [key, transportFor(model)] as [string, string])
    .sort(byKey);
  return Object.fromEntries(pairs);
}

export function buildTransports(api: ModelsDevApi): Transports {
  return {
    "opencode-go": opencodeTransports(api["opencode-go"]),
    "opencode-zen": opencodeTransports(api["opencode"]),
  };
}

export function summarizeCounts(
  record: Record<string, { length: number } | Record<string, unknown>>,
): string {
  return Object.entries(record)
    .map(([key, value]) => {
      const n = Array.isArray(value) ? value.length : Object.keys(value).length;
      return `  ${key}: ${n} models`;
    })
    .join("\n");
}

export async function fetchModelsDev(
  source: string = MODELS_DEV_URL,
): Promise<ModelsDevApi> {
  const response = await fetch(source, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `fetching ${source} failed: ${response.status} ${response.statusText}`,
    );
  }
  return (await response.json()) as ModelsDevApi;
}

export function writeCatalogFiles(
  outDir: string,
  catalog: Catalog,
  transports: Transports,
): { modelsPath: string; transportsPath: string } {
  mkdirSync(outDir, { recursive: true });
  const modelsPath = path.join(outDir, "models.json");
  const transportsPath = path.join(outDir, "tiny-crow-transports.json");
  writeFileSync(modelsPath, JSON.stringify(catalog, null, 2) + "\n");
  writeFileSync(transportsPath, JSON.stringify(transports, null, 2) + "\n");
  return { modelsPath, transportsPath };
}

export interface GenArgs {
  source: string;
  outDir: string;
  help: boolean;
}

export function parseGenArgs(argv: string[], repoRoot: string): GenArgs {
  let source = MODELS_DEV_URL;
  let outDir = path.join(repoRoot, "data");
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--source" && i + 1 < argv.length) {
      source = argv[++i] as string;
    } else if (arg === "--out-dir" && i + 1 < argv.length) {
      outDir = argv[++i] as string;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return { source, outDir, help };
}

export function printGenHelp(): void {
  console.log(
    "Usage: node scripts/gen-models-catalog.ts [--source <url>] [--out-dir <dir>]",
  );
}

export async function runGenModelsCatalog(argv: string[]): Promise<void> {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");
  const args = parseGenArgs(argv, repoRoot);
  if (args.help) {
    printGenHelp();
    return;
  }
  console.error(`Fetching ${args.source} ... (cutoffs: ${JSON.stringify(CUTOFFS)})`);
  const api = await fetchModelsDev(args.source);
  const catalog = buildCatalog(api);
  const transports = buildTransports(api);
  const { modelsPath, transportsPath } = writeCatalogFiles(
    args.outDir,
    catalog,
    transports,
  );
  console.error(`Wrote ${modelsPath}`);
  console.error(summarizeCounts(catalog));
  console.error(`Wrote ${transportsPath}`);
  console.error(summarizeCounts(transports));
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("/gen-models-catalog.ts") ||
    process.argv[1].endsWith("\\gen-models-catalog.ts"));
if (isMain) {
  runGenModelsCatalog(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
