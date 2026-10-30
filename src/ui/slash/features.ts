// /compress, /compact, /loop, /worktree, /wt-merge, /wt-exit.
//
// Compression itself is deferred to the event loop (see handleCompress in
// mod.ts); this file only turns /compress into that deferred outcome.
// Worktree operations run git directly, matching the original's git-worktree
// extra.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  applyPromptMode,
  cliResolveWtBaseDir,
  renderSessionWithCtx,
  writeError,
  writeOk,
  writeResult,
  type SlashCtx,
} from "./mod.ts";
import { SlashDeferredError } from "./outcome.ts";

export const DEFAULT_PLAN_FILENAME = "LOOP_PLAN.md";

/** Deferred worktree action, thrown so the event loop can perform it after the TUI yields. */
export type DeferredWorktreeAction =
  | { kind: "merge"; branch: string; target: string; mainPath: string; wtPath: string }
  | { kind: "exit"; mainPath: string };

export class DeferredWorktreeError extends Error {
  readonly action: DeferredWorktreeAction;

  constructor(action: DeferredWorktreeAction) {
    super(
      action.kind === "merge"
        ? `deferred worktree merge: ${action.branch} into ${action.target}`
        : `deferred worktree exit: ${action.mainPath}`,
    );
    this.name = "DeferredWorktreeError";
    this.action = action;
  }
}

export async function handle(parts: string[], ctx: SlashCtx): Promise<void> {
  switch (parts[0]) {
    case "/compress":
    case "/compact":
      handleCompressCmd(parts);
      break;
    case "/loop":
      await handleLoop(parts, ctx);
      break;
    case "/worktree":
      await handleWorktree(parts, ctx);
      break;
    case "/wt-merge":
      await handleWtMerge(parts, ctx);
      break;
    case "/wt-exit":
      await handleWtExit(ctx);
      break;
    default:
      break;
  }
}

function handleCompressCmd(parts: string[]): never {
  const joined = parts.slice(1).join(" ");
  const trimmed = joined.trim();
  const instructions =
    trimmed === "" || trimmed === "(none)" ? undefined : trimmed;
  throw new SlashDeferredError({ kind: "deferCompress", instructions });
}

async function handleLoop(parts: string[], ctx: SlashCtx): Promise<void> {
  if (parts.length < 2 || parts[1] === "status") {
    if (ctx.loopState !== undefined) {
      const status = ctx.loopState.active ? "active" : "stopped";
      writeOk(
        ctx.renderer,
        `loop ${status}: ${ctx.loopState.iterationLabel()} (${ctx.loopState.planFile})`,
      );
    } else {
      writeOk(ctx.renderer, "no active loop");
      writeResult(ctx.renderer, "usage: /loop <prompt>  |  /loop stop");
    }
  } else if (parts[1] === "stop") {
    if (ctx.loopState !== undefined) {
      ctx.loopState.active = false;
      writeOk(ctx.renderer, "loop stopped");
    } else {
      writeOk(ctx.renderer, "no active loop");
    }
  } else {
    const prompt = parts.slice(1).join(" ");
    if (prompt === "") {
      writeError(ctx.renderer, "usage: /loop <prompt>");
      return;
    }
    if (ctx.loopFactory === undefined) {
      writeError(ctx.renderer, "loop support not available");
      return;
    }
    ctx.loopState = ctx.loopFactory(prompt, DEFAULT_PLAN_FILENAME);
    writeOk(ctx.renderer, "loop started — iteration 1 will run after this message");
  }
}

// --- git worktree helpers (git CLI, as in the original extra) ---

export interface WorktreeInfo {
  branch: string;
  worktreePath: string;
  mainRepoPath: string;
}

function gitOutput(args: string[]): string | undefined {
  try {
    const out = spawnSync("git", args, { encoding: "utf8" });
    if (out.status !== 0) return undefined;
    return out.stdout.trim();
  } catch {
    return undefined;
  }
}

function absolutize(p: string): string {
  return path.isAbsolute(p) ? path.normalize(p) : path.join(process.cwd(), p);
}

export function validateBranchName(name: string): void {
  if (name === "") throw new Error("name is empty");
  if ([...name].some((c) => /\s/.test(c))) {
    throw new Error(`invalid name '${name}': must be a single word without spaces`);
  }
  if (name.includes("/")) {
    throw new Error(
      `invalid name '${name}': must not contain slashes (it is also a directory name)`,
    );
  }
  if (name.startsWith("-")) {
    throw new Error(`invalid name '${name}': must not start with '-'`);
  }
  const out = spawnSync("git", ["check-ref-format", "--branch", name], {
    encoding: "utf8",
  });
  if (out.status !== 0) throw new Error(`invalid branch name '${name}'`);
}

export function detectWorktree(): WorktreeInfo | undefined {
  const commonDir = gitOutput(["rev-parse", "--git-common-dir"]);
  const gitDir = gitOutput(["rev-parse", "--git-dir"]);
  if (commonDir === undefined || gitDir === undefined) return undefined;
  if (absolutize(commonDir) === absolutize(gitDir)) return undefined;
  const gitDirPath = absolutize(gitDir);
  const gitdirFile = path.join(gitDirPath, "gitdir");
  let worktreePath: string;
  if (fs.existsSync(gitdirFile)) {
    try {
      const raw = fs.readFileSync(gitdirFile, "utf8").trim();
      if (raw !== "") {
        const abs = absolutize(raw);
        worktreePath = path.dirname(abs);
      } else {
        worktreePath = path.dirname(gitDirPath);
      }
    } catch {
      worktreePath = path.dirname(gitDirPath);
    }
  } else {
    worktreePath = path.dirname(gitDirPath);
  }
  const mainRepoPath = path.dirname(absolutize(commonDir));
  const branch = gitOutput(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === undefined || branch === "HEAD") return undefined;
  return { branch, worktreePath, mainRepoPath };
}

export function defaultBranch(repoPath: string): string | undefined {
  for (const name of ["main", "master"]) {
    const out = spawnSync("git", ["-C", repoPath, "rev-parse", "--verify", name], {
      encoding: "utf8",
    });
    if (out.status === 0) return name;
  }
  return undefined;
}

export function repoName(repoPath: string): string {
  return path.basename(repoPath) || "unknown";
}

function mainRepoPath(): string {
  const top = gitOutput(["rev-parse", "--show-toplevel"]);
  if (top === undefined) throw new Error("not in a git repository");
  return top;
}

function branchExists(mainRepo: string, name: string): boolean {
  const out = spawnSync(
    "git",
    ["-C", mainRepo, "rev-parse", "--verify", `refs/heads/${name}`],
    { encoding: "utf8" },
  );
  return out.status === 0;
}

function isWorktreeRegistered(mainRepo: string, target: string): boolean {
  const out = spawnSync("git", ["-C", mainRepo, "worktree", "list", "--porcelain"], {
    encoding: "utf8",
  });
  if (out.status !== 0) return false;
  return out.stdout.split("\n").some((line) => line === `worktree ${target}`);
}

export function createWorktree(
  name: string,
  baseDir?: string,
): [string, WorktreeInfo] {
  validateBranchName(name);
  const mainRepo = mainRepoPath();
  if (branchExists(mainRepo, name)) {
    throw new Error(
      `branch '${name}' already exists; use an existing worktree or pick another name`,
    );
  }
  const target = baseDir !== undefined
    ? path.join(baseDir, name)
    : path.join(path.dirname(mainRepo), name);
  if (fs.existsSync(target)) {
    if (isWorktreeRegistered(mainRepo, target)) {
      throw new Error(`worktree '${name}' already exists at ${target}; cd into it instead`);
    }
    throw new Error(`target path ${target} already exists`);
  }
  const parent = path.dirname(target);
  if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
  const out = spawnSync(
    "git",
    ["-C", mainRepo, "worktree", "add", "-b", name, "--", target],
    { encoding: "utf8" },
  );
  if (out.status !== 0) {
    const detail = `${out.stdout.trim()} ${out.stderr.trim()}`.trim();
    throw new Error(`git worktree add failed: ${detail}`);
  }
  const wtPath = absolutize(target);
  return [wtPath, { branch: name, worktreePath: wtPath, mainRepoPath: mainRepo }];
}

async function handleWorktree(parts: string[], ctx: SlashCtx): Promise<void> {
  if (parts.length < 2) {
    writeError(ctx.renderer, "usage: /worktree <name>");
    return;
  }
  const name = parts[1].trim();
  try {
    validateBranchName(name);
  } catch (e) {
    writeError(
      ctx.renderer,
      `${e instanceof Error ? e.message : String(e)}. Use a single word without spaces, slashes, or leading dashes.`,
    );
    return;
  }
  const wtBaseDir = cliResolveWtBaseDir(ctx.cli, ctx.cfg);
  try {
    const [wtPath] = createWorktree(name, wtBaseDir);
    process.chdir(wtPath);
    ctx.session.workingDir = wtPath;
    ctx.context.reload?.();
    if (ctx.context.currentPromptName !== undefined) {
      applyPromptMode(
        ctx.context.currentPromptName,
        ctx.context,
        ctx.session,
        ctx.permission,
        ctx.promptSource,
      );
    }
    await ctx.rebuildAgent();
    renderSessionWithCtx(ctx);
    writeOk(ctx.renderer, `worktree created: branch '${name}' at ${wtPath}`);
  } catch (e) {
    writeError(ctx.renderer, `failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function handleWtMerge(parts: string[], ctx: SlashCtx): Promise<void> {
  const info = detectWorktree();
  if (info === undefined) {
    writeError(ctx.renderer, "not in a git worktree");
    return;
  }
  const target = parts.length >= 2
    ? parts[1].trim()
    : defaultBranch(info.mainRepoPath);
  if (target === undefined) {
    writeError(ctx.renderer, "no target branch specified and couldn't detect main/master");
    return;
  }
  const repo = repoName(info.mainRepoPath);
  writeOk(
    ctx.renderer,
    `merging '${info.branch}' into '${target}' in ${repo}...`,
  );
  throw new DeferredWorktreeError({
    kind: "merge",
    branch: info.branch,
    target,
    mainPath: info.mainRepoPath,
    wtPath: info.worktreePath,
  });
}

async function handleWtExit(ctx: SlashCtx): Promise<void> {
  const info = detectWorktree();
  if (info === undefined) {
    writeError(ctx.renderer, "not in a git worktree");
    return;
  }
  writeOk(ctx.renderer, `returning to main repo at ${info.mainRepoPath}`);
  throw new DeferredWorktreeError({ kind: "exit", mainPath: info.mainRepoPath });
}
