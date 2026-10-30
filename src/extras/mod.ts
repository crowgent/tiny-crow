// Extras barrel: re-exports only the modules owned by this slice.
// Note: mcp, lsp, and acp belong to another slice and are deliberately
// NOT re-exported here; they are imported directly from their own
// modules (../mcp/mod.ts, ../lsp/mod.ts, ../acp/...) by consumers that
// need them, so a missing sibling module never blocks this barrel.
export * from "./hooks/mod.ts";
export * from "./memory/mod.ts";
export * from "./subagents/mod.ts";
export * from "./subagents/builder.ts";
export * from "./subagents/prompt.ts";
export * from "./subagents/task_tool.ts";
export * from "./loop/mod.ts";
export * from "./loop/headless.ts";
export * from "./loop/plan.ts";
export * from "./loop/transcript.ts";
export * from "./git_worktree/mod.ts";
export * from "./archmd/mod.ts";
// advisor/mod.ts also exports `withConfig`, which collides with the
// subagents module's `withConfig`; re-export it under an alias instead.
export {
  ADVISOR_SYSTEM_PROMPT,
  createHandoffRequest,
  initConfig,
  withConfig as advisorWithConfig,
  isEnabled as advisorIsEnabled,
  updateClient as advisorUpdateClient,
  setSessionMessages,
  getSessionMessages,
  advisorDescription,
  ADVISOR_PARAMETERS,
  formatConversation,
  runAdvisorCompletion,
  AdvisorTool,
} from "./advisor/mod.ts";
export type {
  AdvisorSessionMessage,
  MessageRoleString,
  HandoffRequest,
  HandoffSender,
  AdvisorClient,
  AdvisorToolConfig,
  AdvisorArgs,
} from "./advisor/mod.ts";
export * from "./chain/mod.ts";
export * from "./export.ts";
export * from "./status_signals.ts";
export * from "./truncate.ts";
export * from "./multimodal/mod.ts";
export * from "./rtk.ts";
