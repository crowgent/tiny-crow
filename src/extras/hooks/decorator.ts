import { HookDispatcher, Verdict } from "./dispatcher.ts";
import type { HookCtx } from "./envelope.ts";

export interface DecoratableTool {
  name: string;
  description: string;
  parameters: unknown;
  execute(args: unknown): Promise<string>;
}

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

export function wrapAll(
  tools: DecoratableTool[],
  dispatcher: HookDispatcher,
  permission: HookPermission | null,
  sessionId: string,
): DecoratableTool[] {
  if (dispatcher.isEmpty()) return tools;
  return tools.map((tool) => wrapTool(tool, dispatcher, permission, sessionId));
}
