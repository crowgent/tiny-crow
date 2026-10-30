// /memory: status, search, read, write, editor, clear.
//
// The memory store itself belongs to the extras/memory slice and arrives
// on the context as ctx.memoryStore. This file also ships a small
// file-backed store factory (createFileMemoryStore) implementing the same
// interface, so the commands are testable and usable without that slice.

import * as fs from "node:fs";
import * as path from "node:path";
import {
  writeError,
  writeOk,
  writeResult,
  type MemoryStoreLike,
  type SlashCtx,
} from "./mod.ts";
import { SlashDeferredError } from "./outcome.ts";

export type { MemoryStoreLike };
export type WriteTarget = "longTerm" | "scratchpad" | "daily" | "note";
export type WriteMode = "append" | "overwrite";

/** File-backed memory store rooted at `baseDir` (MEMORY.md, scratchpad, daily notes). */
export function createFileMemoryStore(baseDir: string): MemoryStoreLike {
  const today = new Date().toISOString().slice(0, 10);
  const ensureDir = (p: string): void => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
  };
  const memoryMd = (): string => path.join(baseDir, "MEMORY.md");
  const scratchpad = (): string => path.join(baseDir, "scratchpad.md");
  const dailyFile = (date: string): string => path.join(baseDir, "daily", `${date}.md`);
  const notePath = (name: string): string | undefined => {
    if (name === "" || name.includes("/") || name.includes("..")) return undefined;
    return path.join(baseDir, "notes", `${name}.md`);
  };
  return {
    today,
    memoryMd,
    scratchpad,
    dailyFile,
    notePath,
    search(query: string): { render(maxChars: number): string } {
      const q = query.toLowerCase();
      const hits: string[] = [];
      const scan = (file: string, label: string): void => {
        try {
          const content = fs.readFileSync(file, "utf8");
          for (const line of content.split("\n")) {
            if (line.toLowerCase().includes(q)) hits.push(`${label}: ${line}`);
          }
        } catch {
          // Missing files simply contribute no hits.
        }
      };
      scan(memoryMd(), "MEMORY.md");
      scan(scratchpad(), "scratchpad");
      scan(dailyFile(today), "daily");
      return {
        render(maxChars: number): string {
          const joined = hits.join("\n");
          return joined.length > maxChars ? joined.slice(0, maxChars) : joined;
        },
      };
    },
    write(
      target: WriteTarget,
      content: string,
      mode: WriteMode,
      name?: string,
    ): string {
      let file: string | undefined;
      if (target === "longTerm") file = memoryMd();
      else if (target === "scratchpad") file = scratchpad();
      else if (target === "daily") file = dailyFile(today);
      else if (target === "note") file = name !== undefined ? notePath(name) : undefined;
      if (file === undefined) throw new Error("unknown memory target");
      ensureDir(file);
      if (mode === "append") fs.appendFileSync(file, content + "\n");
      else fs.writeFileSync(file, content);
      return `wrote to ${file}`;
    },
  };
}

export async function handle(parts: string[], ctx: SlashCtx): Promise<void> {
  const mem = ctx.memoryStore;
  if (mem === undefined) {
    writeError(ctx.renderer, "/memory is not available (memory store not wired)");
    return;
  }
  switch (parts[1]) {
    case undefined:
    case "status":
      handleStatus(ctx, mem);
      break;
    case "search":
      handleSearch(parts, ctx, mem);
      break;
    case "read":
      handleRead(parts, ctx, mem);
      break;
    case "write":
      handleWrite(parts, ctx, mem);
      break;
    case "editor":
      await handleEditor(ctx, mem);
      break;
    case "clear":
      handleClear(parts, ctx, mem);
      break;
    default:
      writeError(
        ctx.renderer,
        "usage: /memory [status|search|read|write|editor|clear]",
      );
      break;
  }
}

function handleStatus(ctx: SlashCtx, mem: MemoryStoreLike): void {
  writeOk(ctx.renderer, "memory status:");
  const longTerm = mem.memoryMd();
  if (fs.existsSync(longTerm)) {
    try {
      writeResult(ctx.renderer, `  MEMORY.md: ${fs.statSync(longTerm).size}B`);
    } catch {
      writeResult(ctx.renderer, "  MEMORY.md: exists (size unknown)");
    }
  } else {
    writeResult(ctx.renderer, "  MEMORY.md: (not created)");
  }
  const scratch = mem.scratchpad();
  if (fs.existsSync(scratch)) {
    try {
      const s = fs.readFileSync(scratch, "utf8");
      const open = s.split("\n").filter((l) => {
        const t = l.trimStart();
        return t.startsWith("- [ ]") || t.startsWith("* [ ]");
      });
      writeResult(ctx.renderer, `  scratchpad: ${open.length} open item(s)`);
    } catch {
      writeResult(ctx.renderer, "  scratchpad: exists (unreadable)");
    }
  } else {
    writeResult(ctx.renderer, "  scratchpad: (empty)");
  }
  const todayFile = mem.dailyFile(mem.today);
  if (fs.existsSync(todayFile)) {
    try {
      const s = fs.readFileSync(todayFile, "utf8");
      const entries = s.split("\n").filter((l) => l.startsWith("### ")).length;
      writeResult(ctx.renderer, `  today: ${entries} entry(s)`);
    } catch {
      writeResult(ctx.renderer, "  today: exists (unreadable)");
    }
  } else {
    writeResult(ctx.renderer, "  today: (no entries)");
  }
}

function handleSearch(parts: string[], ctx: SlashCtx, mem: MemoryStoreLike): void {
  if (parts.length < 3) {
    writeError(ctx.renderer, "usage: /memory search <query>");
    return;
  }
  const query = parts.slice(2).join(" ");
  const results = mem.search(query);
  const rendered = results.render(4000);
  writeOk(ctx.renderer, "search results:");
  for (const line of rendered.split("\n")) {
    writeResult(ctx.renderer, line);
  }
}

function handleRead(parts: string[], ctx: SlashCtx, mem: MemoryStoreLike): void {
  if (parts.length < 3) {
    writeError(ctx.renderer, "usage: /memory read <source> [name]");
    writeResult(ctx.renderer, "  sources: long_term, scratchpad, daily, note");
    return;
  }
  const source = parts[2].toLowerCase();
  let file: string | undefined;
  if (source === "long_term" || source === "long") file = mem.memoryMd();
  else if (source === "scratchpad") file = mem.scratchpad();
  else if (source === "daily") file = mem.dailyFile(mem.today);
  else if (source === "note") file = parts[3] !== undefined ? mem.notePath(parts[3]) : undefined;
  else {
    writeError(ctx.renderer, `unknown source: ${source}`);
    writeResult(ctx.renderer, "  sources: long_term, scratchpad, daily, note");
    return;
  }
  if (file === undefined) {
    writeError(ctx.renderer, "usage: /memory read <source> [name]");
    return;
  }
  try {
    const s = fs.readFileSync(file, "utf8");
    const capped = s.length > 4000 ? [...s].slice(0, 4000).join("") + "\n…[truncated]" : s;
    writeOk(ctx.renderer, `${file} (${source}):`);
    for (const line of capped.split("\n")) {
      writeResult(ctx.renderer, line);
    }
  } catch (e) {
    writeError(ctx.renderer, `read error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function handleWrite(parts: string[], ctx: SlashCtx, mem: MemoryStoreLike): void {
  if (parts.length < 4) {
    writeError(ctx.renderer, "usage: /memory write <target> <content>");
    writeResult(ctx.renderer, "  targets: long_term, scratchpad, daily, note:<name>");
    return;
  }
  const targetStr = parts[2].toLowerCase();
  const content = parts.slice(3).join(" ");
  let target: WriteTarget;
  let name: string | undefined;
  if (targetStr.startsWith("note:")) {
    target = "note";
    name = targetStr.slice("note:".length);
  } else if (targetStr === "long_term" || targetStr === "long") {
    target = "longTerm";
  } else if (targetStr === "scratchpad") {
    target = "scratchpad";
  } else if (targetStr === "daily") {
    target = "daily";
  } else {
    writeError(ctx.renderer, `unknown target: ${targetStr}`);
    writeResult(ctx.renderer, "  targets: long_term, scratchpad, daily, note:<name>");
    return;
  }
  try {
    const msg = mem.write(target, content, "append", name);
    writeOk(ctx.renderer, msg);
  } catch (e) {
    writeError(ctx.renderer, `write error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function handleEditor(ctx: SlashCtx, mem: MemoryStoreLike): Promise<void> {
  const file = mem.memoryMd();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch (e) {
    writeError(ctx.renderer, `cannot create memory dir: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  try {
    fs.writeFileSync(file, "");
  } catch (e) {
    writeError(ctx.renderer, `cannot prepare ${file}: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  writeOk(ctx.renderer, `opening ${file} in editor...`);
  throw new SlashDeferredError({ kind: "deferEditor", path: file });
}

function handleClear(parts: string[], ctx: SlashCtx, mem: MemoryStoreLike): void {
  if (parts.length < 3) {
    writeError(ctx.renderer, "usage: /memory clear scratchpad|daily");
    return;
  }
  const target = parts[2].toLowerCase();
  if (target !== "scratchpad" && target !== "daily") {
    writeError(ctx.renderer, "clear only supports: scratchpad, daily");
    return;
  }
  try {
    const msg = mem.write(target, "", "overwrite");
    writeOk(ctx.renderer, msg);
  } catch (e) {
    writeError(ctx.renderer, `clear error: ${e instanceof Error ? e.message : String(e)}`);
  }
}
