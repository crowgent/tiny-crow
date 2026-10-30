import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import type {
  AskSenderLike,
  BashArgs,
  PermCheckLike,
  Tool,
} from "./mod.ts";
import {
  ToolError,
  checkPerm,
} from "./mod.ts";

export function splitBashCommands(input: string): string[] {
  const result: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  const chars = [...input];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === "\\") {
      current += ch;
      if (i + 1 < chars.length) {
        i += 1;
        current += chars[i];
      }
    } else if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
    } else if ((ch === ";" || ch === "\n") && !inSingle && !inDouble) {
      const trimmed = current.trim();
      if (trimmed !== "") result.push(trimmed);
      current = "";
    } else if (ch === "&" && !inSingle && !inDouble) {
      if (chars[i + 1] === "&") {
        i += 1;
        const trimmed = current.trim();
        if (trimmed !== "") result.push(trimmed);
        current = "";
      } else {
        current += ch;
      }
    } else if (ch === "|" && !inSingle && !inDouble) {
      if (chars[i + 1] === "|") {
        i += 1;
        const trimmed = current.trim();
        if (trimmed !== "") result.push(trimmed);
        current = "";
      } else {
        current += ch;
      }
    } else if (ch === ">" && !inSingle && !inDouble) {
      if (chars[i + 1] === ">") {
        i += 1;
        const trimmed = current.trim();
        if (trimmed !== "") result.push(trimmed);
        current = "";
      } else {
        current += ch;
      }
    } else {
      current += ch;
    }
  }
  const trimmed = current.trim();
  if (trimmed !== "") result.push(trimmed);
  return result;
}

export function headLines(s: string, max: number): [string, number] {
  const lines = s.split("\n");
  const total = s === "" ? 0 : s.endsWith("\n") ? lines.length - 1 : lines.length;
  if (total <= max) return [s, total];
  const head = lines.slice(0, max).join("\n");
  return [head, total];
}

export function maskHint(
  command: string,
  stderr: string,
  maskedRoots: string[],
  home: string,
): string | undefined {
  const lines: string[] = [];
  for (const root of maskedRoots) {
    const absolute = root;
    const tilde = root.startsWith(home + "/") ? `~/${root.slice(home.length + 1)}` : undefined;
    const mentioned =
      command.includes(absolute) ||
      stderr.includes(absolute) ||
      (tilde !== undefined && (command.includes(tilde) || stderr.includes(tilde)));
    if (mentioned) {
      const display = tilde ?? absolute;
      lines.push(`note: ${display} is masked by the sandbox; ask the user whether it should be exposed`);
    }
  }
  return lines.length === 0 ? undefined : lines.join("\n");
}

const NETWORK_FAILURE_PATTERNS = [
  "could not resolve host",
  "name resolution",
  "network is unreachable",
  "connection refused",
  "cannot assign requested address",
];

export function networkHint(stderr: string): string | undefined {
  const lower = stderr.toLowerCase();
  const matched = NETWORK_FAILURE_PATTERNS.some((p) => lower.includes(p));
  return matched
    ? "note: network is disabled by the sandbox (sandbox-network = false); ask the user whether it should be enabled"
    : undefined;
}

export interface CommandOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SandboxLike {
  refusalReason(): string | undefined;
  networkUnshared(): boolean;
  maskedRoots(): string[];
  outputCommand(command: string): Promise<CommandOutput>;
  killActive(): void;
}

export interface RtkLike {
  rewrite(command: string): Promise<string | undefined>;
}

async function runShellCommand(command: string, timeoutMs?: number): Promise<CommandOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-c", command], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
    }
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        reject(new ToolError("Command timed out"));
        return;
      }
      resolve({ stdout, stderr, exitCode: code ?? -1 });
    });
  });
}

export function maskHintForExit(
  exitCode: number,
  command: string,
  stderr: string,
  sandbox: SandboxLike | undefined | null,
): string | undefined {
  if (exitCode === 0 || !sandbox) return undefined;
  const home = homedir();
  const roots = sandbox.maskedRoots().filter((r) => existsSync(r));
  return maskHint(command, stderr, roots, home);
}

export function networkHintForExit(
  exitCode: number,
  stderr: string,
  sandbox: SandboxLike | undefined | null,
): string | undefined {
  if (exitCode === 0 || !sandbox || !sandbox.networkUnshared()) return undefined;
  return networkHint(stderr);
}

const BASH_DESCRIPTION =
  "Execute a bash command in the current working directory. Returns stdout and stderr.";
const NO_NETWORK_NOTICE =
  " This session's sandbox runs commands without network access, so the internet, the local network, and services listening on the host are unreachable; a server started and used within a single command still works on 127.0.0.1.";

export class BashTool implements Tool<BashArgs, string> {
  static readonly NAME = "bash";
  readonly name = "bash";
  permission: PermCheckLike | undefined | null;
  askTx: AskSenderLike | undefined | null;
  sandbox: SandboxLike | undefined | null;
  maxOutputLines: number | undefined | null;
  rtk: RtkLike | undefined | null;

  constructor(
    permission?: PermCheckLike | null,
    askTx?: AskSenderLike | null,
    sandbox?: SandboxLike | null,
    maxOutputLines?: number | null,
    rtk?: RtkLike | null,
  ) {
    this.permission = permission ?? null;
    this.askTx = askTx ?? null;
    this.sandbox = sandbox ?? null;
    this.maxOutputLines = maxOutputLines ?? null;
    this.rtk = rtk ?? null;
  }

  description(): string {
    let description = BASH_DESCRIPTION;
    if (this.sandbox?.networkUnshared()) description += NO_NETWORK_NOTICE;
    return description;
  }

  parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        command: { type: "string", description: "Bash command to execute" },
        timeout: { type: "integer", description: "Timeout in milliseconds (optional)" },
      },
      required: ["command"],
    };
  }

  async call(args: BashArgs): Promise<string> {
    const commands = splitBashCommands(args.command);
    if (this.sandbox) {
      const reason = this.sandbox.refusalReason();
      if (reason) throw new ToolError(reason);
    }
    let coaching: string | undefined;
    for (const cmd of commands) {
      const msg = await checkPerm(this.permission, this.askTx, "bash", cmd);
      if (msg) coaching = msg;
    }
    let command = args.command;
    if (this.rtk) {
      try {
        const rewritten = await this.rtk.rewrite(args.command);
        if (rewritten !== undefined && rewritten !== args.command) command = rewritten;
      } catch {
        command = args.command;
      }
    }
    let output: CommandOutput;
    try {
      if (this.sandbox) {
        output = await this.sandbox.outputCommand(command);
      } else if (args.timeout !== undefined) {
        output = await runShellCommand(command, args.timeout);
      } else {
        output = await runShellCommand(command);
      }
    } catch (e) {
      if (e instanceof ToolError && e.message === "Command timed out") {
        this.sandbox?.killActive();
        throw e;
      }
      throw new ToolError(e instanceof Error ? e.message : String(e));
    }
    const { stdout, stderr } = output;
    const exitCode = output.exitCode;
    let result = "";
    if (stdout !== "") result += stdout;
    if (stderr !== "") {
      if (result !== "") result += "\n";
      result += stderr;
    }
    if (exitCode !== 0) result += `\nExit code: ${exitCode}`;
    if (this.maxOutputLines !== undefined && this.maxOutputLines !== null) {
      const cap = this.maxOutputLines;
      const [head, total] = headLines(result, cap);
      if (total > cap) {
        result = `${head}\n\n[truncated after ${cap} lines — ${total - cap} more lines elided; re-run with a narrower invocation or pipe through \`tail\`/\`grep\` to see trailing output]`;
      }
    }
    if (coaching) result = `${coaching}\n\n${result}`;
    for (const hint of [maskHintForExit(exitCode, command, stderr, this.sandbox), networkHintForExit(exitCode, stderr, this.sandbox)]) {
      if (hint !== undefined) {
        result += `\n${hint}`;
      }
    }
    return result;
  }
}
