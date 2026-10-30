import type { HookOutput } from "./subprocess.ts";

export type ChannelResult =
  | { kind: "NoObjection"; json: unknown | null }
  | { kind: "Block"; stderr: string }
  | { kind: "Error"; exitCode: number | null; stderr: string }
  | { kind: "TimedOut" };

function tryParseJson(bytes: Buffer): unknown | null {
  if (bytes.length === 0) return null;
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
}

function isJson(bytes: Buffer): boolean {
  if (bytes.length === 0) return false;
  try {
    JSON.parse(bytes.toString("utf8"));
    return true;
  } catch {
    return false;
  }
}

export function interpretHookOutput(output: HookOutput): ChannelResult {
  if (output.timedOut) return { kind: "TimedOut" };
  switch (output.exitCode) {
    case 0: {
      
      const json = tryParseJson(output.stdout);
      return { kind: "NoObjection", json };
    }
    case 2: {
      if (isJson(output.stdout)) {
        console.warn(
          "hooks: hook exited 2 (block) and also printed JSON on stdout; the JSON is ignored",
        );
      }
      return { kind: "Block", stderr: output.stderr.toString("utf8") };
    }
    default:
      return {
        kind: "Error",
        exitCode: output.exitCode,
        stderr: output.stderr.toString("utf8"),
      };
  }
}
