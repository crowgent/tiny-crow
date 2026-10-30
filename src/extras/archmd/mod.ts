// ARCHITECTURE.md prompting and template creation.
import { existsSync, mkdirSync, readFileSync, readSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const DIRS_ASKED_FILE = "dirs_asked_architecture.txt";

export function dirsAskedPath(baseDir?: string): string {
  const dir =
    baseDir ??
    (() => {
      if (process.env.TC_DATA_DIR) return process.env.TC_DATA_DIR.replace(/^~/, homedir());
      const base = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
      return join(base, "tiny-crow");
    })();
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.warn(`archmd: failed to create data dir: ${err}`);
  }
  return join(dir, DIRS_ASKED_FILE);
}

export const ARCHITECTURE_TEMPLATE = `# Architecture

This file documents the high-level architecture of the codebase.
It helps AI agents understand the project structure, key modules,
data flow, and design decisions without having to re-discover
them on every exploration.

## Contents to include

- **Directory layout** — top-level modules and their responsibilities
- **Key types and traits** — central abstractions and their relationships
- **Control flow** — how requests/events flow through the system
- **Data flow** — how data is transformed from input to output
- **Design decisions** — why certain approaches were chosen
- **Dependencies** — external libraries and how they are used
- **Entry points** — where execution starts for different modes

## Instructions for agents

When you discover new architectural information about this
codebase, add it to this file so future explorations start
with the full picture. Keep the document under ~300 lines
    of code total. Keep entries concise and link to specific source files.
`;

export function recordAskedDir(dir: string): void {
  recordAskedDirWithPath(dir, dirsAskedPath());
}

export function shouldAsk(dir: string): boolean {
  return shouldAskWithPath(dir, dirsAskedPath());
}

export function shouldAskWithPath(dir: string, askedPath: string): boolean {
  return !existsSync(join(dir, "ARCHITECTURE.md")) && !hasBeenAskedWithPath(dir, askedPath);
}

function readStdinLine(): string {
  try {
    const buf = Buffer.alloc(4096);
    const n = readSync(0, buf, 0, buf.length, null);
    return buf.subarray(0, n).toString("utf8");
  } catch {
    return "";
  }
}

/**
 * Ask whether to create ARCHITECTURE.md in `dir`; returns true when one
 * was created. Returns false immediately when one already exists or the
 * directory was already asked about.
 */
export function askAndCreate(dir: string, input?: string): boolean {
  if (!shouldAsk(dir)) return false;
  process.stderr.write(
    `No ARCHITECTURE.md found in ${dir} (documents high-level codebase architecture for AI agents). Create one? [y/N] `,
  );
  const answer = (input ?? readStdinLine()).trim().toLowerCase();
  try {
    recordAskedDir(dir);
  } catch (err) {
    console.warn(`Failed to record asked directory: ${err}`);
  }
  if (answer === "y" || answer === "yes") {
    createArchitectureTemplate(dir);
    console.error(`Created ${dir}/ARCHITECTURE.md — edit it to describe the codebase architecture.`);
    return true;
  }
  return false;
}

/** Async variant of `askAndCreate` (stdin reading is synchronous but small). */
export async function askAndCreateAsync(dir: string, input?: string): Promise<boolean> {
  return askAndCreate(dir, input);
}

export function hasBeenAskedWithPath(dir: string, askedPath: string): boolean {
  if (!existsSync(askedPath)) return false;
  let content = "";
  try {
    content = readFileSync(askedPath, "utf8");
  } catch {
    return false;
  }
  // Compare canonicalized paths when possible; fall back to raw strings.
  let target = dir;
  try {
    target = realpathSync(dir);
  } catch {
    target = dir;
  }
  for (const line of content.split("\n")) {
    if (line === "") continue;
    let candidate = line;
    try {
      candidate = realpathSync(line);
    } catch {
      candidate = line;
    }
    if (candidate === target) return true;
    if (resolve(line) === resolve(dir)) return true;
  }
  return false;
}

export function recordAskedDirWithPath(dir: string, askedPath: string): void {
  const parent = askedPath.split("/").slice(0, -1).join("/") || ".";
  mkdirSync(parent, { recursive: true });
  let content = "";
  if (existsSync(askedPath)) {
    try {
      content = readFileSync(askedPath, "utf8");
    } catch {
      content = "";
    }
  }
  if (content !== "" && !content.endsWith("\n")) content += "\n";
  content += `${dir}\n`;
  const tmp = askedPath.replace(/(\.[^.]*)$/, ".tmp");
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, askedPath);
}

/** Create the ARCHITECTURE.md template in `dir` (no-op when one exists). */
export function createArchitectureTemplate(dir: string): void {
  const path = join(dir, "ARCHITECTURE.md");
  if (existsSync(path)) return;
  writeFileSync(path, ARCHITECTURE_TEMPLATE, "utf8");
}
