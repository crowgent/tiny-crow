import { readdir } from "node:fs/promises";
import type {
  AskSenderLike,
  ListDirArgs,
  PermCheckLike,
  Tool,
} from "./mod.ts";
import {
  checkPermPath,
  expandTilde,
  walkDirectory,
} from "./mod.ts";

export function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIdx = 0;
  while (size >= 1024 && unitIdx < units.length - 1) {
    size /= 1024;
    unitIdx += 1;
  }
  if (unitIdx === 0) return `${bytes} ${units[unitIdx]}`;
  return `${size.toFixed(1)} ${units[unitIdx]}`;
}

export async function countDirEntries(path: string): Promise<number> {
  try {
    return (await readdir(path)).length;
  } catch {
    return 0;
  }
}

export class ListDirTool implements Tool<ListDirArgs, string> {
  static readonly NAME = "list_dir";
  readonly name = "list_dir";
  permission: PermCheckLike | undefined | null;
  askTx: AskSenderLike | undefined | null;
  maxEntries: number | undefined | null;

  constructor(
    permission?: PermCheckLike | null,
    askTx?: AskSenderLike | null,
    maxEntries?: number | null,
  ) {
    this.permission = permission ?? null;
    this.askTx = askTx ?? null;
    this.maxEntries = maxEntries ?? null;
  }

  description(): string {
    return "List files and directories in a directory. Respects .gitignore. Shows type, size, entry count for subdirectories. Sorted: directories first, then alphabetical.";
  }

  parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path (defaults to current working directory)" },
      },
      required: [],
    };
  }

  async call(args: ListDirArgs): Promise<string> {
    const path = expandTilde(args.path ?? ".");
    const coaching = await checkPermPath(this.permission, this.askTx, "list_dir", path);
    const entries: Array<[string, string, string]> = [];
    for (const entry of walkDirectory(path, 1)) {
      let kind: string;
      let size = "";
      if (entry.isDir) {
        const count = await countDirEntries(entry.path);
        kind = `dir(${count})`;
      } else if (entry.isSymlink) {
        kind = "link";
      } else {
        kind = "file";
        size = formatSize(entry.size);
      }
      entries.push([entry.name, kind, size]);
    }
    entries.sort((a, b) => {
      const aIsDir = a[1].startsWith("dir") || a[1] === "link";
      const bIsDir = b[1].startsWith("dir") || b[1] === "link";
      if (aIsDir !== bIsDir) return bIsDir ? 1 : -1;
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    });
    if (entries.length === 0) {
      const msg = `Listing ${path}:\n(empty directory)`;
      return coaching ? `${coaching}\n\n${msg}` : msg;
    }
    const totalEntries = entries.length;
    const cap = this.maxEntries ?? undefined;
    const shown = cap !== undefined ? Math.min(totalEntries, cap) : totalEntries;
    const maxName = entries.slice(0, shown).reduce((acc, e) => Math.max(acc, e[0].length), 0);
    let result = `Listing ${path}:\n`;
    for (const [name, kind, size] of entries.slice(0, shown)) {
      const padded = name.padEnd(maxName, " ");
      const sizeStr = size === "" ? "" : `  ${size}`;
      result += `  [${kind}]  ${padded}${sizeStr}\n`;
    }
    if (cap !== undefined && totalEntries > cap) {
      result += `\n[truncated after ${cap} entries — ${totalEntries - cap} more; list a subdirectory or use find_files with a narrower pattern]`;
    }
    if (coaching) result = `${coaching}\n\n${result}`;
    return result;
  }
}
