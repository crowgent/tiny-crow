import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export type DeferredWorktreeAction =
  | { kind: "Merge"; branch: string; target: string; mainPath: string; wtPath: string }
  | { kind: "Exit"; mainPath: string };

export function formatDeferredWorktreeAction(action: DeferredWorktreeAction): string {
  if (action.kind === "Merge") return `deferred worktree merge: ${action.branch} -> ${action.target}`;
  return `deferred worktree exit: back to ${action.mainPath}`;
}

export interface WorktreeInfo {
  branch: string;
  worktreePath: string;
  mainRepoPath: string;
}

export type MergeOutcome =
  | { kind: "Success" }
  | { kind: "Conflicts"; files: string[] }
  | { kind: "Error"; message: string };

export interface MergeState {
  info: WorktreeInfo;
  originalBranch: string;
  origDir: string;
  stashed: boolean;
}

export type AgentMergeStatus =
  | { kind: "Merged" }
  | { kind: "Conflicts"; files: string[] }
  | { kind: "NotMerged"; reason: string };

export function absolutize(p: string): string {
  const abs = isAbsolute(p) ? p : join(process.cwd(), p);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function runGitRaw(args: string[], cwd?: string): GitResult {
  try {
    const res = spawnSync("git", args, { encoding: "utf8", cwd });
    return {
      ok: res.status === 0,
      stdout: (res.stdout ?? "").toString(),
      stderr: (res.stderr ?? "").toString(),
    };
  } catch (err) {
    return { ok: false, stdout: "", stderr: String(err) };
  }
}

function gitOutput(args: string[]): string | null {
  const res = runGitRaw(args);
  if (!res.ok) return null;
  return res.stdout.trim();
}

export function branchExists(repoPath: string, branch: string): boolean {
  const res = runGitRaw(
    ["-C", repoPath, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
  );
  return res.ok;
}

export function isWorktreeRegistered(mainRepoPath: string, wtPath: string): boolean {
  const res = runGitRaw(["-C", mainRepoPath, "worktree", "list", "--porcelain"]);
  if (!res.ok) return false;
  const want = absolutize(wtPath);
  return res.stdout
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .some((l) => absolutize(l.slice("worktree ".length).trim()) === want);
}

export function mainRepoPath(): string {
  const commonDir = gitOutput(["rev-parse", "--git-common-dir"]);
  if (commonDir === null) throw new Error("not a git repository");
  const abs = absolutize(commonDir);
  const parent = dirname(abs);
  if (!parent) throw new Error("cannot determine main repo path");
  return parent;
}

export function validateBranchName(name: string): void {
  if (name === "") throw new Error("name is empty");
  if (/\s/.test(name)) {
    throw new Error(`invalid name '${name}': must be a single word without spaces`);
  }
  if (name.includes("/")) {
    throw new Error(`invalid name '${name}': must not contain slashes (it is also a directory name)`);
  }
  if (name.startsWith("-")) {
    throw new Error(`invalid name '${name}': must not start with '-'`);
  }
  const res = runGitRaw(["check-ref-format", "--branch", name]);
  if (!res.ok) throw new Error(`invalid branch name '${name}'`);
}

export function currentBranch(): string | null {
  const res = runGitRaw(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!res.ok) return null;
  const branch = res.stdout.trim();
  return branch === "HEAD" ? null : branch;
}

export function detect(): WorktreeInfo | null {
  const commonDir = gitOutput(["rev-parse", "--git-common-dir"]);
  const gitDir = gitOutput(["rev-parse", "--git-dir"]);
  if (commonDir === null || gitDir === null) return null;
  if (absolutize(commonDir) === absolutize(gitDir)) return null;
  const gitDirPath = absolutize(gitDir);
  const gitdirFile = join(gitDirPath, "gitdir");
  let worktreePath: string;
  if (existsSync(gitdirFile)) {
    try {
      const raw = readFileSync(gitdirFile, "utf8").trim();
      if (raw !== "") {
        const abs = absolutize(raw);
        worktreePath = dirname(abs);
      } else {
        worktreePath = dirname(gitDirPath);
      }
    } catch {
      worktreePath = dirname(gitDirPath);
    }
  } else {
    worktreePath = dirname(gitDirPath);
  }
  const mainRepoPathValue = dirname(absolutize(commonDir));
  const branch = currentBranch();
  if (branch === null) return null;
  return { branch, worktreePath, mainRepoPath: mainRepoPathValue };
}

export function defaultBranch(repoPath: string): string | null {
  for (const name of ["main", "master"]) {
    const res = runGitRaw(["-C", repoPath, "rev-parse", "--verify", name]);
    if (res.ok) return name;
  }
  return null;
}

export function create(name: string, baseDir?: string): [string, WorktreeInfo] {
  validateBranchName(name);
  const mainRepo = mainRepoPath();
  if (branchExists(mainRepo, name)) {
    throw new Error(
      `branch '${name}' already exists; use an existing worktree or pick another name`,
    );
  }
  const target =
    baseDir !== undefined ? join(baseDir, name) : join(dirname(mainRepo), name);
  if (existsSync(target)) {
    if (isWorktreeRegistered(mainRepo, target)) {
      throw new Error(`worktree '${name}' already exists at ${target}; cd into it instead`);
    }
    throw new Error(`target path ${target} already exists`);
  }
  const parent = dirname(target);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  const res = runGitRaw(["-C", mainRepo, "worktree", "add", "-b", name, "--", target]);
  if (!res.ok) {
    const detail = `${res.stdout.trim()} ${res.stderr.trim()}`.trim();
    throw new Error(`git worktree add failed: ${detail}`);
  }
  const wtPath = absolutize(target);
  return [wtPath, { branch: name, worktreePath: wtPath, mainRepoPath: mainRepo }];
}

export function repoName(path: string): string {
  return basename(path) || "unknown";
}

function runGit(args: string[]): string {
  const res = runGitRaw(args);
  if (!res.ok) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr.trim()}`);
  }
  return res.stdout.trim();
}

function runGitQuiet(args: string[]): string | null {
  const res = runGitRaw(args);
  return res.ok ? res.stdout.trim() : null;
}

function hasUncommittedChanges(): boolean {
  const res = runGitRaw(["status", "--porcelain"]);
  return res.ok && res.stdout.trim() !== "";
}

function isNothingToCommit(): boolean {
  const res = runGitRaw(["diff", "--cached", "--quiet"]);
  return res.ok;
}

function abortMergeBestEffort(): void {
  if (runGitQuiet(["merge", "--abort"]) === null) {
    runGitQuiet(["reset", "--merge"]);
  }
}

export function tryMerge(info: WorktreeInfo, target: string): [MergeState, MergeOutcome] {
  let origDir: string;
  try {
    origDir = process.cwd();
  } catch (err) {
    return [
      { info, originalBranch: "", origDir: "", stashed: false },
      { kind: "Error", message: `current_dir: ${err}` },
    ];
  }
  const restore = () => {
    try {
      process.chdir(origDir);
    } catch {

    }
  };
  try {
    process.chdir(info.mainRepoPath);
  } catch (err) {
    return [
      { info, originalBranch: "", origDir, stashed: false },
      { kind: "Error", message: `cd to ${info.mainRepoPath}: ${err}` },
    ];
  }
  const originalBranch = currentBranch() ?? "";
  let stashed = false;
  if (hasUncommittedChanges()) {
    try {
      runGit(["stash", "--include-untracked"]);
      stashed = true;
    } catch (err) {
      restore();
      return [
        { info, originalBranch, origDir, stashed: false },
        {
          kind: "Error",
          message: `failed to stash uncommitted changes in main repo: ${err}; commit or stash them manually and retry`,
        },
      ];
    }
  }
  const state: MergeState = { info, originalBranch, origDir, stashed };
  const cleanupEarly = (message: string): MergeOutcome => {
    if (state.stashed) {
      try {
        runGit(["stash", "pop"]);
      } catch (err) {
        console.error(
          `worktree merge: failed to restore stash during early cleanup; stashed changes may be lost; try \`git stash pop\` manually: ${err}`,
        );
      }
    }
    restore();
    return { kind: "Error", message };
  };
  try {
    runGit(["fetch", "--all"]);
  } catch (err) {
    return [state, cleanupEarly(`fetch failed: ${err}`)];
  }
  try {
    runGit(["checkout", target]);
  } catch (err) {
    return [state, cleanupEarly(`checkout failed: ${err}`)];
  }
  try {
    runGit(["pull", "--no-edit"]);
  } catch {

  }
  try {
    runGit(["merge", "--squash", info.branch]);
  } catch (err) {
    if (hasMergeConflict()) {
      return [state, { kind: "Conflicts", files: conflictedFiles() }];
    }
    console.error(`worktree merge: merge failed, aborting: ${err}`);
    abortMergeBestEffort();
    if (originalBranch !== "") runGitQuiet(["checkout", originalBranch]);
    return [state, cleanupEarly(`merge failed: ${err}`)];
  }
  try {
    runGit(["commit", "--no-edit"]);
  } catch (err) {
    if (isNothingToCommit()) {
      return [state, { kind: "Success" }];
    }
    abortMergeBestEffort();
    if (originalBranch !== "") runGitQuiet(["checkout", originalBranch]);
    return [state, cleanupEarly(`commit after squash failed: ${err}`)];
  }
  
  return [state, { kind: "Success" }];
}

export function completeMerge(state: MergeState): void {
  completeMergeWithForce(state, false);
}

export function completeMergeForce(state: MergeState): void {
  completeMergeWithForce(state, true);
}

function completeMergeWithForce(state: MergeState, _force: boolean): void {
  const origDir = process.cwd();
  let stayInMain = false;
  try {
    process.chdir(state.info.mainRepoPath);
    runGit(["worktree", "remove", "--force", state.info.worktreePath]);
    runGit(["branch", "-D", state.info.branch]);
    if (state.stashed) {
      try {
        runGit(["stash", "pop"]);
      } catch (err) {
        stayInMain = true;
        throw new Error(
          `merge succeeded and worktree was removed, but stash pop failed: ${err}. Your changes are in the stash; run \`git stash pop\` manually.`,
        );
      }
    }
    stayInMain = true;
  } finally {
    if (!stayInMain) {
      try {
        process.chdir(origDir);
      } catch {

      }
    }
  }
}

export function cleanupWorktree(
  wtPath: string,
  branch: string,
  mainRepoPathValue: string,
  force: boolean,
): void {
  const origDir = process.cwd();
  try {
    process.chdir(mainRepoPathValue);
  } catch (err) {
    console.error(`cleanup_worktree: ${err}`);
    return;
  }
  try {
    const removeArgs = force
      ? ["worktree", "remove", "--force", wtPath]
      : ["worktree", "remove", wtPath];
    runGitRaw(removeArgs);
    const branchFlag = force ? "-D" : "-d";
    runGitRaw(["branch", branchFlag, branch]);
  } finally {
    try {
      process.chdir(origDir);
    } catch {

    }
  }
}

export function cancelMerge(state: MergeState): void {
  const origDir = process.cwd();
  try {
    process.chdir(state.info.mainRepoPath);
    if (hasMergeConflict()) abortMergeBestEffort();
    if (state.originalBranch !== "") runGitQuiet(["checkout", state.originalBranch]);
    if (state.stashed) {
      try {
        runGit(["stash", "pop"]);
      } catch (err) {
        console.error(`cancel_merge: failed to pop stash; try \`git stash pop\` manually: ${err}`);
      }
    }
  } finally {
    try {
      process.chdir(state.origDir);
    } catch {
      try {
        process.chdir(origDir);
      } catch {

      }
    }
  }
}

export function hasMergeConflict(): boolean {
  return repoHasMergeConflict(process.cwd());
}

export function conflictedFiles(): string[] {
  return repoConflictedFiles(process.cwd());
}

export function repoHasMergeConflict(repoPath: string): boolean {
  const res = runGitRaw(["-C", repoPath, "rev-parse", "--git-path", "MERGE_HEAD"]);
  if (res.ok) {
    const rel = res.stdout.trim();
    if (rel !== "") {
      const abs = isAbsolute(rel) ? rel : join(repoPath, rel);
      if (existsSync(abs)) return true;
    }
  }
  const diff = runGitRaw(["-C", repoPath, "diff", "--name-only", "--diff-filter=U"]);
  return diff.ok && diff.stdout.trim() !== "";
}

export function repoConflictedFiles(repoPath: string): string[] {
  const res = runGitRaw(["-C", repoPath, "diff", "--name-only", "--diff-filter=U"]);
  if (!res.ok) return [];
  return res.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

export function verifyBranchMerged(
  mainRepo: string,
  target: string,
  branch: string,
): AgentMergeStatus {
  if (!branchExists(mainRepo, target)) {
    return { kind: "NotMerged", reason: `target branch '${target}' not found` };
  }
  if (!branchExists(mainRepo, branch)) return { kind: "Merged" };
  if (repoHasMergeConflict(mainRepo)) {
    return { kind: "Conflicts", files: repoConflictedFiles(mainRepo) };
  }
  if (branchIsAncestor(mainRepo, branch, target)) return { kind: "Merged" };
  const count = cherryUnmergedCount(mainRepo, target, branch);
  if (typeof count === "number") {
    return count === 0
      ? { kind: "Merged" }
      : {
          kind: "NotMerged",
          reason: `branch '${branch}' has commits not present in '${target}'`,
        };
  }
  return { kind: "NotMerged", reason: count };
}

function branchIsAncestor(mainRepo: string, branch: string, target: string): boolean {
  return runGitRaw(["-C", mainRepo, "merge-base", "--is-ancestor", branch, target]).ok;
}

function cherryUnmergedCount(
  mainRepo: string,
  target: string,
  branch: string,
): number | string {
  const res = runGitRaw(["-C", mainRepo, "cherry", target, branch]);
  if (!res.ok) {
    return `could not compare '${branch}' with '${target}': ${res.stderr.trim()}`;
  }
  return res.stdout.split("\n").filter((l) => l.startsWith("+")).length;
}

export function worktreeHasUncommitted(wtPath: string): boolean {
  const res = runGitRaw(["-C", wtPath, "status", "--porcelain"]);
  return res.ok && res.stdout.trim() !== "";
}

export function worktreeAutoCommitAll(wtPath: string): void {
  const add = runGitRaw(["-C", wtPath, "add", "-u"]);
  if (!add.ok) throw new Error(`git add -u failed: ${add.stderr.trim()}`);
  const diff = runGitRaw(["-C", wtPath, "diff", "--cached", "--quiet"]);
  if (diff.ok) {
    const status = runGitRaw(["-C", wtPath, "status", "--porcelain"]);
    const untracked = status.ok && status.stdout.split("\n").some((l) => l.startsWith("??"));
    if (untracked) {
      throw new Error(
        "only untracked files remain; commit them manually (auto-commit skips untracked files)",
      );
    }
    return;
  }
  const commit = runGitRaw(["-C", wtPath, "commit", "-m", "auto-commit: save changes before merge"]);
  if (!commit.ok) {
    const detail = `${commit.stdout.trim()} ${commit.stderr.trim()}`.trim();
    if (detail.includes("nothing to commit")) return;
    throw new Error(`git commit failed: ${detail}`);
  }
}

export { resolve };
