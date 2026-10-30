import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export function toolErrorFromUnknown(e: unknown): ToolError {
  if (e instanceof ToolError) return e;
  return new ToolError(e instanceof Error ? e.message : String(e));
}

export type EditSystem = "similarity" | "hashedit";

export function parseEditSystem(s: string): EditSystem | undefined {
  if (s === "similarity") return "similarity";
  if (s === "hashedit") return "hashedit";
  return undefined;
}

let editSystemValue: EditSystem = "similarity";

export function setEditSystem(es: EditSystem): void {
  editSystemValue = es;
}

export function editSystem(): EditSystem {
  return editSystemValue;
}

let denyRepeatedReadsValue = true;

export function setDenyRepeatedReads(v: boolean): void {
  denyRepeatedReadsValue = v;
}

export function denyRepeatedReads(): boolean {
  return denyRepeatedReadsValue;
}

interface ReadKey {
  path: string;
  offset: number;
  limit: number;
}

const readTracker: ReadKey[] = [];

export function trackRead(path: string, offset: number, limit: number): string | undefined {
  if (!denyRepeatedReads()) return undefined;
  const key = { path, offset, limit };
  if (readTracker.some((k) => k.path === key.path && k.offset === key.offset && k.limit === key.limit)) {
    const end = offset + limit - 1;
    return (
      `read blocked: ${path} (lines ${offset + 1}-${end > 0 ? end : offset + 1}) ` +
      `was already read and has not been modified since. Use the previous result or read a different section.`
    );
  }
  readTracker.push(key);
  return undefined;
}

export function untrackReadPath(path: string): void {
  for (let i = readTracker.length - 1; i >= 0; i--) {
    if (readTracker[i].path === path) readTracker.splice(i, 1);
  }
}

export function isSkipDir(name: string): boolean {
  return name === "node_modules" || name === "target";
}

export interface ReadArgs {
  path: string;
  offset?: number;
  limit?: number;
}

export interface WriteArgs {
  path: string;
  content: string;
}

export interface EditOp {
  line?: string;
  lines?: string;
  text: string;
}

export interface EditArgs {
  path: string;
  block?: string;
  file_crc?: string;
  edits?: EditOp[];
}

export interface BashArgs {
  command: string;
  timeout?: number;
}

export interface GrepArgs {
  pattern: string;
  path?: string;
  include?: string;
  context_lines?: number;
}

export interface FindFilesArgs {
  pattern: string;
  path?: string;
}

export interface ListDirArgs {
  path?: string;
}

export type CheckResult =
  | { kind: "allowed" }
  | { kind: "allowedWithCoaching"; message: string }
  | { kind: "ask" }
  | { kind: "denied"; reason: string };

export type UserDecision =
  | { kind: "allowOnce" }
  | { kind: "allowAlways"; pattern: string }
  | { kind: "deny" };

export interface AskRequest {
  tool: string;
  input: string;
}

export interface PermCheckLike {
  check(tool: string, input: string): CheckResult;
  checkPath(tool: string, path: string): CheckResult;
  addSessionAllowlist(tool: string, pattern: string): void;
}

export type AskSenderLike =
  | ((request: AskRequest) => Promise<UserDecision>)
  | { sendAsk(request: AskRequest): Promise<UserDecision> };

async function resolveAsk(
  askTx: AskSenderLike,
  tool: string,
  input: string,
): Promise<UserDecision> {
  if (typeof askTx === "function") return askTx({ tool, input });
  return askTx.sendAsk({ tool, input });
}

async function handleAskInner(
  askTx: AskSenderLike,
  permission: PermCheckLike,
  tool: string,
  input: string,
): Promise<void> {
  let decision: UserDecision;
  try {
    decision = await resolveAsk(askTx, tool, input);
  } catch {
    throw new ToolError("Permission system unavailable");
  }
  if (decision.kind === "allowOnce") return;
  if (decision.kind === "allowAlways") {
    permission.addSessionAllowlist(tool, decision.pattern);
    return;
  }
  throw new ToolError("Permission denied by user");
}

export async function checkPerm(
  permission: PermCheckLike | undefined | null,
  askTx: AskSenderLike | undefined | null,
  tool: string,
  inputKey: string,
): Promise<string | undefined> {
  if (!permission) return undefined;
  const result = permission.check(tool, inputKey);
  if (result.kind === "allowed") return undefined;
  if (result.kind === "allowedWithCoaching") return result.message;
  if (result.kind === "denied") throw new ToolError(`Permission denied: ${result.reason}`);
  if (!askTx) throw new ToolError("Permission denied (non-interactive mode)");
  await handleAskInner(askTx, permission, tool, inputKey);
  return undefined;
}

export async function checkPermPath(
  permission: PermCheckLike | undefined | null,
  askTx: AskSenderLike | undefined | null,
  tool: string,
  path: string,
): Promise<string | undefined> {
  if (!permission) return undefined;
  const result = permission.checkPath(tool, path);
  if (result.kind === "allowed") return undefined;
  if (result.kind === "allowedWithCoaching") return result.message;
  if (result.kind === "denied") throw new ToolError(`Permission denied: ${result.reason}`);
  if (!askTx) throw new ToolError("Permission denied (non-interactive mode)");
  await handleAskInner(askTx, permission, tool, path);
  return undefined;
}

export interface Tool<Args = unknown, Output = string> {
  readonly name: string;
  description(): string;
  parameters(): Record<string, unknown>;
  call(args: Args): Promise<Output>;
}

export interface EditBlock {
  search: string;
  replace: string;
}

export function expandTilde(s: string): string {
  if (s === "~") return homedir();
  if (s.startsWith("~/")) return join(homedir(), s.slice(2));
  return s;
}

export async function atomicWrite(path: string, contents: string): Promise<void> {
  let target = path;
  try {
    const { realpath } = await import("node:fs/promises");
    target = await realpath(path);
  } catch {
    target = path;
  }
  const dir = dirname(target) === "" ? "." : dirname(target);
  const tmpPath = join(dir, `.${basename(target)}.zswrite.${randomUUID()}.tmp`);
  try {
    await writeFile(tmpPath, contents, "utf8");
    await rename(tmpPath, target);
  } catch (e) {
    await rm(tmpPath, { force: true }).catch(() => undefined);
    throw e;
  }
}

export async function ensureParentDir(path: string): Promise<void> {
  const dir = dirname(path);
  if (dir && dir !== "" && dir !== ".") await mkdir(dir, { recursive: true });
}

export function tmpPathFor(prefix: string): string {
  return join(tmpdir(), `${prefix}.${randomUUID()}.tmp`);
}

export interface GitignoreRule {
  negated: boolean;
  dirOnly: boolean;
  anchored: boolean;
  regex: RegExp;
  hasSlash: boolean;
}

function globToRegexBody(glob: string): string {
  let out = "";
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 3;
        } else {
          out += ".*";
          i += 2;
        }
      } else {
        out += "[^/]*";
        i += 1;
      }
    } else if (ch === "?") {
      out += "[^/]";
      i += 1;
    } else if (ch === "[") {
      const close = glob.indexOf("]", i + 1);
      if (close === -1) {
        out += "\\[";
        i += 1;
      } else {
        let cls = glob.slice(i + 1, close);
        if (cls.startsWith("!")) cls = "^" + cls.slice(1);
        out += `[${cls.replace(/\\/g, "\\\\")}]`;
        i = close + 1;
      }
    } else if ("\\.+()|^$".includes(ch)) {
      out += `\\${ch}`;
      i += 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

export function parseGitignore(text: string): GitignoreRule[] {
  const rules: GitignoreRule[] = [];
  for (const rawLine of text.split("\n")) {
    let line = rawLine;
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line === "" || line.startsWith("#")) continue;
    let negated = false;
    if (line.startsWith("!")) {
      negated = true;
      line = line.slice(1);
    } else if (line.startsWith("\\!") || line.startsWith("\\#")) {
      line = line.slice(1);
    }
    let dirOnly = false;
    if (line.endsWith("/")) {
      dirOnly = true;
      line = line.slice(0, -1);
    }
    let anchored = false;
    if (line.startsWith("/")) {
      anchored = true;
      line = line.slice(1);
    }
    const hasSlash = line.includes("/");
    if (line === "") continue;
    const body = globToRegexBody(line);
    const regex = hasSlash || anchored ? new RegExp(`^${body}$`) : new RegExp(`^${body}$`);
    rules.push({ negated, dirOnly, anchored, regex, hasSlash });
  }
  return rules;
}

function ruleMatches(rule: GitignoreRule, relPath: string, name: string, isDir: boolean): boolean {
  if (rule.dirOnly && !isDir) return false;
  if (rule.hasSlash || rule.anchored) {
    return rule.regex.test(relPath);
  }
  if (rule.regex.test(name)) return true;
  const parts = relPath.split("/");
  return parts.some((p) => rule.regex.test(p));
}

export interface WalkEntry {
  path: string;
  name: string;
  isDir: boolean;
  isFile: boolean;
  isSymlink: boolean;
  size: number;
  depth: number;
}

interface RuleSet {
  base: string;
  rules: GitignoreRule[];
}

function loadIgnoreFile(dir: string): GitignoreRule[] {
  try {
    return parseGitignore(readFileSync(join(dir, ".gitignore"), "utf8"));
  } catch {
    return [];
  }
}

function ignoredBy(
  ruleSets: RuleSet[],
  root: string,
  fullPath: string,
  name: string,
  isDir: boolean,
): boolean {
  const rel = relative(root, fullPath).split(sep).join("/");
  let ignored = false;
  for (const set of ruleSets) {
    const setRel = relative(set.base, fullPath).split(sep).join("/");
    if (setRel.startsWith("..")) continue;
    for (const rule of set.rules) {
      if (ruleMatches(rule, setRel, name, isDir)) ignored = !rule.negated;
    }
  }
  void rel;
  return ignored;
}

export function walkDirectory(root: string, maxDepth?: number): WalkEntry[] {
  const out: WalkEntry[] = [];
  const start = resolve(root);
  const visit = (dir: string, depth: number, ruleSets: RuleSet[]): void => {
    if (maxDepth !== undefined && depth > maxDepth) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const childRules: RuleSet[] = [...ruleSets, { base: dir, rules: loadIgnoreFile(dir) }];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      let isDir = entry.isDirectory();
      let isSymlink = entry.isSymbolicLink();
      let isFile = entry.isFile();
      let size = 0;
      if (isSymlink) {
        try {
          const st = lstatSync(full);
          size = st.size;
        } catch {

        }
      } else if (isFile) {
        try {
          size = lstatSync(full).size;
        } catch {

        }
      }
      if (entry.name === ".git") continue;
      if (isDir && isSkipDir(entry.name)) continue;
      if (ignoredBy(childRules, start, full, entry.name, isDir)) continue;
      const entryDepth = depth + 1;
      out.push({ path: full, name: entry.name, isDir, isFile, isSymlink, size, depth: entryDepth });
      if (isDir && (maxDepth === undefined || entryDepth < maxDepth)) {
        visit(full, entryDepth, childRules);
      }
    }
  };
  const rootRules: RuleSet[] = [{ base: start, rules: loadIgnoreFile(start) }];
  visit(start, 0, rootRules);
  return out;
}

export function globPatternToRegex(glob: string): RegExp {
  return new RegExp(`^(?:${globToRegexBody(glob)})$`);
}
