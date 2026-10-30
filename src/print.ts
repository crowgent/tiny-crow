// --print-config and session listing output.
// Session reading mirrors session storage's find_recent_sessions locally
// (data dir / sessions, newest first by mtime) until the session slice
// exposes it; the printed shape is identical.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Cli } from "./cli.ts";
import {
  resolveEditSystem,
  resolveMaxAgentTurns,
  resolveMaxTokens,
  resolveModel,
  resolveNoContextFiles,
  resolveNoTools,
  resolveProvider,
  resolveSandbox,
  resolveSandboxBackend,
  resolveSandboxExpose,
  resolveSandboxNetwork,
  resolveSandboxRequired,
  resolveShell,
  resolveTools,
} from "./cli.ts";
import {
  resolveCompactEnabled,
  resolveContextWindow,
  resolveMaxBashOutputLines,
  resolveMaxFindResults,
  resolveMaxGrepResults,
  resolveMaxListDirEntries,
  resolveMaxReadLines,
  resolveReserveTokens,
  resolveSubagentMaxFindResults,
  resolveSubagentMaxGrepResults,
  resolveSubagentMaxListDirEntries,
  resolveSubagentMaxReadLines,
  resolveTemperatureFor,
  type Config,
} from "./config/mod.ts";
import { configFilePath, dataDir } from "./config/load.ts";
import {
  NETWORK_EFFECT_LABEL,
  Sandbox,
  builtinMaskRoots,
  partitionExpose,
  type NetworkEffect,
} from "./sandbox.ts";

export interface SessionLike {
  id: string;
  name: string;
  messages: Array<{ content: string }>;
  updatedAt: string;
  model: string;
}

export function formatTime(rfc3339: string): string {
  const dt = new Date(rfc3339);
  if (Number.isNaN(dt.getTime())) return rfc3339;
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  const hhmm = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  const sameDay =
    dt.getFullYear() === now.getFullYear() &&
    dt.getMonth() === now.getMonth() &&
    dt.getDate() === now.getDate();
  if (sameDay) return hhmm;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (dt.getFullYear() === now.getFullYear()) {
    return `${months[dt.getMonth()]} ${pad(dt.getDate())} ${hhmm}`;
  }
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${hhmm}`;
}

export function findRecentSessions(limit: number): SessionLike[] {
  const dir = path.join(dataDir(), "sessions");
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const p = path.join(dir, f);
      let mtime = 0;
      try {
        mtime = statSync(p).mtimeMs;
      } catch {
        // ignore
      }
      return { mtime, path: p };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
  const sessions: SessionLike[] = [];
  for (const entry of entries) {
    try {
      const raw = JSON.parse(readFileSync(entry.path, "utf-8")) as Record<string, unknown>;
      sessions.push({
        id: String(raw["id"] ?? ""),
        name: String(raw["name"] ?? ""),
        messages: Array.isArray(raw["messages"])
          ? (raw["messages"] as Array<Record<string, unknown>>).map((m) => ({
              content: String(m["content"] ?? ""),
            }))
          : [],
        updatedAt: String(raw["updated_at"] ?? ""),
        model: String(raw["model"] ?? ""),
      });
    } catch {
      // skip unreadable session files, as the original does
    }
  }
  return sessions;
}

export function formatSandboxExposeDisplay(sandboxExpose: string[]): string {
  return sandboxExpose.length === 0 ? "(none)" : sandboxExpose.join(", ");
}

export function formatSandboxNetworkDisplay(effect: NetworkEffect): string {
  return NETWORK_EFFECT_LABEL[effect];
}

export function printSection(title: string, entries: Array<[string, string]>): void {
  console.log(`${title}:`);
  const width = entries.reduce((max, [k]) => Math.max(max, k.length), 0);
  for (const [k, v] of entries) {
    console.log(`  ${k.padEnd(width)}  ${v}`);
  }
  console.log();
}

export function printSessions(sessions?: SessionLike[]): void {
  const list = sessions ?? findRecentSessions(20);
  if (list.length === 0) {
    console.log("no saved sessions");
    return;
  }
  console.log(`recent sessions (${list.length}):`);
  for (const s of list) {
    const last = s.messages.length > 0
      ? `...${[...s.messages[s.messages.length - 1]!.content].slice(0, 30).join("")}`
      : "";
    const time = formatTime(s.updatedAt);
    const nameCol = s.name.length > 0 ? `  [${s.name}]` : "";
    console.log(
      `  ${s.id.slice(0, 8)}  ${time}  ${s.messages.length}msgs  ${s.model}  ${last}${nameCol}`,
    );
  }
  console.log();
  console.log("Use --session <id-or-name> to load a session by its ID prefix or name.");
}

export function printConfig(cli: Cli, cfg: Config): void {
  // storage config_path returns TC_CONFIG_DIR or data_dir; the print table
  // in the original shows that value, not the config file's directory.
  const configDirDisplay = process.env["TC_CONFIG_DIR"]
    ? process.env["TC_CONFIG_DIR"]
    : dataDir();
  const sessionsDir = path.join(dataDir(), "sessions");
  const configFile = configFilePath();
  const model = resolveModel(cli, cfg);
  const provider = resolveProvider(cli, cfg);
  const qmMap = cfg.quickModels ?? {};
  const maxTokens = resolveMaxTokens(cli, cfg);
  const maxAgentTurns = resolveMaxAgentTurns(cli, cfg);
  const contextWindow = resolveContextWindow(cfg, provider, model, qmMap);
  const temperature = resolveTemperatureFor(cli, cfg, model);
  const noTools = resolveNoTools(cli, cfg);
  const resolvedTools = resolveTools(cli, cfg);
  const toolsAllowlist = resolvedTools.length === 0 ? "all" : resolvedTools.join(",");
  const noContextFiles = resolveNoContextFiles(cli, cfg);
  const sandbox = resolveSandbox(cli, cfg);
  const sandboxRequired = resolveSandboxRequired(cli, cfg);
  const sandboxBackend = resolveSandboxBackend(cli, cfg);
  const sandboxExposeRaw = resolveSandboxExpose(cli, cfg);
  const sandboxNetworkDisplay = formatSandboxNetworkDisplay(
    new Sandbox(sandbox, sandboxBackend)
      .withRequired(sandboxRequired)
      .withNetwork(resolveSandboxNetwork(cli, cfg))
      .networkEffect(),
  );
  const home = os.homedir() || "";
  const [sandboxExpose] = partitionExpose(sandboxExposeRaw, builtinMaskRoots(), home || undefined);
  const sandboxExposeDisplay = formatSandboxExposeDisplay(sandboxExpose);
  const shell = resolveShell(cli, cfg);
  const editSystem = resolveEditSystem(cli, cfg);
  const compact = resolveCompactEnabled(cfg);

  const mode = cli.dangerouslySkipPermissions
    ? "dangerously-skip-permissions"
    : cli.yolo || (cfg.yolo ?? false)
      ? "yolo"
      : cli.acceptAll || (cfg.acceptAll ?? false)
        ? "standard"
        : cli.readOnly
          ? "readonly"
          : cli.guarded
            ? "guarded"
            : cli.restrictive || (cfg.restrictive ?? false)
              ? "restrictive"
              : (cfg.defaultPermissionMode ?? "standard");

  printSection("Directories", [
    ["config", configDirDisplay],
    ["data", dataDir()],
    ["sessions", sessionsDir],
    ["config file", configFile],
  ]);

  const modelEntries: Array<[string, string]> = [
    ["provider", provider],
    ["model", model],
  ];
  if (temperature !== undefined) modelEntries.push(["temperature", String(temperature)]);
  printSection("Model", modelEntries);

  const fmtOpt = (v: number | undefined): string =>
    v !== undefined ? String(v) : "— (no cap)";

  const limitEntries: Array<[string, string]> = [
    ["max-tokens", String(maxTokens)],
    ["max-agent-turns", String(maxAgentTurns)],
    ["context-window", String(contextWindow)],
    ["reserve-tokens", String(resolveReserveTokens(cfg, model, qmMap))],
    ["max-read-lines", String(resolveMaxReadLines(cfg))],
    ["max-bash-output-lines", fmtOpt(resolveMaxBashOutputLines(cfg))],
    ["max-grep-results", String(resolveMaxGrepResults(cfg))],
    ["max-find-results", String(resolveMaxFindResults(cfg))],
    ["max-list-dir-entries", fmtOpt(resolveMaxListDirEntries(cfg))],
    ["subagent-max-read-lines", String(resolveSubagentMaxReadLines(cfg))],
    ["subagent-max-grep-results", String(resolveSubagentMaxGrepResults(cfg))],
    ["subagent-max-find-results", String(resolveSubagentMaxFindResults(cfg))],
    ["subagent-max-list-dir-entries", fmtOpt(resolveSubagentMaxListDirEntries(cfg))],
  ];
  printSection("Limits", limitEntries);

  printSection("Behavior", [
    ["permission-mode", mode],
    ["shell", shell],
    ["edit-system", editSystem],
    ["sandbox", String(sandbox)],
    ["sandbox-backend", sandboxBackend],
    ["sandbox-required", String(sandboxRequired)],
    ["sandbox-expose", sandboxExposeDisplay],
    ["sandbox-network", sandboxNetworkDisplay],
    ["no-tools", String(noTools)],
    ["tools", toolsAllowlist],
    ["no-context-files", String(noContextFiles)],
    ["compact", String(compact)],
  ]);

  const advisorEnabled = cli.advisor || (cfg.advisor?.enabled ?? false);
  const humanHandoff = cli.advisorHumanHandoff ?? cfg.advisor?.humanHandoff ?? false;
  const advisorModel = cli.advisorModel ?? cfg.advisor?.model ?? "deepseek-v4-pro";
  const maxUses = cli.advisorMaxUses ?? cfg.advisor?.maxUses;
  const kbLimit = cli.advisorKilobytesLimit !== 256
    ? cli.advisorKilobytesLimit
    : (cfg.advisor?.advisorKilobytesLimit ?? 256);
  printSection("Advisor", [
    ["enabled", String(advisorEnabled)],
    ["model", advisorModel],
    ["human-handoff", String(humanHandoff)],
    ["max-uses", maxUses !== undefined ? String(maxUses) : "unlimited"],
    ["context-limit", `${kbLimit} KB (${Math.floor((kbLimit * 1024) / 2)} head / ${Math.floor((kbLimit * 1024) / 2)} tail)`],
  ]);
}
