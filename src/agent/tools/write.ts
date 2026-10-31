import { access } from "node:fs/promises";
import type {
  AskSenderLike,
  PermCheckLike,
  Tool,
} from "./mod.ts";
import {
  ToolError,
  atomicWrite,
  checkPermPath,
  ensureParentDir,
  expandTilde,
  untrackReadPath,
} from "./mod.ts";
import type { LspManagerLike } from "./lsp.ts";

const DEFAULT_MAX_TEXT_SIZE = 1024 * 1024;

export class WriteTool implements Tool<{ path: string; content: string }, string> {
  static readonly NAME = "write";
  readonly name = "write";
  permission: PermCheckLike | undefined | null;
  askTx: AskSenderLike | undefined | null;
  maxTextFileSize: number;
  lsp: LspManagerLike | undefined | null;

  constructor(
    permission?: PermCheckLike | null,
    askTx?: AskSenderLike | null,
    maxTextFileSize?: number | null,
  ) {
    this.permission = permission ?? null;
    this.askTx = askTx ?? null;
    this.maxTextFileSize = maxTextFileSize ?? DEFAULT_MAX_TEXT_SIZE;
    this.lsp = null;
  }

  withLsp(lsp: LspManagerLike | undefined | null): this {
    this.lsp = lsp ?? null;
    return this;
  }

  description(): string {
    return "Create a new file with the given content. Fails if the file already exists — use edit for existing files. Automatically creates parent directories.";
  }

  parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file (relative or absolute)" },
        content: { type: "string", description: "Content to write to the file" },
      },
      required: ["path", "content"],
    };
  }

  async call(args: { path: string; content: string }): Promise<string> {
    const expanded = expandTilde(args.path);
    const coaching = await checkPermPath(this.permission, this.askTx, "write", expanded);
    let exists = false;
    try {
      await access(expanded);
      exists = true;
    } catch {
      exists = false;
    }
    if (exists) {
      throw new ToolError(
        `File '${expanded}' already exists. Use edit for targeted changes, or delete and recreate if a full rewrite is needed.`,
      );
    }
    await ensureParentDir(expanded);
    const bytes = Buffer.byteLength(args.content, "utf8");
    if (bytes > this.maxTextFileSize) {
      throw new ToolError(
        `File too large (${bytes} bytes). Maximum allowed file size is ${this.maxTextFileSize} bytes.`,
      );
    }
    try {
      await atomicWrite(expanded, args.content);
    } catch (e) {
      throw new ToolError(e instanceof Error ? e.message : String(e));
    }
    untrackReadPath(expanded);
    let result = `Written ${bytes} bytes to ${expanded}`;
    if (coaching) result = `${coaching}\n\n${result}`;
    if (this.lsp) {
      await this.lsp.notifyChanged(expanded);
      const block = await this.lsp.diagnosticsBlockForEdit(expanded);
      if (block) result += block;
    }
    return result;
  }
}
