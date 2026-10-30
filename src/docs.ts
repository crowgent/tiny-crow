// Runtime docs.
// The original bakes eight guide files into the binary and copies them to
// the global docs dir when the version changes. In this port the guides
// live in the project's docs directory (owned by the docs/system slice);
// ensureGlobal copies them from there, and showGetStarted pages the
// installed GET_STARTED.md with `less`, exactly as the original does.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dataDir } from "./config/load.ts";
import { VERSION } from "./logging.ts";

export const DOC_NAMES = [
  "GET_STARTED.md",
  "COMMANDS.md",
  "CONFIG.md",
  "PROVIDERS.md",
  "HASHEDIT.md",
  "MEMORY.md",
  "ARCHITECTURE.md",
  "SUBAGENTS.md",
] as const;

export function globalDocsDir(): string {
  return path.join(dataDir(), "docs");
}

function docsSourceDirs(): string[] {
  const dirs: string[] = [];
  if (process.env["TC_DOCS_DIR"]) dirs.push(process.env["TC_DOCS_DIR"]!);
  dirs.push(path.join(process.cwd(), "docs"));
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    dirs.push(path.join(here, "..", "docs"));
    dirs.push(path.join(here, "..", "..", "docs"));
  } catch {
    // ignore
  }
  return dirs;
}

export function findDocsSourceDir(): string | undefined {
  return docsSourceDirs().find((dir) => {
    try {
      const files = new Set(readdirSync(dir));
      return DOC_NAMES.every((name) => files.has(name));
    } catch {
      return false;
    }
  });
}

function copyDocs(sourceDir: string, dest: string): void {
  for (const name of DOC_NAMES) {
    const content = readFileSync(path.join(sourceDir, name));
    writeFileSync(path.join(dest, name), content);
  }
}

export function showGetStarted(): void {
  ensureGlobal();
  const docPath = path.join(globalDocsDir(), "GET_STARTED.md");
  if (!existsSync(docPath)) {
    throw new Error(
      `GET_STARTED.md not found at ${docPath}. Try reinstalling tiny-crow.`,
    );
  }
  const result = spawnSync("less", [docPath], { stdio: "inherit" });
  if (result.status !== 0 && result.status !== null) {
    process.exit(result.status);
  }
  if (result.error) throw result.error;
}

/**
 * Copy the guides into the global docs dir when the stored version
 * differs from the running version. Returns true when a copy happened
 * (the caller treats this as "version changed").
 */
export function ensureGlobal(): boolean {
  const dir = globalDocsDir();
  const versionFile = path.join(dir, "current_version");
  let stored: string | undefined;
  try {
    stored = readFileSync(versionFile, "utf-8").trim();
  } catch {
    stored = undefined;
  }
  if (stored === VERSION) return false;
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const source = findDocsSourceDir();
  if (source) copyDocs(source, dir);
  writeFileSync(versionFile, VERSION);
  return true;
}
