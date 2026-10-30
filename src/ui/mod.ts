/**
 * UI module root: shared helpers used across the TUI (prompt-mode
 * switching, submission classification, the main-run starters, the
 * mid-turn compaction paths, and the terminal event thread), plus
 * re-exports of every UI slice module so callers can import from one
 * place. The `App` loop itself lives in `app.ts`; this module imports it
 * only for `runInteractive`, and only uses it inside that function, so
 * the app <-> mod import cycle never touches an uninitialised binding
 * during module evaluation.
 */

import { App } from "./app.ts";
import { ensureAgent, resolveAgentMergeOutcome } from "./event_handler.ts";
import { Renderer } from "./renderer.ts";
import { C_ERROR } from "./roles.ts";
import {
  EventQueue,
  securityModeFromString,
  type AgentRunState,
  type AnyAgent,
  type AskRequest,
  type BtwStats,
  type ChainState,
  type ContextFiles,
  type KeyEvent,
  type MergeRequest,
  type PermCheck,
  type SecurityMode,
  type Session,
  type SlashState,
  type UiContext,
  type UserEvent,
} from "./state.ts";
import { build as buildStatusline } from "./statusline.ts";
import type { PickerLike } from "./app.ts";

export { App, SimpleInputEditor } from "./app.ts";
export type {
  AppOptions,
  InputEditorLike,
  PickerLike,
  SlashHandler,
  SlashHandlerCtx,
  SlashOutcome,
  SlashResult,
} from "./app.ts";
export {
  ensureAgent,
  handleAgentEvent,
  resolveAgentMergeOutcome,
  resolveToolResultCallId,
  TODO_LIST,
} from "./event_handler.ts";
export type { TodoItem } from "./event_handler.ts";
export {
  formatTime,
  renderSession,
  sanitizeOutput,
  showWelcome,
  TINY_CROW_VERSION,
} from "./events.ts";
export { Block, BlockStyle, blockColor, Feed, styleFromColor } from "./feed.ts";
export { markdownToStyled, wordWrap } from "./markdown.ts";
export { handlePermissionRequest } from "./permission_handler.ts";
export {
  base64Encode,
  copyToClipboard,
  isSafeUrl,
  openUrl,
  Renderer,
  StringBackend,
  StdoutBackend,
} from "./renderer.ts";
export type {
  BottomSnapshot,
  BottomRedrawPlan,
  ChainPrompt,
  LineEntry,
  PermissionPrompt,
  PromptSnapshot,
  RenderBackend,
} from "./renderer.ts";
export {
  applyRoles,
  C_AGENT,
  C_BTW,
  C_ERROR,
  C_HANDOFF,
  C_PERM,
  C_TOOL,
  color as roleColor,
  defaultColor,
  resetRoles,
  roleFromName,
} from "./roles.ts";
export {
  AgentBuildCtx,
  AgentRunState,
  BtwStats,
  ChainState,
  EventQueue,
  MessageRole,
  realInputTokens,
  resolveShowToolDetails,
  SlashState,
  TurnUsage,
  UiContext,
} from "./state.ts";
export type {
  AgentEvent,
  AskRequest,
  BtwEvent,
  ChainPhase,
  Cli,
  Config,
  ContextFiles,
  GitStatus,
  KeyEvent,
  MergeRequest,
  PermCheck,
  SecurityMode,
  Session,
  SessionMessage,
  StatusLineConfigLike,
  UserDecision,
  UserEvent,
} from "./state.ts";
export {
  build as buildStatusline,
  buildLines as buildStatuslineLines,
  defaultSpec as defaultStatuslineSpec,
  fmtTokens,
  formatChanges,
  formatStatus,
  iconGlyph,
  initStatusline,
  itemIcon,
  lineCount as statuslineLineCount,
  needsGitStatus,
  powerlineGlyph,
} from "./statusline.ts";
export type {
  StatusContext,
  StatusLineConfig,
  StatusLineLine,
  StatusLineSegment,
  StatusSpan,
} from "./statusline.ts";
export {
  parseEditorCommand,
  SuspendGuard,
  suspendTui,
  TerminalGuard,
  terminalSize,
} from "./terminal.ts";
export {
  ansiBackground,
  ansiForeground,
  charDisplayWidth,
  displayWidth,
  expandTilde,
  formatToolCallSummary,
  lineColToCursor,
  cursorToLineCol,
  parseColor,
  resolveColor,
  suggestPattern,
  toAnsi256,
  truncateCjk,
  type Color,
} from "./utils.ts";

/** What `applyPromptMode` did with the prompt's `%%mode=` directive, so callers can report the change without re-parsing the prompt. */
export type PromptModeOutcome =
  | { kind: "none" }
  | { kind: "restored_user_mode" }
  | { kind: "applied"; mode: SecurityMode };

/**
 * Parse a prompt's `%%mode=` directive: returns the directive value (or
 * null) and the prompt content with the directive line stripped.
 */
export function parsePromptMode(content: string): [string | null, string] {
  const lines = content.split("\n");
  let directive: string | null = null;
  const kept: string[] = [];
  for (const line of lines) {
    const m = line.match(/^%%mode=(\S+)\s*$/);
    if (m !== null && directive === null) {
      directive = m[1];
    } else {
      kept.push(line);
    }
  }
  return [directive, kept.join("\n")];
}

/**
 * Select prompt `name` as the current prompt and apply its `%%mode=`
 * directive (if any) to the permission checker. The directive line is
 * stripped from the stored prompt content. Unknown prompt names are a
 * no-op.
 */
export function applyPromptMode(
  name: string,
  context: ContextFiles,
  session: Session,
  permission: PermCheck | null,
): PromptModeOutcome {
  const content = context.prompts.get(name);
  if (content === undefined) return { kind: "none" };
  const [modeDirective, cleanContent] = parsePromptMode(content);
  context.currentPrompt = modeDirective !== null ? cleanContent : content;
  context.currentPromptName = name;
  session.prompt = {
    name,
    source: context.promptSource?.(name) ?? "user_file",
  };
  return applyModeDirective(modeDirective, permission);
}

/** Apply an already-parsed `%%mode=` directive to the permission checker. */
function applyModeDirective(
  modeDirective: string | null,
  permission: PermCheck | null,
): PromptModeOutcome {
  if (modeDirective === null || permission === null) return { kind: "none" };
  if (modeDirective === "last_user_mode") {
    permission.restoreUserMode();
    return { kind: "restored_user_mode" };
  }
  const mode = securityModeFromString(modeDirective);
  if (mode !== null) {
    permission.setPromptMode(mode);
    return { kind: "applied", mode };
  }
  return { kind: "none" };
}

/** Re-apply the current prompt's `%%mode=` directive after a context reload (which restores the raw, unstripped prompt content from disk). */
export function applyCurrentPromptMode(
  context: ContextFiles,
  permission: PermCheck | null,
): void {
  const content = context.currentPrompt;
  if (content === undefined) return;
  const [modeDirective, cleanContent] = parsePromptMode(content);
  if (modeDirective !== null) context.currentPrompt = cleanContent;
  applyModeDirective(modeDirective, permission);
}

/**
 * State held while an agent-driven worktree merge is in flight, until the
 * run finishes and the merge outcome can be verified. (The `WtReturn`
 * shape itself lives in `state.ts`; this re-export keeps the Rust
 * module layout discoverable from here.)
 */
export type { WtReturn } from "./state.ts";

/** Shared tail of the merge-agent completion path (see `event_handler.ts`). */
export { resolveAgentMergeOutcome as resolveMergeOutcome };

/**
 * Refresh the whole display: reconcile the input height first so the
 * chat viewport is drawn against the size the input is about to occupy,
 * then draw the bottom region (input + statusline), then paint an active
 * picker overlay (which forces a full repaint next frame, since it paints
 * over regions the dirty tracking cannot see).
 */
export function refreshDisplay(
  renderer: Renderer,
  inputBuffer: string,
  inputCursor: number,
  picker: PickerLike | null,
  ui: UiContext,
  run: AgentRunState,
  chain: ChainState,
  btw: BtwStats,
): void {
  renderer.syncInputHeight(inputBuffer);
  renderer.renderViewport();
  const permMode = ui.permission !== null ? ui.permission.modeString() : null;
  const statuslineCtx = {
    loopLabel: chain.loopLabel,
    promptName: ui.context.currentPromptName ?? null,
    permMode,
    chainLabel: chain.labelMsg,
    btwCost: btw.cost,
    btwIn: btw.input,
    btwOut: btw.output,
  };
  const statusline = buildStatusline(ui.session, statuslineCtx);
  renderer.drawBottom(inputBuffer, inputCursor, statusline, run.isRunning);
  if (picker !== null) {
    const wasActive = picker.active();
    // Pickers paint straight onto real stdout, bypassing the render
    // backend; in headless runs there is no usable terminal (and on CI
    // stdout is a non-blocking pipe, so the burst of escape sequences
    // fails with EAGAIN). Key handling is unaffected — only painting.
    if (!renderer.isHeadless()) {
      picker.draw();
    }
    if (wasActive) {
      renderer.invalidate();
    }
  }
}

/** Idle cadence of the event thread's poll loop. */
export const IDLE_POLL_MS = 50;

/**
 * How far ahead the event thread peeks after an `Enter`/`Ctrl+J` to
 * decide whether it is really a pasted newline, and how long it waits
 * for the next event before declaring a paste burst over. Terminals
 * without bracketed-paste support deliver a multi-line paste as a rapid
 * stream of key events whose newlines arrive as `Enter` or `Ctrl+J`;
 * without coalescing, each pasted line would be submitted separately.
 * 10 ms is far below the time a human needs to press another key after
 * `Enter`, so genuine submits are unaffected.
 */
export const PASTE_BURST_WINDOW_MS = 10;

/** What a plain `Enter` keypress means in the current input stream. */
export type EnterVerdict = "submit" | "newline";

/**
 * Whether a key event is a candidate pasted newline: a bare `Enter`, or
 * `Ctrl+J` — which is how a raw pasted `\n` byte arrives in raw mode.
 * `Enter`/`j` with any other modifier combo is a deliberate key
 * combination and passes through untouched.
 */
export function isPasteNewlineKey(key: KeyEvent): boolean {
  return (
    (key.code === "enter" && !key.ctrl && !key.alt && !key.shift) ||
    (key.code === "char" && key.ch === "j" && key.ctrl && !key.alt && !key.shift)
  );
}

/**
 * Paste-burst state for terminals without bracketed paste. A burst
 * starts when a paste-newline key has more input queued right behind
 * it, and ends once the input stream goes quiet for the burst window.
 * While a burst is active every such key is a pasted newline, never a
 * submit (and never a literal `j`). Pure state machine, unit-testable
 * without a terminal.
 */
export class PasteBurst {
  private active = false;

  /** Poll timeout for the next event: short while a burst is alive, idle cadence otherwise. */
  waitTimeoutMs(): number {
    return this.active ? PASTE_BURST_WINDOW_MS : IDLE_POLL_MS;
  }

  /** No event arrived within the window: any burst in progress is over. */
  onTimeout(): void {
    this.active = false;
  }

  /** Classify a plain `Enter` press and update burst state. */
  onEnter(moreInputPending: boolean): EnterVerdict {
    if (this.active || moreInputPending) {
      this.active = true;
      return "newline";
    }
    return "submit";
  }

  isActive(): boolean {
    return this.active;
  }
}

/**
 * Spawn the terminal event thread: reads stdin bytes, decodes them into
 * `UserEvent`s (keys, mouse, resize, bracketed paste, focus), applies
 * paste-burst coalescing, and pushes events into `sink`. The returned
 * handle stops the thread; stdin ending also stops it and calls
 * `onExit` so the app loop can shut down instead of idling forever
 * with no input source.
 */
export function spawnEventThread(
  sink: EventQueue<UserEvent>,
  isRunning: () => boolean,
  onExit?: () => void,
): { stop(): void } {
  let stopped = false;
  let buf: number[] = [];
  let notify: (() => void) | null = null;
  let pasteBuf: string | null = null;
  const pasteBurst = new PasteBurst();

  const wake = (): void => {
    if (notify !== null) {
      const n = notify;
      notify = null;
      n();
    }
  };

  const onData = (chunk: Buffer): void => {
    for (const b of chunk) buf.push(b);
    wake();
  };
  const onEnd = (): void => {
    stopped = true;
    wake();
  };

  try {
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.resume();
  } catch {
    // Non-TTY stdin: the loop below exits immediately via isRunning.
  }

  const waitForData = (timeoutMs: number): Promise<boolean> =>
    new Promise((resolve) => {
      if (buf.length > 0 || stopped) {
        resolve(true);
        return;
      }
      const timer = setTimeout(() => {
        notify = null;
        resolve(false);
      }, timeoutMs);
      notify = () => {
        clearTimeout(timer);
        notify = null;
        resolve(true);
      };
    });

  // Decode one event from the buffer, or null when more bytes are needed.
  // Returns "incomplete" implicitly via null + a flag on the caller side:
  // callers wait for more data and retry; a lone ESC at end of input is
  // only emitted once the buffer has been quiet for a full poll window.
  const decodeOne = (): UserEvent | "need_more" | null => {
    if (buf.length === 0) return null;
    const b0 = buf[0];
    // Bracketed paste content accumulates until the closing sequence.
    if (pasteBuf !== null) {
      const text = Buffer.from(buf).toString("utf8");
      const endIdx = text.indexOf("\x1b[201~");
      if (endIdx >= 0) {
        const content = pasteBuf + text.slice(0, endIdx);
        buf = [...Buffer.from(text.slice(endIdx + "\x1b[201~".length), "utf8")];
        pasteBuf = null;
        return { type: "paste", data: content };
      }
      pasteBuf += text;
      buf = [];
      return null;
    }
    if (b0 === 0x1b) {
      if (buf.length === 1) return "need_more";
      const b1 = buf[1];
      if (b1 === 0x5b) {
        // CSI sequence: consume up to the final byte.
        let idx = 2;
        while (idx < buf.length) {
          const c = buf[idx];
          if (c >= 0x40 && c <= 0x7e) break;
          idx += 1;
        }
        if (idx >= buf.length) return "need_more";
        const seqParams = Buffer.from(buf.slice(2, idx)).toString("utf8");
        const finalByte = buf[idx];
        buf = buf.slice(idx + 1);
        return decodeCsi(seqParams, finalByte);
      }
      if (b1 === 0x4f) {
        if (buf.length < 3) return "need_more";
        const code = buf[2];
        buf = buf.slice(3);
        switch (code) {
          case 0x48:
            return { type: "key", key: { code: "home", ctrl: false, alt: false, shift: false } };
          case 0x46:
            return { type: "key", key: { code: "end", ctrl: false, alt: false, shift: false } };
          default:
            return null;
        }
      }
      // Alt + char: ESC followed by a printable byte.
      buf = buf.slice(1);
      const ch = String.fromCharCode(b1);
      return { type: "key", key: { code: "char", ch, ctrl: false, alt: true, shift: false } };
    }
    if (b0 === 0x0d) {
      buf = buf.slice(1);
      return { type: "key", key: { code: "enter", ctrl: false, alt: false, shift: false } };
    }
    if (b0 === 0x0a) {
      buf = buf.slice(1);
      return { type: "key", key: { code: "char", ch: "j", ctrl: true, alt: false, shift: false } };
    }
    if (b0 === 0x09) {
      buf = buf.slice(1);
      return { type: "key", key: { code: "tab", ctrl: false, alt: false, shift: false } };
    }
    if (b0 === 0x7f) {
      buf = buf.slice(1);
      return { type: "key", key: { code: "backspace", ctrl: false, alt: false, shift: false } };
    }
    if (b0 >= 1 && b0 <= 26) {
      buf = buf.slice(1);
      const ch = String.fromCharCode(0x60 + b0);
      return { type: "key", key: { code: "char", ch, ctrl: true, alt: false, shift: false } };
    }
    // Printable / UTF-8 char: consume one full code point.
    const text = Buffer.from(buf).toString("utf8");
    if (text === "" || text.startsWith("�")) {
      // Possibly a split multi-byte sequence; wait for more bytes unless
      // the buffer already holds a complete replacement char.
      if (buf.length >= 4) {
        buf = buf.slice(1);
        return null;
      }
      return "need_more";
    }
    const ch = [...text][0];
    const byteLen = Buffer.byteLength(ch);
    buf = buf.slice(byteLen);
    return { type: "key", key: { code: "char", ch, ctrl: false, alt: false, shift: false } };
  };

  const decodeCsi = (params: string, finalByte: number): UserEvent | null => {
    // SGR mouse sequences carry a leading `<` in their params.
    const body = params.startsWith("<") ? params.slice(1) : params;
    const parts = body.split(";");
    const code = parts[0] ?? "";
    const modifier = Number(parts[1] ?? "1");
    const shift = (modifier - 1) % 2 === 1;
    const alt = Math.floor((modifier - 1) / 2) % 2 === 1;
    const ctrl = Math.floor((modifier - 1) / 4) % 2 === 1;
    const key = (c: KeyEvent["code"]): UserEvent => ({
      type: "key",
      key: { code: c, ctrl, alt, shift },
    });
    // Final-byte-only sequences (no numeric params).
    if (finalByte === 0x5a) {
      return { type: "key", key: { code: "tab", ctrl: false, alt: false, shift: true } };
    }
    if (finalByte === 0x49) return { type: "focus_gained" };
    if (finalByte === 0x4f) return { type: "focus_lost" };
    if (finalByte === 0x4d || finalByte === 0x6d) {
      // SGR mouse: params are `button;x;y`.
      const nums = body.split(";").map(Number);
      const button = nums[0] ?? 0;
      const x = (nums[1] ?? 1) - 1;
      const y = (nums[2] ?? 1) - 1;
      const isRelease = finalByte === 0x6d;
      if (button === 64) return { type: "scroll_up" };
      if (button === 65) return { type: "scroll_down" };
      if (isRelease) return { type: "mouse_up", row: y, col: x };
      if ((button & 32) !== 0) return { type: "mouse_drag", row: y, col: x };
      return { type: "mouse_down", row: y, col: x };
    }
    switch (code) {
      case "A":
        return key("up");
      case "B":
        return key("down");
      case "C":
        return key("right");
      case "D":
        return key("left");
      case "H":
        return key("home");
      case "F":
        return key("end");
      case "1":
        return key("home");
      case "2":
        return key("insert");
      case "3":
        return key("delete");
      case "4":
        return key("end");
      case "5":
        return key("pageup");
      case "6":
        return key("pagedown");
      case "11":
        return key("f1");
      case "12":
        return key("f2");
      case "13":
        return key("f3");
      case "14":
        return key("f4");
      case "15":
        return key("f5");
      case "17":
        return key("f6");
      case "18":
        return key("f7");
      case "19":
        return key("f8");
      case "20":
        return key("f9");
      case "21":
        return key("f10");
      case "23":
        return key("f11");
      case "24":
        return key("f12");
      case "200":
        pasteBuf = "";
        return null;
      case "201":
        return null;
      default:
        return null;
    }
  };


  const loop = async (): Promise<void> => {
    while (!stopped && isRunning()) {
      if (buf.length === 0 && pasteBuf === null) {
        const arrived = await waitForData(pasteBurst.waitTimeoutMs());
        if (!arrived) {
          pasteBurst.onTimeout();
          continue;
        }
        if (stopped || !isRunning()) break;
      }
      const decoded = decodeOne();
      if (decoded === null) {
        // Paste accumulation consumed the buffer; wait for more.
        const arrived = await waitForData(pasteBurst.waitTimeoutMs());
        if (!arrived) pasteBurst.onTimeout();
        continue;
      }
      if (decoded === "need_more") {
        const arrived = await waitForData(PASTE_BURST_WINDOW_MS);
        if (!arrived) {
          // Lone ESC (or a truncated sequence): emit Esc for a bare ESC.
          if (buf.length === 1 && buf[0] === 0x1b) {
            buf = [];
            sink.push({
              type: "key",
              key: { code: "esc", ctrl: false, alt: false, shift: false },
            });
          } else if (buf.length > 0) {
            // Drop the undecodable bytes rather than spinning on them.
            buf = [];
          }
        }
        continue;
      }
      if (decoded.type === "key" && isPasteNewlineKey(decoded.key)) {
        const pending = pasteBurst.isActive() || buf.length > 0;
        let morePending = pending;
        if (!pending) {
          // Peek one burst window ahead for queued input.
          morePending = await waitForData(PASTE_BURST_WINDOW_MS);
          if (stopped || !isRunning()) break;
        }
        if (pasteBurst.onEnter(morePending) === "newline") {
          sink.push({ type: "paste", data: "\n" });
        } else {
          sink.push(decoded);
        }
        continue;
      }
      sink.push(decoded);
    }
    try {
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
    } catch {
      // Listener removal is best effort.
    }
    onExit?.();
  };
  void loop();

  return {
    stop(): void {
      stopped = true;
      wake();
    },
  };
}

/** Lazily initialise the MCP client manager (connects only on first use). Wiring point: the MCP slice owns connection; until it lands this returns the existing manager (or null when no servers are configured). */
export async function ensureMcpManager(
  mcp: unknown | null,
  cfg: { mcpServers?: Record<string, unknown> },
): Promise<unknown | null> {
  if (mcp !== null) return mcp;
  const servers = cfg.mcpServers ?? {};
  if (Object.keys(servers).length === 0) return null;
  return null;
}

/** What to do with a submitted line, given whether a main run is already active. Pure decision, unit-testable without a TUI/agent. */
export type SubmitAction = "run" | "queue" | "reject_while_running" | "ignore";

/**
 * Commands that are safe to run *even while a main run is active* because
 * they don't spawn or mutate the main run — the single "bypass"
 * whitelist: `/queue` (queue management) and `/btw` (isolated, tool-less
 * side question on its own event stream).
 */
export function allowedWhileRunning(text: string): boolean {
  const t = text.trimStart();
  return (
    t === "/queue" || t.startsWith("/queue ") || t === "/btw" || t.startsWith("/btw ")
  );
}

/** Build the rewind picker's list of (message_index, preview) for every user turn in the conversation, oldest first. Only user turns are offered. */
export function rewindTargets(session: Session): [number, string][] {
  return session.messages
    .map((m, idx) => ({ m, idx }))
    .filter(({ m }) => m.role === "user")
    .map(({ m, idx }) => {
      const preview = [...m.content].slice(0, 80).join("").replace(/\n/g, " ");
      return [idx, preview] as [number, string];
    });
}

export function classifySubmission(isRunning: boolean, text: string): SubmitAction {
  // Idle, or a whitelisted parallel-safe command → let it through to its
  // handler. Everything else, while running, is gated.
  if (!isRunning || allowedWhileRunning(text)) return "run";
  const t = text.trimStart();
  if (t === "") return "ignore";
  if (t.startsWith("/") || t.startsWith(".") || t.startsWith("!")) {
    return "reject_while_running";
  }
  return "queue";
}

/** Result of a background agent prebuild. */
export type PrebuildPayload = AnyAgent;

/**
 * If the background prebuild hasn't delivered yet, block until it does.
 * `getPrebuilt` resolves the prebuild promise owned by the app loop.
 */
export async function resolvePrebuild(
  run: AgentRunState,
  getPrebuilt: () => Promise<AnyAgent | null>,
): Promise<void> {
  if (run.agent !== null) return;
  const agent = await getPrebuilt();
  if (agent !== null) run.agent = agent;
}

/**
 * Starts a single main agent run for `text` and records its abort handle.
 * The ONLY place that sets `agentRx`/`isRunning` for user-driven runs, so
 * the "at most one main run" invariant is enforced in one spot. Callers
 * must ensure no run is already active (otherwise the previous one would
 * be orphaned).
 */
export async function startMainRun(
  text: string,
  run: AgentRunState,
  ui: UiContext,
  slash: SlashState,
): Promise<void> {
  await ensureAgent(run, ui, slash.reasoningEnabled);
  const history = ui.convertHistory(ui.session);
  if (run.agent === null) return;
  const runner = await run.agent.spawnRunner(text, history, ui.cfg.retry);
  run.agentRx = runner.events;
  run.mainAbort = runner.abortHandle;
  run.isRunning = true;
  ui.statusSignals?.sendStart();
  ui.session.addMessage("user", text);
  // Mark this message as the rollback target if the turn fails (see the
  // failed-send handling in the main event loop).
  run.pendingSend = text;
  try {
    await ui.saveSessionIfEnabled();
  } catch {
    // Persistence failure is reported by the session slice's own logging;
    // a failed save must not abort the run.
  }
}

/** Continuation prompt injected after a mid-turn compaction. Hardcoded rather than a prompts file: every `.md` under `prompts/` is loaded as a selectable mode, so a file here would pollute the prompt picker. */
export const MID_TURN_CONTINUE_PROMPT =
  "[Context was compacted to save space; the full prior history is in the system summary above.]\n\nContinue with the user's original task. Do not redo work already completed per the summary; focus on what remains. Context was tight, so prefer narrower follow-up tool calls over wide ones until pressure subsides.";

/**
 * Mid-turn auto-compaction. Invoked when real provider prompt pressure
 * crosses `mid_turn_compact_threshold`, and only when `compact_enabled`
 * is true. The in-flight run is aborted at the completion-call boundary,
 * progress is recorded as a recap message, the session is compacted, and
 * the agent is respawned on the compacted history with a continuation
 * prompt.
 */
export async function midTurnCompactAndRespawn(
  pressure: number,
  renderer: Renderer,
  run: AgentRunState,
  ui: UiContext,
  slash: SlashState,
): Promise<void> {
  // 1. Stop the in-flight run.
  run.mainAbort?.abort();
  run.mainAbort = null;
  run.isRunning = false;
  run.agentRx = null;
  run.wasReasoning = false;
  // The aborted run's in-flight calls never get their results; the
  // respawn below reuses this state, so a stranded entry would be paired
  // with the new turn's first call.
  run.clearPendingToolCalls();

  // 2. Record progress so far.
  let recap = "";
  if (run.responseBuf.trim() !== "") {
    recap += `${run.responseBuf.trim()}\n\n`;
  }
  if (run.turnTrace.length > 0) {
    recap += "[Progress this turn before context compaction]\n";
    for (const line of run.turnTrace) recap += `${line}\n`;
  }
  recap = recap.trim();
  if (recap !== "") {
    ui.session.addMessage("assistant", recap);
  }
  run.turnTrace = [];
  run.responseBuf = "";
  run.responseStartBlock = null;
  run.agentLineStarted = false;

  // Unlike the between-turn gate, this announces unconditionally: the
  // relief here is dropping the aborted run's in-flight tool context via
  // the respawn below, which always happens even when the compress step
  // is a no-op.
  renderer.writeLine(
    `mid-turn context relief, restarting (at ${Math.round(pressure * 100)}%)...`,
    "dark_grey",
  );

  // 3. Compact the session (no-op if its text history is under the limit).
  try {
    await ui.handleCompress(null, true, run.agent, slash.reasoningEnabled);
  } catch (e) {
    renderer.writeLine(
      `mid-turn compact error: ${e instanceof Error ? e.message : String(e)}`,
      C_ERROR,
    );
  }

  // 4. Respawn on the compacted history with the continuation prompt.
  await ensureAgent(run, ui, slash.reasoningEnabled);
  const history = ui.convertHistory(ui.session);
  if (run.agent === null) return;
  const runner = await run.agent.spawnRunner(MID_TURN_CONTINUE_PROMPT, history, ui.cfg.retry);
  run.agentRx = runner.events;
  run.mainAbort = runner.abortHandle;
  run.isRunning = true;
  ui.statusSignals?.sendStart();
}

/**
 * Hard stop for a turn whose context cannot be brought under the mid-turn
 * ceiling even after a compaction. Aborts the run and shows the user the
 * full arithmetic — the model and context-window combination is simply
 * too small to run the agentic loop on this task.
 */
export function stopTurnContextExhausted(
  promptTokens: number,
  threshold: number,
  renderer: Renderer,
  ui: UiContext,
  run: AgentRunState,
): void {
  run.mainAbort?.abort();
  run.mainAbort = null;
  run.isRunning = false;
  run.agentRx = null;
  run.wasReasoning = false;
  run.agentLineStarted = false;
  run.turnTrace = [];
  run.responseBuf = "";
  run.responseStartBlock = null;
  run.clearPendingToolCalls();
  ui.statusSignals?.sendStop();

  renderer.writeLine("error: not enough context to continue this turn.", C_ERROR);
  renderer.writeLine(
    "Compaction ran, but the next prompt was still over the mid-turn ceiling. Compacting again cannot help: what remains is the irreducible floor (system prompt, tool schemas, the kept-recent transcript, and reserved response space). Stopping the turn so the conversation is not corrupted.",
    "white",
  );
  renderer.writeLine("", "white");
  const reserve = resolveReserveTokens(ui.cfg, ui.session.model);
  const keepRecent = resolveKeepRecentTokens(ui.cfg);
  for (const line of contextExhaustedReport(
    promptTokens,
    threshold,
    ui.session.contextWindow,
    reserve,
    keepRecent,
  )) {
    renderer.writeLine(line, "white");
  }
}

import {
  resolveKeepRecentTokens,
  resolveReserveTokens,
} from "./state.ts";

/** Builds the math-and-guidance body for a context-exhaustion stop. Pure (no I/O) so the arithmetic can be unit-tested. */
export function contextExhaustedReport(
  promptTokens: number,
  threshold: number,
  window: number,
  reserve: number,
  keepRecent: number,
): string[] {
  const ceiling = Math.floor(threshold * window);
  const pressurePct = window === 0 ? 0 : (promptTokens / window) * 100;
  const overflow = Math.max(0, promptTokens - ceiling);
  return [
    `  context window .............. ${window} tokens`,
    `  mid-turn ceiling ............ ${ceiling} tokens  (${(threshold * 100).toFixed(0)}% of window)`,
    `  prompt after compaction ..... ${promptTokens} tokens  (${pressurePct.toFixed(0)}% of window)`,
    `  overflow above ceiling ...... ${overflow} tokens`,
    `  reserved for response ....... ${reserve} tokens`,
    `  kept-recent budget .......... ${keepRecent} tokens`,
    "",
    "This model and context-window combination is too small to run tiny-crow's agentic loop on this task. To proceed you can:",
    "  - increase context_window (and the model server's real KV cache) so the window clears the floor above;",
    `  - raise mid_turn_compact_threshold above ${pressurePct.toFixed(0)}% so this prompt fits under the ceiling (trades safety for room: the real KV cache must still hold ${promptTokens}+ tokens);`,
    "  - lower keep_recent_tokens or reserve_tokens to shrink the floor;",
    "  - switch to a model/server with a larger context window, or split the task into smaller pieces.",
  ];
}

/** Starts a single main agent run for a worktree merge request and records the return path. The agent must NOT delete the worktree or the branch itself: cleanup is conditional on verification in `resolveAgentMergeOutcome`. */
export async function spawnMergeAgent(
  req: MergeRequest,
  run: AgentRunState,
  ui: UiContext,
  chain: ChainState,
): Promise<void> {
  const prompt =
    `I'm in a git worktree on branch '${req.branch}' at '${req.wtPath}'. Merge it into '${req.target}' in the main repo at '${req.mainPath}'.\n\n` +
    `Follow these steps:\n` +
    `1. cd ${req.mainPath}\n` +
    `2. git fetch --all\n` +
    `3. git checkout ${req.target}\n` +
    `4. git pull --ff-only (if this fails because the branch has no upstream, continue with the local branch)\n` +
    `5. git merge --squash ${req.branch}\n` +
    `6. git commit --no-edit (if this says 'nothing to commit', the branch was already fully merged — treat it as success)\n\n` +
    `After step 5, CHECK THE EXIT CODE and output.\n` +
    `- If the merge Succeeded (no conflicts), continue to step 6.\n` +
    `- If there is a MERGE CONFLICT:\n` +
    `  a. Run: git diff --name-only --diff-filter=U\n` +
    `  b. Tell the user WHICH FILES have conflicts. Show them the list.\n` +
    `  c. Ask the user what to do. Give them these options:\n` +
    `     - 'abort': run \`git merge --abort\` (or \`git reset --merge\` for squash merges), do NOT delete anything, stop here.\n` +
    `     - 'resolve <file>': you help them fix the conflict in that file.\n` +
    `     - 'leave': leave the conflict state as-is for manual resolution.\n` +
    `  d. WAIT for the user's response before continuing.\n` +
    `  e. Follow their instruction.\n\n` +
    `7. If the merge succeeded (or conflicts were resolved and committed):\n` +
    `  - cd ${req.mainPath} and report completion.\n` +
    `  - Do NOT run \`git worktree remove\` or \`git branch -d\`: tiny-crow verifies the merge and cleans up itself.\n\n` +
    `Important: Do NOT skip any step. Always check for conflicts after merge.`;
  ui.session.addMessage("user", prompt);
  const history = ui.convertHistory(ui.session);
  const reasoningEnabled = ui.session.reasoningEnabled;
  await ensureAgent(run, ui, reasoningEnabled);
  if (run.agent === null) return;
  const runner = await run.agent.spawnRunner(prompt, history, ui.cfg.retry);
  run.agentRx = runner.events;
  run.mainAbort = runner.abortHandle;
  run.isRunning = true;
  ui.statusSignals?.sendStart();
  chain.wtReturnPath = {
    mainPath: req.mainPath,
    wtPath: req.wtPath,
    branch: req.branch,
    target: req.target,
    force: req.force,
  };
}

/** Handoff request from the advisor feature: the model asks the user a question and waits for a typed answer. */
export interface HandoffRequest {
  question: string;
  reply: { send(response: string): void };
}

/**
 * Handle a human handoff: show the question, read typed input until
 * Enter (Esc cancels), and deliver the answer. Each keystroke redraws
 * the `> buffer` line, mirroring the Rust handler.
 */
export async function handleHumanHandoff(
  req: HandoffRequest,
  renderer: Renderer,
  userEvents: EventQueue<UserEvent>,
  run: AgentRunState,
): Promise<void> {
  run.wasReasoning = false;
  if (run.agentLineStarted) {
    renderer.writeLine("", "white");
    run.agentLineStarted = false;
  }

  renderer.writeLine("[handoff] Model requests your guidance:", "green");
  for (const line of req.question.split("\n")) {
    renderer.writeLine(`  | ${sanitizeOutputLine(line)}`, "green");
  }
  renderer.writeLine("", "green");
  renderer.writeLine("  Type your response and press Enter (ESC to cancel):", "green");

  let buffer = "";
  let response = "";
  let cancelled = false;
  for (;;) {
    const ev = await userEvents.next();
    if (ev === null) {
      cancelled = true;
      break;
    }
    if (ev.type !== "key") continue;
    if (ev.key.code === "enter") break;
    if (ev.key.code === "esc") {
      cancelled = true;
      break;
    }
    if (ev.key.code === "char" && ev.key.ch !== undefined && !ev.key.ctrl) {
      buffer += ev.key.ch;
      renderer.writeLine(`  > ${buffer}`, "green");
    } else if (ev.key.code === "backspace") {
      buffer = [...buffer].slice(0, -1).join("");
      renderer.writeLine(`  > ${buffer}`, "green");
    }
  }
  response = cancelled ? "" : buffer;

  if (response === "") {
    renderer.writeLine("  [cancelled]", "green");
  } else {
    renderer.writeLine(`  [sent: ${response}]`, "green");
  }
  renderer.writeLine("", "white");

  req.reply.send(response);
}

import { sanitizeOutput as sanitizeOutputLine } from "./events.ts";

/** Run the interactive TUI: build the app, run its loop, then tear the terminal down. */
export async function runInteractive(
  ui: UiContext,
  agent: AnyAgent | null,
  askEvents: EventQueue<AskRequest> | null,
  autoTriggerMsg: string | null,
): Promise<void> {
  const app = await App.create({
    ui,
    agent,
    askEvents,
    autoTriggerMsg,
  });
  await app.run();
  await app.teardown();
}
