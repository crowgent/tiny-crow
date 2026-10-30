import {
  defaultQuickModels,
  quickModelsMap,
  type Config,
  type McpServerConfig,
  type QuickModelConfig,
} from "./config/mod.ts";
import { parseEditSystem, type EditSystem } from "./config/types.ts";
import { defaultModelForProvider } from "./provider.ts";

export const CLI_NAME = "tiny-crow";
export const CLI_VERSION = "1.8.5";
export const CLI_ABOUT = "Minimal coding agent";

export class CliParseError extends Error {}

export interface Cli {
  print: boolean;
  pureStdout: boolean;
  loadPrompt?: string;
  customMcp: string[];
  customMcpHttp: string[];
  promptsDir: string[];
  printConfig: boolean;
  setup: boolean;
  tutor: boolean;
  continueSession: boolean;
  resume: boolean;
  session?: string;
  name?: string;
  noSession: boolean;
  provider?: string;
  model?: string;
  quickModel?: string;
  apiKey?: string;
  maxTokens?: number;
  maxAgentTurns?: number;
  temperature?: number;
  tools: string[];
  noTools: boolean;
  noColor: boolean;
  disableLazygit: boolean;
  noHooks: boolean;
  hooksTest?: string;
  hooksTestInput?: string;
  restrictive: boolean;
  readOnly: boolean;
  guarded: boolean;
  acceptAll: boolean;
  yolo: boolean;
  dangerouslySkipPermissions: boolean;
  sandbox: boolean;
  sandboxBackend?: string;
  sandboxRequired: boolean;
  sandboxExpose: string[];
  sandboxNetwork?: boolean;
  shell?: string;
  editSystem?: string;
  noContextFiles: boolean;
  loopMode: boolean;
  acpEnabled: boolean;
  acpHost?: string;
  acpPort?: number;
  loopPrompt?: string;
  loopPlan?: string;
  loopMax?: number;
  loopRun?: string;
  worktree?: string;
  wtAutoMerge: boolean;
  parallel: boolean;
  wtBaseDir?: string;
  wtForce: boolean;
  advisor: boolean;
  advisorModel?: string;
  advisorMaxUses?: number;
  advisorHumanHandoff?: boolean;
  advisorKilobytesLimit: number;
  statusSocket?: string;
  verbose: boolean;
  logFile?: string;
  logLevel?: string;
  message: string[];
}

export function defaultCli(): Cli {
  return {
    print: false,
    pureStdout: false,
    customMcp: [],
    customMcpHttp: [],
    promptsDir: [],
    printConfig: false,
    setup: false,
    tutor: false,
    continueSession: false,
    resume: false,
    noSession: false,
    tools: [],
    noTools: false,
    noColor: false,
    disableLazygit: false,
    noHooks: false,
    restrictive: false,
    readOnly: false,
    guarded: false,
    acceptAll: false,
    yolo: false,
    dangerouslySkipPermissions: false,
    sandbox: false,
    sandboxRequired: false,
    sandboxExpose: [],
    noContextFiles: false,
    loopMode: false,
    acpEnabled: false,
    wtAutoMerge: false,
    parallel: false,
    wtForce: false,
    advisor: false,
    advisorKilobytesLimit: 256,
    verbose: false,
    message: [],
  };
}

type FlagKind = "bool" | "value" | "append" | "optionalBool";
interface FlagSpec {
  kind: FlagKind;
  set: (cli: Cli, value: string | boolean | undefined) => void;
}

function boolField(key: keyof Cli): (cli: Cli, v: string | boolean | undefined) => void {
  return (cli) => {
    (cli as unknown as Record<string, unknown>)[key] = true;
  };
}

function valueField(key: keyof Cli, parse?: (s: string) => unknown): (cli: Cli, v: string | boolean | undefined) => void {
  return (cli, v) => {
    (cli as unknown as Record<string, unknown>)[key] = parse ? parse(String(v)) : v;
  };
}

function appendField(key: keyof Cli): (cli: Cli, v: string | boolean | undefined) => void {
  return (cli, v) => {
    ((cli as unknown as Record<string, unknown>)[key] as string[]).push(String(v));
  };
}

function parseNum(s: string): number {
  const n = Number(s);
  if (!Number.isFinite(n)) throw new CliParseError(`invalid number: ${s}`);
  return n;
}

function parseInt(s: string): number {
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) throw new CliParseError(`invalid integer: ${s}`);
  return n;
}

function parseBoolValue(s: string): boolean {
  if (s === "true") return true;
  if (s === "false") return false;
  throw new CliParseError(`invalid boolean: ${s}`);
}

const LONG_FLAGS: Record<string, FlagSpec> = {
  "print": { kind: "bool", set: boolField("print") },
  "pure-stdout": { kind: "bool", set: boolField("pureStdout") },
  "load-prompt": { kind: "value", set: valueField("loadPrompt") },
  "custom-mcp": { kind: "append", set: appendField("customMcp") },
  "custom-mcp-http": { kind: "append", set: appendField("customMcpHttp") },
  "prompts-dir": { kind: "append", set: appendField("promptsDir") },
  "print-config": { kind: "bool", set: boolField("printConfig") },
  "setup": { kind: "bool", set: boolField("setup") },
  "tutor": { kind: "bool", set: boolField("tutor") },
  "continue": { kind: "bool", set: boolField("continueSession") },
  "resume": { kind: "bool", set: boolField("resume") },
  "session": { kind: "value", set: valueField("session") },
  "name": { kind: "value", set: valueField("name") },
  "no-session": { kind: "bool", set: boolField("noSession") },
  "provider": { kind: "value", set: valueField("provider") },
  "model": { kind: "value", set: valueField("model") },
  "quick-model": { kind: "value", set: valueField("quickModel") },
  "api-key": { kind: "value", set: valueField("apiKey") },
  "max-tokens": { kind: "value", set: valueField("maxTokens", parseNum) },
  "max-agent-turns": { kind: "value", set: valueField("maxAgentTurns", parseInt) },
  "temperature": { kind: "value", set: valueField("temperature", parseNum) },
  "tools": {
    kind: "append",
    set: (cli, v) => {
      cli.tools.push(...String(v).split(",").filter((s) => s.length > 0));
    },
  },
  "no-tools": { kind: "bool", set: boolField("noTools") },
  "no-color": { kind: "bool", set: boolField("noColor") },
  "disable-lazygit": { kind: "bool", set: boolField("disableLazygit") },
  "no-hooks": { kind: "bool", set: boolField("noHooks") },
  "hooks-test": { kind: "value", set: valueField("hooksTest") },
  "hooks-test-input": { kind: "value", set: valueField("hooksTestInput") },
  "restrictive": { kind: "bool", set: boolField("restrictive") },
  "read-only": { kind: "bool", set: boolField("readOnly") },
  "guarded": { kind: "bool", set: boolField("guarded") },
  "accept-all": { kind: "bool", set: boolField("acceptAll") },
  "yolo": { kind: "bool", set: boolField("yolo") },
  "dangerously-skip-permissions": { kind: "bool", set: boolField("dangerouslySkipPermissions") },
  "sandbox": { kind: "bool", set: boolField("sandbox") },
  "sandbox-backend": { kind: "value", set: valueField("sandboxBackend") },
  "sandbox-required": { kind: "bool", set: boolField("sandboxRequired") },
  "sandbox-expose": { kind: "append", set: appendField("sandboxExpose") },
  "sandbox-network": {
    kind: "optionalBool",
    set: (cli, v) => {
      cli.sandboxNetwork = v === undefined ? true : parseBoolValue(String(v));
    },
  },
  "shell": { kind: "value", set: valueField("shell") },
  "edit-system": { kind: "value", set: valueField("editSystem") },
  "no-context-files": { kind: "bool", set: boolField("noContextFiles") },
  "loop": { kind: "bool", set: boolField("loopMode") },
  "acp": { kind: "bool", set: boolField("acpEnabled") },
  "acp-host": { kind: "value", set: valueField("acpHost") },
  "acp-port": { kind: "value", set: valueField("acpPort", parseInt) },
  "loop-prompt": { kind: "value", set: valueField("loopPrompt") },
  "loop-plan": { kind: "value", set: valueField("loopPlan") },
  "loop-max": { kind: "value", set: valueField("loopMax", parseInt) },
  "loop-run": { kind: "value", set: valueField("loopRun") },
  "worktree": { kind: "value", set: valueField("worktree") },
  "wt-auto-merge": { kind: "bool", set: boolField("wtAutoMerge") },
  "parallel": { kind: "bool", set: boolField("parallel") },
  "wt-base-dir": { kind: "value", set: valueField("wtBaseDir") },
  "wt-force": { kind: "bool", set: boolField("wtForce") },
  "advisor": { kind: "bool", set: boolField("advisor") },
  "advisor-model": { kind: "value", set: valueField("advisorModel") },
  "advisor-max-uses": { kind: "value", set: valueField("advisorMaxUses", parseInt) },
  "advisor-human-handoff": {
    kind: "optionalBool",
    set: (cli, v) => {
      cli.advisorHumanHandoff = v === undefined ? true : parseBoolValue(String(v));
    },
  },
  "advisor-kilobytes-limit": { kind: "value", set: valueField("advisorKilobytesLimit", parseInt) },
  "status-socket": { kind: "value", set: valueField("statusSocket") },
  "verbose": { kind: "bool", set: boolField("verbose") },
  "log-file": { kind: "value", set: valueField("logFile") },
  "log-level": { kind: "value", set: valueField("logLevel") },
};

const SHORT_FLAGS: Record<string, FlagSpec> = {
  "p": { kind: "bool", set: boolField("print") },
  "c": { kind: "bool", set: boolField("continueSession") },
  "r": { kind: "bool", set: boolField("resume") },
  "R": { kind: "bool", set: boolField("restrictive") },
  "n": { kind: "bool", set: boolField("noContextFiles") },
  "v": { kind: "bool", set: boolField("verbose") },
  "t": {
    kind: "value",
    set: (cli, v) => {
      cli.tools.push(...String(v).split(",").filter((s) => s.length > 0));
    },
  },
};

export function parseCliArgs(argv: string[]): Cli {
  const cli = defaultCli();
  let i = 0;
  let positionalOnly = false;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (positionalOnly) {
      cli.message.push(arg);
      i++;
      continue;
    }
    if (arg === "--") {
      positionalOnly = true;
      i++;
      continue;
    }
    if (arg.startsWith("--")) {
      const body = arg.slice(2);
      const eqIdx = body.indexOf("=");
      const name = eqIdx >= 0 ? body.slice(0, eqIdx) : body;
      const eqValue = eqIdx >= 0 ? body.slice(eqIdx + 1) : undefined;
      const spec = LONG_FLAGS[name];
      if (!spec) throw new CliParseError(`unexpected argument '--${name}' found`);
      if (spec.kind === "bool") {
        if (eqValue !== undefined) throw new CliParseError(`--${name} does not take a value`);
        spec.set(cli, true);
      } else if (spec.kind === "optionalBool") {
        if (eqValue !== undefined) spec.set(cli, eqValue);
        else spec.set(cli, undefined);
      } else {
        let value: string;
        if (eqValue !== undefined) value = eqValue;
        else {
          i++;
          if (i >= argv.length) throw new CliParseError(`a value is required for '--${name}'`);
          value = argv[i]!;
        }
        spec.set(cli, value);
      }
      i++;
      continue;
    }
    if (arg.startsWith("-") && arg.length > 1) {
      const cluster = arg.slice(1);
      let consumedValue = false;
      for (let j = 0; j < cluster.length; j++) {
        const ch = cluster[j]!;
        const spec = SHORT_FLAGS[ch];
        if (!spec) throw new CliParseError(`unexpected argument '-${ch}' found`);
        if (spec.kind === "bool") {
          spec.set(cli, true);
        } else {
          
          let value: string;
          if (j + 1 < cluster.length) value = cluster.slice(j + 1);
          else {
            i++;
            if (i >= argv.length) throw new CliParseError(`a value is required for '-${ch}'`);
            value = argv[i]!;
          }
          spec.set(cli, value);
          consumedValue = true;
          break;
        }
      }
      void consumedValue;
      i++;
      continue;
    }
    cli.message.push(arg);
    i++;
  }
  if (cli.tools.length > 0 && cli.noTools) {
    throw new CliParseError(`the argument '--tools' cannot be used with '--no-tools'`);
  }
  
  if (cli.provider === undefined && process.env["TC_PROVIDER"]) {
    cli.provider = process.env["TC_PROVIDER"];
  }
  if (cli.model === undefined && process.env["TC_MODEL"]) {
    cli.model = process.env["TC_MODEL"];
  }
  return cli;
}

export function parseCli(): Cli {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }
  if (argv.includes("--version") || argv.includes("-V")) {
    console.log(`${CLI_NAME} ${CLI_VERSION}`);
    process.exit(0);
  }
  try {
    return parseCliArgs(argv);
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : e}`);
    console.error(`Usage: ${CLI_NAME} [OPTIONS] [MESSAGE]...`);
    process.exit(2);
  }
}

export function printHelp(): void {
  console.log(`${CLI_NAME} ${CLI_VERSION}
${CLI_ABOUT}

Usage: ${CLI_NAME} [OPTIONS] [MESSAGE]...

Options:
  -p, --print                      Print response and exit
      --pure-stdout                With -p: also print tool calls/results to stdout
      --load-prompt <NAME>         Load a named prompt (same as /prompt)
      --custom-mcp <NAME=COMMAND>  Add a stdio MCP server (repeatable)
      --custom-mcp-http <NAME=URL> Add an HTTP MCP server (repeatable)
      --prompts-dir <PATH>         Extra prompts directory (repeatable)
      --print-config               Print resolved configuration and exit
      --setup                      Interactive setup wizard
      --tutor                      Show getting started guide
  -c, --continue                   Continue most recent session
  -r, --resume                     List recent sessions
      --session <ID>               Load session by ID prefix
      --name <NAME>                Name for the session
      --no-session                 Ephemeral mode, do not save
      --provider <NAME>            API provider [env: TC_PROVIDER]
      --model <NAME>               Model name [env: TC_MODEL]
      --quick-model <NAME>         Use a named quick model from config
      --api-key <KEY>              API key for the provider
      --max-tokens <N>             Maximum tokens in response
      --max-agent-turns <N>        Maximum agent turns
      --temperature <F>            Model temperature (0.0 to 2.0)
  -t, --tools <TOOL,...>           Allowlist specific tools (comma-separated; repeatable)
      --no-tools                   Disable all tools
      --no-color                   Disable colored TUI output
      --disable-lazygit            Disable the Ctrl+H lazygit shortcut
      --no-hooks                   Disable all hooks
      --hooks-test <TOOL>          Dry-run PreToolUse hooks for TOOL and exit
      --hooks-test-input <JSON>    tool_input JSON for --hooks-test
  -R, --restrictive                Ask for all operations
      --read-only                  Allow reads only, deny everything else
      --guarded                    Allow reads, ask for all other operations
      --accept-all                 Auto-accept all operations within the working directory
      --yolo                       Allow all operations except destructive bash commands
      --dangerously-skip-permissions  Skip all permission checks
      --sandbox                    Run bash commands inside bubblewrap (bwrap) sandbox
      --sandbox-backend <NAME>     Sandbox backend: bwrap (default) or zerobox
      --sandbox-required           Refuse to run bash commands when the sandbox backend is unavailable
      --sandbox-expose <PATH>      Restore read-only access to a masked credential path (repeatable)
      --sandbox-network[=<BOOL>]   Allow sandboxed bash commands to use the network (default: true)
      --shell <BIN>                Shell binary to use for bash tool (default: bash)
      --edit-system <NAME>         Edit system (similarity or hashedit)
  -n, --no-context-files           Disable AGENTS.md and ARCHITECTURE.md loading
      --loop                       Run in headless loop mode
      --acp                        Enable ACP support
      --acp-host <HOST>            ACP TCP bind host
      --acp-port <PORT>            ACP TCP bind port [default: 7243]
      --loop-prompt <PROMPT>       Prompt for each loop iteration
      --loop-plan <PATH>           Plan file path [default: LOOP_PLAN.md]
      --loop-max <N>               Maximum number of iterations
      --loop-run <CMD>             Validation command to run after each iteration
      --worktree <NAME>            Create a git worktree and cd into it
      --wt-auto-merge              Auto-merge worktree branch on exit
      --parallel                   Create a worktree with timestamp name and auto-merge on exit
      --wt-base-dir <DIR>          Base directory for worktrees
      --wt-force                   Force worktree remove and branch delete even if dirty
      --advisor                    Enable advisor tool
      --advisor-model <NAME>       Advisor model name
      --advisor-max-uses <N>       Maximum advisor calls per request (default: 3)
      --advisor-human-handoff[=<BOOL>]  Route advisor calls to the user instead of a model
      --advisor-kilobytes-limit <N>  Max kilobytes of context to send to the advisor (default: 256)
      --status-socket <PATH>       Unix socket path for status signals
  -v, --verbose                    Enable full logging (trace level) to a timestamped log file
      --log-file <PATH>            Write logs to this file (overrides verbose default path)
      --log-level <LEVEL>          Set stderr log level (trace, debug, info, warn, error)
  -h, --help                       Print help
  -V, --version                    Print version`);
}

export function resolveQuickModel(cli: Cli, cfg: Config): QuickModelConfig | undefined {
  if (!cli.quickModel) return undefined;
  return cfg.quickModels?.[cli.quickModel];
}

export function resolveModel(cli: Cli, cfg: Config): string {
  if (cli.model) return cli.model;
  if (cfg.model) {
    const qm = quickModelsMap(cfg);
    const q = qm[cfg.model];
    if (q) return q.model;
    return cfg.model;
  }
  if (cli.provider !== undefined || cfg.provider !== undefined) {

    const qm = quickModelsMap(cfg);
    const quickAdapter: Record<string, { provider: string; model: string; inputTokenCost: number; outputTokenCost: number }> = {};
    for (const [k, v] of Object.entries(qm)) {
      quickAdapter[k] = {
        provider: v.provider,
        model: v.model,
        inputTokenCost: v.inputTokenCost ?? 0,
        outputTokenCost: v.outputTokenCost ?? 0,
      };
    }
    const found = defaultModelForProvider(resolveProvider(cli, cfg), {
      customProviders: cfg.customProviders,
      quickModels: quickAdapter,
    });
    if (found) return found[0];
  }
  const qm = quickModelsMap(cfg);
  return qm["deepseek-v4-pro"]?.model ?? "deepseek/deepseek-v4-pro";
}

export function resolveProvider(cli: Cli, cfg: Config): string {
  if (cli.provider) return cli.provider;
  if (cfg.provider) return cfg.provider;
  const qm = quickModelsMap(cfg);
  return qm["deepseek-v4-pro"]?.provider ?? "openrouter";
}

export function resolveMaxTokens(cli: Cli, cfg: Config): number {
  return cli.maxTokens ?? cfg.maxTokens ?? 16384;
}

export function resolveMaxAgentTurns(cli: Cli, cfg: Config): number {
  return cli.maxAgentTurns ?? cfg.maxAgentTurns ?? 200;
}

export function resolveNoContextFiles(cli: Cli, cfg: Config): boolean {
  return cli.noContextFiles || (cfg.noContextFiles ?? false);
}

export function resolveNoTools(cli: Cli, cfg: Config): boolean {
  return cli.noTools || (cfg.noTools ?? false);
}

export function resolveTools(cli: Cli, cfg: Config): string[] {
  return cli.tools.length > 0 ? [...cli.tools] : [...(cfg.tools ?? [])];
}

export function resolvePromptsDirs(cli: Cli): string[] {
  const dirs = [...cli.promptsDir];
  const env = process.env["TC_PROMPTS_DIR"];
  if (env) {
    dirs.push(...env.split(process.platform === "win32" ? ";" : ":").filter((s) => s.length > 0));
  }
  return dirs;
}

function splitShellWords(spec: string): string[] {
  const words: string[] = [];
  let cur = "";
  let quote: string | undefined;
  let has = false;
  for (let i = 0; i < spec.length; i++) {
    const ch = spec[i]!;
    if (quote) {
      if (ch === quote) quote = undefined;
      else if (ch === "\\" && quote === '"' && i + 1 < spec.length) cur += spec[++i];
      else cur += ch;
      has = true;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (ch === "\\" && i + 1 < spec.length) {
      cur += spec[++i];
      has = true;
    } else if (ch === " " || ch === "\t") {
      if (has || cur) {
        words.push(cur);
        cur = "";
        has = false;
      }
    } else {
      cur += ch;
      has = true;
    }
  }
  if (quote) throw new Error("unterminated quote");
  if (has || cur) words.push(cur);
  return words;
}

export function isValidServerName(name: string): boolean {
  return (
    name.length > 0 &&
    !name.includes(" ") &&
    !name.includes("=") &&
    !name.includes("__") &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)
  );
}

export function parseCustomMcp(entry: string): [string, McpServerConfig] {
  const eq = entry.indexOf("=");
  if (eq < 0) throw new Error(`--custom-mcp '${entry}': expected NAME=COMMAND ...`);
  const name = entry.slice(0, eq).trim();
  const spec = entry.slice(eq + 1).trim();
  if (!isValidServerName(name)) {
    throw new Error(`--custom-mcp '${entry}': invalid server name '${name}'`);
  }
  let words: string[];
  try {
    words = splitShellWords(spec);
  } catch (e) {
    throw new Error(`--custom-mcp '${entry}': cannot parse command: ${e}`);
  }
  if (words.length === 0) {
    throw new Error(`--custom-mcp '${entry}': command is empty (expected NAME=COMMAND ...)`);
  }
  const [command, ...args] = words as [string, ...string[]];
  return [name, { command, args, env: {} } as unknown as McpServerConfig];
}

export function parseCustomMcpHttp(entry: string): [string, McpServerConfig] {
  const eq = entry.indexOf("=");
  if (eq < 0) throw new Error(`--custom-mcp-http '${entry}': expected NAME=URL`);
  const name = entry.slice(0, eq).trim();
  const url = entry.slice(eq + 1).trim();
  if (!isValidServerName(name)) {
    throw new Error(`--custom-mcp-http '${entry}': invalid server name '${name}'`);
  }
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new Error(`--custom-mcp-http '${entry}': URL must start with http:// or https://`);
  }
  return [name, { url, headers: {} } as unknown as McpServerConfig];
}

export function extraMcpServers(cli: Cli): Record<string, McpServerConfig> {
  const servers: Record<string, McpServerConfig> = {};
  for (const entry of cli.customMcp) {
    const [name, cfg] = parseCustomMcp(entry);
    servers[name] = cfg;
  }
  for (const entry of cli.customMcpHttp) {
    const [name, cfg] = parseCustomMcpHttp(entry);
    servers[name] = cfg;
  }
  return servers;
}

export function mergeCliMcp(cli: Cli, cfg: Config): void {
  const extra = extraMcpServers(cli);
  if (Object.keys(extra).length === 0) return;
  cfg.mcpServers = { ...(cfg.mcpServers ?? {}), ...extra };
}

export function resolveSandbox(cli: Cli, cfg: Config): boolean {
  return cli.sandbox || (cfg.sandbox ?? false) || resolveSandboxRequired(cli, cfg);
}

export function resolveSandboxRequired(cli: Cli, cfg: Config): boolean {
  return cli.sandboxRequired || (cfg.sandboxRequired ?? false);
}

export function sandboxSettingConflict(cli: Cli, cfg: Config): boolean {
  return !cli.sandbox && cfg.sandbox === false && resolveSandboxRequired(cli, cfg);
}

export function resolveSandboxBackend(cli: Cli, cfg: Config): string {
  return cli.sandboxBackend ?? cfg.sandboxBackend ?? "bwrap";
}

export function resolveSandboxExpose(cli: Cli, cfg: Config): string[] {
  return cli.sandboxExpose.length > 0 ? [...cli.sandboxExpose] : [...(cfg.sandboxExpose ?? [])];
}

export function resolveSandboxNetwork(cli: Cli, cfg: Config): boolean {
  return cli.sandboxNetwork ?? cfg.sandboxNetwork ?? true;
}

export function resolveShell(cli: Cli, cfg: Config): string {
  return cli.shell ?? cfg.shell ?? "bash";
}

export function resolveEditSystem(cli: Cli, cfg: Config): EditSystem {
  if (cli.editSystem !== undefined) {
    try {
      return parseEditSystem(cli.editSystem);
    } catch {

    }
  }
  return cfg.editSystem ?? "similarity";
}

export function resolveWtAutoMerge(cli: Cli, cfg: Config): boolean {
  return cli.wtAutoMerge || cli.parallel || (cfg.wtAutoMerge ?? false);
}

export function resolveWtBaseDir(cli: Cli, cfg: Config): string | undefined {
  return cli.wtBaseDir ?? cfg.wtBaseDir;
}

export function resolveWtForce(cli: Cli, cfg: Config): boolean {
  return cli.wtForce || (cfg.wtForce ?? false);
}

export function resolveAdvisorEnabled(cli: Cli, cfg: Config): boolean {
  return cfg.advisor ? cli.advisor || cfg.advisor.enabled : cli.advisor;
}

export function resolveAdvisorModel(cli: Cli, cfg: Config): string {
  return cli.advisorModel ?? cfg.advisor?.model ?? "deepseek-v4-pro";
}

export function resolveAdvisorMaxUses(cli: Cli, cfg: Config): number | undefined {
  return cli.advisorMaxUses ?? cfg.advisor?.maxUses;
}

export function resolveAdvisorHumanHandoff(cli: Cli, cfg: Config): boolean {
  if (cli.advisorHumanHandoff !== undefined) return cli.advisorHumanHandoff;
  return cfg.advisor?.humanHandoff ?? false;
}

export function resolveAdvisorKilobytesLimit(cli: Cli, cfg: Config): number {
  if (cli.advisorKilobytesLimit !== 256) return cli.advisorKilobytesLimit;
  return cfg.advisor?.advisorKilobytesLimit ?? 256;
}

export function resolveDefaultQuickModels(): Record<string, QuickModelConfig> {
  return defaultQuickModels();
}
