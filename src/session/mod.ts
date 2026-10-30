import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { saveToolOutput } from "./storage.ts";

export const TOOL_RESULT_HEAD_CHARS = 4000;
export const TOOL_RESULT_TAIL_CHARS = 8000;
export const TOOL_RESULT_SAVE_THRESHOLD = TOOL_RESULT_HEAD_CHARS + TOOL_RESULT_TAIL_CHARS;

export const MessageRole = {
  User: "user",
  Assistant: "assistant",
  System: "system",
  ToolCall: "tool_call",
  ToolResult: "tool_result",
  SubagentToolCall: "subagent_tool_call",
} as const;
export type MessageRole = (typeof MessageRole)[keyof typeof MessageRole];

export interface SessionMessage {
  role: MessageRole;
  content: string;
  estimatedTokens: number;
  tool?: ToolRecord;
}

/**
 * Structured counterpart to a ToolCall/ToolResult message's display summary.
 * The JSON shape is flat with no discriminant, matching the Rust untagged
 * serde form: Call has `id`/`args`, Result has `call_id`/`truncated`,
 * SubagentCall has `parent_call_id`/`args`.
 */
export type ToolRecord =
  | { kind: "call"; id: number; name: string; args: unknown }
  | {
      kind: "result";
      callId: number;
      name: string;
      truncated: boolean;
      fullOutputPath?: string;
    }
  | { kind: "subagentCall"; parentCallId: number; name: string; args: unknown };

export interface Compaction {
  summary: string;
  firstKeptIndex: number;
  summarizedCount: number;
  tokenSavings: number;
  createdAt: string;
}

export interface PermissionAllowEntry {
  tool: string;
  pattern: string;
}

export const PromptSource = {
  BuiltIn: "built_in",
  UserFile: "user_file",
} as const;
export type PromptSource = (typeof PromptSource)[keyof typeof PromptSource];

export interface PromptRef {
  name: string;
  source: PromptSource;
}

export interface GitStatus {
  staged: number;
  modified: number;
  deleted: number;
  untracked: number;
  ahead: number;
  behind: number;
}

export function emptyGitStatus(): GitStatus {
  return { staged: 0, modified: 0, deleted: 0, untracked: 0, ahead: 0, behind: 0 };
}

export function gitStatusIsDirty(status: GitStatus): boolean {
  return status.staged + status.modified + status.deleted + status.untracked > 0;
}

interface RewindUndo {
  messages: SessionMessage[];
  totalEstimatedTokens: number;
  calibratedTokens: number;
  calibratedMsgCount: number;
}

const TOOL_SUMMARY_MAX = 200;

function displayValue(val: string): string {
  if (new TextEncoder().encode(val).length <= TOOL_SUMMARY_MAX) return `"${val}"`;
  return `"${[...val].slice(0, TOOL_SUMMARY_MAX).join("")}..."`;
}

function formatTaskSummary(obj: Record<string, unknown>): string {
  const prompts = obj["prompts"];
  if (!Array.isArray(prompts)) return "task";
  const parts = prompts.filter((v): v is string => typeof v === "string").map(displayValue);
  return parts.length === 0 ? "task" : `task ${parts.join(" ")}`;
}

/** Formats a tool call showing only the primary file/command parameter. */
export function formatToolCallSummary(name: string, args: unknown): string {
  if (args === null || typeof args !== "object" || Array.isArray(args)) return name;
  const obj = args as Record<string, unknown>;
  if (name === "task") return formatTaskSummary(obj);
  const primaryKeys: string[] = (() => {
    switch (name) {
      case "read":
      case "write":
      case "edit":
      case "list_dir":
        return ["path"];
      case "grep":
        return ["pattern", "path"];
      case "find_files":
        return ["pattern"];
      case "bash":
        return ["command"];
      default:
        return [];
    }
  })();
  const shown: string[] = [];
  for (const key of primaryKeys) {
    const val = obj[key];
    if (typeof val === "string") shown.push(name === "bash" ? val : displayValue(val));
  }
  if (shown.length === 0) {
    const first = Object.values(obj)[0];
    return typeof first === "string" ? `${name} ${displayValue(first)}` : name;
  }
  return `${name} ${shown.join(" ")}`;
}

function toolRecordToJson(tool: ToolRecord): Record<string, unknown> {
  switch (tool.kind) {
    case "call":
      return { id: tool.id, name: tool.name, args: tool.args };
    case "result":
      return {
        call_id: tool.callId,
        name: tool.name,
        truncated: tool.truncated,
        full_output_path: tool.fullOutputPath ?? null,
      };
    case "subagentCall":
      return { parent_call_id: tool.parentCallId, name: tool.name, args: tool.args };
  }
}

function toolRecordFromJson(raw: unknown): ToolRecord | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const name = typeof obj["name"] === "string" ? obj["name"] : "";
  if (typeof obj["call_id"] === "number") {
    return {
      kind: "result",
      callId: obj["call_id"],
      name,
      truncated: obj["truncated"] === true,
      fullOutputPath:
        typeof obj["full_output_path"] === "string" ? obj["full_output_path"] : undefined,
    };
  }
  if (typeof obj["parent_call_id"] === "number") {
    return { kind: "subagentCall", parentCallId: obj["parent_call_id"], name, args: obj["args"] };
  }
  if (typeof obj["id"] === "number") {
    return { kind: "call", id: obj["id"], name, args: obj["args"] };
  }
  return undefined;
}

function messageFromJson(raw: unknown): SessionMessage | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const role = Object.values(MessageRole).find((r) => r === obj["role"]);
  if (role === undefined || typeof obj["content"] !== "string") return null;
  const msg: SessionMessage = {
    role,
    content: obj["content"],
    estimatedTokens:
      typeof obj["estimated_tokens"] === "number" ? obj["estimated_tokens"] : 0,
  };
  if (obj["tool"] !== undefined && obj["tool"] !== null) {
    const tool = toolRecordFromJson(obj["tool"]);
    if (tool !== undefined) msg.tool = tool;
  }
  return msg;
}

export interface SessionInit {
  id: string;
  name: string;
  messages: SessionMessage[];
  compactions: Compaction[];
  createdAt: string;
  updatedAt: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedInputTokens: number;
  totalCacheCreationInputTokens: number;
  totalCost: number;
  totalEstimatedTokens: number;
  calibratedTokens: number;
  calibratedMsgCount: number;
  inputTokenCost: number;
  outputTokenCost: number;
  contextWindow: number;
  model: string;
  provider: string;
  workingDir: string;
  permissionAllowlist: PermissionAllowEntry[];
  nextToolCallId: number;
  prompt?: PromptRef;
}

export class Session {
  id: string;
  name: string;
  messages: SessionMessage[];
  compactions: Compaction[];
  createdAt: string;
  updatedAt: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedInputTokens: number;
  totalCacheCreationInputTokens: number;
  totalCost: number;
  totalEstimatedTokens: number;
  calibratedTokens: number;
  calibratedMsgCount: number;
  inputTokenCost: number;
  outputTokenCost: number;
  contextWindow: number;
  model: string;
  provider: string;
  workingDir: string;
  permissionAllowlist: PermissionAllowEntry[];
  nextToolCallId: number;
  prompt?: PromptRef;
  // Runtime only, never persisted.
  showCostAlways = false;
  gitBranch: string | null = null;
  gitStatus: GitStatus | null = null;
  reasoningEnabled = false;
  overheadTokens = 0;
  rewindUndo: RewindUndo | null = null;

  constructor(init: SessionInit) {
    this.id = init.id;
    this.name = init.name;
    this.messages = init.messages;
    this.compactions = init.compactions;
    this.createdAt = init.createdAt;
    this.updatedAt = init.updatedAt;
    this.totalInputTokens = init.totalInputTokens;
    this.totalOutputTokens = init.totalOutputTokens;
    this.totalCachedInputTokens = init.totalCachedInputTokens;
    this.totalCacheCreationInputTokens = init.totalCacheCreationInputTokens;
    this.totalCost = init.totalCost;
    this.totalEstimatedTokens = init.totalEstimatedTokens;
    this.calibratedTokens = init.calibratedTokens;
    this.calibratedMsgCount = init.calibratedMsgCount;
    this.inputTokenCost = init.inputTokenCost;
    this.outputTokenCost = init.outputTokenCost;
    this.contextWindow = init.contextWindow;
    this.model = init.model;
    this.provider = init.provider;
    this.workingDir = init.workingDir;
    this.permissionAllowlist = init.permissionAllowlist;
    this.nextToolCallId = init.nextToolCallId;
    this.prompt = init.prompt;
  }

  static create(provider: string, model: string, contextWindow: number, name: string): Session {
    const now = new Date().toISOString();
    return new Session({
      id: crypto.randomUUID(),
      name,
      messages: [],
      compactions: [],
      createdAt: now,
      updatedAt: now,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedInputTokens: 0,
      totalCacheCreationInputTokens: 0,
      totalCost: 0,
      totalEstimatedTokens: 0,
      calibratedTokens: 0,
      calibratedMsgCount: 0,
      inputTokenCost: 0,
      outputTokenCost: 0,
      contextWindow,
      model,
      provider,
      workingDir: process.cwd(),
      permissionAllowlist: [],
      nextToolCallId: 0,
    });
  }

  static estimateTokens(text: string): number {
    let wide = 0;
    let narrow = 0;
    for (const ch of text) {
      if (Session.isWideChar(ch)) wide += 1;
      else narrow += 1;
    }
    return Math.max(Math.floor((wide * 9) / 10) + Math.floor(narrow / 4), 1);
  }

  static isWideChar(ch: string): boolean {
    const cp = ch.codePointAt(0) ?? 0;
    return (
      (cp >= 0x1100 && cp <= 0x11ff) ||
      (cp >= 0x2e80 && cp <= 0x9fff) ||
      (cp >= 0xa000 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xff00 && cp <= 0xffef) ||
      (cp >= 0x20000 && cp <= 0x3ffff)
    );
  }

  /** Reads the current git branch for `dir`, or a short hash on detached HEAD; null outside a repo. Reads `.git/HEAD` directly and follows worktree/submodule `.git` file pointers. */
  static detectGitBranch(dir: string): string | null {
    const dotGit = path.join(dir, ".git");
    let gitDir: string;
    try {
      if (existsSync(dotGit) && !readIsFile(dotGit)) {
        gitDir = dotGit;
      } else if (existsSync(dotGit)) {
        const content = readFileSync(dotGit, "utf8");
        const rel = content.startsWith("gitdir:") ? content.slice("gitdir:".length).trim() : null;
        if (rel === null) return null;
        gitDir = path.isAbsolute(rel) ? rel : path.join(dir, rel);
      } else {
        return null;
      }
      const head = readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
      if (head.startsWith("ref:")) {
        const ref = head.slice("ref:".length).trim();
        return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
      }
      return head === "" ? null : head.slice(0, 8);
    } catch {
      return null;
    }
  }

  refreshGitBranch(): void {
    this.gitBranch = Session.detectGitBranch(this.workingDir);
  }

  refreshGitStatus(): void {
    this.gitStatus = Session.detectGitStatus(this.workingDir);
  }

  static detectGitStatus(dir: string): GitStatus | null {
    try {
      const out = spawnSync("git", ["status", "--porcelain=v2", "--branch"], {
        cwd: dir,
        encoding: "utf8",
      });
      if (out.status !== 0) return null;
      return Session.parsePorcelain(out.stdout ?? "");
    } catch {
      return null;
    }
  }

  /** Parses `git status --porcelain=v2 --branch` output. */
  static parsePorcelain(text: string): GitStatus {
    const s = emptyGitStatus();
    for (const line of text.split("\n")) {
      if (line.startsWith("# branch.ab ")) {
        for (const tok of line.slice("# branch.ab ".length).split(/\s+/)) {
          if (tok.startsWith("+")) s.ahead = Number.parseInt(tok.slice(1), 10) || 0;
          else if (tok.startsWith("-")) s.behind = Number.parseInt(tok.slice(1), 10) || 0;
        }
      } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
        const xy = line.slice(2).split(/\s+/)[0] ?? "";
        const x = xy[0] ?? ".";
        const y = xy[1] ?? ".";
        if (x !== ".") s.staged += 1;
        if (y === "M") s.modified += 1;
        else if (y === "D") s.deleted += 1;
      } else if (line.startsWith("u ")) {
        s.modified += 1;
      } else if (line.startsWith("? ")) {
        s.untracked += 1;
      }
    }
    return s;
  }

  addMessage(role: MessageRole, content: string): void {
    this.addMessageWithTool(role, content, undefined);
  }

  addMessageWithTool(role: MessageRole, content: string, tool: ToolRecord | undefined): void {
    const tokens = Session.estimateTokens(content);
    const msg: SessionMessage = { role, content, estimatedTokens: tokens };
    if (tool !== undefined) msg.tool = tool;
    this.messages.push(msg);
    this.totalEstimatedTokens += tokens;
    this.updatedAt = new Date().toISOString();
    // The conversation moved forward, so the last rewind's restore point no
    // longer lines up — drop it so redo can't splice in a stale tail.
    this.rewindUndo = null;
  }

  /** Records the tool call with its complete args and returns the stamped id for linking the result. */
  addToolCall(name: string, args: unknown): number {
    const id = this.nextToolCallId;
    this.nextToolCallId += 1;
    const content = formatToolCallSummary(name, args);
    this.addMessageWithTool(MessageRole.ToolCall, content, { kind: "call", id, name, args });
    return id;
  }

  /** Records the tool result; returns the message content actually stored (possibly truncated with an overflow-file pointer). */
  addToolResult(callId: number, name: string, output: string): string {
    const [content, truncated, fullOutputPath] = this.toolResultContent(name, output);
    const tool: ToolRecord = { kind: "result", callId, name, truncated };
    if (fullOutputPath !== undefined) tool.fullOutputPath = fullOutputPath;
    this.addMessageWithTool(MessageRole.ToolResult, content, tool);
    return content;
  }

  toolResultContent(name: string, output: string): [string, boolean, string | undefined] {
    const outputChars = [...output].length;
    if (outputChars <= TOOL_RESULT_SAVE_THRESHOLD) {
      return [`${name}:\n${output}`, false, undefined];
    }
    try {
      const filePath = saveToolOutput(this.id, name, output);
      return [formatTruncatedToolResult(name, output, outputChars, filePath), true, filePath];
    } catch (err) {
      return [
        `${name}:\n${output}\n\n[failed to save long tool output separately; kept full output in session to avoid data loss: ${err}]`,
        false,
        undefined,
      ];
    }
  }

  /** Records a subagent's tool call attributed to the enclosing `task` call. `parentCallId` null degrades to a display summary with no structured record. */
  addSubagentToolCall(parentCallId: number | null, name: string, args: unknown): void {
    const content = formatToolCallSummary(name, args);
    const tool =
      parentCallId === null
        ? undefined
        : ({ kind: "subagentCall", parentCallId, name, args } as ToolRecord);
    this.addMessageWithTool(MessageRole.SubagentToolCall, content, tool);
  }

  /** True prompt size in the context window, normalizing across providers' differing cache-usage reporting. */
  static realInputTokens(
    anthropicNative: boolean,
    inputTokens: number,
    cachedInputTokens: number,
    cacheCreationInputTokens: number,
  ): number {
    return anthropicNative
      ? inputTokens + cachedInputTokens + cacheCreationInputTokens
      : inputTokens;
  }

  setCalibration(inputTokens: number, outputTokens: number): void {
    if (inputTokens === 0) return;
    this.calibratedTokens = inputTokens + outputTokens;
    this.calibratedMsgCount = this.messages.length;
  }

  resetCalibration(): void {
    this.calibratedTokens = 0;
    this.calibratedMsgCount = 0;
  }

  /** Truncates to `newLen` messages, adjusting the calibration anchor for removed anchored messages instead of discarding it. */
  truncateTo(newLen: number): void {
    if (newLen >= this.messages.length) return;
    const cal = Math.min(this.calibratedMsgCount, this.messages.length);
    if (this.calibratedTokens > 0 && newLen < cal) {
      const removed = this.messages
        .slice(newLen, cal)
        .reduce((sum, m) => sum + m.estimatedTokens, 0);
      this.calibratedTokens = Math.max(0, this.calibratedTokens - removed);
      this.calibratedMsgCount = newLen;
    }
    this.messages.length = newLen;
    this.totalEstimatedTokens = this.messages.reduce((sum, m) => sum + m.estimatedTokens, 0);
  }

  /** Rewinds to `newLen`, capturing a single-step restore point first. Returns messages removed (0 if nothing was cut). */
  rewindTo(newLen: number): number {
    if (newLen >= this.messages.length) return 0;
    const removed = this.messages.length - newLen;
    this.rewindUndo = {
      messages: this.messages.map((m) => ({ ...m })),
      totalEstimatedTokens: this.totalEstimatedTokens,
      calibratedTokens: this.calibratedTokens,
      calibratedMsgCount: this.calibratedMsgCount,
    };
    this.truncateTo(newLen);
    return removed;
  }

  /** Restores the messages removed by the most recent rewind; false when there is nothing to restore. */
  redo(): boolean {
    const undo = this.rewindUndo;
    if (undo === null) return false;
    this.rewindUndo = null;
    this.messages = undo.messages;
    this.totalEstimatedTokens = undo.totalEstimatedTokens;
    this.calibratedTokens = undo.calibratedTokens;
    this.calibratedMsgCount = undo.calibratedMsgCount;
    return true;
  }

  /** True while the context figure is still an estimate — no provider usage reported yet. */
  ctxIsEstimated(): boolean {
    return this.calibratedTokens === 0;
  }

  effectiveContextTokens(): number {
    if (this.calibratedTokens === 0) {
      return this.overheadTokens + this.totalEstimatedTokens;
    }
    const start = Math.min(this.calibratedMsgCount, this.messages.length);
    const delta = this.messages.slice(start).reduce((sum, m) => sum + m.estimatedTokens, 0);
    return this.calibratedTokens + delta;
  }

  /** Picks the compaction boundary: `messages[..cut]` get summarized, `messages[cut..]` are kept. Returns 0 when everything fits within `keepRecent`. */
  static selectCompactionCut(messages: SessionMessage[], keepRecent: number): number {
    let accumulated = 0;
    let cutIdx = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (accumulated >= keepRecent) {
        cutIdx = i + 1;
        break;
      }
      accumulated += messages[i]!.estimatedTokens;
    }
    return cutIdx;
  }

  needsCompaction(reserveTokens: number): boolean {
    if (this.contextWindow === 0) return false;
    return this.effectiveContextTokens() > this.contextWindow - reserveTokens;
  }

  updateContextWindow(cw: number): void {
    this.contextWindow = cw;
  }

  /** Locates the latest compaction's summary System message at runtime rather than trusting a stored index. Returns [summary, indexAfter] or [null, 0]. */
  compactedContext(): [string | null, number] {
    const c = this.compactions[this.compactions.length - 1];
    if (c === undefined) return [null, 0];
    for (let i = 0; i < this.messages.length; i++) {
      const msg = this.messages[i]!;
      if (msg.role === MessageRole.System && msg.content === c.summary) {
        return [c.summary, i + 1];
      }
    }
    return [null, 0];
  }

  compress(summary: string, firstKeptIndex: number, tokenSavings: number): void {
    const summarizedCount = firstKeptIndex;
    const summaryTokens = Session.estimateTokens(summary);
    this.messages.splice(0, firstKeptIndex);
    this.messages.unshift({
      role: MessageRole.System,
      content: summary,
      estimatedTokens: summaryTokens,
    });
    this.totalEstimatedTokens = this.messages.reduce((sum, m) => sum + m.estimatedTokens, 0);
    this.compactions.push({
      summary,
      firstKeptIndex: 1,
      summarizedCount,
      tokenSavings,
      createdAt: new Date().toISOString(),
    });
    // Compaction reindexes messages, so the calibration anchor no longer
    // lines up. Drop it; the next completed turn re-anchors.
    this.resetCalibration();
    this.updatedAt = new Date().toISOString();
  }

  /** Serializes only persisted fields, in the same snake_case JSON shape as the Rust session files. */
  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      name: this.name,
      messages: this.messages.map((m) => {
        const obj: Record<string, unknown> = {
          role: m.role,
          content: m.content,
          estimated_tokens: m.estimatedTokens,
        };
        if (m.tool !== undefined) obj["tool"] = toolRecordToJson(m.tool);
        return obj;
      }),
      compactions: this.compactions.map((c) => ({
        summary: c.summary,
        first_kept_index: c.firstKeptIndex,
        summarized_count: c.summarizedCount,
        token_savings: c.tokenSavings,
        created_at: c.createdAt,
      })),
      created_at: this.createdAt,
      updated_at: this.updatedAt,
      total_input_tokens: this.totalInputTokens,
      total_output_tokens: this.totalOutputTokens,
      total_cached_input_tokens: this.totalCachedInputTokens,
      total_cache_creation_input_tokens: this.totalCacheCreationInputTokens,
      total_cost: this.totalCost,
      total_estimated_tokens: this.totalEstimatedTokens,
      calibrated_tokens: this.calibratedTokens,
      calibrated_msg_count: this.calibratedMsgCount,
      input_token_cost: this.inputTokenCost,
      output_token_cost: this.outputTokenCost,
      context_window: this.contextWindow,
      model: this.model,
      provider: this.provider,
      working_dir: this.workingDir,
      permission_allowlist: this.permissionAllowlist.map((e) => ({
        tool: e.tool,
        pattern: e.pattern,
      })),
      next_tool_call_id: this.nextToolCallId,
      prompt:
        this.prompt === undefined
          ? null
          : { name: this.prompt.name, source: this.prompt.source },
    };
  }

  static fromJSON(raw: unknown): Session {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new TypeError("invalid session JSON");
    }
    const obj = raw as Record<string, unknown>;
    const num = (key: string): number =>
      typeof obj[key] === "number" ? (obj[key] as number) : 0;
    const str = (key: string, fallback = ""): string =>
      typeof obj[key] === "string" ? (obj[key] as string) : fallback;
    const messages: SessionMessage[] = [];
    if (Array.isArray(obj["messages"])) {
      for (const m of obj["messages"]) {
        const parsed = messageFromJson(m);
        if (parsed !== null) messages.push(parsed);
      }
    }
    const compactions: Compaction[] = [];
    if (Array.isArray(obj["compactions"])) {
      for (const c of obj["compactions"]) {
        if (c !== null && typeof c === "object" && !Array.isArray(c)) {
          const co = c as Record<string, unknown>;
          compactions.push({
            summary: typeof co["summary"] === "string" ? co["summary"] : "",
            firstKeptIndex: typeof co["first_kept_index"] === "number" ? co["first_kept_index"] : 0,
            summarizedCount: typeof co["summarized_count"] === "number" ? co["summarized_count"] : 0,
            tokenSavings: typeof co["token_savings"] === "number" ? co["token_savings"] : 0,
            createdAt: typeof co["created_at"] === "string" ? co["created_at"] : "",
          });
        }
      }
    }
    const allowlist: PermissionAllowEntry[] = [];
    if (Array.isArray(obj["permission_allowlist"])) {
      for (const e of obj["permission_allowlist"]) {
        if (e !== null && typeof e === "object" && !Array.isArray(e)) {
          const eo = e as Record<string, unknown>;
          if (typeof eo["tool"] === "string" && typeof eo["pattern"] === "string") {
            allowlist.push({ tool: eo["tool"], pattern: eo["pattern"] });
          }
        }
      }
    }
    let prompt: PromptRef | undefined;
    const rawPrompt = obj["prompt"];
    if (rawPrompt !== null && typeof rawPrompt === "object" && !Array.isArray(rawPrompt)) {
      const po = rawPrompt as Record<string, unknown>;
      const source =
        po["source"] === "user_file" ? PromptSource.UserFile : PromptSource.BuiltIn;
      if (typeof po["name"] === "string") prompt = { name: po["name"], source };
    }
    return new Session({
      id: str("id"),
      name: str("name"),
      messages,
      compactions,
      createdAt: str("created_at"),
      updatedAt: str("updated_at"),
      totalInputTokens: num("total_input_tokens"),
      totalOutputTokens: num("total_output_tokens"),
      totalCachedInputTokens: num("total_cached_input_tokens"),
      totalCacheCreationInputTokens: num("total_cache_creation_input_tokens"),
      totalCost: num("total_cost"),
      totalEstimatedTokens: num("total_estimated_tokens"),
      calibratedTokens: num("calibrated_tokens"),
      calibratedMsgCount: num("calibrated_msg_count"),
      inputTokenCost: num("input_token_cost"),
      outputTokenCost: num("output_token_cost"),
      contextWindow: num("context_window"),
      model: str("model"),
      provider: str("provider"),
      workingDir: str("working_dir"),
      permissionAllowlist: allowlist,
      nextToolCallId: num("next_tool_call_id"),
      prompt,
    });
  }
}

function readIsFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function formatTruncatedToolResult(
  name: string,
  output: string,
  outputChars: number,
  filePath: string,
): string {
  const chars = [...output];
  const head = chars.slice(0, TOOL_RESULT_HEAD_CHARS).join("");
  const tail = chars.slice(Math.max(0, outputChars - TOOL_RESULT_TAIL_CHARS)).join("");
  const omitted = Math.max(0, outputChars - TOOL_RESULT_HEAD_CHARS - TOOL_RESULT_TAIL_CHARS);
  return (
    `${name}:\n${head}\n\n` +
    `[tool output truncated: ${outputChars} characters; ${omitted} omitted]\n` +
    `[full output saved to: ${filePath}; use the read tool on this path to inspect the complete output]\n\n` +
    tail
  );
}
