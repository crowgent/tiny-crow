import { realpathSync } from "node:fs";
import path from "node:path";
import { Pattern, expandTilde } from "./pattern.ts";
import {
  Action,
  defaultBashRules,
  defaultDenyRegexRules,
  type PermissionConfig,
  type PermissionConfigs,
  SecurityMode,
  type ToolPerm,
} from "./mod.ts";

export type CheckResult =
  | { kind: "allowed" }
  | { kind: "allowedWithCoaching"; message: string }
  | { kind: "ask" }
  | { kind: "denied"; reason: string };

export function allowedWithCoaching(tool: string, _input: string, count: number): CheckResult {
  return {
    kind: "allowedWithCoaching",
    message:
      `Coaching: You've called ${tool} on the same input ${count} times in a row. ` +
      `This looks like a loop — try a different approach.`,
  };
}

type Rule = [Pattern, Action];
type RulesMap = Map<string, Rule[]>;

const READ_TOOLS = new Set(["read", "grep", "find_files", "list_dir", "task"]);
const PATH_TOOLS = new Set(["read", "write", "edit", "list_dir"]);
const TOOL_FIELDS: Array<[string, (c: PermissionConfig) => ToolPerm | undefined]> = [
  ["bash", (c) => c.bash],
  ["read", (c) => c.read],
  ["write", (c) => c.write],
  ["edit", (c) => c.edit],
  ["grep", (c) => c.grep],
  ["find_files", (c) => c.findFiles],
  ["list_dir", (c) => c.listDir],
  ["todo_write", (c) => c.todoWrite],
  ["mcp_tool", (c) => c.mcpTool],
];

function compileConfig(config: PermissionConfig, isRegex: boolean): RulesMap {
  const rules: RulesMap = new Map();
  for (const [toolName, get] of TOOL_FIELDS) {
    const perm = get(config);
    if (perm === undefined) continue;
    const entries: Rule[] = [];
    if (perm.kind === "simple") {
      entries.push([new Pattern(isRegex ? ".*" : "*", isRegex), perm.action]);
    } else {
      for (const [pat, action] of perm.rules) {
        entries.push([new Pattern(pat, isRegex), action]);
      }
    }
    rules.set(toolName, entries);
  }
  return rules;
}

function resolveAbsolute(p: string, workingDir: string): string {
  const expanded = expandTilde(p);
  return path.isAbsolute(expanded) ? expanded : path.join(workingDir, expanded);
}

function normalizePath(p: string): string {
  const parsed = path.parse(p);
  const out: string[] = [];
  for (const part of p.split(path.sep)) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      out.pop();
    } else {
      out.push(part);
    }
  }
  const joined = out.join(path.sep);
  return (parsed.root || "") + joined;
}

function isPlanFile(p: string): boolean {
  const name = path.basename(p);
  return name.startsWith("PLAN") && name.endsWith(".md");
}

function isReadEquivalentMcp(input: string): boolean {
  const lower = input.toLowerCase();
  return (
    lower.startsWith("mcp_tool:exa web search:") ||
    lower.startsWith("mcp_tool:context7:") ||
    lower.startsWith("mcp_tool:grep.app:")
  );
}

export class PermissionChecker {
  #rules: RulesMap;
  #defaultAction: Action;
  #extDirRules: Rule[];
  #doomLoopAction: Action;
  #workingDir: string;
  #sessionAllowlist: Array<[string, Pattern]> = [];
  #lastCall: [string, string] | null = null;
  #consecutiveRepeatCount = 0;
  #mode: SecurityMode;
  #userMode: SecurityMode;
  #permissionModes: SecurityMode[];
  #allowAllMcpCalls = false;
  #pendingForcedAsk: string | null = null;
  #pendingOneShotAllow: string | null = null;

  constructor(
    configs: PermissionConfigs,
    mode: SecurityMode,
    workingDir?: string,
    permissionModes?: string[],
  ) {
    this.#defaultAction = configs.glob.default ?? configs.regex.default ?? Action.Allow;
    this.#doomLoopAction = configs.glob.doomLoop ?? configs.regex.doomLoop ?? Action.Ask;

    const rules = compileConfig(configs.glob, false);
    for (const [tool, entries] of compileConfig(configs.regex, true)) {
      const existing = rules.get(tool) ?? [];
      existing.push(...entries);
      rules.set(tool, existing);
    }
    const mergeEntries = (
      entries: Map<string, string[]> | undefined,
      action: Action,
    ): void => {
      if (entries === undefined) return;
      for (const [tool, patterns] of entries) {
        const list = rules.get(tool) ?? [];
        for (const pat of patterns) list.push([new Pattern(pat), action]);
        rules.set(tool, list);
      }
    };
    mergeEntries(configs.glob.allowEntries, Action.Allow);
    mergeEntries(configs.glob.askEntries, Action.Ask);
    mergeEntries(configs.glob.denyEntries, Action.Deny);

    if (!rules.has("bash")) {
      rules.set(
        "bash",
        defaultBashRules().map(([pat, action]) => [new Pattern(pat), action] as Rule),
      );
    }
    for (const [tool, regex] of defaultDenyRegexRules()) {
      const list = rules.get(tool) ?? [];
      list.push([new Pattern(regex, true), Action.Deny]);
      rules.set(tool, list);
    }
    this.#rules = rules;

    this.#extDirRules = configs.glob.externalDirectory
      ? [...configs.glob.externalDirectory].map(
          ([pat, action]) => [new Pattern(pat), action] as Rule,
        )
      : [];

    this.#workingDir = workingDir ?? process.cwd();
    this.#mode = mode;
    this.#userMode = mode;
    const rawModes = permissionModes ?? ["guarded", "standard", "yolo"];
    this.#permissionModes = rawModes.flatMap((s) => {
      switch (s) {
        case "restrictive":
          return [SecurityMode.Restrictive];
        case "readonly":
          return [SecurityMode.ReadOnly];
        case "planwrite":
          return [SecurityMode.PlanWrite];
        case "guarded":
          return [SecurityMode.Guarded];
        case "standard":
          return [SecurityMode.Standard];
        case "yolo":
          return [SecurityMode.Yolo];
        default:
          return [];
      }
    });
  }

  forceAskOnce(tool: string): void {
    this.#pendingForcedAsk = tool;
  }

  allowOnce(tool: string): void {
    this.#pendingOneShotAllow = tool;
  }

  #applyRules(): boolean {
    return this.#permissionModes.includes(this.#mode) || this.#mode === SecurityMode.Yolo;
  }

  #isReadTool(tool: string): boolean {
    return READ_TOOLS.has(tool);
  }

  #isPathTool(tool: string): boolean {
    return PATH_TOOLS.has(tool);
  }

  #resolveCheckAction(tool: string, matched: Action[]): Action {
    const base = matched[matched.length - 1];
    switch (this.#mode) {
      case SecurityMode.Restrictive:
        return base ?? Action.Ask;
      case SecurityMode.ReadOnly:
      case SecurityMode.PlanWrite:
        return base ?? (this.#isReadTool(tool) ? Action.Allow : Action.Deny);
      case SecurityMode.Guarded:
        return base ?? (this.#isReadTool(tool) ? Action.Allow : Action.Ask);
      case SecurityMode.Standard:
        return base ?? this.#defaultAction;
      case SecurityMode.Yolo:
        if (base === Action.Deny) return Action.Deny;
        return base ?? Action.Allow;
    }
  }

  #resolvePathAction(tool: string, matched: Action[], absPath: string): Action {
    const base = matched[matched.length - 1];
    switch (this.#mode) {
      case SecurityMode.Restrictive:
        return base ?? Action.Ask;
      case SecurityMode.ReadOnly:
        return base ?? (this.#isReadTool(tool) ? Action.Allow : Action.Deny);
      case SecurityMode.PlanWrite:
        return (
          base ??
          (this.#isReadTool(tool) || ((tool === "write" || tool === "edit") && isPlanFile(absPath))
            ? Action.Allow
            : Action.Deny)
        );
      case SecurityMode.Guarded:
        return base ?? (this.#isReadTool(tool) ? Action.Allow : Action.Ask);
      case SecurityMode.Standard: {
        const a = base ?? this.#defaultAction;
        if (matched.length === 0 && this.#isPathTool(tool) && !this.#isExternalPath(absPath)) {
          return Action.Allow;
        }
        if (matched.length === 0 && a === Action.Allow && this.#isExternalPath(absPath)) {
          return this.#matchExtDir(absPath) ?? Action.Ask;
        }
        return a;
      }
      case SecurityMode.Yolo:
        if (base === Action.Deny) return Action.Deny;
        return base ?? Action.Allow;
    }
  }

  #doomLoopCheck(tool: string, doomKey: string, action: Action): CheckResult {
    if (action !== Action.Deny) {
      this.#trackDoomLoop(tool, doomKey);
      if (this.#isDoomLoop()) {
        if (action === Action.Allow) {
          return allowedWithCoaching(tool, doomKey, this.#countDoomLoop());
        }
        switch (this.#doomLoopAction) {
          case Action.Deny:
            return { kind: "denied", reason: "Doom loop: repeated identical tool call" };
          case Action.Ask:
            return { kind: "ask" };
          case Action.Allow:
            break;
        }
      }
    }
    switch (action) {
      case Action.Allow:
        return { kind: "allowed" };
      case Action.Ask:
        return { kind: "ask" };
      case Action.Deny:
        return { kind: "denied", reason: "Blocked by permission rules" };
    }
  }

  #takePendingOneShot(tool: string): CheckResult | null {
    if (this.#pendingForcedAsk === tool) {
      this.#pendingForcedAsk = null;
      return { kind: "ask" };
    }
    if (this.#pendingOneShotAllow === tool) {
      this.#pendingOneShotAllow = null;
      return { kind: "allowed" };
    }
    return null;
  }

  check(tool: string, input: string): CheckResult {
    if (tool === "todo_write") return { kind: "allowed" };

    if (this.#matchesDenyRule(tool, [input])) {
      return { kind: "denied", reason: "Blocked by deny rule" };
    }
    const oneShot = this.#takePendingOneShot(tool);
    if (oneShot !== null) return oneShot;
    if (this.#allowAllMcpCalls && tool === "mcp_tool") return { kind: "allowed" };
    if (this.#isSessionAllowed(tool, input)) return { kind: "allowed" };
    if (
      tool === "mcp_tool" &&
      (this.#mode === SecurityMode.ReadOnly || this.#mode === SecurityMode.PlanWrite) &&
      isReadEquivalentMcp(input)
    ) {
      return { kind: "allowed" };
    }
    const matched: Action[] = [];
    if (this.#applyRules()) {
      for (const [pattern, action] of this.#rules.get(tool) ?? []) {
        if (pattern.matches(input)) matched.push(action);
      }
    }
    return this.#doomLoopCheck(tool, input, this.#resolveCheckAction(tool, matched));
  }

  checkPath(tool: string, pathStr: string): CheckResult {
    if (tool === "todo_write") return { kind: "allowed" };
    const expanded = expandTilde(pathStr);
    const absPath = resolveAbsolute(expanded, this.#workingDir);
    if (this.#matchesDenyRule(tool, [absPath, expanded])) {
      return { kind: "denied", reason: "Blocked by deny rule" };
    }
    const oneShot = this.#takePendingOneShot(tool);
    if (oneShot !== null) return oneShot;
    if (this.#isSessionAllowed(tool, expanded) || this.#isSessionAllowed(tool, absPath)) {
      return { kind: "allowed" };
    }
    const matched: Action[] = [];
    if (this.#applyRules()) {
      for (const [pattern, action] of this.#rules.get(tool) ?? []) {
        if (pattern.matches(absPath) || pattern.matches(expanded)) matched.push(action);
      }
    }
    return this.#doomLoopCheck(tool, expanded, this.#resolvePathAction(tool, matched, absPath));
  }

  #matchesDenyRule(tool: string, inputs: string[]): boolean {
    if (!this.#applyRules()) return false;
    for (const [pattern, action] of this.#rules.get(tool) ?? []) {
      if (action === Action.Deny && inputs.some((input) => pattern.matches(input))) return true;
    }
    return false;
  }

  #isSessionAllowed(tool: string, input: string): boolean {
    return this.#sessionAllowlist.some(
      ([allowedTool, pattern]) => allowedTool === tool && pattern.matches(input),
    );
  }

  addSessionAllowlist(tool: string, patternStr: string): void {
    this.#sessionAllowlist.push([tool, new Pattern(patternStr)]);
    if (this.#isPathTool(tool)) {
      const expanded = expandTilde(patternStr);
      const abs = resolveAbsolute(expanded, this.#workingDir);
      if (abs !== expanded) this.#sessionAllowlist.push([tool, new Pattern(abs)]);
    }
  }

  loadSessionAllowlist(entries: Array<[string, string]>): void {
    for (const [tool, pat] of entries) this.addSessionAllowlist(tool, pat);
  }

  setMode(mode: SecurityMode): void {
    this.#mode = mode;
    this.#userMode = mode;
  }

  setPromptMode(mode: SecurityMode): void {
    this.#mode = mode;
  }

  restoreUserMode(): void {
    this.#mode = this.#userMode;
  }

  mode(): SecurityMode {
    return this.#mode;
  }

  setAllowAllMcpCalls(allow: boolean): void {
    this.#allowAllMcpCalls = allow;
  }

  recordBlocked(tool: string, input: string): void {
    this.#trackDoomLoop(tool, input);
  }

  #isExternalPath(pathStr: string): boolean {
    const p = path.isAbsolute(pathStr) ? pathStr : path.join(this.#workingDir, pathStr);
    let normalized: string;
    try {
      normalized = realpathSync(p);
    } catch {
      normalized = normalizePath(p);
    }
    let normalizedCwd: string;
    try {
      normalizedCwd = realpathSync(this.#workingDir);
    } catch {
      normalizedCwd = normalizePath(this.#workingDir);
    }
    const rel = path.relative(normalizedCwd, normalized);
    return rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
  }

  #matchExtDir(pathStr: string): Action | undefined {
    for (const [pattern, action] of this.#extDirRules) {
      if (pattern.matches(pathStr)) return action;
    }
    return undefined;
  }

  #trackDoomLoop(tool: string, input: string): void {
    const current: [string, string] = [tool, input];
    if (
      this.#lastCall !== null &&
      this.#lastCall[0] === current[0] &&
      this.#lastCall[1] === current[1]
    ) {
      this.#consecutiveRepeatCount += 1;
    } else {
      this.#lastCall = current;
      this.#consecutiveRepeatCount = 1;
    }
  }

  #isDoomLoop(): boolean {
    return this.#consecutiveRepeatCount >= 5;
  }

  #countDoomLoop(): number {
    return this.#consecutiveRepeatCount;
  }
}
