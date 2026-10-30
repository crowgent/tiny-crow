// Tool decorator: runs Pre/PostToolUse hooks around an inner tool call.
import { HookDispatcher, Verdict } from "./dispatcher.ts";
import type { HookCtx } from "./envelope.ts";

/**
 * Minimal structural tool shape used by the decorator. The agent slice's
 * concrete tool type should satisfy this shape (name, description,
 * JSON-schema parameters, and an async execute function); the decorator
 * does not depend on any provider framework type.
 */
export interface DecoratableTool {
  name: string;
  description: string;
  parameters: unknown;
  execute(args: unknown): Promise<string>;
}

/**
 * Permission-checker surface the decorator needs. All methods are
 * optional: when no checker is supplied the hook verdicts still apply,
 * except Ask/Allow which only nudge a checker when one is present.
 */
export interface HookPermission {
  mode(): string;
  recordBlocked(toolName: string, argsJson: string): void;
  forceAskOnce(toolName: string): void;
  allowOnce(toolName: string): void;
}

export function buildHookCtx(permission: HookPermission | null, sessionId: string): HookCtx {
  let cwd = "";
  try {
    cwd = process.cwd();
  } catch {
    cwd = "";
  }
  return {
    sessionId,
    sessionPath: "",
    cwd,
    permissionMode: permission ? permission.mode() : "standard",
  };
}

/**
 * Wrap one tool so PreToolUse/PostToolUse/PostToolUseFailure run around
 * the inner call. Deny blocks with "Blocked by guard rail: <reason>";
 * Ask forces the checker's prompt for this call; Allow suppresses it for
 * this call only; a PreToolUse rewrite replaces the arguments; a
 * PostToolUse rewrite replaces the model-visible result.
 */
export function wrapTool(
  inner: DecoratableTool,
  dispatcher: HookDispatcher,
  permission: HookPermission | null,
  sessionId: string,
): DecoratableTool {
  return {
    name: inner.name,
    description: inner.description,
    parameters: inner.parameters,
    async execute(args: unknown): Promise<string> {
      if (!dispatcher.hasToolHooks()) {
        return inner.execute(args);
      }
      const toolName = inner.name;
      const ctx = buildHookCtx(permission, sessionId);
      const toolInput = args;
      const argsStr = JSON.stringify(args) ?? "";
      const pre = await dispatcher.dispatchPreToolUse(ctx, toolName, toolInput);
      if (pre.verdict === Verdict.Deny) {
        const reason = pre.reason ?? "denied by hook";
        if (permission) permission.recordBlocked(toolName, argsStr);
        throw new Error(`Blocked by guard rail: ${reason}`);
      }
      if (pre.verdict === Verdict.Ask && permission) {
        permission.forceAskOnce(toolName);
      }
      if (pre.verdict === Verdict.Allow && permission) {
        permission.allowOnce(toolName);
      }
      const callArgs = pre.updatedInput !== null && pre.updatedInput !== undefined ? pre.updatedInput : args;
      try {
        const result = await inner.execute(callArgs);
        const decision = await dispatcher.dispatchPostToolUse(ctx, toolName, toolInput, result);
        if (decision.kind === "Rewrite") return decision.content;
        return result;
      } catch (err) {
        await dispatcher.dispatchPostToolUseFailure(
          ctx,
          toolName,
          toolInput,
          err instanceof Error ? err.message : String(err),
        );
        throw err;
      }
    },
  };
}

/**
 * Wrap every tool with the hook dispatcher's guard rail. Returns `tools`
 * unchanged when the dispatcher has no configured hooks.
 */
export function wrapAll(
  tools: DecoratableTool[],
  dispatcher: HookDispatcher,
  permission: HookPermission | null,
  sessionId: string,
): DecoratableTool[] {
  if (dispatcher.isEmpty()) return tools;
  return tools.map((tool) => wrapTool(tool, dispatcher, permission, sessionId));
}
