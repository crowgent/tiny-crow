import { access } from "node:fs/promises";
import type { Tool } from "./mod.ts";
import { ToolError, expandTilde } from "./mod.ts";

export const QUERY_WAIT_MS = 3000;

export interface LspManagerLike {
  notifyChanged(path: string): Promise<void>;
  diagnosticsBlock(path: string, waitMs: number): Promise<string | undefined>;
  diagnosticsBlockForEdit(path: string): Promise<string | undefined>;
  allDiagnosticsBlock(): string | undefined;
}

export interface LspArgs {
  path?: string;
}

export class LspTool implements Tool<LspArgs, string> {
  static readonly NAME = "lsp_diagnostics";
  readonly name = "lsp_diagnostics";
  manager: LspManagerLike;

  constructor(manager: LspManagerLike) {
    this.manager = manager;
  }

  description(): string {
    return "Get language-server diagnostics (errors/warnings). With `path`: diagnostics for that file, synced from disk first. Without: every file that currently has diagnostics.";
  }

  parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        path: { type: "string", description: "File to inspect (optional; omit for all files)" },
      },
    };
  }

  async call(args: LspArgs): Promise<string> {
    if (args.path !== undefined) {
      const expanded = expandTilde(args.path);
      let exists = false;
      try {
        await access(expanded);
        exists = true;
      } catch {
        exists = false;
      }
      if (!exists) throw new ToolError(`File '${expanded}' does not exist.`);
      await this.manager.notifyChanged(expanded);
      const block = await this.manager.diagnosticsBlock(expanded, QUERY_WAIT_MS);
      return block !== undefined ? block.replace(/^\s+/, "") : `No diagnostics for ${expanded}.`;
    }
    const block = this.manager.allDiagnosticsBlock();
    return block !== undefined ? `Files with diagnostics:\n${block}` : "No diagnostics.";
  }
}
