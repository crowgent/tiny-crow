// /review: switch to the review prompt and defer the review message to
// the agent, restoring the previous prompt afterwards (one-shot restore).

import {
  applyPromptMode,
  writeError,
  writeOk,
  type SlashCtx,
} from "./mod.ts";
import { detectWorktree } from "./features.ts";
import { SlashDeferredError } from "./outcome.ts";

function isSessionEmpty(ctx: SlashCtx): boolean {
  return !ctx.session.messages.some((m) => m.role === "user");
}

function isInWorktree(): boolean {
  try {
    return detectWorktree() !== undefined;
  } catch {
    return false;
  }
}

export function buildDefaultReviewMessage(
  sessionEmpty: boolean,
  inWorktree: boolean,
): string {
  if (sessionEmpty && inWorktree) {
    return "Review the current worktree state. Check the diff from the base branch for correctness, design, testing, and security.";
  }
  if (sessionEmpty) {
    return "Review the current codebase for correctness, design, testing, and security.";
  }
  if (inWorktree) {
    return "Review the changes in this worktree session. Consider the diff from main since the branch was created. Check for correctness, design, testing, and security.";
  }
  return "Review the changes discussed in this session for correctness, design, testing, and security.";
}

export async function handle(parts: string[], ctx: SlashCtx): Promise<void> {
  if (!ctx.context.prompts.has("review")) {
    writeError(ctx.renderer, "no 'review' prompt found. Run /regen-prompts first.");
    return;
  }
  const msg = parts.length > 1
    ? parts.slice(1).join(" ")
    : buildDefaultReviewMessage(isSessionEmpty(ctx), isInWorktree());

  // Save current prompt for one-shot restoration.
  ctx.context.oneShotRestore = ctx.context.currentPromptName;

  // Switch to review prompt.
  applyPromptMode("review", ctx.context, ctx.session, ctx.permission, ctx.promptSource);

  const modelSwitched = await ctx.switchToPromptModel("review");
  if (!modelSwitched) await ctx.rebuildAgent();
  writeOk(ctx.renderer, `review: ${msg}`);

  throw new SlashDeferredError({ kind: "deferReview", message: msg });
}
