// Per-iteration loop transcripts stored under the data dir.
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function loopDataDir(): string {
  if (process.env.TC_DATA_DIR) return process.env.TC_DATA_DIR.replace(/^~/, homedir());
  const base = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(base, "tiny-crow");
}

export function transcriptDir(sessionId: string, baseDir?: string): string {
  return join(baseDir ?? loopDataDir(), "loops", sessionId);
}

export interface IterationRecord {
  iteration: number;
  timestamp: string;
  prompt: string;
  response: string;
  validationOutput: string | null;
  summary: string;
}

/** Save one iteration's record as `iter-NNNN.json`; returns the file path. */
export function saveIteration(
  sessionId: string,
  iteration: number,
  prompt: string,
  response: string,
  validationOutput: string | null,
  summary: string,
  baseDir?: string,
): string {
  const dir = transcriptDir(sessionId, baseDir);
  mkdirSync(dir, { recursive: true });
  const record: IterationRecord = {
    iteration,
    timestamp: new Date().toISOString(),
    prompt,
    response,
    validationOutput,
    summary,
  };
  const path = join(dir, `iter-${String(iteration).padStart(4, "0")}.json`);
  writeFileSync(path, JSON.stringify(record, null, 2), "utf8");
  return path;
}
