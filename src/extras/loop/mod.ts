// Headless `--loop` state: prompt assembly, iteration labels, stop rule.
import { readPlan } from "./plan.ts";

export const DEFAULT_PLAN_FILENAME = "LOOP_PLAN.md";
export const SUMMARY_TRUNCATION_CHARS = 1024;

export class LoopState {
  active: boolean;
  prompt: string;
  planFile: string;
  iteration: number;
  maxIterations: number | null;
  lastSummary: string | null;
  runCmd: string | null;
  lastRunOutput: string | null;

  constructor(
    prompt: string,
    planFile: string,
    maxIterations: number | null,
    runCmd: string | null,
  ) {
    this.active = true;
    this.prompt = prompt;
    this.planFile = planFile;
    this.iteration = 0;
    this.maxIterations = maxIterations;
    this.lastSummary = null;
    this.runCmd = runCmd;
    this.lastRunOutput = null;
  }

  static new(
    prompt: string,
    planFile: string,
    maxIterations: number | null,
    runCmd: string | null,
  ): LoopState {
    return new LoopState(prompt, planFile, maxIterations, runCmd);
  }

  buildPrompt(): string {
    const planContents = readPlan(this.planFile) ?? "";
    const maxLabel = this.maxIterations !== null ? String(this.maxIterations) : "∞";
    const summary = this.lastSummary ?? "starting fresh";
    const runOutput = this.lastRunOutput ?? "(none)";
    return (
      `${this.prompt}\n\n` +
      `--- Loop Context (Iteration ${this.iteration}/${maxLabel}) ---\n\n` +
      `Current plan (${this.planFile}):\n${planContents}\n\n` +
      `Previous iteration summary:\n${summary}\n\n` +
      `Previous validation output:\n${runOutput}\n\n` +
      `--- Instructions ---\n` +
      `- Choose ONE task from the plan. Do not implement multiple things.\n` +
      `- Before writing code, search the codebase with grep/find_files first.\n` +
      `- After implementing: run the tests for the changed code.\n` +
      `- Keep ${DEFAULT_PLAN_FILENAME} up to date: mark completed items, add new findings.\n` +
      `- If you discover bugs unrelated to your task, document them in ${DEFAULT_PLAN_FILENAME}.\n` +
      `- Commit working changes with descriptive messages.`
    );
  }

  iterationLabel(): string {
    const maxLabel = this.maxIterations !== null ? String(this.maxIterations) : "∞";
    return `LOOP ${this.iteration}/${maxLabel}`;
  }

  shouldStop(): boolean {
    if (this.maxIterations !== null) return this.iteration > this.maxIterations;
    return false;
  }
}
