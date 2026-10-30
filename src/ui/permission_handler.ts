import type { Renderer } from "./renderer.ts";
import { C_ERROR, C_PERM } from "./roles.ts";
import {
  EventQueue,
  type AgentRunState,
  type AskRequest,
  type UiContext,
  type UserDecision,
  type UserEvent,
} from "./state.ts";
import { suggestPattern } from "./utils.ts";

/**
 * Handle a permission request from a tool: show the prompt, wait for the
 * user's y / a / n / Esc decision on the user-event queue, and deliver
 * it. `AllowAlways` also records the suggested pattern in the session
 * allowlist and persists the session (when a session saver is wired).
 *
 * The blocked-scope guard is disposed before the decision is delivered:
 * the protocol promises the `state:working` signal precedes the decision
 * reaching the waiting tool, so that ordering must stay above the reply
 * send even though moving it later would still compile.
 */
export async function handlePermissionRequest(
  askReq: AskRequest,
  renderer: Renderer,
  ui: UiContext,
  run: AgentRunState,
  userEvents: EventQueue<UserEvent>,
): Promise<void> {
  run.wasReasoning = false;
  if (run.agentLineStarted) {
    renderer.writeLine("", "white");
    run.agentLineStarted = false;
  }

  renderer.writeLine(`[permission] ${askReq.tool}: ${askReq.input}`, C_PERM);
  renderer.writeLine("  (y) allow once  (a) allow always  (n) deny  (ESC) abort", C_PERM);

  renderer.permissionPrompt = {
    tool: `[permission] ${askReq.tool}: ${askReq.input}`,
    options: "  (y) allow once  (a) allow always  (n) deny  (ESC) abort",
  };
  renderer.renderViewport();
  renderer.drawBottom("", 0, [], false);

  const blockedGuard =
    ui.statusSignals !== null ? ui.statusSignals.blockedScope("permission") : null;

  // The guard must release on every exit path, including a renderer error
  // mid-prompt: without this finally, a throw would skip the explicit
  // dispose below and leave the wait bracket unclosed on the wire.
  try {
    let decision: UserDecision;
    for (;;) {
      const ev = await userEvents.next();
      if (ev === null) {
        decision = { kind: "deny" };
        break;
      }
      if (ev.type !== "key") continue;
      const key = ev.key;
      if (key.code === "char" && key.ch === "y") {
        decision = { kind: "allow_once" };
        break;
      }
      if (key.code === "char" && key.ch === "a") {
        const pattern = suggestPattern(askReq.tool, askReq.input);
        renderer.writeLine(`  -> will allow: ${pattern}`, "green");
        decision = { kind: "allow_always", pattern };
        break;
      }
      if ((key.code === "char" && key.ch === "n") || key.code === "esc") {
        decision = { kind: "deny" };
        break;
      }
    }

    renderer.permissionPrompt = null;

    const allowPattern = decision.kind === "allow_always" ? decision.pattern : null;
    // Explicit dispose sends state:working before the decision reaches the
    // waiting tool; it must stay above askReq.reply.send.
    blockedGuard?.dispose();
    askReq.reply.send(decision);
    if (allowPattern !== null) {
      renderer.writeLine(`  allowed ${askReq.tool} ${allowPattern} (saved to session)`, "green");
      ui.session.permissionAllowlist.push({ tool: askReq.tool, pattern: allowPattern });
      if (!ui.cli.noSession && ui.saveSession !== null) {
        try {
          await ui.saveSession(ui.session);
        } catch (e) {
          renderer.writeLine(
            `warning: failed to save session: ${e instanceof Error ? e.message : String(e)}`,
            C_ERROR,
          );
        }
      }
    }
  } finally {
    blockedGuard?.dispose();
  }
}
