import { readFileSync, readSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { HookDispatcher } from "./dispatcher.ts";
import { parseHooksConfig, type HookGroup, type HookHandler, type HooksConfig } from "./settings.ts";

export function dataDir(): string {
  if (process.env.TC_DATA_DIR) {
    const dir = process.env.TC_DATA_DIR.replace(/^~/, homedir());
    return dir;
  }
  const base = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(base, "tiny-crow");
}

export function configDir(): string {
  if (process.env.TC_CONFIG_DIR) {
    return process.env.TC_CONFIG_DIR.replace(/^~/, homedir());
  }
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return base;
}

export function fnv1a64Hex(text: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = (1n << 64n) - 1n;
  for (const byte of Buffer.from(text, "utf8")) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

export function hashHookBinding(
  projectRoot: string,
  event: string,
  matcher: string | undefined,
  handler: HookHandler,
): string {
  return fnv1a64Hex(
    JSON.stringify([projectRoot, event, matcher ?? "", handler]),
  );
}

export function defaultTrustStorePath(): string {
  return join(dataDir(), "trusted-hooks.json");
}

export function loadTrustStore(path: string): Set<string> {
  try {
    const content = readFileSync(path, "utf8");
    const parsed: unknown = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((v): v is string => typeof v === "string"));
    }
    return new Set();
  } catch {
    return new Set();
  }
}

export function saveTrustStore(path: string, trusted: Set<string>): void {
  try {
    const parent = path.split("/").slice(0, -1).join("/") || ".";
    mkdirSync(parent, { recursive: true });
    writeFileSync(path, JSON.stringify([...trusted].sort(), null, 2), "utf8");
  } catch (err) {
    console.warn(`hooks: failed to save trust store (trust decisions won't persist): ${err}`);
  }
}

export function globalSettingsPath(): string {
  return join(configDir(), "tiny-crow", "settings.json");
}

export function projectSettingsPath(): string {
  return join(".tiny-crow", "settings.json");
}

export function managedSettingsPath(): string {
  if (process.platform === "darwin") {
    return "/Library/Application Support/tiny-crow/managed-settings.json";
  }
  if (process.platform === "win32") {
    return "C:\\ProgramData\\tiny-crow\\managed-settings.json";
  }
  return "/etc/tiny-crow/managed-settings.json";
}

export function confirmUntrustedHook(description: string): boolean {
  try {
    process.stderr.write(`Trust project hook: ${description}? [y/N] `);
    const buf = Buffer.alloc(4096);
    const n = readSync(0, buf, 0, buf.length, null);
    const input = buf.subarray(0, n).toString("utf8").trim().toLowerCase();
    return input === "y" || input === "yes";
  } catch {
    return false;
  }
}

interface SourceConfig {
  hooks: HooksConfig;
  disableAllHooks: boolean;
}

function loadSettingsFile(path: string): SourceConfig {
  const empty: SourceConfig = { hooks: {}, disableAllHooks: false };
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return empty;
  }
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    console.warn(`hooks: ${path}: invalid JSON, ignoring`);
    return empty;
  }
  if (value === null || typeof value !== "object") return empty;
  const record = value as Record<string, unknown>;
  let hooks: HooksConfig = {};
  if (record.hooks !== undefined) {
    try {
      hooks = parseHooksConfig(record.hooks);
    } catch (err) {
      console.warn(`hooks: ${path}: ${err}`);
      hooks = {};
    }
  }
  return {
    hooks,
    disableAllHooks: record.disableAllHooks === true,
  };
}

export function mergeInto(target: HooksConfig, source: HooksConfig): void {
  for (const [event, groups] of Object.entries(source)) {
    if (!target[event]) target[event] = [];
    target[event]!.push(...groups);
  }
}

export function filterTrustedProjectHooks(
  hooks: HooksConfig,
  projectRoot: string,
  trustStorePath: string,
  headless: boolean,
  confirm: (description: string) => boolean,
): HooksConfig {
  const trustedHashes = loadTrustStore(trustStorePath);
  const result: HooksConfig = {};
  for (const [event, groups] of Object.entries(hooks)) {
    const keptGroups: HookGroup[] = [];
    for (const group of groups) {
      const keptHandlers: HookHandler[] = [];
      for (const handler of group.hooks) {
        const hash = hashHookBinding(projectRoot, event, group.matcher, handler);
        if (trustedHashes.has(hash)) {
          keptHandlers.push(handler);
        } else if (headless) {
          console.warn(
            `hooks: skipping unconfirmed project hook for event ${JSON.stringify(event)} (headless; run interactively once to confirm)`,
          );
        } else if (confirm(handler.command ?? "<no command>")) {
          trustedHashes.add(hash);
          keptHandlers.push(handler);
        } else {
          console.warn(`hooks: user declined project hook for event ${JSON.stringify(event)}`);
        }
      }
      if (keptHandlers.length > 0) {
        keptGroups.push({ matcher: group.matcher, hooks: keptHandlers });
      }
    }
    if (keptGroups.length > 0) result[event] = keptGroups;
  }
  saveTrustStore(trustStorePath, trustedHashes);
  return result;
}

export function buildDispatcherFromPaths(
  globalPath: string,
  projectPath: string,
  managedPath: string,
  projectRoot: string,
  noHooksFlag: boolean,
  headless: boolean,
  trustStorePath: string,
  confirm: (description: string) => boolean,
): HookDispatcher {
  const global = loadSettingsFile(globalPath);
  const project = loadSettingsFile(projectPath);
  const managed = loadSettingsFile(managedPath);
  const disableNonManaged =
    noHooksFlag || global.disableAllHooks || project.disableAllHooks;
  const merged: HooksConfig = {};
  if (!disableNonManaged) {
    mergeInto(merged, global.hooks);
    const filteredProject = filterTrustedProjectHooks(
      project.hooks,
      projectRoot,
      trustStorePath,
      headless,
      confirm,
    );
    mergeInto(merged, filteredProject);
  }
  mergeInto(merged, managed.hooks);
  try {
    return HookDispatcher.fromConfig(merged);
  } catch (err) {
    console.warn(`hooks: invalid merged config, disabling hooks: ${err}`);
    return HookDispatcher.empty();
  }
}

export function currentProjectRoot(): string {
  let cwd = ".";
  try {
    cwd = process.cwd();
  } catch {
    cwd = ".";
  }
  try {
    return resolve(cwd);
  } catch {
    return cwd;
  }
}

export function loadDispatcher(noHooksFlag: boolean, headless: boolean): HookDispatcher {
  return buildDispatcherFromPaths(
    globalSettingsPath(),
    projectSettingsPath(),
    managedSettingsPath(),
    currentProjectRoot(),
    noHooksFlag,
    headless,
    defaultTrustStorePath(),
    confirmUntrustedHook,
  );
}

export async function loadDispatcherAsync(
  noHooksFlag: boolean,
  headless: boolean,
): Promise<HookDispatcher> {
  return loadDispatcher(noHooksFlag, headless);
}

export { existsSync };
