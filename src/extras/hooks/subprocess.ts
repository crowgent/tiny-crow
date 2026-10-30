import { spawn } from "node:child_process";

export interface HookOutput {
  exitCode: number | null;
  stdout: Buffer;
  stderr: Buffer;
  timedOut: boolean;
}

export function buildShellInvocation(
  command: string,
  args?: string[],
): [string, string[]] {
  if (args !== undefined) return [command, [...args]];
  return ["sh", ["-c", command]];
}

export function runHook(
  command: string,
  args: string[] | undefined,
  stdinJson: Buffer,
  timeoutMs: number,
  projectDir: string,
): Promise<HookOutput> {
  return new Promise((resolve) => {
    const [program, argv] = buildShellInvocation(command, args);
    let child;
    try {
      child = spawn(program, argv, {
        env: { ...process.env, TINY_CROW_PROJECT_DIR: projectDir },
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
    } catch (err) {
      resolve({
        exitCode: null,
        stdout: Buffer.alloc(0),
        stderr: Buffer.from(`failed to spawn hook: ${err}`),
        timedOut: false,
      });
      return;
    }
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        if (child.pid !== undefined && process.platform !== "win32") {
          process.kill(-child.pid, "SIGKILL");
        } else {
          child.kill("SIGKILL");
        }
      } catch {

      }
      resolve({ exitCode: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), timedOut: true });
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(Buffer.from(chunk)));
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: null,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.from(`failed to spawn hook: ${err.message}`),
        timedOut: false,
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: code,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
        timedOut: false,
      });
    });
    if (child.stdin) {
      child.stdin.on("error", () => {

      });
      child.stdin.end(stdinJson);
    }
  });
}
