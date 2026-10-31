import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import * as readline from "node:readline";
import type { Cli } from "./cli.ts";
import {
  resolveEditSystem,
  resolveNoContextFiles,
  resolvePromptsDirs,
  resolveQuickModel,
  resolveSandbox,
  resolveSandboxBackend,
  resolveSandboxExpose,
  resolveSandboxNetwork,
  resolveNoTools,
  resolveSandboxRequired,
  resolveShell,
  resolveTools,
  resolveModel,
  resolveProvider,
} from "./cli.ts";
import {
  buildPermissionConfig,
  catalogContextWindowOf,
  catalogInputOutputCostOf,
  customProvidersMap,
  quickModelsMap,
  quickModelsMapRef,
  resolveContextWindow,
  isAnthropicNative,
  resolvePromptModel,
  resolveTemperatureFor,
  resolveExtraBodyFor,
  type Config,
} from "./config/mod.ts";
import { loadArchitecture, loadWithPromptsDirs, type ContextFiles } from "./context/mod.ts";
import * as promptsMod from "./context/prompts.ts";
import * as themesMod from "./context/themes.ts";
import { Sandbox, buildSandbox } from "./sandbox.ts";
import { billableInputTokens, estimateCost } from "./pricing.ts";
import { resolveAdvisorEnabled, resolveAdvisorHumanHandoff, resolveAdvisorKilobytesLimit, resolveAdvisorMaxUses, resolveAdvisorModel } from "./cli.ts";

export type SecurityMode =
  | "standard"
  | "restrictive"
  | "readonly"
  | "planwrite"
  | "guarded"
  | "yolo";

export interface SessionMessageLike {
  role: string;
  content: string;
  estimatedTokens: number;
  tool?: unknown;
}

export interface PromptRefLike {
  name: string;
  source: "built_in" | "user_file";
}

export interface SessionLike {
  id: string;
  name: string;
  messages: SessionMessageLike[];
  compactions: unknown[];
  createdAt: string;
  updatedAt: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedInputTokens: number;
  totalCacheCreationInputTokens: number;
  totalCost: number;
  totalEstimatedTokens: number;
  calibratedTokens: number;
  calibratedMsgCount: number;
  inputTokenCost: number;
  outputTokenCost: number;
  contextWindow: number;
  model: string;
  provider: string;
  workingDir: string;
  permissionAllowlist: Array<{ tool: string; pattern: string }>;
  nextToolCallId: number;
  prompt?: PromptRefLike;
  showCostAlways?: boolean;
}

export function estimateTokens(text: string): number {
  let wide = 0;
  let narrow = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const isWide =
      (cp >= 0x1100 && cp <= 0x11ff) ||
      (cp >= 0x2e80 && cp <= 0x9fff) ||
      (cp >= 0xa000 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff);
    if (isWide) wide++;
    else narrow++;
  }
  return Math.max(1, Math.floor((wide * 9) / 10) + Math.floor(narrow / 4));
}

export function createSession(
  provider: string,
  model: string,
  contextWindow: number,
  name: string,
): SessionLike {
  const now = new Date().toISOString();
  let workingDir = "";
  try {
    workingDir = process.cwd();
  } catch {
    workingDir = "";
  }
  return {
    id: randomUUID(),
    name,
    messages: [],
    compactions: [],
    createdAt: now,
    updatedAt: now,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCachedInputTokens: 0,
    totalCacheCreationInputTokens: 0,
    totalCost: 0,
    totalEstimatedTokens: 0,
    calibratedTokens: 0,
    calibratedMsgCount: 0,
    inputTokenCost: 0,
    outputTokenCost: 0,
    contextWindow,
    model,
    provider,
    workingDir,
    permissionAllowlist: [],
    nextToolCallId: 0,
    prompt: undefined,
    showCostAlways: false,
  };
}

export function addSessionMessage(
  session: SessionLike,
  role: string,
  content: string,
): void {
  const tokens = estimateTokens(content);
  session.messages.push({ role, content, estimatedTokens: tokens });
  session.totalEstimatedTokens += tokens;
  session.updatedAt = new Date().toISOString();
}

export function addToolCall(
  session: SessionLike,
  name: string,
  args: unknown,
): number {
  const id = session.nextToolCallId;
  session.nextToolCallId += 1;
  const summary = typeof args === "object" && args !== null && "path" in (args as Record<string, unknown>)
    ? `${name}(${(args as Record<string, unknown>)["path"]})`
    : name;
  session.messages.push({
    role: "tool_call",
    content: summary,
    estimatedTokens: estimateTokens(summary),
    tool: { kind: "call", id, name, args },
  });
  return id;
}

export function addToolResult(
  session: SessionLike,
  callId: number,
  name: string,
  output: string,
): string {
  const content = `${name}:\n${output}`;
  session.messages.push({
    role: "tool_result",
    content,
    estimatedTokens: estimateTokens(content),
    tool: { kind: "result", callId, name },
  });
  return content;
}

export async function promptYnAsync(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  process.stderr.write(question);
  const answer = await new Promise<string>((resolve) => {
    rl.once("line", (line) => resolve(line));
  });
  rl.close();
  const t = answer.trim().toLowerCase();
  return t === "y" || t === "yes";
}

export function regenResource(regen: () => void, what: string, suffix: string): boolean {
  try {
    regen();
    console.error(`${what} updated${suffix}.`);
    return true;
  } catch (e) {
    console.error(`warning: failed to update ${what.toLowerCase()}: ${e}`);
    return false;
  }
}

export function resolveMode(cli: Cli, cfg: Config): SecurityMode {
  if (cli.yolo || (cfg.yolo ?? false)) return "yolo";
  if (cli.acceptAll || (cfg.acceptAll ?? false)) return "standard";
  if (cli.readOnly) return "readonly";
  if (cli.guarded) return "guarded";
  if (cli.restrictive || (cfg.restrictive ?? false)) return "restrictive";
  if (cfg.defaultPermissionMode) {
    switch (cfg.defaultPermissionMode) {
      case "yolo":
        return "yolo";
      case "accept":
      case "standard":
        return "standard";
      case "guarded":
        return "guarded";
      case "readonly":
        return "readonly";
      case "restrictive":
        return "restrictive";
      default:
        return "standard";
    }
  }
  return "standard";
}

export function parsePromptMode(content: string): [string | undefined, string] {
  const nl = content.indexOf("\n");
  const first = nl >= 0 ? content.slice(0, nl) : content;
  const trimmed = first.trim();
  if (trimmed.startsWith("%%mode=")) {
    const mode = trimmed.slice("%%mode=".length).trim();
    if (!mode) return [undefined, content];
    return [mode, nl >= 0 ? content.slice(nl + 1) : ""];
  }
  return [undefined, content];
}

export function resolveStartupPromptMode(
  promptsMap: Record<string, string>,
  name: string,
): SecurityMode | undefined {
  const content = promptsMap[name];
  if (!content) return undefined;
  const [directive] = parsePromptMode(content);
  if (!directive || directive === "last_user_mode") return undefined;
  switch (directive) {
    case "standard":
      return "standard";
    case "restrictive":
      return "restrictive";
    case "readonly":
      return "readonly";
    case "guarded":
      return "guarded";
    case "yolo":
      return "yolo";
    default:
      return undefined;
  }
}

export interface AskChannel<T> {
  send(value: T): void;
  receive(): Promise<T>;
}

export function createChannel<T>(): [AskChannel<T>, AskChannel<T>] {
  const queue: T[] = [];
  const waiters: Array<(v: T) => void> = [];
  const channel: AskChannel<T> = {
    send(value: T): void {
      const waiter = waiters.shift();
      if (waiter) waiter(value);
      else queue.push(value);
    },
    receive(): Promise<T> {
      const queued = queue.shift();
      if (queued !== undefined) return Promise.resolve(queued);
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
  return [channel, channel];
}

export interface PermissionCheckerLike {
  loadSessionAllowlist(entries: Array<[string, string]>): void;
  setPromptMode(mode: SecurityMode): void;
}

async function loadPermissionChecker(
  cli: Cli,
  cfg: Config,
): Promise<
  | { permission: PermissionCheckerLike; askTx: AskChannel<unknown>; askRx: AskChannel<unknown> }
  | { permission: undefined; askTx: undefined; askRx: undefined }
> {
  if (resolveNoTools(cli, cfg)) return { permission: undefined, askTx: undefined, askRx: undefined };
  if (cli.dangerouslySkipPermissions) {
    return { permission: undefined, askTx: undefined, askRx: undefined };
  }
  let mod: Record<string, unknown>;
  try {
    mod = (await import("./permission/checker.ts")) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`permission slice not available (./permission/checker.ts): ${e}`);
  }
  const Checker = mod["PermissionChecker"] as
    | (new (
        configs: unknown,
        mode: SecurityMode,
        allowlist: unknown,
        modes: string[] | undefined,
      ) => PermissionCheckerLike)
    | undefined;
  if (!Checker) {
    throw new Error("permission slice does not export PermissionChecker from ./permission/checker.ts");
  }
  const checker = new Checker(
    buildPermissionConfig(cfg),
    resolveMode(cli, cfg),
    undefined,
    cfg.permissionModes,
  );
  const [tx, rx] = createChannel<unknown>();
  return { permission: checker, askTx: tx, askRx: rx };
}

export function applyStartupPromptModel(
  promptName: string,
  cfg: Config,
  state: { provider: string; model: string; session: SessionLike },
): void {
  const qmName = resolvePromptModel(cfg, promptName);
  if (!qmName) return;
  const qm = quickModelsMapRef(cfg);
  const qmc = qm[qmName];
  if (!qmc) return;
  state.provider = qmc.provider;
  state.model = qmc.model;
  state.session.model = qmc.model;
  state.session.provider = qmc.provider;
  state.session.inputTokenCost = qmc.inputTokenCost ?? 0;
  state.session.outputTokenCost = qmc.outputTokenCost ?? 0;
  state.session.contextWindow = resolveContextWindow(cfg, state.session.provider, state.session.model, qm);
}

async function loadSessionModule(): Promise<Record<string, unknown>> {
  try {
    return (await import("./session/storage.ts")) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`session slice not available (./session/storage.ts): ${e}`);
  }
}

async function loadProviderModule(): Promise<Record<string, unknown>> {
  try {
    return (await import("./provider.ts")) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`provider slice not available (./provider.ts): ${e}`);
  }
}

export interface StartupOptions {
  isFirstStartup: boolean;
  versionChanged: boolean;
  isInteractive: boolean;
}

export class Startup {
  cli: Cli;
  cfg: Config;
  isFirstStartup: boolean;
  context: ContextFiles;
  provider: string;
  model: string;
  session: SessionLike;
  client: unknown;
  isInteractive: boolean;
  versionChanged: boolean;
  permission?: PermissionCheckerLike;
  askTx?: AskChannel<unknown>;
  askRx?: AskChannel<unknown>;
  sandbox: Sandbox;
  statusSignals?: unknown;
  handoffRx?: AskChannel<unknown>;
  archMsg?: string;
  sessionResumed: boolean;

  private constructor(init: {
    cli: Cli;
    cfg: Config;
    isFirstStartup: boolean;
    context: ContextFiles;
    provider: string;
    model: string;
    session: SessionLike;
    client: unknown;
    isInteractive: boolean;
    versionChanged: boolean;
    sessionResumed: boolean;
  }) {
    this.cli = init.cli;
    this.cfg = init.cfg;
    this.isFirstStartup = init.isFirstStartup;
    this.context = init.context;
    this.provider = init.provider;
    this.model = init.model;
    this.session = init.session;
    this.client = init.client;
    this.isInteractive = init.isInteractive;
    this.versionChanged = init.versionChanged;
    this.sandbox = new Sandbox(false, "bwrap");
    this.sessionResumed = init.sessionResumed;
  }

  static async init(cli: Cli, cfg: Config, opts: StartupOptions): Promise<Startup> {
    const extraPromptsDirs = resolvePromptsDirs(cli);
    for (const dir of extraPromptsDirs) {
      const { existsSync } = await import("node:fs");
      if (!existsSync(dir)) {
        console.error(`warning: --prompts-dir '${dir}' does not exist (skipped)`);
      }
    }
    const context = loadWithPromptsDirs(resolveNoContextFiles(cli, cfg), extraPromptsDirs);

    let provider = resolveProvider(cli, cfg);
    let model = resolveModel(cli, cfg);
    const quick = resolveQuickModel(cli, cfg);
    if (quick) {
      provider = quick.provider;
      model = quick.model;
    }

    const name = cli.name ?? "";
    const qmMap = quickModelsMap(cfg);
    const session = createSession(
      provider,
      model,
      resolveContextWindow(cfg, provider, model, qmMap),
      name,
    );

    if (quick) {
      session.inputTokenCost = quick.inputTokenCost ?? 0;
      session.outputTokenCost = quick.outputTokenCost ?? 0;
    } else {
      const match = Object.values(qmMap).find(
        (v) => v.model === model && v.provider === provider,
      );
      if (match) {
        session.inputTokenCost = match.inputTokenCost ?? 0;
        session.outputTokenCost = match.outputTokenCost ?? 0;
      } else {
        const costs = catalogInputOutputCostOf(provider, model);
        if (costs) {
          session.inputTokenCost = costs[0];
          session.outputTokenCost = costs[1];
        }
      }
    }

    const sessionMod = await loadSessionModule();
    let sessionResumed = false;

    if (cli.continueSession && !cli.session) {
      const findRecent = sessionMod["findRecentSessions"] as
        | ((limit: number) => Promise<SessionLike[]> | SessionLike[])
        | undefined;
      if (findRecent) {
        const sessions = await findRecent(1);
        const first = sessions[0];
        if (first) {
          Object.assign(session, first);
          sessionResumed = true;
        }
      }
    }

    if (cli.session) {
      const sessionId = cli.session;
      const findByPrefix = sessionMod["findSessionsByPrefix"] as
        | ((prefix: string) => Promise<SessionLike[]> | SessionLike[])
        | undefined;
      const findByName = sessionMod["findSessionByName"] as
        | ((name: string) => Promise<SessionLike | undefined> | SessionLike | undefined)
        | undefined;
      const matches = findByPrefix ? await findByPrefix(sessionId) : [];
      if (matches.length === 0) {
        const byName = findByName ? await findByName(sessionId) : undefined;
        if (byName) {
          Object.assign(session, byName);
          sessionResumed = true;
        } else {
          throw new Error(`no session matching '${sessionId}'`);
        }
      } else if (matches.length === 1) {
        Object.assign(session, matches[0]);
        sessionResumed = true;
      } else {
        console.error(`multiple sessions match '${sessionId}':`);
        for (const s of matches) {
          const preview = s.messages.length > 0
            ? [...s.messages[s.messages.length - 1]!.content].slice(0, 40).join("")
            : "";
          const namePart = s.name ? `  [${s.name}]` : "";
          console.error(
            `  ${s.id.slice(0, 8)}  ${s.updatedAt}  ${s.messages.length}msgs  ${s.model}  ${preview}${namePart}`,
          );
        }
        throw new Error("be more specific with the session ID prefix");
      }
    }

    if (cfg.contextWindow === undefined) {
      const cw = catalogContextWindowOf(session.provider, session.model);
      if (cw !== undefined) session.contextWindow = cw;
    }

    const providerMod = await loadProviderModule();
    const setSessionId = providerMod["setOpencodeSessionId"] as
      | ((id: string) => void)
      | undefined;
    setSessionId?.(session.id);
    const createClient = providerMod["createClient"] as
      | ((
          provider: string,
          apiKey: string | undefined,
          customProviders: Record<string, unknown>,
          apiKeys: Record<string, string> | undefined,
        ) => unknown)
      | undefined;
    if (!createClient) throw new Error("provider slice does not export createClient");
    const client = createClient(
      provider,
      cli.apiKey,
      customProvidersMap(cfg) as Record<string, unknown>,
      cfg.apiKeys,
    );

    return new Startup({
      cli,
      cfg,
      isFirstStartup: opts.isFirstStartup,
      context,
      provider,
      model,
      session,
      client,
      isInteractive: opts.isInteractive,
      versionChanged: opts.versionChanged,
      sessionResumed,
    });
  }

  async initFeatures(): Promise<void> {

    try {
      const subMod = (await import("./extras/subagents/mod.ts")) as Record<string, unknown>;
      const initSub = subMod["init"] as
        | ((client: unknown, model: string, maxTurns: number, cfg: unknown, tools: string[], architecture?: string) => void)
        | undefined;
      if (initSub) {
        const taskMaxTurns = this.cfg.taskMaxTurns ?? 20;
        const qm = quickModelsMapRef(this.cfg);
        let subProvider: string;
        let subModel: string;
        if (this.cfg.subagentModel) {
          const q = qm[this.cfg.subagentModel];
          if (q) {
            subProvider = q.provider;
            subModel = q.model;
          } else {
            subProvider = this.cfg.subagentProvider ?? this.provider;
            subModel = this.cfg.subagentModel;
          }
        } else if (this.cfg.subagentProvider) {
          subProvider = this.cfg.subagentProvider;
          subModel = this.model;
        } else {
          subProvider = this.provider;
          subModel = this.model;
        }
        let subClient: unknown = this.client;
        if (subProvider !== this.provider) {
          try {
            const providerMod = await loadProviderModule();
            const createClient = providerMod["createClient"] as
              | ((provider: string, apiKey: string | undefined, custom: Record<string, unknown>, keys: Record<string, string> | undefined) => unknown)
              | undefined;
            if (createClient) {
              subClient = createClient(
                subProvider,
                this.cli.apiKey,
                customProvidersMap(this.cfg) as Record<string, unknown>,
                this.cfg.apiKeys,
              );
            }
          } catch (e) {
            console.warn(
              `Could not initialize subagent provider '${subProvider}' (${e}); falling back to main provider '${this.provider}'.`,
            );
            subModel = this.model;
            subClient = this.client;
          }
        }
        initSub(
          subClient,
          subModel,
          taskMaxTurns,
          this.cfg,
          resolveTools(this.cli, this.cfg),
          this.context.architecture,
        );
      }
    } catch {

    }

    const providerMod = await loadProviderModule();
    const liveInfoProvider =
      this.provider === "openrouter" ||
      Object.prototype.hasOwnProperty.call(customProvidersMap(this.cfg), this.provider);
    if (liveInfoProvider) {
      const needPricing =
        this.session.inputTokenCost === 0 && this.session.outputTokenCost === 0;
      const needCtx =
        this.cfg.contextWindow === undefined &&
        catalogContextWindowOf(this.provider, this.model) === undefined;
      if (needPricing || needCtx) {
        const fetchLive = providerMod["fetchLiveModelInfo"] as
          | ((
              provider: string,
              apiKey: string | undefined,
              customProviders: Record<string, unknown>,
              apiKeys: Record<string, string> | undefined,
            ) => Promise<Record<string, { inputCost: number; outputCost: number; contextLength?: number }>>)
          | undefined;
        if (fetchLive) {
          try {
            const infos = await Promise.race([
              fetchLive(
                this.provider,
                this.cli.apiKey,
                customProvidersMap(this.cfg) as Record<string, unknown>,
                this.cfg.apiKeys,
              ),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("timeout")), 5000),
              ),
            ]);
            const info = infos[this.model];
            if (info) {
              if (needPricing) {
                this.session.inputTokenCost = info.inputCost;
                this.session.outputTokenCost = info.outputCost;
              }
              if (needCtx && info.contextLength !== undefined) {
                this.session.contextWindow = info.contextLength;
              }
            }
          } catch {

          }
        }
      }
    }

    const sandboxSetup = buildSandbox({
      enabled: resolveSandbox(this.cli, this.cfg),
      required: resolveSandboxRequired(this.cli, this.cfg),
      backend: resolveSandboxBackend(this.cli, this.cfg),
      shell: resolveShell(this.cli, this.cfg),
      expose: resolveSandboxExpose(this.cli, this.cfg),
      network: resolveSandboxNetwork(this.cli, this.cfg),
    });
    this.sandbox = sandboxSetup.sandbox;
    for (const warning of sandboxSetup.warnings) console.warn(warning);
    if (
      !this.cli.sandbox &&
      this.cfg.sandbox === false &&
      resolveSandboxRequired(this.cli, this.cfg)
    ) {
      console.warn("sandbox is set to false but sandbox-required is set, enabling the sandbox anyway");
    }
    const sandboxEnabled = resolveSandbox(this.cli, this.cfg);
    if (sandboxEnabled && !this.sandbox.isEffectivelySandboxed()) {
      const backend = resolveSandboxBackend(this.cli, this.cfg);
      if (resolveSandboxRequired(this.cli, this.cfg)) {
        console.warn(
          `sandbox backend '${backend}' was not found and sandbox-required is set, bash commands will be refused`,
        );
      } else {
        console.warn(
          `sandbox is enabled but backend '${backend}' was not found, commands will run unsandboxed`,
        );
      }
    }

    try {
      const agentMod = (await import("./agent/tools/mod.ts")) as Record<string, unknown>;
      const setEditSystem = agentMod["setEditSystem"] as ((s: string) => void) | undefined;
      setEditSystem?.(resolveEditSystem(this.cli, this.cfg));
      const setDeny = agentMod["setDenyRepeatedReads"] as ((v: boolean) => void) | undefined;
      setDeny?.(this.cfg.denyRepeatedReads ?? true);
    } catch {
      console.warn("agent slice not available; edit-system / deny-repeated-reads not applied");
    }

    if (this.cli.statusSocket) {
      try {
        const extras = (await import("./extras/status_signals.ts")) as Record<string, unknown>;
        const StatusSignals = extras["StatusSignals"] as (new (socket: string) => unknown) | undefined;
        if (StatusSignals) this.statusSignals = new StatusSignals(this.cli.statusSocket);
      } catch {
        console.warn("extras slice not available; status signals disabled");
      }
    }

    const checker = await loadPermissionChecker(this.cli, this.cfg);
    this.permission = checker.permission;
    this.askTx = checker.askTx;
    this.askRx = checker.askRx;

    try {
      const extras = (await import("./extras/advisor/mod.ts")) as Record<string, unknown>;
      const initAdvisor = extras["initConfig"] as ((cfg: unknown) => void) | undefined;
      if (initAdvisor && resolveAdvisorEnabled(this.cli, this.cfg)) {
        const advisorModelName = resolveAdvisorModel(this.cli, this.cfg);
        const qm = quickModelsMapRef(this.cfg);
        const q = qm[advisorModelName];
        const advisorProvider = q ? q.provider : this.provider;
        const advisorModel = q ? q.model : advisorModelName;
        const [handoffTx, handoffRx] = resolveAdvisorHumanHandoff(this.cli, this.cfg) && this.isInteractive
          ? (() => {
              const [tx, rx] = createChannel<unknown>();
              return [tx, rx] as const;
            })()
          : [undefined, undefined] as const;
        this.handoffRx = handoffRx;
        initAdvisor({
          client: null,
          advisorModel,
          humanHandoff: resolveAdvisorHumanHandoff(this.cli, this.cfg),
          maxUses: resolveAdvisorMaxUses(this.cli, this.cfg) ?? null,
          handoffTx: handoffTx ?? null,
          enabled: true,
          kilobytesLimit: resolveAdvisorKilobytesLimit(this.cli, this.cfg),
        });
      }
    } catch {

    }
  }

  async resolvePrompts(): Promise<void> {
    if (this.versionChanged && this.isInteractive && !this.isFirstStartup) {
      const promptsDir = promptsMod.globalDir();
      const themesDir = themesMod.globalDir();
      let regenerated = false;
      const promptsChanged = promptsMod.changedFiles(promptsDir);
      if (promptsChanged.length > 0) {
        const suffix = ` (${promptsChanged.length} files changed)`;
        const auto = this.cfg.autoUpdatePrompts;
        if (auto === true) {
          regenerated = regenResource(() => promptsMod.regen(), "Prompts", suffix) || regenerated;
        } else if (auto === undefined) {
          const { existsSync } = await import("node:fs");
          if (!existsSync(promptsDir)) {
            regenerated = regenResource(() => promptsMod.regen(), "Prompts", " (first launch)") || regenerated;
          } else if (await promptYnAsync(`Update prompts${suffix}? [y/N] `)) {
            regenerated = regenResource(() => promptsMod.regen(), "Prompts", suffix) || regenerated;
          }
        }
      }
      const themesChanged = themesMod.changedFiles(themesDir);
      if (themesChanged.length > 0) {
        const suffix = ` (${themesChanged.length} files changed)`;
        const auto = this.cfg.autoUpdateThemes;
        if (auto === true) {
          regenerated = regenResource(() => themesMod.regen(), "Themes", suffix) || regenerated;
        } else if (auto === undefined) {
          const { existsSync } = await import("node:fs");
          if (!existsSync(themesDir)) {
            regenerated = regenResource(() => themesMod.regen(), "Themes", " (first launch)") || regenerated;
          } else if (await promptYnAsync(`Update themes${suffix}? [y/N] `)) {
            regenerated = regenResource(() => themesMod.regen(), "Themes", suffix) || regenerated;
          }
        }
      }
      if (regenerated) {
        this.context = loadWithPromptsDirs(
          resolveNoContextFiles(this.cli, this.cfg),
          resolvePromptsDirs(this.cli),
        );
      }
    }

    try {
      const hooks = (await import("./extras/hooks/mod.ts")) as Record<string, unknown>;
      const dispatchStart = hooks["dispatchSessionStart"] as
        | ((source: string) => Promise<void>)
        | undefined;
      if (dispatchStart) await dispatchStart(this.sessionResumed ? "resume" : "startup");
    } catch {

    }

    let archCreated = false;
    if (!resolveNoContextFiles(this.cli, this.cfg)) {
      try {
        const archmd = (await import("./extras/archmd/mod.ts")) as Record<string, unknown>;
        const askAndCreate = archmd["askAndCreateAsync"] as
          | ((dir: string) => Promise<boolean>)
          | undefined;
        if (askAndCreate) {
          archCreated = await askAndCreate(process.cwd());
        }
      } catch (e) {
        console.warn(`Architecture.md prompt failed: ${e}`);
      }
    }
    if (archCreated) {
      this.context.architecture = loadArchitecture();
      this.archMsg =
        "I've just created an empty ARCHITECTURE.md template at the project root. " +
        "Explore the codebase thoroughly using the `task` tool (delegating parallel exploration to subagents) " +
        "and fill ARCHITECTURE.md with a high-level architecture document covering:\n" +
        "- Directory layout and module responsibilities\n" +
        "- Key types, traits, and their relationships\n" +
        "- Control flow (how requests/events flow through the system)\n" +
        "- Data flow (how data is transformed from input to output)\n" +
        "- Design decisions and rationale\n" +
        "- External dependencies and how they are used\n" +
        "- Entry points for different execution modes\n\n" +
        "Keep the document under ~300 lines of code total. Keep entries concise and reference specific source files.";
    }

    const defaultPrompt = this.cfg.defaultPrompt ?? "code";
    const applyPrompt = (name: string, content: string): void => {
      const [modeDirective, cleanContent] = parsePromptMode(content);
      const promptText = modeDirective !== undefined ? cleanContent : content;
      this.context.currentPrompt = promptText;
      this.context.currentPromptName = name;
      this.session.prompt = {
        name,
        source: promptsMod.sourceOfWithExtra(name, resolvePromptsDirs(this.cli)),
      };
      applyStartupPromptModel(name, this.cfg, this);
    };
    const defaultContent = this.context.prompts[defaultPrompt];
    if (defaultContent !== undefined) applyPrompt(defaultPrompt, defaultContent);

    if (this.cli.loadPrompt) {
      const name = this.cli.loadPrompt;
      const content = this.context.prompts[name];
      if (content === undefined) {
        const sorted = Object.keys(this.context.prompts).sort();
        console.error(`error: unknown prompt '${name}'`);
        console.error("available prompts:");
        for (const p of sorted) console.error(`  ${p}`);
        throw new Error(`unknown prompt '${name}'`);
      }
      applyPrompt(name, content);
    }

    const clientObj = this.client as { providerName?: () => string } | undefined;
    if (clientObj?.providerName && clientObj.providerName() !== this.provider) {
      try {
        const providerMod = await loadProviderModule();
        const createClient = providerMod["createClient"] as
          | ((provider: string, apiKey: string | undefined, custom: Record<string, unknown>, keys: Record<string, string> | undefined) => unknown)
          | undefined;
        if (createClient) {
          this.client = createClient(
            this.provider,
            this.cli.apiKey,
            customProvidersMap(this.cfg) as Record<string, unknown>,
            this.cfg.apiKeys,
          );
        }
      } catch (e) {
        console.warn(`Failed to rebuild client for prompt-mapped provider '${this.provider}': ${e}`);
      }
    }

    if (this.permission) {
      const allowlist = this.session.permissionAllowlist.map(
        (e) => [e.tool, e.pattern] as [string, string],
      );
      this.permission.loadSessionAllowlist(allowlist);
      if (this.context.currentPromptName) {
        const mode = resolveStartupPromptMode(
          this.context.prompts,
          this.context.currentPromptName,
        );
        if (mode) this.permission.setPromptMode(mode);
      }
    }
  }

  async dispatch(): Promise<void> {
    if (this.cli.print) await this.dispatchPrint();
    else if (this.cli.loopMode) await this.dispatchLoop();
    else await this.dispatchInteractive();
    try {
      const hooks = (await import("./extras/hooks/mod.ts")) as Record<string, unknown>;
      const dispatchEnd = hooks["dispatchSessionEnd"] as
        | ((reason: string) => Promise<void>)
        | undefined;
      if (dispatchEnd) await dispatchEnd("exit");
    } catch {

    }
  }

  async dispatchPrint(): Promise<void> {
    const msg = this.cli.message.join(" ");
    if (msg.startsWith("!")) {
      const cmd = msg.slice(1).trim();
      if (cmd) {
        const output = spawnSync(this.cli.shell ?? "bash", ["-c", cmd], { encoding: "utf-8" });
        let result = "";
        if (output.stdout) result += output.stdout;
        if (output.stderr) {
          if (result) result += "\n";
          result += output.stderr;
        }
        result = result.trim();
        console.log(result);
        if (!this.cli.noSession) {
          addSessionMessage(this.session, "user", msg);
          addSessionMessage(this.session, "assistant", result);
          await this.saveSession();
        }
      } else {
        console.error("error: empty command after '!'");
      }
      return;
    }

    const providerMod = await loadProviderModule();
    const buildAgent = providerMod["buildAgent"] as
      | ((model: unknown, build: Record<string, unknown>) => Promise<unknown>)
      | undefined;
    if (!buildAgent) throw new Error("provider slice does not export buildAgent");
    const clientObj = this.client as {
      completionModel?: (model: string) => unknown;
    };
    const completionModel = clientObj.completionModel
      ? clientObj.completionModel(this.model)
      : this.model;
    const agent = (await buildAgent(completionModel, {
      cli: this.cli,
      cfg: this.cfg,
      context: this.context,
      permission: this.permission,
      askTx: undefined,
      sandbox: this.sandbox,
      reasoningEnabled: true,
      temperature: resolveTemperatureFor(this.cli, this.cfg, this.model),
      extraBody: resolveExtraBodyFor(this.cfg, this.model),
    })) as {
      runPrint: (
        msg: string,
        pureStdout: boolean,
        retry: unknown,
        history: unknown,
      ) => Promise<{
        response: string;
        usage: {
          inputTokens?: number;
          outputTokens?: number;
          cachedInputTokens?: number;
          cacheCreationInputTokens?: number;
        };
        toolInteractions: Array<{
          name: string;
          args: unknown;
          output: string;
          subagentCalls?: Array<{ name: string; args: unknown }>;
        }>;
      }>;
    };

    let history: unknown = this.session.messages;
    try {
      const agentMod = (await import("./agent/tools/mod.ts")) as Record<string, unknown>;
      const convertHistory = agentMod["convertHistory"] as
        | ((session: SessionLike) => unknown)
        | undefined;
      if (convertHistory) history = convertHistory(this.session);
    } catch {

    }

    const rawOutcome = await agent.runPrint(
      msg,
      this.cli.pureStdout,
      this.cfg.retry,
      history,
    );

    const response =
      (rawOutcome as { response?: string }).response ??
      (rawOutcome as { output?: string }).output ??
      "";
    const usage = (rawOutcome as { usage?: {
      inputTokens?: number;
      outputTokens?: number;
      cachedInputTokens?: number;
      cacheCreationInputTokens?: number;
    } }).usage ?? {};
    const toolInteractions = (rawOutcome as { toolInteractions?: Array<{
      name: string;
      args: unknown;
      output: string;
      subagentCalls?: Array<{ name: string; args: unknown }>;
    }> }).toolInteractions ?? [];
    if (!this.cli.noSession) {
      addSessionMessage(this.session, "user", msg);
      for (const interaction of toolInteractions) {
        const callId = addToolCall(this.session, interaction.name, interaction.args);
        for (const sub of interaction.subagentCalls ?? []) {
          this.session.messages.push({
            role: "subagent_tool_call",
            content: sub.name,
            estimatedTokens: estimateTokens(sub.name),
            tool: { kind: "subagentCall", parentCallId: callId, name: sub.name, args: sub.args },
          });
        }
        addToolResult(this.session, callId, interaction.name, interaction.output);
      }
      addSessionMessage(this.session, "assistant", response);
      const inputTokens = usage.inputTokens ?? 0;
      const outputTokens = usage.outputTokens ?? 0;
      const cached = usage.cachedInputTokens ?? 0;
      const cacheCreation = usage.cacheCreationInputTokens ?? 0;
      this.session.totalInputTokens += inputTokens;
      this.session.totalOutputTokens += outputTokens;
      this.session.totalCachedInputTokens += cached;
      this.session.totalCacheCreationInputTokens += cacheCreation;
      this.session.totalCost += estimateCost(
        billableInputTokens(
          isAnthropicNative(this.cfg, this.session.provider, this.session.model),
          inputTokens,
          cached,
          cacheCreation,
        ),
        outputTokens,
        this.session.inputTokenCost,
        this.session.outputTokenCost,
      );
      await this.saveSession();
    }
  }

  async dispatchLoop(): Promise<void> {
    let extras: Record<string, unknown>;
    try {
      extras = (await import("./extras/mod.ts")) as Record<string, unknown>;
    } catch (e) {
      throw new Error(`extras slice not available for loop mode (./extras/mod.ts): ${e}`);
    }
    const runLoop = extras["runHeadlessLoop"] as
      | ((agent: unknown, options: Record<string, unknown>) => Promise<void>)
      | undefined;
    if (!runLoop) throw new Error("extras slice does not export runHeadlessLoop");
    const providerMod = await loadProviderModule();
    const buildAgent = providerMod["buildAgent"] as
      | ((model: unknown, build: Record<string, unknown>) => Promise<unknown>)
      | undefined;
    if (!buildAgent) throw new Error("provider slice does not export buildAgent");
    const clientObj = this.client as { completionModel?: (model: string) => unknown };
    const completionModel = clientObj.completionModel
      ? clientObj.completionModel(this.model)
      : this.model;
    const agent = await buildAgent(completionModel, {
      cli: this.cli,
      cfg: this.cfg,
      context: this.context,
      permission: this.permission,
      askTx: undefined,
      sandbox: this.sandbox,
      reasoningEnabled: true,
      temperature: resolveTemperatureFor(this.cli, this.cfg, this.model),
      extraBody: resolveExtraBodyFor(this.cfg, this.model),
    });
    await runLoop(agent, {
      loopPrompt: this.cli.loopPrompt,
      message: this.cli.message.join(" "),
      planFile: this.cli.loopPlan,
      maxIterations: this.cli.loopMax ?? null,
      runCmd: this.cli.loopRun ?? null,
      statusSignals: this.statusSignals ?? null,
    });
  }

  async dispatchInteractive(): Promise<void> {
    const initialMsg = this.cli.message.join(" ");
    if (initialMsg) addSessionMessage(this.session, "user", initialMsg);
    if (typeof (this.session as unknown as { addMessage?: unknown }).addMessage !== "function") {
      try {
        const sessionSlice = (await import("./session/mod.ts")) as Record<string, unknown>;
        const SessionCtor = sessionSlice["Session"] as
          | (new (init: Record<string, unknown>) => unknown)
          | undefined;
        if (SessionCtor) {
          this.session = new SessionCtor({ ...this.session }) as unknown as SessionLike;
        }
      } catch {
      }
    }
    
    let stateMod: Record<string, unknown>;
    let appMod: Record<string, unknown>;
    try {
      stateMod = (await import("./ui/state.ts")) as Record<string, unknown>;
      appMod = (await import("./crowtui/app.ts")) as Record<string, unknown>;
    } catch (e) {
      throw new Error(`ui slice not available (./ui/state.ts, ./crowtui/app.ts): ${e}`);
    }
    const UiContext = stateMod["UiContext"] as
      | (new (opts: Record<string, unknown>) => unknown)
      | undefined;
    const App = appMod["CrowApp"] as
      | { create: (opts: Record<string, unknown>) => Promise<{ run: () => Promise<void> }> }
      | undefined;
    if (!UiContext || !App) {
      throw new Error("ui slice does not export UiContext / CrowApp.create");
    }
    const uiContext = new UiContext({
      cli: this.cli,
      cfg: this.cfg,
      session: this.session,
      context: this.context,
      client: this.client,
      permission: this.permission ?? null,
      sandbox: this.sandbox,
      statusSignals: this.statusSignals ?? null,
      saveSession: async (session: SessionLike) => {
        await this.saveSessionFor(session);
      },
    });

    const slashHandler = async (
      text: string,
      handlerCtx: Record<string, unknown>,
    ): Promise<Record<string, unknown>> => {
      const slashMod = (await import("./ui/slash/mod.ts")) as Record<string, unknown>;
      const outcomeMod = (await import("./ui/slash/outcome.ts")) as Record<string, unknown>;
      const eventsMod = (await import("./ui/events.ts")) as Record<string, unknown>;
      const docsMod = (await import("./docs.ts")) as Record<string, unknown>;
      const terminalMod = (await import("./ui/terminal.ts")) as Record<string, unknown>;
      const storageMod = (await import("./session/storage.ts")) as Record<string, unknown>;
      const hooksMod = (await import("./extras/hooks/mod.ts")) as Record<string, unknown>;
      const memoryMod = (await import("./extras/memory/mod.ts")) as Record<string, unknown>;
      const exportMod = (await import("./extras/export.ts")) as Record<string, unknown>;
      const loopMod = (await import("./extras/loop/mod.ts")) as Record<string, unknown>;
      const oauthMod = (await import("./extras/mcp/oauth.ts")) as Record<string, unknown>;
      const providerMod = (await import("./provider.ts")) as Record<string, unknown>;
      const catalogMod = (await import("./models_catalog.ts")) as Record<string, unknown>;
      const loadMod = (await import("./config/load.ts")) as Record<string, unknown>;
      const chatHistoryMod = (await import("./session/chat_history.ts")) as Record<string, unknown>;
      const ui = handlerCtx["ui"] as Record<string, unknown>;
      const SlashCtx = slashMod["SlashCtx"] as new (init: Record<string, unknown>) => Record<string, unknown>;
      const handleSlash = slashMod["handleSlash"] as (text: string, ctx: unknown) => Promise<void>;
      const isSlashDeferredError = outcomeMod["isSlashDeferredError"] as (e: unknown) => e is { outcome: unknown };
      const getDispatcher = hooksMod["getDispatcher"] as (() => unknown) | undefined;
      let mem: Record<string, unknown> | null = null;
      const openMem = (): Record<string, unknown> =>
        (memoryMod["Mem"] as { open: () => Record<string, unknown> }).open();
      const memoryStore = {
        memoryMd: () => (openMem()["memoryMd"] as () => string)(),
        scratchpad: () => (openMem()["scratchpad"] as () => string)(),
        dailyFile: (date: string) => (openMem()["dailyFile"] as (d: string) => string)(date),
        today: new Date().toISOString().slice(0, 10),
        search: (query: string) => {
          if (mem === null) mem = openMem();
          const results = (mem["search"] as (q: string) => unknown)(query);
          return {
            render: (maxChars: number) =>
              (memoryMod["renderSearchResults"] as (r: unknown, n: number) => string)(results, maxChars),
          };
        },
        notePath: (name: string) => {
          const v = (openMem()["notePath"] as (n: string) => string | null)(name);
          return v ?? undefined;
        },
        write: (target: string, content: string, mode: string, name?: string) => {
          if (mem === null) mem = openMem();
          return (mem["write"] as (t: string, c: string, m: string, n?: string) => string)(target, content, mode, name);
        },
      };
      const slashCtx = new SlashCtx({
        client: ui["client"],
        renderer: handlerCtx["renderer"],
        session: ui["session"],
        cli: ui["cli"],
        cfg: ui["cfg"],
        context: ui["context"],
        input: handlerCtx["input"],
        permission: ui["permission"] ?? undefined,
        sandbox: ui["sandbox"],
        mcpManager: ui["mcpManager"] ?? undefined,
        renderSession: eventsMod["renderSession"],
        showWelcome: eventsMod["showWelcome"],
        showGetStarted: docsMod["showGetStarted"],
        suspendTui: terminalMod["suspendTui"],
        sessionStore: {
          findRecentSessions: storageMod["findRecentSessions"],
          findSessionsByPrefix: storageMod["findSessionsByPrefix"],
          saveSession: storageMod["saveSession"],
          deleteSession: storageMod["deleteSession"],
          saveThemeName: (name: string | undefined) =>
            (storageMod["saveThemeName"] as (n: string | null) => void)(name ?? null),
        },
        hooksDispatcher: getDispatcher?.() ?? undefined,
        memoryStore,
        loopFactory: (prompt: string, planFile: string) => {
          const LoopState = loopMod["LoopState"] as new (p: string, f: string, m: null, r: null) => unknown;
          return new LoopState(prompt, planFile, null, null);
        },
        createClient: async (provider: string) => {
          const createClient = providerMod["createClient"] as (
            p: string,
            k: string | undefined,
            c: Record<string, unknown>,
            a: Record<string, string> | undefined,
          ) => unknown;
          return createClient(provider, this.cli.apiKey, customProvidersMap(this.cfg) as Record<string, unknown>, this.cfg.apiKeys);
        },
        buildAgent: async (model: string, reasoning: boolean) => {
          const buildAgent = providerMod["buildAgent"] as (m: unknown, b: Record<string, unknown>) => Promise<unknown>;
          const clientObj = ui["client"] as { completionModel?: (m: string) => unknown };
          const completionModel = clientObj.completionModel ? clientObj.completionModel(model) : model;
          return buildAgent(completionModel, {
            cli: this.cli,
            cfg: this.cfg,
            context: this.context,
            permission: this.permission,
            sandbox: this.sandbox,
            reasoningEnabled: reasoning,
            temperature: resolveTemperatureFor(this.cli, this.cfg, model),
            extraBody: resolveExtraBodyFor(this.cfg, model),
          });
        },
        defaultModelForProvider: providerMod["defaultModelForProvider"],
        parseProvider: (name: string) => providerMod["parseProvider"] !== undefined && (providerMod["parseProvider"] as (n: string) => unknown)(name) !== null,
        catalogEntries: catalogMod["catalogEntries"],
        catalogContextWindow: catalogMod["catalogContextWindow"],
        isAgentModel: providerMod["isAgentModel"],
        fetchLiveModelInfo: async (provider: string, apiKey: string | undefined, customMap: Record<string, unknown>, apiKeys: Record<string, string> | undefined) => {
          const fn = providerMod["fetchLiveModelInfo"] as (p: string, k: string | undefined, c: unknown, a: unknown) => Promise<unknown>;
          return fn(provider, apiKey, customMap, apiKeys);
        },
        saveQuickModel: (name: string, provider: string, model: string, inputCost: number, outputCost: number) => {
          void (loadMod["saveQuickModel"] as (n: string, p: string, m: string, i: number, o: number) => Promise<void>)(name, provider, model, inputCost, outputCost);
        },
        loadHistory: chatHistoryMod["loadHistory"],
        formatTime: eventsMod["formatTime"],
        exportToJsonl: exportMod["sessionToJsonl"],
        exportToHtml: exportMod["sessionToHtml"],
        parseJsonlImport: exportMod["parseJsonlImport"],
        shareGist: exportMod["shareGist"],
        mcpLogout: (name: string) => {
          try {
            const tokenPath = oauthMod["tokenPath"] as (n: string) => string;
            const p = tokenPath(name);
            if (!existsSync(p)) return false;
            rmSync(p, { force: true });
            return true;
          } catch {
            return false;
          }
        },
      });
      try {
        await handleSlash(text, slashCtx);
      } catch (e) {
        if (isSlashDeferredError(e)) return { ok: false, outcome: e.outcome };
        if (e instanceof Error && e.name === "QuitError") throw new Error("Interrupted");
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }

      if (slashCtx["client"] !== undefined && slashCtx["client"] !== ui["client"]) {
        ui["client"] = slashCtx["client"];
      }
      return { ok: true };
    };
    const app = await App.create({
      ui: uiContext,
      autoTriggerMsg: this.archMsg ?? null,
      slashHandler,
    });
    await app.run();
  }

  async saveSessionFor(session: SessionLike): Promise<void> {
    const sessionMod = await loadSessionModule();
    const saveSession = sessionMod["saveSession"] as
      | ((session: SessionLike) => Promise<void> | void)
      | undefined;
    if (!saveSession) throw new Error("session slice does not export saveSession");
    await saveSession(session);
  }

  async saveSession(): Promise<void> {
    const sessionMod = await loadSessionModule();
    const saveSession = sessionMod["saveSession"] as
      | ((session: SessionLike) => Promise<void> | void)
      | undefined;
    if (!saveSession) throw new Error("session slice does not export saveSession");
    await saveSession(this.session);
  }
}

export async function connectHeadlessMcp(
  cfg: Config,
): Promise<unknown | undefined> {
  const servers = cfg.mcpServers;
  if (!servers || Object.keys(servers).length === 0) return undefined;
  try {
    const extras = (await import("./extras/mcp/mod.ts")) as Record<string, unknown>;
    const Manager = extras["McpClientManager"] as
      | { connectAll: (servers: unknown) => Promise<unknown> }
      | undefined;
    if (!Manager) return undefined;
    const manager = (await Promise.race([
      Manager.connectAll(servers),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 10_000),
      ),
    ])) as { notices?: string[] };
    for (const notice of manager.notices ?? []) console.error(notice);
    return manager;
  } catch {
    console.error("MCP connect timed out after 10s (servers may be unreachable)");
    return undefined;
  }
}
