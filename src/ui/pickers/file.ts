// File picker: walks the working tree (skipping dot-named components,
// honouring simple .gitignore patterns, depth-capped) and filters by
// substring, showing at most 50 matches.

import * as fs from "node:fs";
import * as path from "node:path";
import { insertAt, removeAt } from "../input/cursor.ts";
import { clearCurrentLine, moveTo, resetColor, setForegroundColor, terminalSize } from "./mod.ts";

/** Paths per batch sent from the walk to the picker. */
export const WALK_BATCH_SIZE = 25;
/** Hard cap on walked paths. */
export const MAX_WALK_FILES = 200;
const MAX_DEPTH = 8;

export interface WalkCancel {
  cancelled: boolean;
}

function readGitignorePatterns(root: string): string[] {
  try {
    const raw = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));
  } catch {
    return [];
  }
}

function matchesGitignore(rel: string, patterns: string[]): boolean {
  const base = rel.split("/").pop() ?? rel;
  for (const raw of patterns) {
    let pat = raw;
    let dirOnly = false;
    if (pat.endsWith("/")) {
      dirOnly = true;
      pat = pat.slice(0, -1);
    }
    const isDir = rel.includes("/");
    if (dirOnly && !isDir && !rel.endsWith("/")) {
      // A directory pattern also matches a directory prefix of the path.
      if (rel.split("/").slice(0, -1).includes(pat)) return true;
      continue;
    }
    const regex = new RegExp(
      `^${pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")}$`,
    );
    if (regex.test(rel) || regex.test(base)) return true;
    if (pat.includes("/") && rel.startsWith(pat)) return true;
  }
  return false;
}

function hasDotComponent(rel: string): boolean {
  return rel.split("/").some((part) => part.startsWith("."));
}

export function walkFilesStreaming(
  root: string,
  cancel: WalkCancel,
  emit: (batch: string[]) => boolean,
): void {
  const patterns = readGitignorePatterns(root);
  const batch: string[] = [];
  // The walk yields the root itself first (as ""), matching the original
  // walk: a pre-set cancel flag still suppresses every result, including this.
  if (cancel.cancelled) return;
  batch.push("");
  let total = 0;
  const walk = (dir: string, relDir: string, depth: number): boolean => {
    if (cancel.cancelled || depth > MAX_DEPTH) return !cancel.cancelled;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return true;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (cancel.cancelled) return false;
      const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      if (hasDotComponent(rel)) continue;
      if (matchesGitignore(rel, patterns)) continue;
      if (!entry.isFile() && !entry.isDirectory()) continue;
      batch.push(rel);
      total += 1;
      if (batch.length >= WALK_BATCH_SIZE) {
        const toSend = batch.splice(0, batch.length);
        if (!emit(toSend)) return false;
      }
      if (total >= MAX_WALK_FILES) return false;
      if (entry.isDirectory()) {
        if (!walk(path.join(dir, entry.name), rel, depth + 1)) return false;
        if (total >= MAX_WALK_FILES) return false;
      }
    }
    return true;
  };
  walk(root, "", 0);
  if (batch.length > 0 && !cancel.cancelled) emit(batch);
}

/** Collect the full walk into an array (synchronous fallback). */
export function walkFiles(root: string): string[] {
  const files: string[] = [];
  walkFilesStreaming(root, { cancelled: false }, (batch) => {
    files.push(...batch);
    return true;
  });
  return files;
}

export class FilePicker {
  active = false;
  query = "";
  cursor = 0;
  matches: string[] = [];
  selected = 0;
  private fileCache: string[] = [];
  private monochrome = false;
  loading = false;
  private walkCancel: WalkCancel = { cancelled: false };

  setMonochrome(monochrome: boolean): void {
    this.monochrome = monochrome;
  }

  activate(): void {
    this.walkCancel.cancelled = true;
    this.walkCancel = { cancelled: false };
    this.active = true;
    this.query = "";
    this.cursor = 0;
    this.matches = [];
    this.selected = 0;
    this.fileCache = [];
    // No background runtime in this port: the walk runs synchronously, so
    // the cache is complete as soon as activate returns.
    this.loading = true;
    this.loadFilesSync();
    this.loading = false;
  }

  private loadFilesSync(): void {
    this.fileCache = walkFiles(".");
    this.filter();
  }

  deactivate(): void {
    this.active = false;
    this.walkCancel.cancelled = true;
    this.loading = false;
  }

  /** Drains walk batches; always false here because activate loads synchronously. */
  tryFinishLoading(): boolean {
    return false;
  }

  charInput(c: string): void {
    this.query = insertAt(this.query, this.cursor, c);
    this.cursor += 1;
    this.filter();
  }

  backspace(): void {
    if (this.cursor > 0 && this.query !== "") {
      this.cursor -= 1;
      this.query = removeAt(this.query, this.cursor);
      this.filter();
    }
  }

  private filter(): void {
    if (this.fileCache.length === 0) {
      this.matches = [];
      return;
    }
    const queryLower = this.query.toLowerCase();
    this.matches = this.fileCache
      .filter((p) => p.toLowerCase().includes(queryLower))
      .slice(0, 50);
    this.selected = 0;
  }

  selectNext(): void {
    if (this.matches.length > 0) {
      this.selected = (this.selected + 1) % this.matches.length;
    }
  }

  selectPrev(): void {
    if (this.matches.length > 0) {
      this.selected =
        this.selected === 0 ? this.matches.length - 1 : this.selected - 1;
    }
  }

  selectedPath(): string | undefined {
    return this.matches[this.selected];
  }

  /** Test helper: seed the cache directly. */
  testSetCache(files: string[]): void {
    this.fileCache = [...files];
    this.loading = false;
    this.filter();
  }

  draw(): void {
    if (!this.active) return;
    this.tryFinishLoading();
    const { cols, rows } = terminalSize();
    const maxItems = Math.min(Math.max(rows - 4, 0), 10);

    if (this.loading && this.matches.length === 0) {
      moveTo(0, Math.max(rows - 3, 0));
      setForegroundColor("darkGrey", this.monochrome);
      process.stdout.write("scanning files...");
      resetColor();
      return;
    }
    if (this.matches.length === 0) {
      moveTo(0, Math.max(rows - 4, 0));
      setForegroundColor("darkGrey", this.monochrome);
      process.stdout.write("no matches");
      resetColor();
      return;
    }

    const listHeight = Math.min(maxItems, this.matches.length);
    const startIdx = Math.min(
      Math.max(this.selected - Math.floor(listHeight / 2), 0),
      Math.max(this.matches.length - listHeight, 0),
    );
    const endIdx = Math.min(startIdx + listHeight, this.matches.length);
    const topRow = Math.max(rows - 3 - listHeight, 0);

    for (let i = startIdx; i < endIdx; i += 1) {
      moveTo(0, topRow + (i - startIdx));
      clearCurrentLine();
      let display = this.matches[i];
      try {
        if (fs.statSync(this.matches[i]).isDirectory()) display += "/";
      } catch {
        // Path may have vanished since the walk; show it as-is.
      }
      const truncated = [...display].slice(0, Math.max(cols - 3, 0)).join("");
      if (i === this.selected) {
        setForegroundColor("green", this.monochrome);
        process.stdout.write(`▸ ${truncated}`);
      } else {
        setForegroundColor("darkGrey", this.monochrome);
        process.stdout.write(`  ${truncated}`);
      }
      resetColor();
    }
  }
}
