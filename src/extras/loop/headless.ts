// Headless loop runner: iterate prompt -> agent -> validation -> transcript.
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { LoopState, DEFAULT_PLAN_FILENAME, SUMMARY_TRUNCATION_CHARS } from "./mod.ts";
import { handleStartup } from "./plan.ts";
import { saveIteration } from "./transcript.ts";
import type { StatusSignals } from "../status_signals.ts";

/** Agent surface the loop needs (agent slice's printable agent). */
export interface LoopAgent {
  /** Run one iteration prompt and return the final response text. */
  runPrint(prompt: string): Promise<string>;
}

export interface HeadlessLoopOptions {
  /** Explicit loop prompt; falls back to `message` when absent. */
  loopPrompt?: string;
  /** Free-form message used as the prompt when `loopPrompt` is absent. */
  message?: string;
  planFile?: string;
  maxIterations?: number | null;
  runCmd?: string | null;
  statusSignals?: StatusSignals | null;
  /** Skip the interactive existing-plan prompt (used by non-interactive callers). */
  startupAnswer?: string;
  /** Transcript base dir override (tests). */
  transcriptBaseDir?: string;
  /** Called after each completed iteration (observability hook). */
  onIteration?: (iteration: number, response: string) => void;
}

function runShell(cmd: string): Promise<string> {
  return new Promise((resolve) => {
    execFile("sh", ["-c", cmd], { encoding: "utf8" }, (err, stdout, stderr) => {
      if (err && !stdout && !stderr) {
        resolve(`error: ${err.message}`);
        return;
      }
      const out = stdout ?? "";
      const errText = stderr ?? "";
      resolve(errText === "" ? out : `${out}\n${errText}`);
    });
  });
}

/**
 * Run the headless loop until `maxIterations` is reached, the agent
 * errors, or the caller stops the process. Each iteration builds its
 * prompt from the plan file + previous summary + validation output,
 * runs the agent, optionally runs the validation command, and saves a
 * transcript record. Note: like the Rust loop, history is threaded only
 * through plan/summary state folded into the prompt, not a live session.
 */
export async function runHeadlessLoop(
  agent: LoopAgent,
  options: HeadlessLoopOptions,
): Promise<void> {
  const prompt = options.loopPrompt ?? options.message ?? null;
  if (prompt === null || prompt === "") {
    throw new Error("No loop prompt. Use --loop-prompt or pass a message.");
  }
  const planFile = options.planFile ?? DEFAULT_PLAN_FILENAME;
  const maxIterations = options.maxIterations ?? null;
  const runCmd = options.runCmd ?? null;
  const sessionId = randomUUID();

  await handleStartup(planFile, options.startupAnswer);

  const state = LoopState.new(prompt, planFile, maxIterations, runCmd);

  for (;;) {
    state.iteration += 1;
    if (state.shouldStop()) {
      console.error(`[loop] max iterations (${state.maxIterations ?? 0}) reached, stopping`);
      break;
    }
    const iterationPrompt = state.buildPrompt();
    console.error(`=== ${state.iterationLabel()} ===`);
    console.error();

    options.statusSignals?.sendStart();
    let response: string;
    try {
      response = await agent.runPrint(iterationPrompt);
    } catch (err) {
      options.statusSignals?.sendStop();
      console.error(`[loop] error in iteration ${state.iteration}: ${err}`);
      break;
    }
    options.statusSignals?.sendStop();

    const summary = [...response].slice(0, SUMMARY_TRUNCATION_CHARS).join("");
    state.lastSummary = summary;

    let validationOutput: string | null = null;
    if (state.runCmd) {
      const cmd = state.runCmd;
      console.error(`--- Validation: ${cmd} ---`);
      const combined = await runShell(cmd);
      console.error(combined);
      validationOutput = combined;
    }
    state.lastRunOutput = validationOutput;

    try {
      saveIteration(
        sessionId,
        state.iteration,
        iterationPrompt,
        response,
        validationOutput,
        summary,
        options.transcriptBaseDir,
      );
    } catch (err) {
      console.error(`[loop] warning: failed to save transcript: ${err}`);
    }
    options.onIteration?.(state.iteration, response);
    console.error(`--- iteration ${state.iteration} complete, looping ---\n`);
  }
}
