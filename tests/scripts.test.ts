import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildCatalog,
  buildTransports,
  isChatModel,
  type ModelsDevApi,
  type ModelsDevModel,
} from "../scripts/gen-models-catalog.ts";
import {
  parseSyncArgs,
  syncVersion,
} from "../scripts/sync-version.ts";

function model(
  overrides: Partial<ModelsDevModel> = {},
): ModelsDevModel {
  return {
    id: "model-x",
    name: "Model X",
    limit: { context: 1000 },
    modalities: { output: ["text"] },
    ...overrides,
  };
}

test("gen: non-text and denied models are dropped", () => {
  // "embed-model" contains the denied substring "embed-".
  assert.equal(isChatModel("embed-model", model(), "0000-00-00"), false);
  assert.equal(
    isChatModel("plain", model({ modalities: { output: ["image"] } }), "0000-00-00"),
    false,
  );
  assert.equal(isChatModel("gpt-image-1", model(), "0000-00-00"), false);
  assert.equal(isChatModel("plain", model(), "0000-00-00"), true);
});

test("gen: anthropic date cutoff drops retired ids, keeps newer ones", () => {
  const old = model({ last_updated: "2025-02-01" });
  const kept = model({ last_updated: "2025-06-01" });
  const undated = model({ last_updated: undefined, release_date: undefined });
  assert.equal(isChatModel("claude-old", old, "2025-04-01"), false);
  assert.equal(isChatModel("claude-new", kept, "2025-04-01"), true);
  // No date at all falls back to "0000", which is below any real cutoff.
  assert.equal(isChatModel("claude-undated", undated, "2025-04-01"), false);
  assert.equal(isChatModel("claude-undated", undated, "0000-00-00"), true);
});

test("gen: catalog keeps priced direct entries, plain openrouter subset, sorted", () => {
  const api: ModelsDevApi = {
    anthropic: {
      models: {
        "claude-b": model({
          id: "claude-b",
          name: "Claude B",
          cost: { input: 3, output: 15 },
          last_updated: "2026-01-01",
        }),
        "claude-a": model({
          id: "claude-a",
          name: "Claude A",
          cost: { input: 1, output: 5 },
          last_updated: "2026-01-01",
        }),
        "claude-retired": model({
          id: "claude-retired",
          last_updated: "2024-01-01",
        }),
      },
    },
    openrouter: {
      models: {
        "anthropic/claude-x": model({ id: "anthropic/claude-x" }),
        "unknown-vendor/some-model": model({ id: "unknown-vendor/some-model" }),
        "openai/gpt-x": model({ id: "openai/gpt-x" }),
      },
    },
  };
  const catalog = buildCatalog(api);
  assert.deepEqual(
    (catalog["anthropic"] ?? []).map((m) => m.id),
    ["claude-a", "claude-b"],
  );
  assert.equal(catalog["anthropic"]?.[0]?.input_price, 1);
  assert.equal(catalog["anthropic"]?.[0]?.output_price, 5);
  assert.equal(catalog["anthropic"]?.[0]?.context, 1000);
  // OpenRouter entries are plain: no pricing keys at all.
  const openrouter = catalog["openrouter"] ?? [];
  assert.deepEqual(
    openrouter.map((m) => m.id),
    ["anthropic/claude-x", "openai/gpt-x"],
  );
  assert.equal("input_price" in (openrouter[0] ?? {}), false);
  assert.deepEqual(catalog["openai"], []);
  assert.deepEqual(catalog["gemini"], []);
});

test("gen: opencode slices drop deprecated and google-native models", () => {
  const api: ModelsDevApi = {
    "opencode-go": {
      models: {
        "good-chat": model({
          id: "good-chat",
          provider: { npm: "@ai-sdk/openai" },
          cost: { input: 2, output: 8 },
        }),
        "old-one": model({
          id: "old-one",
          status: "deprecated",
          provider: { npm: "@ai-sdk/openai" },
        }),
        "google-native": model({
          id: "google-native",
          provider: { npm: "@ai-sdk/google" },
        }),
      },
    },
    opencode: {
      models: {
        "anthropic-model": model({
          id: "anthropic-model",
          provider: { npm: "@ai-sdk/anthropic" },
        }),
        "other-model": model({ id: "other-model" }),
      },
    },
  };
  const catalog = buildCatalog(api);
  assert.deepEqual(
    (catalog["opencode-go"] ?? []).map((m) => m.id),
    ["good-chat"],
  );
  assert.equal(catalog["opencode-go"]?.[0]?.input_price, 2);
  const transports = buildTransports(api);
  assert.deepEqual(transports["opencode-go"], { "good-chat": "responses" });
  assert.deepEqual(transports["opencode-zen"], {
    "anthropic-model": "messages",
    "other-model": "chat",
  });
});

test("sync: rewrites version literals from package.json, then is stable", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "tiny-crow-sync-"));
  mkdirSync(path.join(root, "src"), { recursive: true });
  mkdirSync(path.join(root, "src", "ui"), { recursive: true });
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "tiny-crow", version: "9.9.9" }),
  );
  writeFileSync(
    path.join(root, "src", "cli.ts"),
    'export const CLI_NAME = "tiny-crow";\nexport const CLI_VERSION = "1.8.5";\n',
  );
  writeFileSync(
    path.join(root, "src", "logging.ts"),
    'export const VERSION = "1.8.5";\n',
  );
  writeFileSync(
    path.join(root, "src", "ui", "events.ts"),
    'export const TINY_CROW_VERSION = "0.1.0";\n',
  );

  const first = syncVersion(root);
  assert.equal(first.version, "9.9.9");
  assert.equal(first.results.filter((r) => r.updated).length, 3);
  assert.match(
    readFileSync(path.join(root, "src", "cli.ts"), "utf-8"),
    /CLI_VERSION = "9\.9\.9"/,
  );
  assert.match(
    readFileSync(path.join(root, "src", "logging.ts"), "utf-8"),
    /VERSION = "9\.9\.9"/,
  );
  assert.match(
    readFileSync(path.join(root, "src", "ui", "events.ts"), "utf-8"),
    /TINY_CROW_VERSION = "9\.9\.9"/,
  );

  const second = syncVersion(root);
  assert.equal(second.results.filter((r) => r.needsSync).length, 0);
  assert.equal(second.results.filter((r) => r.updated).length, 0);

  const checked = syncVersion(root, { check: true });
  assert.equal(checked.results.filter((r) => r.updated).length, 0);
});

test("sync: check mode reports drift without writing", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "tiny-crow-sync-"));
  mkdirSync(path.join(root, "src"), { recursive: true });
  mkdirSync(path.join(root, "src", "ui"), { recursive: true });
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ version: "2.0.0" }),
  );
  for (const [rel, line] of [
    ["src/cli.ts", 'export const CLI_VERSION = "1.0.0";'],
    ["src/logging.ts", 'export const VERSION = "1.0.0";'],
    ["src/ui/events.ts", 'export const TINY_CROW_VERSION = "1.0.0";'],
  ] as const) {
    writeFileSync(path.join(root, rel), line + "\n");
  }
  const result = syncVersion(root, { check: true });
  assert.equal(result.results.filter((r) => r.needsSync).length, 3);
  assert.equal(result.results.filter((r) => r.updated).length, 0);
  assert.match(
    readFileSync(path.join(root, "src", "cli.ts"), "utf-8"),
    /CLI_VERSION = "1\.0\.0"/,
  );
});

test("sync: arg parsing rejects unknown options", () => {
  assert.deepEqual(parseSyncArgs(["--check"]), { check: true, help: false });
  assert.deepEqual(parseSyncArgs([]), { check: false, help: false });
  assert.throws(() => parseSyncArgs(["--bogus"]), /Unknown option/);
});

test("sync: missing version constant fails loudly", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "tiny-crow-sync-"));
  mkdirSync(path.join(root, "src"), { recursive: true });
  mkdirSync(path.join(root, "src", "ui"), { recursive: true });
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ version: "2.0.0" }),
  );
  writeFileSync(path.join(root, "src", "cli.ts"), "// no version here\n");
  assert.throws(() => syncVersion(root), /does not contain/);
});
