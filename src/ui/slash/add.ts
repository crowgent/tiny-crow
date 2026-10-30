import * as fs from "node:fs";
import * as path from "node:path";
import {
  writeError,
  writeOk,
  writeResult,
  type SlashCtx,
} from "./mod.ts";

export function resolvePath(s: string): string {
  return path.isAbsolute(s) ? s : path.join(process.cwd(), s);
}

function hasPendingMedia(ctx: SlashCtx): boolean {
  return (ctx.session.pendingMedia?.length ?? 0) > 0;
}

const MEDIA_EXTENSIONS: Record<string, { kind: "image" | "audio" | "document"; mime: string }> = {
  ".png": { kind: "image", mime: "image/png" },
  ".jpg": { kind: "image", mime: "image/jpeg" },
  ".jpeg": { kind: "image", mime: "image/jpeg" },
  ".gif": { kind: "image", mime: "image/gif" },
  ".webp": { kind: "image", mime: "image/webp" },
  ".mp3": { kind: "audio", mime: "audio/mpeg" },
  ".wav": { kind: "audio", mime: "audio/wav" },
  ".ogg": { kind: "audio", mime: "audio/ogg" },
  ".flac": { kind: "audio", mime: "audio/flac" },
  ".pdf": { kind: "document", mime: "application/pdf" },
};

export async function handle(parts: string[], ctx: SlashCtx): Promise<void> {
  switch (parts[0]) {
    case "/add":
      await handleAdd(parts, ctx);
      break;
    case "/drop":
      await handleDrop(parts, ctx);
      break;
    case "/drop-all":
      await handleDropAll(ctx);
      break;
    default:
      break;
  }
}

async function handleAdd(parts: string[], ctx: SlashCtx): Promise<void> {
  if (parts.length < 2) {
    if (ctx.context.extraFiles.length === 0 && !hasPendingMedia(ctx)) {
      writeOk(ctx.renderer, "no files added (use /add <path>)");
    } else {
      writeOk(ctx.renderer, "added files:");
      for (const f of ctx.context.extraFiles) {
        let size = 0;
        try {
          size = fs.statSync(f).size;
        } catch {

        }
        writeResult(ctx.renderer, `  ${f} (${size}B)`);
      }
      for (const m of ctx.session.pendingMedia ?? []) {
        writeResult(ctx.renderer, `  [${m.kind}] ${m.pathText} (${m.size}B)`);
      }
    }
    return;
  }

  const filePath = resolvePath(parts[1]);
  if (!fs.existsSync(filePath)) {
    writeError(ctx.renderer, `file not found: ${filePath}`);
    return;
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch (e) {
    writeError(ctx.renderer, `file not found: ${filePath} (${e instanceof Error ? e.message : String(e)})`);
    return;
  }
  if (!stat.isFile()) {
    writeError(ctx.renderer, `not a file: ${filePath}`);
    return;
  }

  const media = MEDIA_EXTENSIONS[path.extname(filePath).toLowerCase()];
  if (media !== undefined) {
    try {
      const data = fs.readFileSync(filePath);
      const pending = ctx.session.pendingMedia ?? [];
      pending.push({
        kind: media.kind,
        size: data.length,
        pathText: filePath,
        mime: media.mime,
      });
      ctx.session.pendingMedia = pending;
      writeOk(
        ctx.renderer,
        `attached: ${filePath} (${media.mime}, ${data.length}B)`,
      );
    } catch (e) {
      writeError(ctx.renderer, `failed to load media: ${e instanceof Error ? e.message : String(e)}`);
    }
    return;
  }

  let canonical: string;
  try {
    canonical = fs.realpathSync(filePath);
  } catch {
    canonical = filePath;
  }
  if (ctx.context.extraFiles.includes(canonical)) {
    writeOk(ctx.renderer, `already added: ${canonical}`);
    return;
  }
  let size = 0;
  try {
    size = fs.statSync(canonical).size;
  } catch {

  }
  ctx.context.extraFiles.push(canonical);
  await ctx.rebuildAgent();
  writeOk(ctx.renderer, `added: ${canonical} (${size}B)`);
}

async function handleDrop(parts: string[], ctx: SlashCtx): Promise<void> {
  if (parts.length < 2) {
    writeError(ctx.renderer, "usage: /drop <path-or-index>");
    return;
  }
  const filePath = resolvePath(parts[1]);
  let canonical: string;
  try {
    canonical = fs.realpathSync(filePath);
  } catch {
    canonical = filePath;
  }

  const idx = ctx.context.extraFiles.indexOf(canonical);
  if (idx !== -1) {
    ctx.context.extraFiles.splice(idx, 1);
    await ctx.rebuildAgent();
    writeOk(ctx.renderer, `dropped: ${canonical}`);
    return;
  }

  const media = ctx.session.pendingMedia ?? [];
  const mediaIdx = media.findIndex((m) => m.pathText === canonical);
  if (mediaIdx !== -1) {
    media.splice(mediaIdx, 1);
    writeOk(ctx.renderer, `dropped media: ${canonical}`);
    return;
  }
  const parsed = Number(parts[1]);
  if (Number.isInteger(parsed) && parsed >= 0 && parsed < media.length) {
    const removed = media.splice(parsed, 1)[0];
    writeOk(ctx.renderer, `dropped media: ${removed.pathText}`);
    return;
  }

  writeError(ctx.renderer, `not in context: ${canonical} (use /add to see)`);
}

async function handleDropAll(ctx: SlashCtx): Promise<void> {
  const fileCount = ctx.context.extraFiles.length;
  const mediaCount = ctx.session.pendingMedia?.length ?? 0;
  if (fileCount === 0 && mediaCount === 0) {
    writeOk(ctx.renderer, "no files or media to drop");
    return;
  }
  if (fileCount > 0) {
    ctx.context.extraFiles.length = 0;
    await ctx.rebuildAgent();
  }
  if (ctx.session.pendingMedia !== undefined) {
    ctx.session.pendingMedia.length = 0;
  }
  const bits: string[] = [];
  if (fileCount > 0) bits.push(`${fileCount} file(s)`);
  if (mediaCount > 0) bits.push(`${mediaCount} media`);
  writeOk(ctx.renderer, `dropped ${bits.join(", ")}`);
}
