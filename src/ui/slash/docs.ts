// /docs: list and display the bundled documentation files.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  writeError,
  writeOk,
  writeResult,
  type SlashCtx,
} from "./mod.ts";

/** Doc file names and their display titles. */
export const DOC_FILES: Array<[string, string]> = [
  ["COMMANDS.md", "Slash Commands"],
  ["CONFIG.md", "Configuration"],
  ["PROVIDERS.md", "Providers"],
  ["HASHEDIT.md", "Hash-Anchored Edits"],
  ["MEMORY.md", "Memory System"],
  ["ARCHITECTURE.md", "ARCHITECTURE.md Support"],
  ["SUBAGENTS.md", "Subagents"],
];

export function globalDocsDir(ctx?: SlashCtx): string {
  if (ctx?.docsDir !== undefined) return ctx.docsDir;
  return path.join(os.homedir(), ".local", "share", "zerostack-ts", "docs");
}

function listDocs(ctx: SlashCtx, withSlashPrefix: boolean): void {
  const docsDir = globalDocsDir(ctx);
  writeOk(ctx.renderer, "docs:");
  for (const [file, title] of DOC_FILES) {
    const filePath = path.join(docsDir, file);
    let size = 0;
    try {
      size = fs.statSync(filePath).size;
    } catch {
      // Missing file reports as 0 bytes, as in the original.
    }
    const label = withSlashPrefix ? `/docs ${file}` : file;
    writeResult(ctx.renderer, `  ${label}  — ${title}  (${size} bytes)`);
  }
}

export async function handle(parts: string[], ctx: SlashCtx): Promise<void> {
  const docsDir = globalDocsDir(ctx);

  if (parts.length < 2) {
    listDocs(ctx, true);
    writeResult(ctx.renderer, "");
    writeResult(ctx.renderer, "  /docs list  — show this listing");
    return;
  }

  const arg = parts[1];
  if (arg === "list") {
    listDocs(ctx, false);
    return;
  }

  const found = DOC_FILES.find(([f]) => f === arg);
  if (found === undefined) {
    writeError(ctx.renderer, `unknown doc: ${arg} (try /docs list)`);
    return;
  }
  const [file, title] = found;
  const filePath = path.join(docsDir, file);
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    writeError(
      ctx.renderer,
      `failed to read ${file}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return;
  }
  ctx.renderer.clearContent();
  writeOk(ctx.renderer, `── ${title} ──`);
  writeResult(ctx.renderer, "");
  for (const line of content.split("\n")) {
    writeResult(ctx.renderer, line);
  }
}
