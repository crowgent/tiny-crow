import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { Session as SessionClass } from "./mod.ts";
import { homedir } from "node:os";
import path from "node:path";
import { expandTilde } from "../permission/pattern.ts";
import type { Session } from "./mod.ts";

function homeFallback(): string {
  return process.env["HOME"] ?? ".";
}

/** Data dir: `$TC_DATA_DIR` wins, else the OS data dir, else `$HOME`, suffixed with `tiny-crow`. */
export function dataDir(): string {
  const override = process.env["TC_DATA_DIR"];
  if (override !== undefined) return expandTilde(override);
  const base =
    process.platform === "darwin"
      ? path.join(homedir(), "Library", "Application Support")
      : process.platform === "win32"
        ? process.env["APPDATA"] ?? homeFallback()
        : process.env["XDG_DATA_HOME"] ?? path.join(homedir(), ".local", "share");
  return path.join(base || homeFallback(), "tiny-crow");
}

function sessionDir(): string {
  return path.join(dataDir(), "sessions");
}

export function toolOutputDir(sessionId: string): string {
  return path.join(dataDir(), "tool-outputs", safePathComponent(sessionId));
}

function configPath(): string {
  const override = process.env["TC_CONFIG_DIR"];
  if (override !== undefined) return expandTilde(override);
  return dataDir();
}

/** Writes via a temp file in the same directory, then renames, so a crash mid-write leaves the previous version intact. */
export function atomicWrite(filePath: string, content: string): void {
  const parent = path.dirname(filePath);
  mkdirSync(parent, { recursive: true });
  const tmp = filePath.replace(/\.json$/, "") + ".json.tmp";
  writeFileSync(tmp, content);
  renameSync(tmp, filePath);
}

export function saveSession(session: Session): void {
  const dir = sessionDir();
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${session.id}.json`);
  atomicWrite(filePath, JSON.stringify(session.toJSON()));
}

export function saveToolOutput(sessionId: string, toolName: string, output: string): string {
  const dir = toolOutputDir(sessionId);
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${crypto.randomUUID()}-${safePathComponent(toolName)}.txt`);
  writeFileSync(filePath, output);
  return filePath;
}

export function safePathComponent(value: string): string {
  const safe = [...value]
    .slice(0, 64)
    .map((ch) => (/[A-Za-z0-9_-]/.test(ch) ? ch : "_"))
    .join("");
  return safe === "" ? "tool" : safe;
}

export function deleteSession(id: string): void {
  const filePath = path.join(sessionDir(), `${id}.json`);
  if (existsSync(filePath)) rmSync(filePath);
}

export function findSessionsByPrefix(prefix: string): Session[] {
  const dir = sessionDir();
  if (!existsSync(dir)) return [];
  const lower = prefix.toLowerCase();
  const sessions: Session[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const stem = entry.slice(0, -".json".length);
    let session: Session;
    try {
      session = sessionFromJson(readFileSync(path.join(dir, entry), "utf8"));
    } catch {
      continue;
    }
    if (stem.startsWith(prefix) || session.name.toLowerCase().includes(lower)) {
      sessions.push(session);
    }
  }
  sessions.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return sessions.filter(
    (s, i) => sessions.findIndex((other) => other.id === s.id) === i,
  );
}

export function findSessionByName(name: string): Session | null {
  const dir = sessionDir();
  if (!existsSync(dir)) return null;
  const lower = name.toLowerCase();
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    let session: Session;
    try {
      session = sessionFromJson(readFileSync(path.join(dir, entry), "utf8"));
    } catch {
      continue;
    }
    if (session.name.toLowerCase() === lower) return session;
  }
  return null;
}

export function findRecentSessions(limit: number): Session[] {
  const dir = sessionDir();
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => {
      const full = path.join(dir, e.name);
      let mtime = 0;
      try {
        mtime = requireMtime(full);
      } catch {
        mtime = 0;
      }
      return { mtime, full };
    })
    .sort((a, b) => b.mtime - a.mtime);
  const sessions: Session[] = [];
  for (const { full } of entries.slice(0, limit)) {
    try {
      sessions.push(sessionFromJson(readFileSync(full, "utf8")));
    } catch {
      continue;
    }
  }
  return sessions;
}

function requireMtime(full: string): number {
  return statSync(full).mtimeMs;
}

// Note: this module imports Session at runtime while mod.ts imports
// saveToolOutput from here; the cycle is safe because both directions are
// only used inside functions called after both modules have initialized.
function sessionFromJson(json: string): Session {
  return SessionClass.fromJSON(JSON.parse(json) as unknown);
}

export function agentsPath(): string {
  return path.join(configPath(), "agent", "AGENTS.md");
}

export function suffixPath(): string {
  return path.join(configPath(), "SUFFIX.md");
}

export function loadSuffix(): string | null {
  const filePath = suffixPath();
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, "utf8");
  return content.trim() === "" ? null : content;
}

function themeFilePath(): string {
  return path.join(dataDir(), "theme.json");
}

export function saveThemeName(name: string | null): void {
  const filePath = themeFilePath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify({ theme: name }, null, 2));
}

export function loadThemeName(): string | null {
  let content: string;
  try {
    content = readFileSync(themeFilePath(), "utf8");
  } catch {
    return null;
  }
  try {
    const value = JSON.parse(content) as { theme?: unknown };
    return typeof value.theme === "string" ? value.theme : null;
  } catch {
    return null;
  }
}
