// Hook system glue: global dispatcher, lifecycle gates, dry-run helper.
import { randomUUID } from "node:crypto";
import { canonicalToolName } from "./normalize.ts";
import { HookDispatcher, verdictName, type Decision, type PreDecision } from "./dispatcher.ts";
import { wrapAll, type DecoratableTool, type HookPermission } from "./decorator.ts";
import type { HookCtx } from "./envelope.ts";

export { canonicalToolName };
export { HookDispatcher, DEFAULT_TIMEOUT_SECS, Verdict, compareVerdicts, verdictName } from "./dispatcher.ts";
export type { Decision, PreDecision } from "./dispatcher.ts";
export { buildEnvelope, type EventFields, type HookCtx } from "./envelope.ts";
export { interpretHookOutput, type ChannelResult } from "./channel.ts";
export { buildShellInvocation, runHook, type HookOutput } from "./subprocess.ts";
export { parseHooksConfig, type HookHandler, type HookGroup, type HooksConfig } from "./settings.ts";
export { wrapAll, wrapTool, type DecoratableTool, type HookPermission } from "./decorator.ts";
export {
  hashHookBinding,
  loadTrustStore,
  saveTrustStore,
  globalSettingsPath,
  projectSettingsPath,
  managedSettingsPath,
  confirmUntrustedHook,
  filterTrustedProjectHooks,
  buildDispatcherFromPaths,
  loadDispatcher,
  loadDispatcherAsync,
  currentProjectRoot,
  defaultTrustStorePath,
  dataDir,
  configDir,
} from "./trust.ts";

/** `--loop` iteration/active state, threaded so the `Stop` envelope can report it. */
export interface LoopInfo {
  /** 1-based `--loop` iteration count. */
  iteration: number;
  /** Whether the loop will continue after this iteration. */
  active: boolean;
}

let processSessionId: string | null = null;

/** Best-effort session identity until the session seam supplies the real id/path. */
export function sessionContext(): [string, string] {
  if (processSessionId === null) processSessionId = randomUUID();
  const id: string = processSessionId;
  return [id, ""];
}

let globalDispatcher: HookDispatcher | null = null;

/** Install the process-wide dispatcher, built once from loaded config. */
export function initDispatcher(dispatcher: HookDispatcher): void {
  globalDispatcher = dispatcher;
}

export function getDispatcher(): HookDispatcher | null {
  return globalDispatcher;
}

/** Clear the process-global dispatcher (test helper). */
export function resetDispatcher(): void {
  globalDispatcher = null;
}

/**
 * Wrap `tools` with the process-global dispatcher's guard rail, or return
 * them unchanged when no hooks are configured.
 */
export function wrapFromGlobal(
  tools: DecoratableTool[],
  permission: HookPermission | null,
  sessionId?: string,
): DecoratableTool[] {
  const dispatcher = getDispatcher();
  if (!dispatcher) return tools;
  const [id] = sessionContext();
  return wrapAll(tools, dispatcher, permission, sessionId ?? id);
}

/** Build a HookCtx from process state for seams without a live checker. */
export function bestEffortCtx(): HookCtx {
  const [sessionId, sessionPath] = sessionContext();
  let cwd = "";
  try {
    cwd = process.cwd();
  } catch {
    cwd = "";
  }
  return { sessionId, sessionPath, cwd, permissionMode: "unknown" };
}

/** Outcome of gating a user prompt through `UserPromptSubmit` hooks. */
export type PromptGate =
  | { kind: "Proceed"; prompt: string }
  | { kind: "Blocked"; reason: string };

/** Testable core: dispatch `UserPromptSubmit` and decide whether the prompt proceeds. */
export async function gateUserPrompt(
  dispatcher: HookDispatcher,
  ctx: HookCtx,
  prompt: string,
): Promise<PromptGate> {
  const decision = await dispatcher.dispatch("UserPromptSubmit", null, ctx, {
    kind: "UserPromptSubmit",
    prompt,
  });
  switch (decision.kind) {
    case "Continue":
      return { kind: "Proceed", prompt };
    case "Block":
      return { kind: "Blocked", reason: decision.reason };
    case "Rewrite":
      return { kind: "Proceed", prompt: `${decision.content}\n\n${prompt}` };
  }
}

/** Production entry point: gate `prompt` through the global dispatcher, if any. */
export async function dispatchUserPromptSubmit(prompt: string): Promise<PromptGate> {
  const dispatcher = getDispatcher();
  if (!dispatcher) return { kind: "Proceed", prompt };
  return gateUserPrompt(dispatcher, bestEffortCtx(), prompt);
}

/** Outcome of dispatching `Stop`. */
export type StopGate = { kind: "Release" } | { kind: "Continue"; reason: string };

export async function gateStop(
  dispatcher: HookDispatcher,
  ctx: HookCtx,
  stopHookActive: boolean,
  loopIteration: number | null,
  loopActive: boolean | null,
): Promise<StopGate> {
  const decision = await dispatcher.dispatch("Stop", null, ctx, {
    kind: "Stop",
    stopHookActive,
    loopIteration,
    loopActive,
  });
  if (decision.kind === "Block") return { kind: "Continue", reason: decision.reason };
  return { kind: "Release" };
}

export async function dispatchStop(
  stopHookActive: boolean,
  loopIteration: number | null,
  loopActive: boolean | null,
): Promise<StopGate> {
  const dispatcher = getDispatcher();
  if (!dispatcher) return { kind: "Release" };
  return gateStop(dispatcher, bestEffortCtx(), stopHookActive, loopIteration, loopActive);
}

/** Dispatch `SessionStart` (informational only; the decision is ignored). */
export async function dispatchSessionStartWith(
  dispatcher: HookDispatcher,
  ctx: HookCtx,
  source: string,
): Promise<void> {
  await dispatcher.dispatch("SessionStart", null, ctx, { kind: "SessionStart", source });
}

export async function dispatchSessionStart(source: string): Promise<void> {
  const dispatcher = getDispatcher();
  if (!dispatcher) return;
  await dispatchSessionStartWith(dispatcher, bestEffortCtx(), source);
}

/** Dispatch `SessionEnd` (informational only; the decision is ignored). */
export async function dispatchSessionEndWith(
  dispatcher: HookDispatcher,
  ctx: HookCtx,
  reason: string,
): Promise<void> {
  await dispatcher.dispatch("SessionEnd", null, ctx, { kind: "SessionEnd", reason });
}

export async function dispatchSessionEnd(reason: string): Promise<void> {
  const dispatcher = getDispatcher();
  if (!dispatcher) return;
  await dispatchSessionEndWith(dispatcher, bestEffortCtx(), reason);
}

/** Dispatch `SubagentStart`; returns hook-injected context to prepend, if any. */
export async function gateSubagentStart(
  dispatcher: HookDispatcher,
  ctx: HookCtx,
  agentType: string,
): Promise<string | null> {
  const canonical = canonicalToolName(agentType);
  const decision = await dispatcher.dispatch("SubagentStart", canonical, ctx, {
    kind: "SubagentStart",
    agentType: canonical,
  });
  return decision.kind === "Rewrite" ? decision.content : null;
}

export async function dispatchSubagentStart(agentType: string): Promise<string | null> {
  const dispatcher = getDispatcher();
  if (!dispatcher) return null;
  return gateSubagentStart(dispatcher, bestEffortCtx(), agentType);
}

/** Outcome of dispatching `SubagentStop`. */
export type SubagentStopGate = { kind: "Release" } | { kind: "Continue"; reason: string };

export async function gateSubagentStop(
  dispatcher: HookDispatcher,
  ctx: HookCtx,
  agentType: string,
  stopHookActive: boolean,
): Promise<SubagentStopGate> {
  const canonical = canonicalToolName(agentType);
  const decision = await dispatcher.dispatch("SubagentStop", canonical, ctx, {
    kind: "SubagentStop",
    stopHookActive,
    agentType: canonical,
  });
  if (decision.kind === "Block") return { kind: "Continue", reason: decision.reason };
  return { kind: "Release" };
}

export async function dispatchSubagentStop(
  agentType: string,
  stopHookActive: boolean,
): Promise<SubagentStopGate> {
  const dispatcher = getDispatcher();
  if (!dispatcher) return { kind: "Release" };
  return gateSubagentStop(dispatcher, bestEffortCtx(), agentType, stopHookActive);
}

/** Testable core of the `hooks test` dry-run. */
export async function hooksTestDryRunWith(
  dispatcher: HookDispatcher,
  ctx: HookCtx,
  toolName: string,
  toolInput: unknown,
): Promise<string> {
  const decision = await dispatcher.dispatchPreToolUse(ctx, toolName, toolInput);
  return (
    `hooks test PreToolUse tool=${JSON.stringify(toolName)}\n` +
    `  verdict: ${verdictName(decision.verdict)}\n` +
    `  reason: ${decision.reason ?? "(none)"}\n` +
    `  updated_input: ${decision.updatedInput !== null ? JSON.stringify(decision.updatedInput) : "(none)"}`
  );
}

/** Production dry-run entry point for the `hooks test` flag. */
export async function hooksTestDryRun(toolName: string, toolInput: unknown): Promise<string> {
  const dispatcher = getDispatcher();
  if (!dispatcher) {
    return "hooks: no dispatcher installed (--no-hooks, disableAllHooks, or no settings.json hooks found)";
  }
  return hooksTestDryRunWith(dispatcher, bestEffortCtx(), toolName, toolInput);
}
