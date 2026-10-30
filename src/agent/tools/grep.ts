import { readFile } from "node:fs/promises";
import type {
  AskSenderLike,
  GrepArgs,
  PermCheckLike,
  Tool,
} from "./mod.ts";
import {
  ToolError,
  checkPerm,
  expandTilde,
  walkDirectory,
} from "./mod.ts";

export function globToRegex(glob: string): string {
  let re = "";
  for (const c of glob) {
    if (c === ".") re += "\\.";
    else if (c === "*") re += ".*";
    else if (c === "?") re += ".";
    else if (c === "{") re += "(?:";
    else if (c === "}") re += ")";
    else if (c === ",") re += "|";
    else re += c;
  }
  return re;
}

export function isBinary(data: Uint8Array): boolean {
  const n = Math.min(data.length, 8192);
  for (let i = 0; i < n; i++) {
    if (data[i] === 0) return true;
  }
  return false;
}

export class GrepTool implements Tool<GrepArgs, string> {
  static readonly NAME = "grep";
  readonly name = "grep";
  permission: PermCheckLike | undefined | null;
  askTx: AskSenderLike | undefined | null;
  maxResults: number;

  constructor(permission?: PermCheckLike | null, askTx?: AskSenderLike | null, maxResults = 100) {
    this.permission = permission ?? null;
    this.askTx = askTx ?? null;
    this.maxResults = maxResults;
  }

  description(): string {
    return "Search file contents using a regex pattern (Rust regex syntax). Respects .gitignore. Skips binary files, node_modules, and target.";
  }

  parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern to search for (supports Rust regex syntax)" },
        path: { type: "string", description: "Directory to search in (defaults to current working directory)" },
        include: { type: "string", description: "Optional file glob pattern to filter (e.g. '*.rs', '*.{ts,tsx}')" },
        context_lines: { type: "integer", description: "Number of context lines to show before and after each match (like grep -C)" },
      },
      required: ["pattern"],
    };
  }

  async call(args: GrepArgs): Promise<string> {
    const coaching = await checkPerm(this.permission, this.askTx, "grep", args.pattern);
    let re: RegExp;
    try {
      re = new RegExp(args.pattern);
    } catch (e) {
      throw new ToolError(`Invalid regex pattern: ${e instanceof Error ? e.message : String(e)}`);
    }
    const searchPath = expandTilde(args.path ?? ".");
    const context = args.context_lines ?? 0;
    let includeRe: RegExp | undefined;
    if (args.include !== undefined) {
      try {
        includeRe = new RegExp(`^(?:${globToRegex(args.include)})$`);
      } catch {
        includeRe = /.*/;
      }
    }
    const entries = walkDirectory(searchPath).filter((e) => e.isFile);
    const maxResults = this.maxResults;
    let fileCount = 0;
    let filesWithMatches = 0;
    const allResults: string[] = [];
    for (const entry of entries) {
      if (allResults.length >= maxResults) break;
      if (includeRe && !includeRe.test(entry.name)) continue;
      if (entry.size > 10 * 1024 * 1024) continue;
      let data: Buffer;
      try {
        data = await readFile(entry.path);
      } catch {
        continue;
      }
      if (isBinary(data)) continue;
      fileCount += 1;
      const content = data.toString("utf8");
      const lines = content.split("\n");
      const total = content === "" ? 0 : content.endsWith("\n") ? lines.length - 1 : lines.length;
      const usable = lines.slice(0, total);
      const matchLines: number[] = [];
      for (let i = 0; i < usable.length; i++) {
        re.lastIndex = 0;
        if (re.test(usable[i])) matchLines.push(i);
      }
      if (matchLines.length === 0) continue;
      filesWithMatches += 1;
      if (context === 0) {
        for (const ml of matchLines) {
          allResults.push(`${entry.path}:${ml + 1}:${usable[ml]}`);
          if (allResults.length >= maxResults) break;
        }
      } else {
        const shown = new Array<boolean>(total).fill(false);
        for (const ml of matchLines) {
          const start = Math.max(ml - context, 0);
          const end = Math.min(ml + 1 + context, total);
          for (let s = start; s < end; s++) shown[s] = true;
        }
        let i = 0;
        while (i < total && allResults.length < maxResults) {
          if (!shown[i]) {
            i += 1;
            continue;
          }
          if (allResults.length > 0) allResults.push("--");
          while (i < total && shown[i] && allResults.length < maxResults) {
            const isMatch = matchLines.includes(i);
            const sep = isMatch ? ":" : "-";
            allResults.push(`${entry.path}-${i + 1}${sep} ${usable[i]}`);
            i += 1;
          }
        }
      }
    }
    if (allResults.length === 0) {
      const msg = "No matches found.";
      return coaching ? `${coaching}\n\n${msg}` : msg;
    }
    const totalResults = allResults.length;
    const truncated = totalResults >= maxResults;
    let result: string;
    if (truncated) {
      result = `${totalResults} results (showing first ${maxResults}, searched ${fileCount} files):\n${allResults.join("\n")}\n\n[truncated after ${maxResults} matches — ${totalResults - maxResults} more matches; narrow the pattern or restrict to a path]`;
    } else {
      result = `${totalResults} results (searched ${fileCount} files):\n${allResults.join("\n")}`;
    }
    if (!truncated && totalResults >= 10 && filesWithMatches >= 2) {
      result += `\n\n[${totalResults} matches across ${filesWithMatches} files; for cross-file enumeration or synthesis, \`task\` returns a verified summary in one call]`;
    }
    return coaching ? `${coaching}\n\n${result}` : result;
  }
}
