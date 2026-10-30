// /init: create AGENTS.md (and ARCHITECTURE.md) for the current project.
//
// With `force` both files are created unconditionally. Otherwise the user
// is asked, outside the TUI, one yes/no question per file. Creating
// AGENTS.md itself is deferred to the agent via SlashOutcome::DeferInit;
// ARCHITECTURE.md is created from a template when the arch template hook
// is wired, mirroring the original's archmd feature.

import * as fs from "node:fs";
import * as path from "node:path";
import {
  renderSessionWithCtx,
  resolveMouseCapture,
  writeError,
  writeOk,
  type SlashCtx,
} from "./mod.ts";
import { SlashDeferredError } from "./outcome.ts";

/** The prompt delegated to the agent to write AGENTS.md. */
export const AGENTS_CREATION_PROMPT =
  "Create an AGENTS.md file for this project. Read existing AGENTS.md or CLAUDE.md files " +
  "in parent directories, README.md, and any config files to understand the project first. " +
  "Then write a comprehensive AGENTS.md that documents: " +
  "1) the overall purpose and architecture " +
  "2) build/test/lint commands " +
  "3) coding style and conventions " +
  "4) directory layout " +
  "Keep it focused and actionable for a coding agent.";

const AGENTS_DESC = "tells coding agents how to build, test, and work with this codebase";
const ARCHITECTURE_DESC = "documents high-level codebase architecture for AI agents";

export function askYn(question: string, readLine?: () => string): boolean {
  process.stdout.write(`${question} `);
  if (readLine !== undefined) {
    const input = readLine();
    const v = input.trim().toLowerCase();
    return v === "y" || v === "yes";
  }
  try {
    const buf = Buffer.alloc(1024);
    const n = fs.readSync(0, buf, 0, buf.length, null);
    const input = buf.subarray(0, n).toString("utf8");
    const v = input.trim().toLowerCase();
    return v === "y" || v === "yes";
  } catch {
    return false;
  }
}

export function buildQuestion(
  label: string,
  desc: string,
  exists: boolean,
  cwd: string,
): string {
  if (exists) return `${label} already exists (${desc}). Overwrite? [y/N]`;
  return `No ${label} found in ${cwd} (${desc}). Create one? [y/N]`;
}

export async function handle(parts: string[], ctx: SlashCtx): Promise<void> {
  const force = parts.length >= 2 && parts[1] === "force";
  const cwd = process.cwd();
  const agentsPath = path.join(cwd, "AGENTS.md");
  const archPath = path.join(cwd, "ARCHITECTURE.md");
  const agentsExists = fs.existsSync(agentsPath);
  const archExists = fs.existsSync(archPath);

  let createAgents: boolean;
  let createArch: boolean;
  if (force) {
    if (agentsExists) writeOk(ctx.renderer, "AGENTS.md exists — will overwrite");
    if (archExists) writeOk(ctx.renderer, "ARCHITECTURE.md exists — will overwrite");
    createAgents = true;
    createArch = true;
  } else {
    const mouseCapture = resolveMouseCapture(ctx.cfg);
    const run = ctx.suspendTui ?? ((_m: boolean, fn: () => [boolean, boolean]) => fn());
    const [a, b] = run(mouseCapture, () => {
      const createA = askYn(buildQuestion("AGENTS.md", AGENTS_DESC, agentsExists, cwd));
      const createB = askYn(buildQuestion("ARCHITECTURE.md", ARCHITECTURE_DESC, archExists, cwd));
      return [createA, createB] as [boolean, boolean];
    });
    renderSessionWithCtx(ctx);
    createAgents = a;
    createArch = b;
  }

  if (createArch) {
    // The template creator belongs to the arch extra; without it, report
    // the same requirement the original reports without its feature.
    if ((ctx as unknown as { createArchitectureTemplate?: (cwd: string) => void }).createArchitectureTemplate !== undefined) {
      try {
        if (archExists) fs.unlinkSync(archPath);
        (ctx as unknown as { createArchitectureTemplate: (cwd: string) => void }).createArchitectureTemplate(cwd);
        writeOk(
          ctx.renderer,
          `Created ${cwd}/ARCHITECTURE.md — edit it to describe the codebase architecture.`,
        );
      } catch (e) {
        writeError(
          ctx.renderer,
          `Failed to create ARCHITECTURE.md: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    } else {
      writeError(
        ctx.renderer,
        "ARCHITECTURE.md creation requires the architecture template service.",
      );
    }
  }

  if (createAgents) {
    if (!ctx.context.prompts.has("code")) {
      writeError(ctx.renderer, "no 'code' prompt found. Run /regen-prompts first.");
      return;
    }
    writeOk(ctx.renderer, "delegating AGENTS.md creation to agent...");
    throw new SlashDeferredError({ kind: "deferInit" });
  }
}
