import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { GitStatus, Session } from "./state.ts";
import { gitStatusIsDirty } from "./state.ts";
import { parseColor, type Color } from "./utils.ts";

/**
 * Configurable status-bar statusline. Up to 3 lines, each an ordered list
 * of segments parsed from `[statusline]` in config. When no
 * `[statusline]` is set, a built-in default layout is used. Items resolve
 * to text + colours at render time; `separator` is literal text and
 * `flex_separator` expands to fill the row, pushing later segments right.
 */

export const MAX_STATUS_LINES = 3;

/** A drawable statusline piece after items are resolved. */
export type StatusSpan =
  | { kind: "text"; text: string; fg: Color | null; bg: Color | null }
  | { kind: "flex" };

export function textSpan(text: string, fg: Color | null, bg: Color | null): StatusSpan {
  return { kind: "text", text, fg, bg };
}

export const FLEX_SPAN: StatusSpan = { kind: "flex" };

/** Runtime values the statusline can show beyond the session itself. */
export interface StatusContext {
  loopLabel?: string | null;
  promptName?: string | null;
  permMode?: string | null;
  chainLabel?: string | null;
  btwCost: number;
  btwIn: number;
  btwOut: number;
}

export function defaultStatusContext(): StatusContext {
  return { btwCost: 0, btwIn: 0, btwOut: 0 };
}

/** Icon for a statusline item: `auto` uses the item's built-in glyph, `custom` names or literally gives one. */
export type IconSpec = { kind: "auto"; value: boolean } | { kind: "custom"; value: string };

export interface StatusLineSegment {
  item: string;
  color?: string;
  bg?: string;
  text?: string;
  left?: string;
  right?: string;
  icon?: IconSpec;
  always?: boolean;
}

export interface StatusLineLine {
  segments: StatusLineSegment[];
}

export interface StatusLineConfig {
  lines: StatusLineLine[];
}

let spec: StatusLineConfig | null = null;
let needsGitStatusValue = false;

/** Parse the statusline spec from config once at startup. Clamps to 3 lines. */
export function initStatusline(cfg: { statusline?: StatusLineConfig }): void {
  let parsed = cfg.statusline ?? defaultSpec();
  if (parsed.lines.length === 0) parsed = defaultSpec();
  parsed = { lines: parsed.lines.slice(0, MAX_STATUS_LINES) };
  needsGitStatusValue = parsed.lines.some((l) =>
    l.segments.some((s) => s.item === "git_changes" || s.item === "git_status"),
  );
  spec = parsed;
}

function getSpec(): StatusLineConfig {
  if (spec === null) spec = defaultSpec();
  return spec;
}

/** Number of statusline lines (1-3). */
export function lineCount(): number {
  return Math.min(Math.max(getSpec().lines.length, 1), MAX_STATUS_LINES);
}

/** Whether the configured statusline needs `git status` (a subprocess). False lets the caller skip computing it. */
export function needsGitStatus(): boolean {
  return needsGitStatusValue;
}

/** Build the statusline's drawable lines for the current state. */
export function build(session: Session, ctx: StatusContext): StatusSpan[][] {
  return buildLines(getSpec(), session, ctx);
}

/** Build drawable lines from an explicit spec (used by `build` and tests). */
export function buildLines(
  specValue: StatusLineConfig,
  session: Session,
  ctx: StatusContext,
): StatusSpan[][] {
  return specValue.lines.map((line) => buildLine(line, session, ctx));
}

function segmentColor(c: string | undefined): Color | null {
  return c === undefined ? null : parseColor(c);
}

function buildLine(line: StatusLineLine, session: Session, ctx: StatusContext): StatusSpan[] {
  const raw: [StatusSpan, boolean][] = [];
  for (const seg of line.segments) {
    if (seg.item === "flex_separator" || seg.item === "flex") {
      raw.push([{ kind: "flex" }, false]);
    } else if (seg.item === "separator" || seg.item === "sep") {
      raw.push([
        {
          kind: "text",
          text: seg.text ?? " ",
          fg: segmentColor(seg.color),
          bg: segmentColor(seg.bg),
        },
        true,
      ]);
    } else {
      const always = seg.always ?? false;
      let text = resolveItem(seg.item, session, ctx, always);
      if (text !== null) {
        const glyph = resolveIcon(seg.icon, seg.item);
        if (glyph !== null) text = `${glyph} ${text}`;
        // A live-state override (the context meter turning amber/red as
        // it fills) wins over the configured colour.
        const fg = dynamicItemColor(seg.item, session) ?? segmentColor(seg.color);
        const bg = segmentColor(seg.bg);
        const cap = bg ?? fg;
        if (seg.left !== undefined) {
          raw.push([{ kind: "text", text: powerlineGlyph(seg.left), fg: cap, bg: null }, false]);
        }
        raw.push([{ kind: "text", text, fg, bg }, false]);
        if (seg.right !== undefined) {
          raw.push([{ kind: "text", text: powerlineGlyph(seg.right), fg: cap, bg: null }, false]);
        }
      }
    }
  }

  // Drop leading/duplicate separators, then any trailing separators, so
  // layouts stay clean when optional items resolve to nothing.
  const cleaned: [StatusSpan, boolean][] = [];
  for (const [span, isSep] of raw) {
    if (isSep) {
      const prevIsSep = cleaned.length === 0 || cleaned[cleaned.length - 1][1];
      if (prevIsSep) continue;
    }
    cleaned.push([span, isSep]);
  }
  while (cleaned.length > 0 && cleaned[cleaned.length - 1][1]) cleaned.pop();
  return cleaned.map(([s]) => s);
}

/**
 * Context fill as an integer percentage of the window, or null when the
 * window is unknown (so the meter shows `0%` rather than dividing by
 * zero). Deliberately not clamped: a value past 100% is a real
 * "over budget" state.
 */
export function contextPercentage(session: Session): number | null {
  if (session.contextWindow === 0) return null;
  return Math.floor((session.effectiveContextTokens() * 100) / session.contextWindow);
}

/** Per-item colour override driven by live session state; currently only the context percentage. */
export function dynamicItemColor(item: string, session: Session): Color | null {
  if (item !== "context_percentage") return null;
  const pct = contextPercentage(session);
  if (pct === null) return null;
  if (pct > 100) return "red";
  if (pct >= 90) return "yellow";
  return null;
}

/** Resolve a non-separator item to display text, or null to skip it. `always` forces zero-valued numeric items to render. */
export function resolveItem(
  item: string,
  session: Session,
  ctx: StatusContext,
  always: boolean,
): string | null {
  switch (item) {
    case "session_name":
      return session.name !== "" ? session.name : null;
    case "session_id":
      return [...session.id].slice(0, 8).join("");
    case "git_branch":
      return session.gitBranch;
    case "git_changes":
      return session.gitStatus !== null ? formatChanges(session.gitStatus) : null;
    case "git_status":
      return session.gitStatus !== null ? formatStatus(session.gitStatus) : null;
    case "cwd":
      return basename(session.workingDir);
    case "cwd_full":
      return contractHome(session.workingDir);
    case "worktree":
      return gitWorktree(session.workingDir);
    case "model":
      return session.model;
    case "model_short": {
      const parts = session.model.split("/");
      return parts[parts.length - 1] ?? session.model;
    }
    case "provider":
      return session.provider;
    case "message_count":
      return String(session.messages.length);
    case "session_age":
      return fmtElapsed(session.createdAt);
    case "session_updated":
      return fmtElapsed(session.updatedAt);
    case "clock": {
      const now = new Date();
      return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    }
    case "host":
      return hostname();
    case "user": {
      const u = process.env["USER"] ?? process.env["USERNAME"] ?? "";
      return u !== "" ? u : null;
    }
    case "reasoning":
      return session.reasoningEnabled ? "reasoning" : null;
    case "tokens_input":
      return session.totalInputTokens > 0 || always
        ? fmtTokens(session.totalInputTokens)
        : null;
    case "tokens_output":
      return session.totalOutputTokens > 0 || always
        ? fmtTokens(session.totalOutputTokens)
        : null;
    case "context_used": {
      const mark = session.ctxIsEstimated() ? "~" : "";
      return `${mark}${fmtTokens(session.effectiveContextTokens())}`;
    }
    case "context_max":
      return fmtTokens(session.contextWindow);
    case "context_percentage":
      return `${contextPercentage(session) ?? 0}%`;
    case "cost":
      return session.totalCost > 0 || session.showCostAlways || always
        ? `$${session.totalCost.toFixed(4)}`
        : null;
    case "prompt":
      return ctx.promptName !== undefined && ctx.promptName !== null
        ? `prompt:${ctx.promptName}`
        : null;
    case "mode":
      return ctx.permMode !== undefined && ctx.permMode !== null && ctx.permMode !== "standard"
        ? `mode:${ctx.permMode}`
        : null;
    case "loop":
      return ctx.loopLabel !== undefined && ctx.loopLabel !== null ? `[${ctx.loopLabel}]` : null;
    case "chain":
      return ctx.chainLabel ?? null;
    case "compaction":
      return session.compactions.length > 0 ? `cmp:${session.compactions.length}` : null;
    case "btw": {
      if (ctx.btwIn === 0 && ctx.btwOut === 0) return null;
      if (ctx.btwCost > 0) {
        return `btw:$${ctx.btwCost.toFixed(4)} (${fmtTokens(ctx.btwIn)}/${fmtTokens(ctx.btwOut)})`;
      }
      return `btw:${fmtTokens(ctx.btwIn)}/${fmtTokens(ctx.btwOut)}`;
    }
    default:
      return null;
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function basename(dir: string): string {
  const parts = dir.replace(/\/$/, "").split("/");
  const last = parts[parts.length - 1] ?? dir;
  return last === "" ? dir : last;
}

/** Full working-directory path with `$HOME` shortened to `~`. */
export function contractHome(dir: string): string {
  const home = homedir();
  if (dir === home) return "~";
  if (dir.startsWith(`${home}/`)) return `~/${dir.slice(home.length + 1)}`;
  return dir;
}

/** Name of the linked git worktree for `dir` (from a `.git` file pointing into `.../worktrees/<name>`), or null. */
export function gitWorktree(dir: string): string | null {
  let content: string;
  try {
    content = readFileSync(join(dir, ".git"), "utf8");
  } catch {
    return null;
  }
  const gitdir = content.startsWith("gitdir:") ? content.slice("gitdir:".length).trim() : null;
  if (gitdir === null) return null;
  const parts = gitdir.split("/");
  if (!parts.includes("worktrees")) return null;
  return parts[parts.length - 1] ?? null;
}

/** Short human elapsed time since an RFC3339 timestamp (for example `5m`, `2h10m`). */
export function fmtElapsed(rfc3339: string): string | null {
  const then = Date.parse(rfc3339);
  if (Number.isNaN(then)) return null;
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h${Math.floor((secs % 3600) / 60)}m`;
  return `${Math.floor(secs / 86400)}d${Math.floor((secs % 86400) / 3600)}h`;
}

/** Machine hostname from env, falling back to `/etc/hostname`. */
export function hostname(): string | null {
  const h = process.env["HOSTNAME"] ?? process.env["HOST"];
  if (h !== undefined && h !== "") return h;
  try {
    const fromFile = readFileSync("/etc/hostname", "utf8").trim();
    if (fromFile !== "") return fromFile;
  } catch {
    // No /etc/hostname (non-unix host).
  }
  return null;
}

/** `+staged ~modified -deleted ?untracked`, only the non-zero parts; null when the tree is clean. */
export function formatChanges(g: GitStatus): string | null {
  if (!gitStatusIsDirty(g)) return null;
  const parts: string[] = [];
  if (g.staged > 0) parts.push(`+${g.staged}`);
  if (g.modified > 0) parts.push(`~${g.modified}`);
  if (g.deleted > 0) parts.push(`-${g.deleted}`);
  if (g.untracked > 0) parts.push(`?${g.untracked}`);
  return parts.join(" ");
}

/** Upstream sync plus a clean/dirty marker: `↑1 ↓2 *`, or `✓` when clean and in sync. */
export function formatStatus(g: GitStatus): string {
  const parts: string[] = [];
  if (g.ahead > 0) parts.push(`↑${g.ahead}`);
  if (g.behind > 0) parts.push(`↓${g.behind}`);
  if (gitStatusIsDirty(g)) parts.push("*");
  return parts.length === 0 ? "✓" : parts.join(" ");
}

/** Resolve a segment's `icon` setting to a glyph: auto uses the item's built-in icon, a custom string is looked up by name (or used literally). */
export function resolveIcon(icon: IconSpec | undefined, item: string): string | null {
  if (icon === undefined) return null;
  if (icon.kind === "auto") return icon.value ? itemIcon(item) : null;
  return iconGlyph(icon.value);
}

/** Built-in Nerd Font icon for an item, when one fits. */
export function itemIcon(item: string): string | null {
  switch (item) {
    case "git_branch":
      return "";
    case "git_changes":
      return "";
    case "git_status":
      return "";
    case "cwd":
    case "cwd_full":
      return "";
    case "worktree":
      return "";
    case "model":
    case "model_short":
      return "";
    case "provider":
      return "";
    case "cost":
      return "";
    case "context_used":
    case "context_max":
    case "context_percentage":
      return "";
    case "session_name":
    case "session_id":
      return "";
    case "message_count":
      return "";
    case "session_age":
    case "session_updated":
    case "clock":
      return "";
    case "host":
      return "";
    case "user":
      return "";
    case "reasoning":
      return "";
    case "prompt":
      return "";
    case "mode":
      return "";
    case "loop":
      return "";
    case "btw":
      return "";
    case "compaction":
      return "";
    default:
      return null;
  }
}

/** Named icon lookup, with passthrough so any literal glyph also works. */
export function iconGlyph(name: string): string {
  switch (name) {
    case "branch":
    case "git":
      return "";
    case "folder":
    case "dir":
      return "";
    case "chip":
    case "model":
      return "";
    case "dollar":
    case "money":
      return "";
    case "database":
    case "context":
      return "";
    case "hash":
      return "";
    case "terminal":
      return "";
    case "lock":
      return "";
    case "pencil":
    case "edit":
      return "";
    case "sync":
    case "refresh":
      return "";
    default:
      return name;
  }
}

/** Resolve a powerline cap name to its glyph, or return the input unchanged so any literal string also works. */
export function powerlineGlyph(name: string): string {
  switch (name) {
    case "pl_right":
    case "powerline_right":
      return "";
    case "pl_left":
    case "powerline_left":
      return "";
    case "pl_right_thin":
      return "";
    case "pl_left_thin":
      return "";
    case "pl_round_right":
    case "round_right":
      return "";
    case "pl_round_left":
    case "round_left":
      return "";
    case "pl_flame_right":
      return "";
    case "pl_flame_left":
      return "";
    default:
      return name;
  }
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.floor(n / 1000)}k`;
  return String(n);
}

/** Built-in single-line layout used when `[statusline]` is not configured. */
export function defaultSpec(): StatusLineConfig {
  const seg = (item: string, c?: string): StatusLineSegment => ({
    item,
    ...(c !== undefined ? { color: c } : {}),
  });
  const sep = (text: string): StatusLineSegment => ({ item: "separator", text });
  const segments: StatusLineSegment[] = [
    seg("cwd", "dark_grey"),
    sep("  "),
    { item: "git_branch", color: "dark_grey", left: "(", right: ")" },
    sep(" | "),
    seg("model", "dark_grey"),
    sep("  |  "),
    seg("context_used", "dark_grey"),
    sep("/"),
    seg("context_max", "dark_grey"),
    sep(" "),
    seg("context_percentage", "dark_grey"),
    sep("  ⇑"),
    seg("tokens_input", "dark_grey"),
    sep(" ⇓"),
    seg("tokens_output", "dark_grey"),
    { item: "flex_separator" },
    seg("loop", "dark_grey"),
    sep(" "),
    seg("mode", "dark_grey"),
    sep(" "),
    seg("cost", "dark_grey"),
    sep(" "),
    seg("btw", "dark_grey"),
    sep(" "),
    seg("prompt", "dark_grey"),
  ];
  return { lines: [{ segments }] };
}

