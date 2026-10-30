// Hook dispatcher: matcher compilation, handler execution, decision merging.
import { interpretHookOutput } from "./channel.ts";
import { buildEnvelope, type EventFields, type HookCtx } from "./envelope.ts";
import { canonicalToolName } from "./normalize.ts";
import type { HookHandler, HooksConfig } from "./settings.ts";
import { runHook, type HookOutput } from "./subprocess.ts";

/** Default per-hook timeout when a handler doesn't declare one. */
export const DEFAULT_TIMEOUT_SECS = 60;

/**
 * Permission decision vocabulary, least to most severe. A plain const
 * object (not a TS enum) so the file runs under Node 24 type stripping,
 * which does not support enums.
 */
export const Verdict = {
  Allow: 0,
  Defer: 1,
  Ask: 2,
  Deny: 3,
} as const;
export type Verdict = (typeof Verdict)[keyof typeof Verdict];

/** Compare two verdicts by severity (negative when `a` is less severe). */
export function compareVerdicts(a: Verdict, b: Verdict): number {
  return a - b;
}

export function verdictName(v: Verdict): string {
  switch (v) {
    case Verdict.Allow:
      return "Allow";
    case Verdict.Defer:
      return "Defer";
    case Verdict.Ask:
      return "Ask";
    case Verdict.Deny:
      return "Deny";
  }
}

/** Outcome of a non-tool-permission hook dispatch. */
export type Decision =
  | { kind: "Continue" }
  | { kind: "Block"; reason: string }
  | { kind: "Rewrite"; content: string };

/** Result of dispatching `PreToolUse`. */
export interface PreDecision {
  verdict: Verdict;
  reason: string | null;
  updatedInput: unknown | null;
}

type CompiledMatcher =
  | { kind: "All" }
  | { kind: "Names"; names: Set<string> }
  | { kind: "Regex"; re: RegExp };

function isPlainNameList(s: string): boolean {
  return /^[A-Za-z0-9_|,\s]*$/.test(s);
}

function compileMatcher(matcher: string | undefined): CompiledMatcher {
  if (matcher === undefined || matcher === "" || matcher === "*") return { kind: "All" };
  if (isPlainNameList(matcher)) {
    const names = new Set(
      matcher
        .split(/[|,]/)
        .map((n) => canonicalToolName(n.trim()))
        .filter((n) => n !== ""),
    );
    return { kind: "Names", names };
  }
  try {
    return { kind: "Regex", re: new RegExp(matcher) };
  } catch (e) {
    throw new Error(`hooks: invalid matcher regex \`${matcher}\`: ${e}`);
  }
}

function matcherMatches(matcher: CompiledMatcher, name: string): boolean {
  switch (matcher.kind) {
    case "All":
      return true;
    case "Names":
      return matcher.names.has(name);
    case "Regex":
      return matcher.re.test(name);
  }
}

interface MatcherEntry {
  matcher: CompiledMatcher;
  handlers: HookHandler[];
}

interface PreDecisionPart {
  verdict: Verdict;
  reason: string | null;
  updatedInput: unknown | null;
}

function getStr(obj: unknown, key: string): string | undefined {
  if (obj !== null && typeof obj === "object") {
    const v = (obj as Record<string, unknown>)[key];
    return typeof v === "string" ? v : undefined;
  }
  return undefined;
}

export function parsePreDecisionPart(output: HookOutput): PreDecisionPart {
  const result = interpretHookOutput(output);
  switch (result.kind) {
    case "Block":
      return { verdict: Verdict.Deny, reason: result.stderr, updatedInput: null };
    case "NoObjection": {
      if (result.json === null || result.json === undefined) {
        return { verdict: Verdict.Defer, reason: null, updatedInput: null };
      }
      const decision = getStr(result.json, "permissionDecision");
      let verdict: Verdict = Verdict.Defer;
      if (decision === "deny") verdict = Verdict.Deny;
      else if (decision === "ask") verdict = Verdict.Ask;
      else if (decision === "allow") verdict = Verdict.Allow;
      const reason = getStr(result.json, "reason") ?? null;
      const updatedInput =
        result.json !== null && typeof result.json === "object" && "updatedInput" in result.json
          ? (result.json as Record<string, unknown>).updatedInput ?? null
          : null;
      return { verdict, reason, updatedInput };
    }
    case "Error":
      console.warn(`hooks: hook exited ${result.exitCode} (non-blocking): ${result.stderr}`);
      return { verdict: Verdict.Defer, reason: null, updatedInput: null };
    case "TimedOut":
      console.warn("hooks: hook timed out");
      return { verdict: Verdict.Defer, reason: null, updatedInput: null };
  }
}

/**
 * Deterministic merge for `PreToolUse`: strict most-severe verdict wins;
 * `updatedInput` folds in declared order (later declarations overwrite
 * earlier ones). Seeded from the first part actually seen, so an
 * all-`Allow` result reflects the real verdict rather than regressing
 * to the `Defer` sentinel.
 */
export function mergePreDecisions(originalInput: unknown, parts: PreDecisionPart[]): PreDecision {
  let verdict: Verdict = Verdict.Defer;
  let reason: string | null = null;
  let currentInput: unknown = originalInput;
  let rewriteCount = 0;
  let seenAny = false;
  for (const part of parts) {
    if (!seenAny || part.verdict > verdict) {
      verdict = part.verdict;
      reason = part.reason;
    }
    seenAny = true;
    if (part.updatedInput !== null && part.updatedInput !== undefined) {
      currentInput = part.updatedInput;
      rewriteCount += 1;
    }
  }
  if (rewriteCount > 1) {
    console.warn(
      `hooks: ${rewriteCount} hooks rewrote tool input for the same call; using the last declared rewrite`,
    );
  }
  return {
    verdict,
    reason,
    updatedInput: rewriteCount > 0 ? currentInput : null,
  };
}

export function parseDecision(output: HookOutput): Decision {
  const result = interpretHookOutput(output);
  switch (result.kind) {
    case "Block":
      return { kind: "Block", reason: result.stderr };
    case "NoObjection": {
      if (result.json === null || result.json === undefined) return { kind: "Continue" };
      if (getStr(result.json, "decision") === "block") {
        return { kind: "Block", reason: getStr(result.json, "reason") ?? "" };
      }
      const additional = getStr(result.json, "additionalContext");
      if (additional !== undefined) return { kind: "Rewrite", content: additional };
      const rewritten = getStr(result.json, "result");
      if (rewritten !== undefined) return { kind: "Rewrite", content: rewritten };
      return { kind: "Continue" };
    }
    case "Error":
    case "TimedOut":
      return { kind: "Continue" };
  }
}

/** Merge generic decisions: any `Block` wins; else the first `Rewrite`; else `Continue`. */
export function mergeDecisions(outputs: HookOutput[]): Decision {
  let rewrite: Decision | null = null;
  for (const output of outputs) {
    const decision = parseDecision(output);
    if (decision.kind === "Block") return decision;
    if (decision.kind === "Rewrite" && rewrite === null) rewrite = decision;
  }
  return rewrite ?? { kind: "Continue" };
}

/**
 * The dispatcher seam: accepts only strings/JSON and returns only
 * tiny-crow-owned `Decision`/`PreDecision` values.
 */
export class HookDispatcher {
  private events: Map<string, MatcherEntry[]>;
  /** Handlers with `once: true` already run, keyed by `event\0command`. */
  private onceRan: Set<string>;

  private constructor(events: Map<string, MatcherEntry[]>) {
    this.events = events;
    this.onceRan = new Set();
  }

  static fromConfig(config: HooksConfig): HookDispatcher {
    const events = new Map<string, MatcherEntry[]>();
    for (const [event, groups] of Object.entries(config)) {
      const entries: MatcherEntry[] = groups.map((group) => ({
        matcher: compileMatcher(group.matcher),
        handlers: [...group.hooks],
      }));
      events.set(event, entries);
    }
    return new HookDispatcher(events);
  }

  static empty(): HookDispatcher {
    return new HookDispatcher(new Map());
  }

  isEmpty(): boolean {
    for (const entries of this.events.values()) {
      if (entries.some((e) => e.handlers.length > 0)) return false;
    }
    return true;
  }

  /** True when any Pre/PostToolUse handler is registered. */
  hasToolHooks(): boolean {
    for (const event of ["PreToolUse", "PostToolUse", "PostToolUseFailure"]) {
      const entries = this.events.get(event);
      if (entries && entries.some((e) => e.handlers.length > 0)) return true;
    }
    return false;
  }

  /** Configured events with total handler counts, sorted by event name. */
  summary(): Array<[string, number]> {
    const result: Array<[string, number]> = [];
    for (const [event, entries] of this.events) {
      const count = entries.reduce((n, e) => n + e.handlers.length, 0);
      if (count > 0) result.push([event, count]);
    }
    result.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return result;
  }

  /**
   * Handlers matching `event`/`canonicalToolName`, in declared order,
   * with identical commands deduplicated (first occurrence wins).
   */
  handlersFor(event: string, canonicalName: string): HookHandler[] {
    const entries = this.events.get(event);
    if (!entries) return [];
    const seen = new Set<string>();
    const result: HookHandler[] = [];
    for (const entry of entries) {
      if (!matcherMatches(entry.matcher, canonicalName)) continue;
      for (const handler of entry.handlers) {
        if (handler.command !== undefined && seen.has(handler.command)) continue;
        if (handler.command !== undefined) seen.add(handler.command);
        result.push(handler);
      }
    }
    return result;
  }

  async dispatch(
    event: string,
    canonicalName: string | null,
    ctx: HookCtx,
    fields: EventFields,
  ): Promise<Decision> {
    const handlers = this.handlersFor(event, canonicalName ?? "");
    if (handlers.length === 0) return { kind: "Continue" };
    const envelope = buildEnvelope(ctx, event, fields);
    const outputs = await this.runHandlers(event, handlers, envelope, ctx.cwd);
    return mergeDecisions(outputs);
  }

  async dispatchPreToolUse(
    ctx: HookCtx,
    toolName: string,
    toolInput: unknown,
  ): Promise<PreDecision> {
    const canonical = canonicalToolName(toolName);
    const handlers = this.handlersFor("PreToolUse", canonical);
    if (handlers.length === 0) {
      return { verdict: Verdict.Defer, reason: null, updatedInput: null };
    }
    const envelope = buildEnvelope(ctx, "PreToolUse", {
      kind: "PreToolUse",
      toolName: canonical,
      toolInput,
    });
    const outputs = await this.runHandlers("PreToolUse", handlers, envelope, ctx.cwd);
    const parts = outputs.map(parsePreDecisionPart);
    return mergePreDecisions(toolInput, parts);
  }

  async dispatchPostToolUse(
    ctx: HookCtx,
    toolName: string,
    toolInput: unknown,
    toolResponse: string,
  ): Promise<Decision> {
    const canonical = canonicalToolName(toolName);
    const handlers = this.handlersFor("PostToolUse", canonical);
    if (handlers.length === 0) return { kind: "Continue" };
    const envelope = buildEnvelope(ctx, "PostToolUse", {
      kind: "PostToolUse",
      toolName: canonical,
      toolInput,
      toolResponse,
    });
    const outputs = await this.runHandlers("PostToolUse", handlers, envelope, ctx.cwd);
    return mergeDecisions(outputs);
  }

  async dispatchPostToolUseFailure(
    ctx: HookCtx,
    toolName: string,
    toolInput: unknown,
    error: string,
  ): Promise<void> {
    const canonical = canonicalToolName(toolName);
    const handlers = this.handlersFor("PostToolUseFailure", canonical);
    if (handlers.length === 0) return;
    const envelope = buildEnvelope(ctx, "PostToolUseFailure", {
      kind: "PostToolUseFailure",
      toolName: canonical,
      toolInput,
      error,
    });
    await this.runHandlers("PostToolUseFailure", handlers, envelope, ctx.cwd);
  }

  private async runHandlers(
    event: string,
    handlers: HookHandler[],
    envelope: Record<string, unknown>,
    projectDir: string,
  ): Promise<HookOutput[]> {
    const stdin = Buffer.from(JSON.stringify(envelope), "utf8");
    const pending: Array<Promise<HookOutput>> = [];
    for (const handler of handlers) {
      if (handler.command === undefined) continue;
      const command = handler.command;
      if (handler.once) {
        const key = `${event}\0${command}`;
        if (this.onceRan.has(key)) continue;
        this.onceRan.add(key);
      }
      if (handler.if !== undefined) {
        const condition = handler.if;
        const condTimeoutMs = (handler.timeout ?? DEFAULT_TIMEOUT_SECS) * 1000;
        const condOutput = await runHook(condition, undefined, stdin, condTimeoutMs, projectDir);
        if (condOutput.timedOut) {
          console.warn(
            `hooks: \`if\` condition for ${JSON.stringify(command)} timed out; failing closed (running the handler)`,
          );
        } else if (condOutput.exitCode === 0) {
          // Condition passed; run the handler.
        } else if (condOutput.exitCode !== null) {
          continue;
        } else {
          console.warn(
            `hooks: \`if\` condition for ${JSON.stringify(command)} could not be spawned; failing closed (running the handler)`,
          );
        }
      }
      const timeoutMs = (handler.timeout ?? DEFAULT_TIMEOUT_SECS) * 1000;
      const args = handler.args !== undefined ? [...handler.args] : undefined;
      if (handler.async) {
        // Fire and forget; the decision is ignored.
        void runHook(command, args, stdin, timeoutMs, projectDir);
      } else {
        pending.push(runHook(command, args, stdin, timeoutMs, projectDir));
      }
    }
    return Promise.all(pending);
  }
}
