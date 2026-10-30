import { spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  renderSessionWithCtx,
  sessionRedo,
  sessionResetCalibration,
  undoLast,
  writeError,
  writeOk,
  writeResult,
  type MessageLike,
  type SessionLike,
  type SlashCtx,
} from "./mod.ts";

export class QuitError extends Error {
  constructor() {
    super("quit");
    this.name = "QuitError";
  }
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatTimeDefault(rfc3339: string): string {
  const dt = new Date(rfc3339);
  if (Number.isNaN(dt.getTime())) return rfc3339;
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  const hhmm = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  const sameDay =
    dt.getFullYear() === now.getFullYear() &&
    dt.getMonth() === now.getMonth() &&
    dt.getDate() === now.getDate();
  if (sameDay) return hhmm;
  if (dt.getFullYear() === now.getFullYear()) {
    return `${MONTHS[dt.getMonth()]} ${pad(dt.getDate())} ${hhmm}`;
  }
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${hhmm}`;
}

export function formatSessionLine(s: SessionLike, formatTime?: (v: string) => string): string {
  const last = s.messages.length > 0
    ? `...${[...s.messages[s.messages.length - 1].content].slice(0, 30).join("")}`
    : "";
  const time = formatTime !== undefined && s.updatedAt !== undefined
    ? formatTime(s.updatedAt)
    : s.updatedAt ?? "";
  const namePart = s.name === "" ? "" : `  [${s.name}]`;
  return `  ${s.id.slice(0, 8)}  ${time}  ${s.messages.length}msgs  ${s.model}  ${last}${namePart}`;
}

export async function handle(parts: string[], ctx: SlashCtx): Promise<void> {
  switch (parts[0]) {
    case "/sessions":
      await handleSessions(parts, ctx);
      break;
    case "/rename":
      await handleRename(parts, ctx);
      break;
    case "/clear":
    case "/new":
      await handleClear(ctx);
      break;
    case "/undo":
      await handleUndo(ctx);
      break;
    case "/redo":
      await handleRedo(ctx);
      break;
    case "/rewind":
      await handleRewind(ctx);
      break;
    case "/retry":
      await handleRetry(ctx);
      break;
    case "/quit":
    case "/exit":
      await handleQuit(ctx);
      break;
    case "/history":
      await handleHistory(ctx);
      break;
    case "/export":
      await handleExport(parts, ctx);
      break;
    case "/import":
      await handleImport(parts, ctx);
      break;
    case "/share":
      await handleShare(ctx);
      break;
    default:
      break;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sessionToHtml(session: SessionLike): string {
  const rows = session.messages
    .map((m) => `<div class="msg ${escapeHtml(String(m.role))}">${escapeHtml(m.content)}</div>`)
    .join("\n");
  return `<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>${escapeHtml(session.name || "tiny-crow session")}</title></head><body>\n${rows}\n</body></html>\n`;
}

function sessionToJsonl(session: SessionLike): string {
  return session.messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
}

async function handleExport(parts: string[], ctx: SlashCtx): Promise<void> {
  const idPrefix = ctx.session.id.slice(0, 8);
  const defaultName = `tiny-crow-session-${idPrefix}.html`;
  const filePath = parts[1]?.trim() !== undefined && parts[1].trim() !== ""
    ? parts[1].trim()
    : defaultName;
  const isJsonl = filePath.endsWith(".jsonl");
  const content = isJsonl
    ? (ctx.exportToJsonl?.(ctx.session) ?? sessionToJsonl(ctx.session))
    : (ctx.exportToHtml?.(ctx.session) ?? sessionToHtml(ctx.session));
  const kind = isJsonl ? "JSONL" : "HTML";
  try {
    fs.writeFileSync(filePath, content);
    writeOk(ctx.renderer, `exported ${kind} to ${filePath}`);
  } catch (e) {
    writeError(ctx.renderer, `export failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function handleImport(parts: string[], ctx: SlashCtx): Promise<void> {
  const filePath = parts[1]?.trim();
  if (filePath === undefined || filePath === "") {
    writeError(ctx.renderer, "usage: /import <file.jsonl|session.json>");
    return;
  }
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    writeError(ctx.renderer, `failed to read ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  let session: SessionLike;
  if (content.trimStart().startsWith("{")) {
    try {
      const parsed = JSON.parse(content) as Partial<SessionLike> & { messages?: MessageLike[] };
      if (!Array.isArray(parsed.messages)) throw new Error("session file has no messages array");
      session = {
        ...ctx.session,
        ...parsed,
        messages: parsed.messages,
      } as SessionLike;
    } catch (e) {
      writeError(ctx.renderer, `invalid session file: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
  } else {
    let messages: MessageLike[];
    try {
      if (ctx.parseJsonlImport !== undefined) {
        messages = ctx.parseJsonlImport(content);
      } else {
        messages = content
          .split("\n")
          .filter((l) => l.trim() !== "")
          .map((l) => JSON.parse(l) as MessageLike);
      }
    } catch (e) {
      writeError(ctx.renderer, `invalid JSONL session: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const name = path.basename(filePath, path.extname(filePath)) || "imported";
    session = {
      ...ctx.session,
      id: crypto.randomUUID(),
      name,
      messages,
    };
    for (const msg of messages) {
      void msg;
    }
  }
  if (session.name === "") session.name = "imported";
  const msgCount = session.messages.length;
  try {
    ctx.sessionStore?.saveSession(session);
  } catch (e) {
    writeError(ctx.renderer, `failed to save session: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  
  const keys = Object.keys(ctx.session) as Array<keyof SessionLike>;
  for (const k of keys) delete (ctx.session as unknown as Record<string, unknown>)[k as string];
  Object.assign(ctx.session, session);
  renderSessionWithCtx(ctx);
  writeOk(ctx.renderer, `imported session from ${filePath} (${msgCount} msgs)`);
}

async function handleShare(ctx: SlashCtx): Promise<void> {
  const idPrefix = ctx.session.id.slice(0, 8);
  const filename = `tiny-crow-session-${idPrefix}.html`;
  const html = ctx.exportToHtml?.(ctx.session) ?? sessionToHtml(ctx.session);
  const description = ctx.session.name === ""
    ? "tiny-crow session"
    : `tiny-crow session: ${ctx.session.name}`;
  if (ctx.shareGist === undefined) {
    writeError(ctx.renderer, "share failed: gist sharing not wired");
    return;
  }
  try {
    const url = await ctx.shareGist(filename, html, description);
    writeOk(ctx.renderer, `shared as secret gist: ${url}`);
  } catch (e) {
    writeError(ctx.renderer, `share failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function handleRename(parts: string[], ctx: SlashCtx): Promise<void> {
  if (parts.length < 2 || parts[1] === "") {
    if (ctx.session.name === "") {
      writeOk(ctx.renderer, "current session has no name. Usage: /rename <name>");
    } else {
      writeOk(
        ctx.renderer,
        `current session name: "${ctx.session.name}". Usage: /rename <new-name>`,
      );
    }
    return;
  }
  const newName = parts.slice(1).join(" ").trim();
  ctx.session.name = newName;
  try {
    ctx.sessionStore?.saveSession(ctx.session);
  } catch (e) {
    writeError(ctx.renderer, `failed to save session: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  writeOk(ctx.renderer, `session renamed to "${newName}"`);
}

async function handleSessions(parts: string[], ctx: SlashCtx): Promise<void> {
  const store = ctx.sessionStore;
  const fmt = ctx.formatTime ?? formatTimeDefault;
  if (parts.length < 2) {
    const sessions = store?.findRecentSessions(20) ?? [];
    if (sessions.length === 0) {
      writeOk(ctx.renderer, "no saved sessions");
    } else {
      writeOk(ctx.renderer, `recent sessions (${sessions.length}):`);
      for (const s of sessions) {
        writeResult(ctx.renderer, formatSessionLine(s, fmt));
      }
    }
  } else if (parts[1] === "delete" && parts.length >= 3) {
    const prefix = parts[2].trim();
    const sessions = store?.findSessionsByPrefix(prefix) ?? [];
    if (sessions.length === 0) {
      writeOk(ctx.renderer, `no session matching '${prefix}'`);
    } else if (sessions.length === 1) {
      const s = sessions[0];
      const id = s.id;
      const preview = s.messages.length > 0
        ? `...${[...s.messages[s.messages.length - 1].content].slice(0, 40).join("")}`
        : "";
      try {
        store?.deleteSession(id);
        writeOk(ctx.renderer, `deleted session ${id.slice(0, 8)} ${preview}`);
      } catch (e) {
        writeError(ctx.renderer, `failed to delete: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      writeOk(ctx.renderer, `multiple sessions match '${prefix}', be more specific`);
      for (const s of sessions) {
        writeResult(ctx.renderer, formatSessionLine(s, fmt));
      }
    }
  } else {
    const prefix = parts[1].trim();
    const sessions = store?.findSessionsByPrefix(prefix) ?? [];
    if (sessions.length === 0) {
      writeOk(ctx.renderer, `no session matching '${prefix}'`);
    } else if (sessions.length === 1) {
      const s = sessions[0];
      const msgCount = s.messages.length;
      const keys = Object.keys(ctx.session) as Array<keyof SessionLike>;
      for (const k of keys) delete (ctx.session as unknown as Record<string, unknown>)[k as string];
      Object.assign(ctx.session, s);
      renderSessionWithCtx(ctx);
      writeOk(ctx.renderer, `loaded session (${msgCount} msgs)`);
    } else {
      writeOk(ctx.renderer, `multiple sessions match '${prefix}':`);
      for (const s of sessions) {
        writeResult(ctx.renderer, formatSessionLine(s, fmt));
      }
    }
  }
}

async function handleClear(ctx: SlashCtx): Promise<void> {
  if (ctx.dispatchSessionEnd !== undefined) await ctx.dispatchSessionEnd("clear");
  ctx.session.messages.length = 0;
  ctx.session.totalEstimatedTokens = 0;
  sessionResetCalibration(ctx.session);
  ctx.session.compactions.length = 0;
  if (Array.isArray(ctx.context.chainDeclined)) ctx.context.chainDeclined.length = 0;
  else ctx.context.chainDeclined.clear();
  renderSessionWithCtx(ctx);
  if (ctx.dispatchSessionStart !== undefined) await ctx.dispatchSessionStart("clear");
}

function readStashAnswer(): boolean {
  try {
    const buf = Buffer.alloc(1);
    const n = fs.readSync(0, buf, 0, 1, null);
    if (n !== 1) return false;
    return buf[0] === 0x79 || buf[0] === 0x59; 
  } catch {
    return false;
  }
}

async function handleUndo(ctx: SlashCtx): Promise<void> {
  const removed = undoLast(ctx.session);
  if (removed === 0) {
    writeOk(ctx.renderer, "nothing to undo");
    return;
  }
  renderSessionWithCtx(ctx);
  writeOk(ctx.renderer, `removed ${removed} message(s)`);
  writeOk(ctx.renderer, "  git stash working changes? [y/N] ");
  const doStash = readStashAnswer();
  if (doStash) {
    try {
      const out = spawnSync("git", ["stash"], { encoding: "utf8" });
      if (out.status === 0) {
        writeOk(ctx.renderer, "git stash done");
      } else {
        writeError(ctx.renderer, `git stash failed: ${out.stderr.trim()}`);
      }
    } catch (e) {
      writeError(ctx.renderer, `git stash failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

async function handleRedo(ctx: SlashCtx): Promise<void> {
  if (!sessionRedo(ctx.session)) {
    writeOk(ctx.renderer, "nothing to redo");
    return;
  }
  renderSessionWithCtx(ctx);
  writeOk(ctx.renderer, "restored the last rewind");
}

async function handleRewind(ctx: SlashCtx): Promise<void> {
  const targets = ctx.rewindTargets !== undefined
    ? ctx.rewindTargets(ctx.session)
    : ctx.session.messages
      .map((m, idx) => [idx, m] as const)
      .filter(([, m]) => m.role === "user")
      .map(([idx, m]) => [idx, [...m.content].slice(0, 80).join("").replace(/\n/g, " ")] as [number, string]);
  if (targets.length === 0) {
    writeOk(ctx.renderer, "nothing to rewind to");
    return;
  }
  ctx.input.startRewindPicker(targets);
}

async function handleRetry(ctx: SlashCtx): Promise<void> {
  const lastUser = [...ctx.session.messages].reverse().find((m) => m.role === "user");
  if (lastUser !== undefined) {
    ctx.input.buffer = lastUser.content;
    ctx.input.cursor = [...lastUser.content].length;
    writeOk(ctx.renderer, "edit last message and press Enter to retry");
  } else {
    writeOk(ctx.renderer, "no previous message to retry");
  }
}

async function handleQuit(ctx: SlashCtx): Promise<void> {
  ctx.isRunning = false;
  throw new QuitError();
}

async function handleHistory(ctx: SlashCtx): Promise<void> {
  const entries = ctx.loadHistory?.() ?? [];
  if (entries.length === 0) {
    writeOk(ctx.renderer, "no chat history");
    return;
  }
  writeOk(ctx.renderer, `global chat history (${entries.length} entries):`);
  const lastTen = entries.slice(-10);
  for (const entry of lastTen) {
    const preview = [...entry.content].slice(0, 80).join("");
    writeResult(ctx.renderer, `  ${preview}`);
  }
  if (entries.length > 10) {
    writeOk(ctx.renderer, "  ... (showing last 10)");
  }
}
