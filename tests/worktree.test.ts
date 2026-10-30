import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { defaultCli, resolveWtAutoMerge, resolveWtBaseDir, resolveWtForce } from "../src/cli.ts";
import { defaultConfig } from "../src/config/mod.ts";
import {
  branchExists,
  cancelMerge,
  cleanupWorktree,
  completeMerge,
  create,
  currentBranch,
  defaultBranch,
  detect,
  formatDeferredWorktreeAction,
  isWorktreeRegistered,
  repoName,
  repoConflictedFiles,
  repoHasMergeConflict,
  tryMerge,
  validateBranchName,
  verifyBranchMerged,
  worktreeAutoCommitAll,
  worktreeHasUncommitted,
  type DeferredWorktreeAction,
  type WorktreeInfo,
} from "../src/extras/git_worktree/mod.ts";
import { resolveAgentMergeOutcome } from "../src/ui/event_handler.ts";
import type { WtReturn } from "../src/ui/state.ts";

let counter = 0;

function uniqueDir(tag: string): string {
  return path.join(os.tmpdir(), `tc_wt_${tag}_${process.pid}_${counter++}_${tag}`);
}

function uniqueName(tag: string): string {
  return `zs${tag}${process.pid}_${Date.now()}_${counter++}`;
}

function run(dir: string, args: string[]): void {
  try {
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: "pipe" });
  } catch (e) {
    const err = e as { stderr?: string };
    assert.fail(`git ${args.join(" ")} failed in ${dir}: ${err.stderr ?? e}`);
  }
}

class TempRepo {
  root: string;
  orig: string;

  constructor(tag: string, branch: string) {
    this.orig = process.cwd();
    const raw = uniqueDir(tag);
    fs.mkdirSync(raw);
    this.root = fs.realpathSync(raw);
    run(this.root, ["init", "-b", branch]);
    run(this.root, ["config", "user.email", "test@example.com"]);
    run(this.root, ["config", "user.name", "test"]);
    run(this.root, ["config", "commit.gpgsign", "false"]);
    fs.writeFileSync(path.join(this.root, "file.txt"), "base\n");
    run(this.root, ["add", "file.txt"]);
    run(this.root, ["commit", "-m", "init"]);
  }

  cd(): void {
    process.chdir(this.root);
  }

  dispose(): void {
    try {
      const out = execFileSync("git", ["-C", this.root, "worktree", "list", "--porcelain"], { encoding: "utf8", stdio: "pipe" });
      const parent = path.dirname(this.root);
      for (const line of out.split("\n")) {
        if (!line.startsWith("worktree ")) continue;
        const p = line.slice("worktree ".length).trim();
        if (p !== this.root && p.startsWith(parent)) {
          try {
            execFileSync("git", ["-C", this.root, "worktree", "remove", "--force", p], { stdio: "pipe" });
          } catch { }
          try {
            fs.rmSync(p, { recursive: true, force: true });
          } catch { }
        }
      }
      try {
        execFileSync("git", ["-C", this.root, "worktree", "prune"], { stdio: "pipe" });
      } catch { }
    } catch { }
    try {
      process.chdir(this.orig);
    } catch { }
    try {
      fs.rmSync(this.root, { recursive: true, force: true });
    } catch { }
  }
}

function worktreeInfoFor(repo: TempRepo, branch: string): WorktreeInfo {
  const stale = path.join(path.dirname(repo.root), branch);
  if (fs.existsSync(stale) && !isWorktreeRegistered(repo.root, stale)) {
    fs.rmSync(stale, { recursive: true, force: true });
  }
  repo.cd();
  const [wtPath] = create(branch);
  process.chdir(wtPath);
  const detected = detect();
  assert.ok(detected, "should detect worktree");
  return detected;
}

function abortCleanup(root: string): void {
  try {
    execFileSync("git", ["-C", root, "reset", "--merge"], { stdio: "pipe" });
  } catch { }
  try {
    execFileSync("git", ["-C", root, "checkout", "main"], { stdio: "pipe" });
  } catch { }
}

test("worktree_info_clone", () => {
  const info: WorktreeInfo = { branch: "feature-x", worktreePath: "/tmp/wt", mainRepoPath: "/tmp/repo" };
  const cloned = { ...info };
  assert.equal(cloned.branch, "feature-x");
  assert.equal(cloned.worktreePath, "/tmp/wt");
  assert.equal(cloned.mainRepoPath, "/tmp/repo");
});

test("merge_outcome_success_eq", () => {
  assert.deepEqual({ kind: "Success" }, { kind: "Success" });
});

test("merge_outcome_conflicts_eq", () => {
  assert.deepEqual({ kind: "Conflicts", files: ["a", "b"] }, { kind: "Conflicts", files: ["a", "b"] });
});

test("merge_outcome_conflicts_ne", () => {
  assert.notDeepEqual({ kind: "Conflicts", files: ["a"] }, { kind: "Conflicts", files: ["b"] });
});

test("merge_outcome_error_eq", () => {
  assert.deepEqual({ kind: "Error", message: "msg" }, { kind: "Error", message: "msg" });
});

test("merge_outcome_error_ne", () => {
  assert.notDeepEqual({ kind: "Error", message: "a" }, { kind: "Error", message: "b" });
});

test("merge_outcome_cross_variant_ne", () => {
  assert.notDeepEqual({ kind: "Success" }, { kind: "Error", message: "err" });
  assert.notDeepEqual({ kind: "Success" }, { kind: "Conflicts", files: ["f"] });
});

test("merge_state_clone", () => {
  const state = {
    info: { branch: "feat", worktreePath: "/tmp/wt", mainRepoPath: "/tmp/repo" },
    originalBranch: "main",
    origDir: "/tmp/wt",
    stashed: true,
  };
  const cloned = { ...state, info: { ...state.info } };
  assert.equal(cloned.originalBranch, "main");
  assert.ok(cloned.stashed);
  assert.equal(cloned.origDir, "/tmp/wt");
  assert.equal(cloned.info.branch, "feat");
});

test("repo_name_basic", () => {
  assert.equal(repoName("/home/user/my-project"), "my-project");
});

test("repo_name_trailing_slash", () => {
  assert.equal(repoName("/home/user/repo/"), "repo");
});

test("repo_name_empty", () => {
  assert.equal(repoName(""), "unknown");
});

test("repo_name_root", () => {
  assert.equal(repoName("/"), "unknown");
});

test("wt_cli_flags_default", () => {
  const cli = defaultCli();
  assert.equal(cli.worktree, undefined);
  assert.equal(cli.wtAutoMerge, false);
  assert.equal(cli.parallel, false);
  assert.equal(cli.wtBaseDir, undefined);
  assert.equal(cli.wtForce, false);
});

test("wt_cli_flags_enabled", () => {
  const cli = { ...defaultCli(), worktree: "feature-x", wtAutoMerge: true, wtForce: true, wtBaseDir: "/tmp" };
  assert.equal(cli.worktree, "feature-x");
  assert.ok(cli.wtAutoMerge);
  assert.ok(cli.wtForce);
  assert.equal(cli.wtBaseDir, "/tmp");
});

test("resolve_wt_auto_merge_cli", () => {
  assert.ok(resolveWtAutoMerge({ ...defaultCli(), wtAutoMerge: true }, defaultConfig()));
});

test("resolve_wt_auto_merge_parallel", () => {
  assert.ok(resolveWtAutoMerge({ ...defaultCli(), parallel: true }, defaultConfig()));
});

test("resolve_wt_auto_merge_config", () => {
  assert.ok(resolveWtAutoMerge(defaultCli(), { ...defaultConfig(), wtAutoMerge: true }));
});

test("resolve_wt_auto_merge_default_false", () => {
  assert.ok(!resolveWtAutoMerge(defaultCli(), defaultConfig()));
});

test("resolve_wt_force_cli", () => {
  assert.ok(resolveWtForce({ ...defaultCli(), wtForce: true }, defaultConfig()));
});

test("resolve_wt_force_config", () => {
  assert.ok(resolveWtForce(defaultCli(), { ...defaultConfig(), wtForce: true }));
});

test("resolve_wt_force_default_false", () => {
  assert.ok(!resolveWtForce(defaultCli(), defaultConfig()));
});

test("resolve_wt_base_dir_cli", () => {
  assert.equal(resolveWtBaseDir({ ...defaultCli(), wtBaseDir: "/custom/base" }, defaultConfig()), "/custom/base");
});

test("resolve_wt_base_dir_config", () => {
  assert.equal(resolveWtBaseDir(defaultCli(), { ...defaultConfig(), wtBaseDir: "/config/base" }), "/config/base");
});

test("resolve_wt_base_dir_default_none", () => {
  assert.equal(resolveWtBaseDir(defaultCli(), defaultConfig()), undefined);
});

test("resolve_wt_base_dir_cli_overrides_config", () => {
  assert.equal(
    resolveWtBaseDir({ ...defaultCli(), wtBaseDir: "/cli" }, { ...defaultConfig(), wtBaseDir: "/config" }),
    "/cli",
  );
});

test("default_branch_is_refutable", () => {
  assert.equal(defaultBranch("/tmp/nonexistent_repo"), null);
});

test("validate_branch_name_ok", () => {
  validateBranchName("feature-x");
  validateBranchName("wt-123-456");
  validateBranchName("a");
});

test("validate_branch_name_rejects", () => {
  for (const bad of ["", "has space", "has/slash", "-leading-dash", "..", ".", "@{x}", "a..b", "a~b", "a^b", "a:b", "a?b", "a*b", "a[b", "a.lock"]) {
    assert.throws(() => validateBranchName(bad), `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

test("validate_branch_name_whitespace_variants", () => {
  assert.throws(() => validateBranchName("a\tb"));
  assert.throws(() => validateBranchName("a\nb"));
  assert.throws(() => validateBranchName(" a"));
});

test("create_and_detect_round_trip", () => {
  const repo = new TempRepo("roundtrip", "main");
  try {
    repo.cd();
    const name = uniqueName("feat");
    const [wtPath, info] = create(name);
    assert.equal(info.branch, name);
    assert.ok(fs.existsSync(wtPath));
    assert.equal(path.dirname(wtPath), path.dirname(repo.root));
    process.chdir(wtPath);
    const detected = detect();
    assert.ok(detected, "should detect linked worktree");
    assert.equal(detected.branch, name);
    assert.equal(detected.mainRepoPath, repo.root);
  } finally {
    repo.dispose();
  }
});

test("detect_returns_none_in_main_repo", () => {
  const repo = new TempRepo("nondetect", "main");
  try {
    repo.cd();
    assert.equal(detect(), null);
  } finally {
    repo.dispose();
  }
});

test("detect_returns_none_outside_repo", () => {
  const dir = uniqueDir("outside");
  fs.mkdirSync(dir, { recursive: true });
  const orig = process.cwd();
  try {
    process.chdir(dir);
    assert.equal(detect(), null);
  } finally {
    process.chdir(orig);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("create_rejects_existing_branch", () => {
  const repo = new TempRepo("dupbranch", "main");
  try {
    repo.cd();
    const name = uniqueName("feat");
    create(name);
    assert.throws(() => create(name), /already exists/);
  } finally {
    repo.dispose();
  }
});

test("create_rejects_occupied_target", () => {
  const repo = new TempRepo("occupied", "main");
  try {
    repo.cd();
    fs.mkdirSync(path.join(path.dirname(repo.root), "taken"), { recursive: true });
    assert.throws(() => create("taken"), /already exists/);
  } finally {
    try {
      fs.rmSync(path.join(path.dirname(repo.root), "taken"), { recursive: true, force: true });
    } catch { }
    repo.dispose();
  }
});

test("create_uses_base_dir_and_makedirs", () => {
  const repo = new TempRepo("basedir", "main");
  try {
    repo.cd();
    const base = path.join(repo.root, "nested", "bases");
    const name = uniqueName("feat");
    const [wtPath, info] = create(name, base);
    assert.equal(wtPath, path.join(base, name));
    assert.ok(fs.existsSync(wtPath));
    assert.equal(info.mainRepoPath, repo.root);
    process.chdir(wtPath);
    assert.ok(detect() !== null);
  } finally {
    repo.dispose();
  }
});

test("create_validates_name", () => {
  const repo = new TempRepo("badname", "main");
  try {
    repo.cd();
    assert.throws(() => create("../escape"));
    assert.throws(() => create("-dash"));
    assert.throws(() => create(""));
  } finally {
    repo.dispose();
  }
});

test("branch_exists_and_registration", () => {
  const repo = new TempRepo("exists", "main");
  try {
    repo.cd();
    assert.ok(branchExists(repo.root, "main"));
    assert.ok(!branchExists(repo.root, "nope"));
    const [wtPath] = create(uniqueName("feat"));
    assert.ok(isWorktreeRegistered(repo.root, wtPath));
    assert.ok(!isWorktreeRegistered(repo.root, path.join(repo.root, "not-a-worktree")));
  } finally {
    repo.dispose();
  }
});

test("clean_merge_then_complete", () => {
  const repo = new TempRepo("cleanmerge", "main");
  try {
    const info = worktreeInfoFor(repo, uniqueName("feat"));
    fs.writeFileSync(path.join(info.worktreePath, "new.txt"), "hello\n");
    run(info.worktreePath, ["add", "new.txt"]);
    run(info.worktreePath, ["commit", "-m", "add new"]);
    repo.cd();
    const [state, outcome] = tryMerge(info, "main");
    assert.deepEqual(outcome, { kind: "Success" });
    completeMerge(state);
    assert.ok(fs.existsSync(path.join(repo.root, "new.txt")));
    assert.ok(!fs.existsSync(info.worktreePath));
    assert.ok(!branchExists(repo.root, info.branch));
    assert.equal(process.cwd(), repo.root);
  } finally {
    repo.dispose();
  }
});

test("already_merged_branch_is_success", () => {
  const repo = new TempRepo("nomerge", "main");
  try {
    const info = worktreeInfoFor(repo, uniqueName("feat"));
    repo.cd();
    const [state, outcome] = tryMerge(info, "main");
    assert.deepEqual(outcome, { kind: "Success" });
    completeMerge(state);
    assert.ok(!branchExists(repo.root, info.branch));
  } finally {
    repo.dispose();
  }
});

test("merge_without_upstream_succeeds", () => {
  const repo = new TempRepo("noupstream", "main");
  try {
    const info = worktreeInfoFor(repo, uniqueName("feat"));
    fs.writeFileSync(path.join(info.worktreePath, "u.txt"), "x\n");
    run(info.worktreePath, ["add", "u.txt"]);
    run(info.worktreePath, ["commit", "-m", "u"]);
    repo.cd();
    const [, outcome] = tryMerge(info, "main");
    assert.deepEqual(outcome, { kind: "Success" });
  } finally {
    repo.dispose();
  }
});

test("conflict_then_cancel_restores_state", () => {
  const repo = new TempRepo("conflict", "main");
  try {
    const info = worktreeInfoFor(repo, uniqueName("feat"));
    fs.writeFileSync(path.join(info.worktreePath, "file.txt"), "worktree side\n");
    run(info.worktreePath, ["commit", "-am", "worktree change"]);
    repo.cd();
    fs.writeFileSync(path.join(repo.root, "file.txt"), "main side\n");
    run(repo.root, ["commit", "-am", "main change"]);
    fs.writeFileSync(path.join(repo.root, "dirty.txt"), "uncommitted\n");
    const [state, outcome] = tryMerge(info, "main");
    assert.ok(state.stashed, "dirty main-repo file should be stashed");
    assert.equal(outcome.kind, "Conflicts");
    if (outcome.kind === "Conflicts") {
      assert.ok(outcome.files.length > 0);
      assert.ok(outcome.files.some((f) => f.includes("file.txt")));
    }
    cancelMerge(state);
    assert.equal(currentBranch(), "main");
    assert.ok(!repoHasMergeConflict(repo.root));
    assert.ok(fs.existsSync(path.join(repo.root, "dirty.txt")));
    assert.ok(fs.existsSync(info.worktreePath));
    assert.ok(branchExists(repo.root, info.branch));
  } finally {
    repo.dispose();
  }
});

test("conflict_cancel_with_untracked_stash", () => {
  const repo = new TempRepo("untracked", "main");
  try {
    const info = worktreeInfoFor(repo, uniqueName("feat"));
    fs.writeFileSync(path.join(info.worktreePath, "file.txt"), "worktree side\n");
    run(info.worktreePath, ["commit", "-am", "worktree change"]);
    repo.cd();
    fs.writeFileSync(path.join(repo.root, "file.txt"), "main side\n");
    run(repo.root, ["commit", "-am", "main change"]);
    fs.writeFileSync(path.join(repo.root, "scratch.txt"), "temp\n");
    const [state, outcome] = tryMerge(info, "main");
    assert.equal(outcome.kind, "Conflicts");
    cancelMerge(state);
    assert.ok(fs.existsSync(path.join(repo.root, "scratch.txt")));
    assert.ok(!repoHasMergeConflict(repo.root));
  } finally {
    repo.dispose();
  }
});

test("cleanup_is_idempotent", () => {
  const repo = new TempRepo("idempotent", "main");
  try {
    const info = worktreeInfoFor(repo, uniqueName("feat"));
    cleanupWorktree(info.worktreePath, info.branch, info.mainRepoPath, false);
    assert.ok(!fs.existsSync(info.worktreePath));
    cleanupWorktree(info.worktreePath, info.branch, info.mainRepoPath, false);
    cleanupWorktree(info.worktreePath, "no-such-branch", info.mainRepoPath, true);
  } finally {
    repo.dispose();
  }
});

test("verify_merged_after_squash", () => {
  const repo = new TempRepo("verify", "main");
  try {
    const info = worktreeInfoFor(repo, uniqueName("feat"));
    fs.writeFileSync(path.join(info.worktreePath, "v.txt"), "v\n");
    run(info.worktreePath, ["add", "v.txt"]);
    run(info.worktreePath, ["commit", "-m", "v"]);
    repo.cd();
    const [state, outcome] = tryMerge(info, "main");
    assert.deepEqual(outcome, { kind: "Success" });
    assert.deepEqual(verifyBranchMerged(repo.root, "main", info.branch), { kind: "Merged" });
    completeMerge(state);
    assert.deepEqual(verifyBranchMerged(repo.root, "main", info.branch), { kind: "Merged" });
  } finally {
    repo.dispose();
  }
});

test("verify_not_merged_and_conflicts", () => {
  const repo = new TempRepo("verifyn", "main");
  try {
    const info = worktreeInfoFor(repo, uniqueName("feat"));
    fs.writeFileSync(path.join(info.worktreePath, "extra.txt"), "x\n");
    run(info.worktreePath, ["add", "extra.txt"]);
    run(info.worktreePath, ["commit", "-m", "extra"]);
    assert.equal(verifyBranchMerged(repo.root, "main", info.branch).kind, "NotMerged");
    assert.equal(verifyBranchMerged(repo.root, "no-such-target-xyz", info.branch).kind, "NotMerged");
    assert.deepEqual(verifyBranchMerged(repo.root, "main", "nope"), { kind: "Merged" });
    repo.cd();
    fs.writeFileSync(path.join(info.worktreePath, "file.txt"), "wt\n");
    run(info.worktreePath, ["commit", "-am", "wt change"]);
    fs.writeFileSync(path.join(repo.root, "file.txt"), "mn\n");
    run(repo.root, ["commit", "-am", "main change"]);
    try {
      execFileSync("git", ["-C", repo.root, "merge", "--squash", info.branch], { stdio: "pipe" });
    } catch { }
    assert.ok(repoHasMergeConflict(repo.root));
    assert.ok(repoConflictedFiles(repo.root).length > 0);
    assert.equal(verifyBranchMerged(repo.root, "main", info.branch).kind, "Conflicts");
    assert.ok(fs.existsSync(info.worktreePath));
    assert.ok(branchExists(repo.root, info.branch));
    abortCleanup(repo.root);
  } finally {
    repo.dispose();
  }
});

test("auto_commit_round_trip", () => {
  const repo = new TempRepo("autocommit", "main");
  try {
    const info = worktreeInfoFor(repo, uniqueName("feat"));
    fs.writeFileSync(path.join(info.worktreePath, "file.txt"), "edited\n");
    assert.ok(worktreeHasUncommitted(info.worktreePath));
    worktreeAutoCommitAll(info.worktreePath);
    assert.ok(!worktreeHasUncommitted(info.worktreePath));
    worktreeAutoCommitAll(info.worktreePath);
    fs.writeFileSync(path.join(info.worktreePath, "new-untracked.txt"), "u\n");
    assert.throws(() => worktreeAutoCommitAll(info.worktreePath));
  } finally {
    repo.dispose();
  }
});

test("resolve_agent_merge_outcome_messages", () => {
  const ret: WtReturn = { mainPath: "/m", wtPath: "/w", branch: "b", target: "main", force: false };
  const msg = resolveAgentMergeOutcome(ret);
  assert.ok(msg.includes("b"));
});

test("deferred_action_display", () => {
  const a: DeferredWorktreeAction = { kind: "Merge", branch: "b", target: "main", mainPath: "/m", wtPath: "/w" };
  assert.ok(formatDeferredWorktreeAction(a).includes("b"));
  const e: DeferredWorktreeAction = { kind: "Exit", mainPath: "/m" };
  assert.ok(formatDeferredWorktreeAction(e).includes("/m"));
});

test("cherry_and_ancestor_helpers", () => {
  const repo = new TempRepo("helpers", "main");
  try {
    const info = worktreeInfoFor(repo, uniqueName("feat"));
    assert.deepEqual(verifyBranchMerged(repo.root, "main", info.branch), { kind: "Merged" });
    repo.cd();
    const [state, outcome] = tryMerge(info, "main");
    assert.deepEqual(outcome, { kind: "Success" });
    assert.deepEqual(verifyBranchMerged(repo.root, "main", info.branch), { kind: "Merged" });
    completeMerge(state);
  } finally {
    repo.dispose();
  }
});
