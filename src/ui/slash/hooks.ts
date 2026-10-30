// /hooks: report the configured hook events and handlers.

import {
  writeOk,
  writeResult,
  type SlashCtx,
} from "./mod.ts";

export async function handle(_parts: string[], ctx: SlashCtx): Promise<void> {
  const dispatcher = ctx.hooksDispatcher;
  if (dispatcher === undefined) {
    writeOk(
      ctx.renderer,
      "hooks: no dispatcher installed (--no-hooks, disableAllHooks, or no settings.json hooks found)",
    );
    return;
  }
  const summary = dispatcher.summary();
  if (summary.length === 0) {
    writeOk(ctx.renderer, "hooks: enabled, no hooks configured");
  } else {
    writeOk(ctx.renderer, "hooks: configured events");
    for (const [event, count] of summary) {
      writeResult(
        ctx.renderer,
        `  ${event}: ${count} handler${count === 1 ? "" : "s"}`,
      );
    }
  }
}
