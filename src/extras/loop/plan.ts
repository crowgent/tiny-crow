// Loop plan file handling.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createInterface } from "node:readline";
import { DEFAULT_PLAN_FILENAME } from "./mod.ts";

export function planExists(planFile: string): boolean {
  return existsSync(planFile);
}

export function readPlan(planFile: string): string | null {
  if (!existsSync(planFile)) return null;
  try {
    return readFileSync(planFile, "utf8");
  } catch {
    return null;
  }
}

export function deletePlan(planFile: string): void {
  if (existsSync(planFile)) {
    try {
      rmSync(planFile);
    } catch {
      // Best effort.
    }
  }
}

async function readStdinLine(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("", (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Startup handling for an existing plan: ask whether to restart from it.
 * Returns true when the existing plan should be used, false when there
 * was no plan or the user declined (the plan file is deleted then).
 * `input` overrides stdin reading (useful for tests / non-interactive
 * callers); when omitted, one line is read from stdin.
 */
export async function handleStartup(planFile: string, input?: string): Promise<boolean> {
  if (!planExists(planFile)) return false;
  process.stderr.write(`${DEFAULT_PLAN_FILENAME} already exists. Restart from existing plan? [Y/n] `);
  const answer = input !== undefined ? input : await readStdinLine();
  const normalized = answer.trim().toLowerCase();
  if (normalized === "n" || normalized === "no") {
    deletePlan(planFile);
    return false;
  }
  return true;
}
