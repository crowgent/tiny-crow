import { readFile, stat } from "node:fs/promises";
import type {
  AskSenderLike,
  PermCheckLike,
  ReadArgs,
  Tool,
} from "./mod.ts";
import {
  ToolError,
  checkPermPath,
  editSystem,
  expandTilde,
  trackRead,
} from "./mod.ts";
import { crc32HexOfString } from "./crc.ts";

export const DEFAULT_MAX_TEXT_SIZE = 1024 * 1024;

export function readBounds(offset: number, limit: number, totalLines: number): [number, number] {
  const start = Math.min(offset, totalLines);
  const end = Math.min(start + limit, totalLines);
  return [start, end];
}

export function displayStart(start: number, totalLines: number): number {
  return totalLines === 0 ? 0 : start + 1;
}

export class ReadTool implements Tool<ReadArgs, string> {
  static readonly NAME = "read";
  readonly name = "read";
  permission: PermCheckLike | undefined | null;
  askTx: AskSenderLike | undefined | null;
  maxTextFileSize: number;
  maxLines: number;

  constructor(
    permission?: PermCheckLike | null,
    askTx?: AskSenderLike | null,
    maxTextFileSize?: number | null,
    maxLines = 200,
  ) {
    this.permission = permission ?? null;
    this.askTx = askTx ?? null;
    this.maxTextFileSize = maxTextFileSize ?? DEFAULT_MAX_TEXT_SIZE;
    this.maxLines = maxLines;
  }

  description(): string {
    if (editSystem() === "hashedit") {
      return `Read file contents with CRC-32 tagged lines for tag-based editing. Each line is prefixed with 'N|TAG' where TAG is an 8-char hex CRC-32 of the line content. Use these tags with the edit tool for CAS-guarded edits. Defaults to first ${this.maxLines} lines.`;
    }
    return `Read the contents of a file. Supports text files. Defaults to first ${this.maxLines} lines. Use offset/limit for large files.`;
  }

  parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file (relative or absolute)" },
        offset: { type: "integer", description: "Line number to start from (1-indexed)" },
        limit: { type: "integer", description: "Maximum number of lines to read" },
      },
      required: ["path"],
    };
  }

  async call(args: ReadArgs): Promise<string> {
    const path = expandTilde(args.path);
    const offset = Math.max((args.offset ?? 1) - 1, 0);
    const limit = args.limit ?? this.maxLines;
    const coaching = await checkPermPath(this.permission, this.askTx, "read", path);
    const blocked = trackRead(path, offset, limit);
    if (blocked) throw new ToolError(blocked);
    let fileSize: number;
    try {
      fileSize = (await stat(path)).size;
    } catch (e) {
      throw new ToolError(e instanceof Error ? e.message : String(e));
    }
    if (fileSize > this.maxTextFileSize) {
      throw new ToolError(
        `File too large (${fileSize} bytes). Maximum allowed file size is ${this.maxTextFileSize} bytes.`,
      );
    }
    let content: string;
    try {
      content = await readFile(path, "utf8");
    } catch (e) {
      throw new ToolError(e instanceof Error ? e.message : String(e));
    }
    const allLines = content.split("\n");
    const totalLines = content === "" ? 0 : content.endsWith("\n") ? allLines.length - 1 : allLines.length;
    const lines = content === "" ? [] : allLines.slice(0, totalLines).map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
    const [start, end] = readBounds(offset, limit, totalLines);
    const es = editSystem();
    let excerpt: string;
    if (es === "hashedit") {
      const width = totalLines >= 1000 ? 4 : 3;
      excerpt = lines
        .slice(start, end)
        .map((line, i) => {
          const lineNum = start + i + 1;
          return `${String(lineNum).padStart(width, " ")}|${crc32HexOfString(line)} ${line}`;
        })
        .join("\n");
    } else {
      excerpt = lines.slice(start, end).join("\n");
    }
    let info: string;
    if (es === "hashedit") {
      const fileCrc = crc32HexOfString(content.replace(/\r\n/g, "\n"));
      info = `File: ${path} (${totalLines} lines total, lines ${displayStart(start, totalLines)}-${end}) [CRC: ${fileCrc}]\n\n${excerpt}`;
    } else {
      info = `File: ${path} (${totalLines} lines total, showing lines ${displayStart(start, totalLines)}-${end})\n\n${excerpt}`;
    }
    if (end < totalLines) {
      const remaining = totalLines - end;
      info += `\n\n[truncated after ${end - start} lines — ${remaining} more lines (lines ${end + 1}-${totalLines}); re-call with offset/limit to see more]`;
    }
    if (coaching) info = `${coaching}\n\n${info}`;
    return info;
  }
}
