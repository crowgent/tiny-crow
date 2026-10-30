import test from "node:test";
import assert from "node:assert/strict";
import { catalogEntries } from "../src/models_catalog.ts";

const ids = (provider: string): string[] =>
  (catalogEntries(provider) ?? []).map((m) => m.id);

test("catalog_parses_and_has_expected_providers", () => {
  for (const p of [
    "anthropic",
    "openai",
    "gemini",
    "openrouter",
    "opencode-zen",
    "opencode-go",
  ]) {
    assert.ok(ids(p).length > 0, `missing or empty baked catalog for: ${p}`);
  }
});

test("openrouter_includes_default_model", () => {
  assert.ok(
    ids("openrouter").includes("deepseek/deepseek-v4-pro"),
    "default model missing from baked openrouter catalog",
  );
});

test("unbaked_provider_has_no_catalog", () => {
  assert.equal(catalogEntries("ollama"), undefined);
});
