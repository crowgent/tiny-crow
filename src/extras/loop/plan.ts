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
