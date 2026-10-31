import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { providerKindEnvVar, providerKindFromName } from "../provider.ts";
import { dataDir, load as loadConfig, richDefaultConfig } from "../config/load.ts";
import type { Config } from "../config/mod.ts";

export interface ConfigLike {
  provider?: string | null;
  model?: string | null;
  apiKeys?: Record<string, string> | null;
  quickModels?: Record<string, { provider: string; model: string }> | null;
  defaultPrompt?: string | null;
}

export function providerEnvName(name: string): string {
  const kind = providerKindFromName(name);
  if (kind === null) return "";
  return providerKindEnvVar(kind);
}

export function providerKeyState(apiKeys: Record<string, string> | undefined, name: string): string {
  if (name === "ollama" || name === "opencode-zen") return "no key needed";
  if (apiKeys !== undefined && (apiKeys[name] ?? "") !== "") return "key saved";
  const envName = providerEnvName(name);
  if (envName !== "" && (process.env[envName] ?? "") !== "") return "key saved";
  return "needs key";
}

export function setupReadyFromConfig(cfg: ConfigLike): boolean {
  const provider = cfg.provider ?? "openrouter";
  return providerKeyState(cfg.apiKeys ?? undefined, provider) !== "needs key";
}

export function loadSetupCfg(): Config {
  try {
    return loadConfig()[0];
  } catch {
    return richDefaultConfig();
  }
}

export interface SessionFileInfo {
  id: string;
  provider: string;
  model: string;
  messages: number;
  updated: number;
}

export function listSessionFiles(): SessionFileInfo[] {
  let files: string[] = [];
  try {
    files = readdirSync(path.join(dataDir(), "sessions"));
  } catch {
    return [];
  }
  const infos: SessionFileInfo[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const full = path.join(dataDir(), "sessions", file);
    try {
      const parsed = JSON.parse(readFileSync(full, "utf-8")) as Record<string, unknown>;
      const messages = Array.isArray(parsed["messages"]) ? parsed["messages"].length : 0;
      infos.push({
        id: typeof parsed["id"] === "string" ? parsed["id"] : file.slice(0, -5),
        provider: typeof parsed["provider"] === "string" ? parsed["provider"] : "",
        model: typeof parsed["model"] === "string" ? parsed["model"] : "",
        messages,
        updated: statSync(full).mtimeMs,
      });
    } catch {
      continue;
    }
  }
  infos.sort((a, b) => b.updated - a.updated);
  return infos.slice(0, 30);
}

export function listDirNames(dir: string, ext: string): string[] {
  let files: string[] = [];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  const names: string[] = [];
  for (const file of files) {
    if (file.endsWith(`.${ext}`)) names.push(file.slice(0, -(ext.length + 1)));
  }
  return [...new Set(names)].sort();
}

export function repoDataDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
}

export function listPromptNames(): string[] {
  return [
    ...new Set([
      ...listDirNames(path.join(repoDataDir(), "prompts"), "md"),
      ...listDirNames(path.join(dataDir(), "prompts"), "md"),
    ]),
  ].sort();
}

export function listThemeNames(): string[] {
  return [
    ...new Set([
      ...listDirNames(path.join(repoDataDir(), "themes"), "json"),
      ...listDirNames(path.join(dataDir(), "themes"), "json"),
    ]),
  ].sort();
}

export function applyTheme(name: string): boolean {
  try {
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(path.join(dataDir(), "theme.json"), `${JSON.stringify({ theme: name })}\n`);
    return true;
  } catch {
    return false;
  }
}
