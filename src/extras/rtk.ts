import { execFile } from "node:child_process";

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

export class Rtk {
  private path: string;

  private constructor(path: string) {
    this.path = path;
  }

  get binaryPath(): string {
    return this.path;
  }

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

  async rewrite(command: string): Promise<string | null> {
    const result = await runWithTimeout(this.path, ["rewrite", command], RTK_TIMEOUT_MS);
    const rewritten = result.stdout.trim();
    return rewritten === "" ? null : rewritten;
  }
}
