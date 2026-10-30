// rtk integration: an external CLI proxy that filters and compresses
// shell command output before it reaches the model context.
//
// When enabled, bash commands are passed through `rtk rewrite <cmd>`
// before execution. rtk is the single source of truth for which commands
// have a compact equivalent: it prints the rewritten command on stdout,
// or nothing when the command has no filter. Everything here is
// fail-open — any error (binary missing, timeout, empty output) runs the
// original command unchanged.
import { execFile } from "node:child_process";

/** Bound guarding against a hung binary; on expiry the original runs. */
export const RTK_TIMEOUT_MS = 5 * 1000;

export interface RtkConfig {
  enabled: boolean;
  path?: string | null;
}

function runWithTimeout(
  program: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      resolve({ code: null, stdout: "" });
    }, timeoutMs);
    const child = execFile(program, args, { encoding: "utf8", timeout: timeoutMs }, (err, stdout) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: err ? (typeof err.code === "number" ? err.code : null) : 0, stdout: stdout ?? "" });
    });
    child.stdin?.end();
  });
}

/** A detected, working rtk binary. Construct via `Rtk.detect`. */
export class Rtk {
  private path: string;

  private constructor(path: string) {
    this.path = path;
  }

  get binaryPath(): string {
    return this.path;
  }

  /**
   * Returns a working instance when rtk is enabled in config and the
   * binary responds to `<path> --version`; otherwise null, so
   * misconfiguration never blocks the agent.
   */
  static async detect(cfg: RtkConfig | null | undefined): Promise<Rtk | null> {
    if (!cfg || !cfg.enabled) return null;
    const path = cfg.path ?? "rtk";
    const result = await runWithTimeout(path, ["--version"], RTK_TIMEOUT_MS);
    if (result.code === 0) {
      return new Rtk(path);
    }
    console.warn(
      `rtk.enabled is set but '${path}' is not a working rtk binary; commands will run unfiltered`,
    );
    return null;
  }

  /**
   * Rewrite `command` via `rtk rewrite`. Returns null — meaning "run the
   * original" — when rtk has no filter for the command or anything fails.
   */
  async rewrite(command: string): Promise<string | null> {
    const result = await runWithTimeout(this.path, ["rewrite", command], RTK_TIMEOUT_MS);
    const rewritten = result.stdout.trim();
    return rewritten === "" ? null : rewritten;
  }
}
