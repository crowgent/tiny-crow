import type {
  AskSenderLike,
  FindFilesArgs,
  PermCheckLike,
  Tool,
} from "./mod.ts";
import {
  ToolError,
  checkPerm,
  expandTilde,
  walkDirectory,
} from "./mod.ts";

export class FindFilesTool implements Tool<FindFilesArgs, string> {
  static readonly NAME = "find_files";
  readonly name = "find_files";
  permission: PermCheckLike | undefined | null;
  askTx: AskSenderLike | undefined | null;
  maxResults: number;

  constructor(permission?: PermCheckLike | null, askTx?: AskSenderLike | null, maxResults = 100) {
    this.permission = permission ?? null;
    this.askTx = askTx ?? null;
    this.maxResults = maxResults;
  }

  description(): string {
    return "Recursively find files matching a regex pattern on the filename (e.g. `.*\\.rs$`, `config.*\\.toml`). Respects .gitignore. Skips node_modules and target.";
  }

  parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Regex pattern matched against the filename (e.g. `.*\\.rs$`). Not a glob — escape dots, use `.*` for wildcards.",
        },
        path: { type: "string", description: "Directory to search in (defaults to current working directory)" },
      },
      required: ["pattern"],
    };
  }

  async call(args: FindFilesArgs): Promise<string> {
    const coaching = await checkPerm(this.permission, this.askTx, "find_files", args.pattern);
    let re: RegExp;
    try {
      re = new RegExp(args.pattern);
    } catch (e) {
      throw new ToolError(`Invalid regex: ${e instanceof Error ? e.message : String(e)}`);
    }
    const searchPath = expandTilde(args.path ?? ".");
    const results: string[] = [];
    for (const entry of walkDirectory(searchPath).filter((e) => e.isFile)) {
      re.lastIndex = 0;
      if (re.test(entry.name)) {
        results.push(entry.path);
        if (results.length >= this.maxResults) break;
      }
    }
    if (results.length === 0) {
      const msg = "No files found matching the pattern.";
      return coaching ? `${coaching}\n\n${msg}` : msg;
    }
    results.sort();
    const total = results.length;
    const maxResults = this.maxResults;
    let result: string;
    if (total >= maxResults) {
      result = `${total} files found (showing first ${maxResults}):\n${results.slice(0, maxResults).join("\n")}\n\n[truncated after ${maxResults} entries — ${total - maxResults} more; narrow the pattern or path]`;
    } else {
      result = `${total} files found:\n${results.join("\n")}`;
    }
    return coaching ? `${coaching}\n\n${result}` : result;
  }
}
