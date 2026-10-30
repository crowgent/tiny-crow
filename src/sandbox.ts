// Bubblewrap/zerobox sandboxing (port of src/sandbox.rs).
// Command construction is pure (wrapCommand returns argv); execution
// uses node:child_process. Credential masking, network unsharing and
// sandbox-expose validation mirror the original exactly.
import { existsSync, realpathSync, mkdirSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { expandTildeWithHome } from "./fs.ts";

export type NetworkEffect =
  | "open"
  | "unshared"
  | "sandboxOff"
  | "otherBackend"
  | "backendMissing";

export const NETWORK_EFFECT_LABEL: Record<NetworkEffect, string> = {
  open: "true",
  unshared: "false",
  sandboxOff: "false (no effect: sandbox is off)",
  otherBackend: "false (no effect: bwrap backend only)",
  backendMissing: "false (no effect: bwrap is not installed)",
};

export const HOME_MASK_DIRS = [".ssh", ".aws", ".gnupg", ".kube", ".docker"] as const;
export const CONFIG_MASK_DIRS = ["gh", "gcloud", "op", "sops/age"] as const;

export function maskRootsFor(home: string, xdgConfig?: string): string[] {
  const configBase =
    xdgConfig && path.isAbsolute(xdgConfig) ? xdgConfig : path.join(home, ".config");
  return [
    ...HOME_MASK_DIRS.map((rel) => path.join(home, rel)),
    ...CONFIG_MASK_DIRS.map((rel) => path.join(configBase, rel)),
  ];
}

export function builtinMaskRoots(): string[] {
  const home = os.homedir();
  if (!home) return [];
  const xdg = process.env["XDG_CONFIG_HOME"];
  return maskRootsFor(home, xdg && xdg.length > 0 ? xdg : undefined);
}

/**
 * Split raw sandbox-expose values into valid (a masked path or subpath,
 * after ~/$HOME expansion, with no `..` component) and rejected values.
 */
export function partitionExpose(
  raw: string[],
  maskRoots: string[],
  home?: string,
): [string[], string[]] {
  const valid: string[] = [];
  const rejected: string[] = [];
  for (const value of raw) {
    const expanded = expandTildeWithHome(value, home);
    // path.join() normalises ".." away during tilde expansion, so also
    // check the raw value: a ".." component must never be exposed, even
    // when it lands inside another mask root after normalisation.
    const escapes =
      expanded.split(path.sep).includes("..") || value.split("/").includes("..");
    const isSubpath = maskRoots.some((root) => {
      const rel = path.relative(root, expanded);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    });
    if (!escapes && isSubpath) valid.push(expanded);
    else rejected.push(value);
  }
  return [valid, rejected];
}

function whichCmd(name: string): boolean {
  const pathEnv = process.env["PATH"];
  if (!pathEnv) return false;
  return pathEnv.split(path.delimiter).some((dir) => {
    const candidate = path.join(dir, name);
    try {
      return existsSync(candidate);
    } catch {
      return false;
    }
  });
}

let bwrapAvailableCache: boolean | undefined;
let zeroboxAvailableCache: boolean | undefined;

export function bwrapExists(): boolean {
  if (bwrapAvailableCache === undefined) bwrapAvailableCache = whichCmd("bwrap");
  return bwrapAvailableCache;
}

export function zeroboxExists(): boolean {
  if (zeroboxAvailableCache === undefined) zeroboxAvailableCache = whichCmd("zerobox");
  return zeroboxAvailableCache;
}

export class ProcessGroupGuard {
  pid: number | undefined;
  private activeGroups: Set<number>;

  constructor(pid: number | undefined, activeGroups: Set<number>) {
    this.pid = pid;
    this.activeGroups = activeGroups;
    if (pid !== undefined) activeGroups.add(pid);
  }

  disarm(): void {
    if (this.pid !== undefined) {
      this.activeGroups.delete(this.pid);
      this.pid = undefined;
    }
  }

  /** Drop semantics: kill the process group unless disarmed. */
  dispose(): void {
    if (this.pid !== undefined) {
      const pid = this.pid;
      this.activeGroups.delete(pid);
      this.pid = undefined;
      killProcessGroup(pid);
    }
  }
}

export function killProcessGroup(pid: number): void {
  if (process.platform === "win32") return;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // already gone
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // already gone
  }
}

export interface BuiltCommand {
  program: string;
  args: string[];
}

export class Sandbox {
  enabled: boolean;
  required: boolean;
  backend: string;
  shell: string;
  network: boolean;
  backendAvailableOverride?: boolean;
  backendInstalledNowOverride?: boolean;
  cacheDirOverride?: string;
  maskRootsOverride?: string[];
  resolvConfOverride?: string;
  expose: string[];
  sshAuthSockOverride?: string | undefined;
  sshAuthSockSet: boolean;
  activeGroups: Set<number>;

  constructor(enabled: boolean, backend: string) {
    this.enabled = enabled;
    this.required = false;
    this.backend = backend;
    this.shell = "bash";
    this.network = true;
    this.expose = [];
    this.sshAuthSockSet = false;
    this.activeGroups = new Set<number>();
  }

  static create(enabled: boolean, backend: string): Sandbox {
    return new Sandbox(enabled, backend);
  }

  isEffectivelySandboxed(): boolean {
    return this.enabled && this.backendAvailable();
  }

  withShell(shell: string): this {
    if (shell.length > 0) this.shell = shell;
    return this;
  }

  withRequired(required: boolean): this {
    this.required = required;
    return this;
  }

  withNetwork(network: boolean): this {
    this.network = network;
    return this;
  }

  withExpose(expose: string[]): this {
    this.expose = [...expose];
    return this;
  }

  withBackendAvailable(available: boolean): this {
    this.backendAvailableOverride = available;
    return this;
  }

  withBackendInstalledNow(installed: boolean): this {
    this.backendInstalledNowOverride = installed;
    return this;
  }

  withCacheDir(dir: string): this {
    this.cacheDirOverride = dir;
    return this;
  }

  withMaskRoots(roots: string[]): this {
    this.maskRootsOverride = [...roots];
    return this;
  }

  withResolvConf(filePath: string): this {
    this.resolvConfOverride = filePath;
    return this;
  }

  withSshAuthSock(sock: string | undefined): this {
    this.sshAuthSockOverride = sock;
    this.sshAuthSockSet = true;
    return this;
  }

  maskedRoots(): string[] {
    if (!this.bwrapPolicyActive()) return [];
    const roots = this.maskRootsOverride ?? builtinMaskRoots();
    return roots.filter((root) => existsSync(root));
  }

  bwrapPolicyActive(): boolean {
    return this.backendWillRun() && this.backendBinary() === "bwrap";
  }

  networkUnshared(): boolean {
    return !this.network && this.bwrapPolicyActive();
  }

  networkEffect(): NetworkEffect {
    if (this.network) return "open";
    if (this.bwrapPolicyActive()) return "unshared";
    if (!this.enabled) return "sandboxOff";
    if (this.backendBinary() !== "bwrap") return "otherBackend";
    return "backendMissing";
  }

  sshAuthSock(): string | undefined {
    const advertised = this.sshAuthSockSet
      ? this.sshAuthSockOverride
      : process.env["SSH_AUTH_SOCK"];
    if (!advertised || advertised.length === 0) return undefined;
    return existsSync(advertised) ? advertised : undefined;
  }

  shadowedMaskRoot(cwd: string): string | undefined {
    return this.maskedRoots().find((root) => containedIn(cwd, root));
  }

  shadowedMaskWarning(): string | undefined {
    let cwd: string;
    try {
      cwd = process.cwd();
    } catch {
      return undefined;
    }
    const root = this.shadowedMaskRoot(cwd);
    if (!root) return undefined;
    return `sandbox: the working directory is inside ${root}, so the project bind partially shadows the mask on it`;
  }

  backendBinary(): "bwrap" | "zerobox" {
    return this.backend === "zerobox" ? "zerobox" : "bwrap";
  }

  backendAvailable(): boolean {
    if (this.backendAvailableOverride !== undefined) return this.backendAvailableOverride;
    return this.backend === "zerobox" ? zeroboxExists() : bwrapExists();
  }

  backendAvailableNow(): boolean {
    if (this.backendInstalledNowOverride !== undefined) return this.backendInstalledNowOverride;
    if (this.backendAvailableOverride !== undefined) return this.backendAvailableOverride;
    return whichCmd(this.backendBinary());
  }

  backendWillRun(): boolean {
    return (
      this.enabled &&
      (this.backendAvailable() || (this.required && this.backendAvailableNow()))
    );
  }

  refusalReason(): string | undefined {
    if (!this.enabled || !this.required) return undefined;
    if (this.backendAvailable() || this.backendAvailableNow()) return undefined;
    return `sandbox backend '${this.backend}' not found; refusing to run because sandbox-required is set`;
  }

  bareCommand(command: string): BuiltCommand {
    return { program: this.shell, args: ["-c", command] };
  }

  wrapCommand(command: string): BuiltCommand {
    if (!this.enabled) return this.bareCommand(command);
    const reason = this.refusalReason();
    if (reason) throw new Error(reason);
    if (!this.backendWillRun()) {
      console.warn(`sandbox: ${this.backendBinary()} not found, running unsandboxed`);
      return this.bareCommand(command);
    }
    const cwd = process.cwd();
    if (this.backend === "zerobox") {
      return {
        program: "zerobox",
        args: ["--allow-write", cwd, "--", this.shell, "-c", command],
      };
    }
    const args: string[] = ["--clearenv"];
    for (const [k, v] of essentialEnv()) {
      args.push("--setenv", k, v);
    }
    const resolvConf = this.resolvConfOverride ?? "/etc/resolv.conf";
    try {
      const target = realpathSync(resolvConf);
      args.push("--ro-bind-try", target, "/etc/resolv.conf");
    } catch (e) {
      console.warn(
        `sandbox: no resolver file could be mounted: could not resolve ${resolvConf}: ${e}`,
      );
    }
    args.push("--ro-bind", "/", "/");
    const masks = this.maskedRoots();
    pushMaskLayer(args, masks, this.expose);
    args.push("--bind", cwd, cwd);
    const cacheDir = this.cacheDirOverride ?? xdgCacheDir();
    if (cacheDir) {
      try {
        mkdirSync(cacheDir, { recursive: true });
      } catch (e) {
        console.warn(`sandbox: failed to create cache dir ${cacheDir}: ${e}`);
      }
      args.push("--bind", cacheDir, cacheDir);
    }
    const reopened = masks.filter((root) =>
      [cwd, ...(cacheDir ? [cacheDir] : [])].some(
        (bind) => containedIn(root, bind) && !sameDir(root, bind),
      ),
    );
    const reopenedExpose = this.expose.filter((p) =>
      reopened.some((root) => isSubpathOf(p, root)),
    );
    pushMaskLayer(args, reopened, reopenedExpose);
    const sock = this.sshAuthSock();
    if (sock) args.push("--ro-bind-try", "/dev/null", sock);
    args.push(
      "--ro-bind", "/sys", "/sys",
      "--proc", "/proc",
      "--dev", "/dev",
      "--tmpfs", "/tmp",
    );
    args.push("--unshare-ipc", "--unshare-pid", "--unshare-uts", "--unshare-cgroup");
    if (!this.network) args.push("--unshare-net");
    args.push("--die-with-parent", this.shell, "-c", command);
    return { program: "bwrap", args };
  }

  async outputCommand(command: string): Promise<{
    status: number | null;
    stdout: Buffer;
    stderr: Buffer;
  }> {
    const built = this.wrapCommand(command);
    const child: ChildProcess = spawn(built.program, built.args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on("data", (d: Buffer) => stdoutChunks.push(d));
    child.stderr?.on("data", (d: Buffer) => stderrChunks.push(d));
    const guard = new ProcessGroupGuard(child.pid, this.activeGroups);
    // Mirror the Rust output_command: return once the child exits, giving
    // the pipes only a short drain window. A descendant holding a pipe
    // open must not delay the result; its group is killed instead.
    const status = await new Promise<number | null>((resolve, reject) => {
      let settled = false;
      const finish = (code: number | null) => {
        if (settled) return;
        settled = true;
        resolve(code);
      };
      child.on("error", reject);
      child.on("close", (code) => finish(code));
      child.on("exit", (code) => {
        const timer = setTimeout(() => {
          if (child.pid !== undefined) killProcessGroup(child.pid);
          finish(code);
        }, 100);
        child.on("close", () => clearTimeout(timer));
      });
    });
    guard.disarm();
    return {
      status,
      stdout: Buffer.concat(stdoutChunks),
      stderr: Buffer.concat(stderrChunks),
    };
  }

  killActive(): void {
    const groups = [...this.activeGroups];
    this.activeGroups.clear();
    for (const pid of groups) killProcessGroup(pid);
  }

  activeGroupCount(): number {
    return this.activeGroups.size;
  }
}

function xdgCacheDir(): string | undefined {
  if (process.env["XDG_CACHE_HOME"]) return process.env["XDG_CACHE_HOME"];
  const home = os.homedir();
  if (!home) return undefined;
  return process.platform === "darwin"
    ? path.join(home, "Library", "Caches")
    : path.join(home, ".cache");
}

function containedIn(inner: string, outer: string): boolean {
  if (isSubpathOf(inner, outer)) return true;
  try {
    const innerReal = realpathSync(inner);
    const outerReal = realpathSync(outer);
    return isSubpathOf(innerReal, outerReal);
  } catch {
    // Unresolvable paths count as contained: callers use containment to
    // decide whether to mask more, so err toward hiding credentials.
    return true;
  }
}

function isSubpathOf(inner: string, outer: string): boolean {
  const rel = path.relative(outer, inner);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function sameDir(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

function pushMaskLayer(args: string[], roots: string[], expose: string[]): void {
  for (const root of roots) args.push("--tmpfs", root);
  for (const p of expose) args.push("--ro-bind-try", p, p);
}

export interface SandboxSetup {
  sandbox: Sandbox;
  warnings: string[];
}

export interface SandboxSettings {
  enabled: boolean;
  required: boolean;
  backend: string;
  shell: string;
  expose: string[];
  network: boolean;
}

export function buildSandbox(settings: SandboxSettings): SandboxSetup {
  const home = os.homedir() || undefined;
  const [expose, rejected] = partitionExpose(settings.expose, builtinMaskRoots(), home);
  const sandbox = new Sandbox(settings.enabled, settings.backend)
    .withRequired(settings.required)
    .withShell(settings.shell)
    .withNetwork(settings.network)
    .withExpose(expose);
  const warnings: string[] = rejected.map(
    (value) =>
      `sandbox-expose value '${value}' is not a masked path or subpath of one, ignoring it`,
  );
  if (!settings.network && !settings.enabled) {
    warnings.push(
      "sandbox-network is set to false but the sandbox is disabled, so commands still have network access",
    );
  }
  const shadowWarning = sandbox.shadowedMaskWarning();
  if (shadowWarning) warnings.push(shadowWarning);
  return { sandbox, warnings };
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
    const rel = path.relative(home, root);
    const tilde = !rel.startsWith("..") && !path.isAbsolute(rel) ? `~/${rel}` : undefined;
    const mentioned =
      command.includes(absolute) ||
      stderr.includes(absolute) ||
      (tilde !== undefined && (command.includes(tilde) || stderr.includes(tilde)));
    if (mentioned) {
      const display = tilde ?? absolute;
      lines.push(
        `note: ${display} is masked by the sandbox; ask the user whether it should be exposed`,
      );
    }
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}

const NETWORK_FAILURE_PATTERNS = [
  "could not resolve host",
  "name resolution",
  "network is unreachable",
  "connection refused",
  "cannot assign requested address",
] as const;

export function containsIgnoreAsciiCase(haystack: string, needle: string): boolean {
  if (haystack.length < needle.length) return false;
  const lowerHay = haystack.toLowerCase();
  return lowerHay.includes(needle.toLowerCase());
}

export function networkHint(stderr: string): string | undefined {
  const matched = NETWORK_FAILURE_PATTERNS.some((p) => containsIgnoreAsciiCase(stderr, p));
  return matched
    ? "note: network is disabled by the sandbox (sandbox-network = false); ask the user whether it should be enabled"
    : undefined;
}

const ESSENTIAL_ENV_VARS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "SSH_ASKPASS",
  "GIT_ASKPASS",
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "DBUS_SESSION_BUS_ADDRESS",
  "EDITOR",
  "VISUAL",
  "LD_LIBRARY_PATH",
  "CARGO_HOME",
  "RUSTUP_HOME",
  "GOPATH",
  "GOROOT",
  "VIRTUAL_ENV",
  "JAVA_HOME",
  "NODE_PATH",
  "TMPDIR",
  "XDG_RUNTIME_DIR",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "COLORTERM",
  "NO_COLOR",
] as const;

export function essentialEnvFrom(
  lookup: (name: string) => string | undefined,
): Array<[string, string]> {
  const vars: Array<[string, string]> = [];
  for (const name of ESSENTIAL_ENV_VARS) {
    const val = lookup(name);
    if (val !== undefined) vars.push([name, val]);
  }
  return vars;
}

export function essentialEnv(): Array<[string, string]> {
  return essentialEnvFrom((name) => process.env[name]);
}
