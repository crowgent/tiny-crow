export interface HookCtx {
  sessionId: string;
  sessionPath: string;
  cwd: string;
  permissionMode: string;
}

export type EventFields =
  | { kind: "PreToolUse"; toolName: string; toolInput: unknown }
  | { kind: "PostToolUse"; toolName: string; toolInput: unknown; toolResponse: string }
  | { kind: "PostToolUseFailure"; toolName: string; toolInput: unknown; error: string }
  | { kind: "UserPromptSubmit"; prompt: string }
  | {
      kind: "Stop";
      stopHookActive: boolean;
      loopIteration?: number | null;
      loopActive?: boolean | null;
    }
  | { kind: "SessionStart"; source: string }
  | { kind: "SessionEnd"; reason: string }
  | { kind: "SubagentStart"; agentType: string }
  | { kind: "SubagentStop"; stopHookActive: boolean; agentType: string };

export function buildEnvelope(
  ctx: HookCtx,
  hookEventName: string,
  fields: EventFields,
): Record<string, unknown> {
  const envelope: Record<string, unknown> = {
    session_id: ctx.sessionId,
    session_path: ctx.sessionPath,
    cwd: ctx.cwd,
    permission_mode: ctx.permissionMode,
    hook_event_name: hookEventName,
  };
  switch (fields.kind) {
    case "PreToolUse":
      envelope.tool_name = fields.toolName;
      envelope.tool_input = fields.toolInput;
      break;
    case "PostToolUse":
      envelope.tool_name = fields.toolName;
      envelope.tool_input = fields.toolInput;
      envelope.tool_response = fields.toolResponse;
      break;
    case "PostToolUseFailure":
      envelope.tool_name = fields.toolName;
      envelope.tool_input = fields.toolInput;
      envelope.error = fields.error;
      break;
    case "UserPromptSubmit":
      envelope.prompt = fields.prompt;
      break;
    case "Stop":
      envelope.stop_hook_active = fields.stopHookActive;
      envelope.loop_iteration = fields.loopIteration ?? null;
      envelope.loop_active = fields.loopActive ?? null;
      break;
    case "SessionStart":
      envelope.source = fields.source;
      break;
    case "SessionEnd":
      envelope.reason = fields.reason;
      break;
    case "SubagentStart":
      envelope.agent_type = fields.agentType;
      break;
    case "SubagentStop":
      envelope.stop_hook_active = fields.stopHookActive;
      envelope.agent_type = fields.agentType;
      break;
  }
  return envelope;
}
