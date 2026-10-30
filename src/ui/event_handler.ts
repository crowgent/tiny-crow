import { spawnSync } from "node:child_process";
import { BlockStyle } from "./feed.ts";
import type { Renderer } from "./renderer.ts";
import { C_ERROR, C_TOOL } from "./roles.ts";
import {
  billableInputTokens,
  configIsAnthropicNative,
  estimateCost,
  realInputTokens,
  resolveCompactEnabled,
  resolveReserveTokens,
  resolveShowToolDetails,
  type AgentEvent,
  type AgentRunState,
  type ChainState,
  type SlashState,
  type TurnUsage,
  type UiContext,
} from "./state.ts";
import { renderSession, sanitizeOutput } from "./events.ts";
import { formatToolCallSummary } from "./utils.ts";

/** A todo-list item as rendered after a `todo_write` tool result. The todo tool slice owns the live list; this is the shape it reports. */
export interface TodoItem {
  status: string;
  priority: string;
  content: string;
}

/**
 * The live todo list, mirroring the Rust `TODO_LIST` global. The agent
 * slice's todo tool writes to it; the event handler only reads it to
 * render the `todo_write` summary. Wiring point: the todo tool should
 * import and mutate this same instance.
 */
export const TODO_LIST: TodoItem[] = [];

/** Build the main agent on first use, lazily connecting MCP as well. Callers only reach the build when `agent` is null, so the client connects at most once. */
export async function ensureAgent(
  run: AgentRunState,
  ui: UiContext,
  reasoningEnabled: boolean,
): Promise<void> {
  if (run.agent !== null) return;
  run.agent = await ui.agentBuildCtx().rebuildAgent(ui.session.model, reasoningEnabled);
  // Keep the pre-calibration context estimate in sync with the preamble
  // just built (system prompt + tools + context files).
  ui.session.overheadTokens = estimateOverhead(ui, reasoningEnabled);
}

/**
 * Pre-calibration context estimate for the fixed request overhead
 * (system prompt + tools + context files). The agent slice owns the real
 * estimator; this local estimate counts the loaded context text so the
 * meter is sane before the first provider calibration lands.
 */
export function estimateOverhead(ui: UiContext, reasoningEnabled: boolean): number {
  void reasoningEnabled;
  let text = "";
  if (ui.context.agents !== undefined) text += ui.context.agents;
  if (ui.context.architecture !== undefined) text += ui.context.architecture;
  if (ui.context.currentPrompt !== undefined) text += ui.context.currentPrompt;
  if (text === "") return 0;
  return Math.max(1, Math.floor(text.length / 4));
}

/** Handle one agent event: stream tokens, tool calls/results, retries, usage accounting, and turn completion. */
export async function handleAgentEvent(
  event: AgentEvent,
  renderer: Renderer,
  run: AgentRunState,
  ui: UiContext,
  slash: SlashState,
  chain: ChainState,
): Promise<void> {
  switch (event.type) {
    case "reasoning": {
      if (!slash.showReasoning) return;
      if (!run.agentLineStarted) {
        renderer.write("< ", "dark_magenta");
        run.agentLineStarted = true;
      }
      renderer.write(sanitizeOutput(event.text), "dark_magenta");
      run.wasReasoning = true;
      return;
    }
    case "token": {
      if (run.wasReasoning) {
        renderer.writeLine("", "white");
        run.agentLineStarted = false;
        run.wasReasoning = false;
        run.responseBuf = "";
        run.responseStartBlock = null;
      }
      const safe = sanitizeOutput(event.text);
      run.responseBuf += safe;
      if (run.responseBuf === "") return;
      if (run.responseStartBlock === null) {
        renderer.feedMut().pushStreamingBlock(BlockStyle.Agent);
        run.responseStartBlock = renderer.feed().blockCount() - 1;
      }
      renderer.feedMut().appendToLast(safe);
      // Throttle repaints: redraw when a line completed (markdown
      // structure changes at line boundaries) or while the buffer is
      // small. The final full parse happens in handleAgentDone.
      if (run.responseBuf.length >= 200 && !run.responseBuf.endsWith("\n")) return;
      renderer.renderViewport();
      run.agentLineStarted = true;
      return;
    }
    case "tool_call": {
      run.wasReasoning = false;
      if (run.agentLineStarted) {
        renderer.writeLine("", "white");
        run.agentLineStarted = false;
      }
      run.responseBuf = "";
      run.responseStartBlock = null;
      const callId = ui.session.addToolCall(event.name, event.args);
      run.pushPendingToolCall(event.callId, callId);
      await saveSessionIfEnabled(ui.session, ui, renderer);
      const line = `◈ ${formatToolCallSummary(event.name, event.args)}`;
      renderer.writeLine(sanitizeOutput(line), C_TOOL);
      return;
    }
    case "subagent_tool_call": {
      ui.session.addSubagentToolCall(run.newestPendingToolCall(), event.name, event.args);
      await saveSessionIfEnabled(ui.session, ui, renderer);
      const line = `⌥ ${formatToolCallSummary(event.name, event.args)}`;
      renderer.writeLine(sanitizeOutput(line), C_TOOL);
      return;
    }
    case "tool_result": {
      const callId = resolveToolResultCallId(run, ui.session, event.callId, event.name);
      ui.session.addToolResult(callId, event.name, event.output);
      await saveSessionIfEnabled(ui.session, ui, renderer);
      if (event.name === "todo_write") {
        if (TODO_LIST.length === 0) {
          renderer.writeLine("tasks cleared", "dark_grey");
        } else {
          const total = TODO_LIST.length;
          const completed = TODO_LIST.filter((t) => t.status === "completed").length;
          renderer.writeLine(`tasks  ${completed} done / ${total} total`, C_TOOL);
          for (const item of TODO_LIST) {
            const icon =
              item.status === "completed"
                ? "[x]"
                : item.status === "in_progress"
                  ? "[>]"
                  : item.status === "cancelled"
                    ? "[-]"
                    : "[ ]";
            const statusColor =
              item.status === "completed"
                ? "green"
                : item.status === "in_progress"
                  ? C_TOOL
                  : "dark_grey";
            const priorityMark =
              item.priority === "high" ? "!!" : item.priority === "medium" ? "! " : "  ";
            renderer.writeLine(`  ${icon} ${priorityMark} ${item.content}`, statusColor);
          }
        }
      } else {
        writeToolResultSummary(renderer, event.output, ui);
      }
      return;
    }
    case "done": {
      await handleAgentDone(
        event.response,
        {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cachedInputTokens: event.cachedInputTokens,
          cacheCreationInputTokens: event.cacheCreationInputTokens,
        },
        renderer,
        run,
        ui,
        chain,
      );
      return;
    }
    case "completion_call": {
      const anthropic = configIsAnthropicNative(ui.cfg, ui.session.provider, ui.session.model);
      const real =
        realInputTokens(
          anthropic,
          event.inputTokens,
          event.cachedInputTokens,
          event.cacheCreationInputTokens,
        ) + event.outputTokens;
      if (real > ui.session.totalEstimatedTokens) ui.session.totalEstimatedTokens = real;
      ui.session.totalInputTokens += event.inputTokens;
      ui.session.totalOutputTokens += event.outputTokens;
      ui.session.totalCost += estimateCost(
        billableInputTokens(
          anthropic,
          event.inputTokens,
          event.cachedInputTokens,
          event.cacheCreationInputTokens,
        ),
        event.outputTokens,
        ui.session.inputTokenCost,
        ui.session.outputTokenCost,
      );
      return;
    }
    case "retrying": {
      run.wasReasoning = false;
      if (run.agentLineStarted) {
        renderer.writeLine("", "white");
        run.agentLineStarted = false;
      }
      run.responseBuf = "";
      run.responseStartBlock = null;
      renderer.writeLine(`retrying... (${event.attempt}/${event.max})`, "yellow");
      return;
    }
    case "error": {
      run.wasReasoning = false;
      const safe = sanitizeOutput(event.message);
      renderer.writeLine(`error: ${safe}`, C_ERROR);
      run.isRunning = false;
      ui.statusSignals?.sendStop();
      run.agentRx = null;
      run.agentLineStarted = false;
      run.responseBuf = "";
      run.responseStartBlock = null;
      // A mid-stream error strands whatever was in flight.
      run.clearPendingToolCalls();
      await saveSessionIfEnabled(ui.session, ui, renderer);
      return;
    }
  }
}

function writeToolResultSummary(renderer: Renderer, output: string, ui: UiContext): void {
  const details = resolveShowToolDetails(ui.cfg.showToolDetails);
  switch (details.kind) {
    case "off":
      break;
    case "limited": {
      const sanitized = sanitizeOutput(output);
      const charCount = [...sanitized].length;
      const lines = sanitized.split("\n");
      if (lines.length > details.maxLines) {
        const shown = lines.slice(0, details.maxLines).join("\n");
        renderer.writeLine(
          `◈ result (${charCount} chars, ${lines.length} lines, showing ${details.maxLines}):\n${shown}`,
          "dark_grey",
        );
      } else {
        renderer.writeLine(`◈ result (${charCount} chars):\n${sanitized}`, "dark_grey");
      }
      break;
    }
    case "unlimited": {
      const sanitized = sanitizeOutput(output);
      const charCount = [...sanitized].length;
      renderer.writeLine(`◈ result (${charCount} chars):\n${sanitized}`, "dark_grey");
      break;
    }
  }
}

/**
 * Session call id a `ToolResult` event's output belongs to. Normally the
 * matching `ToolCall` event left a pending entry. A result can also arrive
 * for a call that never produced a `ToolCall` stream item, so an unmatched
 * result must not be linked to call id 0 (a real call): a call is
 * synthesized for it instead, keeping the recorded pair self-consistent.
 */
export function resolveToolResultCallId(
  run: AgentRunState,
  session: import("./state.ts").Session,
  id: string,
  name: string,
): number {
  const pending = run.takePendingToolCall(id);
  if (pending !== null) return pending;
  return session.addToolCall(name, null);
}

async function saveSessionIfEnabled(
  session: import("./state.ts").Session,
  ui: UiContext,
  renderer: Renderer,
): Promise<void> {
  if (!ui.cli.noSession && ui.saveSession !== null) {
    try {
      await ui.saveSession(session);
    } catch (e) {
      renderer.writeLine(
        `warning: failed to save session: ${e instanceof Error ? e.message : String(e)}`,
        C_ERROR,
      );
    }
  }
}

async function handleAgentDone(
  response: string,
  usage: TurnUsage,
  renderer: Renderer,
  run: AgentRunState,
  ui: UiContext,
  chain: ChainState,
): Promise<void> {
  run.wasReasoning = false;

  if (run.responseBuf !== "") {
    if (run.responseStartBlock !== null) {
      // Drop anything interleaved after the streaming block, then
      // finalize it: the full response (including the last line) is
      // parsed as markdown once, here.
      renderer.feedMut().truncateBlocks(run.responseStartBlock + 1);
      renderer.feedMut().finalizeLast();
    } else {
      renderer.feedMut().pushBlock(BlockStyle.Agent, run.responseBuf);
    }
    renderer.renderViewport();
  } else if (!run.agentLineStarted) {
    renderer.feedMut().pushLine(BlockStyle.Agent, "< ");
  }

  renderer.writeLine("", "white");
  renderer.writeLine("", "white");
  ui.session.addMessage("assistant", response);
  ui.session.totalInputTokens += usage.inputTokens;
  ui.session.totalOutputTokens += usage.outputTokens;
  const anthropic = configIsAnthropicNative(ui.cfg, ui.session.provider, ui.session.model);
  ui.session.totalCost += estimateCost(
    billableInputTokens(
      anthropic,
      usage.inputTokens,
      usage.cachedInputTokens,
      usage.cacheCreationInputTokens,
    ),
    usage.outputTokens,
    ui.session.inputTokenCost,
    ui.session.outputTokenCost,
  );
  // Anchor context-size accounting to the provider's real usage; the
  // cache-inclusive count must come after addMessage so the anchor
  // includes the just-appended response.
  const contextInputTokens = realInputTokens(
    anthropic,
    usage.inputTokens,
    usage.cachedInputTokens,
    usage.cacheCreationInputTokens,
  );
  ui.session.setCalibration(contextInputTokens, usage.outputTokens);
  run.agentLineStarted = false;
  run.responseBuf = "";
  run.responseStartBlock = null;

  const loopRunning = chain.loopState !== null && chain.loopState.active;
  const reserve = resolveReserveTokens(ui.cfg, ui.session.model);

  if (
    !loopRunning &&
    resolveCompactEnabled(ui.cfg) &&
    ui.session.needsCompaction(reserve) &&
    !ui.cli.noSession
  ) {
    try {
      await ui.handleCompress(null, true, run.agent, true);
    } catch (e) {
      renderer.writeLine(
        `auto-compact error: ${e instanceof Error ? e.message : String(e)}`,
        C_ERROR,
      );
    }
  }

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
  run.isRunning = false;
  ui.statusSignals?.sendStop();
  run.agentRx = null;
  // A clean turn has consumed every entry already; this covers a turn
  // that ended with calls still open, and must precede the loop respawn
  // below so the next iteration starts empty.
  run.clearPendingToolCalls();

  if (chain.loopState !== null && chain.loopState.active) {
    const ls = chain.loopState;
    const summary = [...response].slice(0, 500).join("");
    ls.lastSummary = summary;
    let validationOutput: string | null = null;
    if (ls.runCmd !== undefined) {
      try {
        const out = spawnSync("sh", ["-c", ls.runCmd], { encoding: "utf8" });
        const stdout = out.stdout ?? "";
        const stderr = out.stderr ?? "";
        validationOutput = stderr === "" ? stdout : `${stdout}\n${stderr}`;
      } catch (e) {
        validationOutput = `error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    ls.lastRunOutput = validationOutput ?? undefined;
    ls.iteration += 1;
    if (ls.shouldStop()) {
      renderer.writeLine(`[loop] max iterations (${ls.iteration - 1}) reached, stopping`, "white");
      ls.active = false;
      chain.loopLabel = null;
    } else {
      const prompt = ls.buildPrompt();
      run.agent = await ui.agentBuildCtx().rebuildAgent(ui.session.model, true);
      const runner = await run.agent.spawnRunner(prompt, [], ui.cfg.retry);
      run.agentRx = runner.events;
      run.mainAbort = runner.abortHandle;
      run.isRunning = true;
      ui.statusSignals?.sendStart();
      chain.loopLabel = ls.iterationLabel();
      renderer.writeLine(`[loop] launching ${ls.iterationLabel()}`, "white");
    }
  }

  if (chain.wtReturnPath !== null) {
    const ret = chain.wtReturnPath;
    chain.wtReturnPath = null;
    const outcomeMsg = resolveAgentMergeOutcome(ret);
    try {
      process.chdir(ret.mainPath);
      ui.session.workingDir = ret.mainPath;
      ui.context.reload();
      run.agent = await ui.agentBuildCtx().rebuildAgent(ui.session.model, true);
      renderSession(renderer, ui.session, ui.cli, ui.cfg, ui.context);
      renderer.writeLine(outcomeMsg, "white");
    } catch (e) {
      renderer.writeLine(
        `warning: failed to change back to main repo: ${e instanceof Error ? e.message : String(e)}`,
        C_ERROR,
      );
    }
  }
}

/**
 * Shared tail of the merge-agent completion path: decide, from the
 * on-disk state, whether the agent actually merged, and only then clean
 * up. Returns the message to show the user. Cleanup (worktree remove +
 * branch delete) runs only after verification confirms the branch
 * content landed in the target — never on abort or failure.
 */
export function resolveAgentMergeOutcome(ret: import("./state.ts").WtReturn): string {
  const status = verifyBranchMerged(ret.mainPath, ret.target, ret.branch);
  if (status.kind === "merged") {
    cleanupWorktree(ret.wtPath, ret.branch, ret.mainPath, ret.force);
    return `merged '${ret.branch}' into '${ret.target}' and cleaned up; returned to main repo at ${ret.mainPath}`;
  }
  if (status.kind === "conflicts") {
    let msg = `merge has conflicts in ${status.files.length} file(s); worktree kept at ${ret.wtPath}:`;
    for (const f of status.files) msg += `\n  ${f}`;
    return msg;
  }
  return `agent run finished but '${ret.branch}' is not merged into '${ret.target}' (${status.reason}); worktree kept at ${ret.wtPath} for manual handling`;
}

export type AgentMergeStatus =
  | { kind: "merged" }
  | { kind: "conflicts"; files: string[] }
  | { kind: "not_merged"; reason: string };

/** Whether `branch` is fully merged into `target` in the repo at `mainPath`. */
export function verifyBranchMerged(
  mainPath: string,
  target: string,
  branch: string,
): AgentMergeStatus {
  const ancestor = spawnSync("git", ["-C", mainPath, "merge-base", "--is-ancestor", branch, target], {
    encoding: "utf8",
  });
  if (ancestor.status === 0) return { kind: "merged" };
  const unmerged = spawnSync("git", ["-C", mainPath, "ls-files", "-u"], { encoding: "utf8" });
  const files = [...new Set((unmerged.stdout ?? "").split("\n").filter((l) => l !== "").map((l) => {
    const parts = l.split("\t");
    return parts[parts.length - 1] ?? l;
  }))];
  if (files.length > 0) return { kind: "conflicts", files };
  return { kind: "not_merged", reason: "branch is not an ancestor of the target" };
}

/** Remove a worktree and delete its branch (forced when `force` is set). */
export function cleanupWorktree(
  wtPath: string,
  branch: string,
  mainPath: string,
  force: boolean,
): void {
  const wtArgs = force ? ["worktree", "remove", "--force", wtPath] : ["worktree", "remove", wtPath];
  spawnSync("git", ["-C", mainPath, ...wtArgs], { encoding: "utf8" });
  spawnSync("git", ["-C", mainPath, "branch", force ? "-D" : "-d", branch], { encoding: "utf8" });
}


