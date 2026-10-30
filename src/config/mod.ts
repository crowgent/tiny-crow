import { defaultRetryConfig, retryConfigFromJson, type RetryConfig } from "../retry.ts";
import {
  advisorFromJson,
  chainFromJson,
  customProviderFromJson,
  defaultAdvisorConfig,
  defaultChainConfig,
  parseEditSystem,
  quickModelFromJson,
  quickModelToJson,
  statusLineFromJson,
  type AdvisorConfig,
  type ChainConfig,
  type ColorsConfig,
  type CustomProviderConfig,
  type EditSystem,
  type LspConfig,
  type QuickModelConfig,
  type RtkConfig,
  type StatusLineConfig,
} from "./types.ts";
import { catalogContextWindow, catalogInputOutputCost } from "../models_catalog.ts";
import { opencodeTransport } from "../provider.ts";
import type { Cli } from "../cli.ts";

export * from "./load.ts";
export * from "./types.ts";

export type PermissionAction = "allow" | "ask" | "deny";
export type ToolPerm =
  | PermissionAction
  | Record<string, PermissionAction>;

export interface PermissionConfig {
  default?: PermissionAction;
  bash?: ToolPerm;
  read?: ToolPerm;
  write?: ToolPerm;
  edit?: ToolPerm;
  grep?: ToolPerm;
  findFiles?: ToolPerm;
  listDir?: ToolPerm;
  todoWrite?: ToolPerm;
  mcpTool?: ToolPerm;
  externalDirectory?: Map<string, PermissionAction>;
  doomLoop?: PermissionAction;
  allowEntries?: Map<string, string[]>;
  askEntries?: Map<string, string[]>;
  denyEntries?: Map<string, string[]>;
}

export interface PermissionConfigs {
  glob: PermissionConfig;
  regex: PermissionConfig;
}

export function defaultPermissionConfig(): PermissionConfig {
  return {};
}

function permissionConfigFromJson(raw: unknown): PermissionConfig {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: PermissionConfig = {};
  const asAction = (v: unknown): PermissionAction | undefined =>
    v === "allow" || v === "ask" || v === "deny" ? v : undefined;
  const asToolPerm = (v: unknown): ToolPerm | undefined => {
    const a = asAction(v);
    if (a) return a;
    if (v && typeof v === "object") {
      const m: Record<string, PermissionAction> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const av = asAction(val);
        if (av) m[k] = av;
      }
      return m;
    }
    return undefined;
  };
  const d = asAction(r["*"]);
  if (d) out.default = d;
  const fields: Array<[string, keyof PermissionConfig]> = [
    ["bash", "bash"],
    ["read", "read"],
    ["write", "write"],
    ["edit", "edit"],
    ["grep", "grep"],
    ["find_files", "findFiles"],
    ["list_dir", "listDir"],
    ["todo_write", "todoWrite"],
    ["mcp_tool", "mcpTool"],
  ];
  for (const [jsonKey, key] of fields) {
    const v = asToolPerm(r[jsonKey]);
    if (v !== undefined) (out as Record<string, unknown>)[key] = v;
  }
  if (r["external_directory"] && typeof r["external_directory"] === "object") {
    const m = new Map<string, PermissionAction>();
    for (const [k, v] of Object.entries(r["external_directory"] as Record<string, unknown>)) {
      const a = asAction(v);
      if (a) m.set(k, a);
    }
    out.externalDirectory = m;
  }
  const doom = asAction(r["doom_loop"]);
  if (doom) out.doomLoop = doom;
  for (const [jsonKey, key] of [
    ["allow_entries", "allowEntries"],
    ["ask_entries", "askEntries"],
    ["deny_entries", "denyEntries"],
  ] as const) {
    if (r[jsonKey] && typeof r[jsonKey] === "object") {
      const m = new Map<string, string[]>();
      for (const [k, v] of Object.entries(r[jsonKey] as Record<string, unknown>)) {
        if (Array.isArray(v)) m.set(k, v.map(String));
      }
      (out as Record<string, unknown>)[key] = m;
    }
  }
  return out;
}

export type ShowToolDetails = boolean | number;
export type ResolvedShowToolDetails =
  | { kind: "off" }
  | { kind: "limited"; lines: number }
  | { kind: "unlimited" };

export function defaultShowToolDetails(): ShowToolDetails {
  return 1;
}

export function resolveShowToolDetails(v: ShowToolDetails): ResolvedShowToolDetails {
  if (v === false) return { kind: "off" };
  if (v === true) return { kind: "unlimited" };
  return { kind: "limited", lines: v };
}

export interface McpServerConfig {
  
  [key: string]: unknown;
}

export interface Config {
  model?: string;
  provider?: string;
  maxTokens?: number;
  temperature?: number;
  extraBody?: unknown;
  retry: RetryConfig;
  noTools?: boolean;
  tools?: string[];
  noContextFiles?: boolean;
  contextWindow?: number;
  reserveTokens?: number;
  keepRecentTokens?: number;
  maxAgentTurns?: number;
  maxTextFileSize?: number;
  maxReadLines?: number;
  maxBashOutputLines?: number;
  maxGrepResults?: number;
  maxFindResults?: number;
  maxListDirEntries?: number;
  subagentMaxReadLines?: number;
  subagentMaxGrepResults?: number;
  subagentMaxFindResults?: number;
  subagentMaxListDirEntries?: number;
  compactEnabled?: boolean;
  midTurnCompactThreshold?: number;
  alwaysShowWelcome?: boolean;
  autoUpdatePrompts?: boolean;
  autoUpdateThemes?: boolean;
  customProviders?: Record<string, CustomProviderConfig>;
  permission?: unknown;
  permissionRegex?: unknown;
  permissionAllow?: Record<string, string[]>;
  permissionAsk?: Record<string, string[]>;
  permissionDeny?: Record<string, string[]>;
  restrictive?: boolean;
  acceptAll?: boolean;
  yolo?: boolean;
  sandbox?: boolean;
  sandboxBackend?: string;
  sandboxRequired?: boolean;
  sandboxExpose?: string[];
  sandboxNetwork?: boolean;
  allowAllMcpCalls?: boolean;
  enableExaMcp?: boolean;
  enableContext7Mcp?: boolean;
  enableGrepappMcp?: boolean;
  defaultPermissionMode?: string;
  permissionModes?: string[];
  showToolDetails?: ShowToolDetails;
  showReasoning?: boolean;
  statusline?: StatusLineConfig;
  chatLeftMargin?: number;
  mouseCapture?: boolean;
  defaultPrompt?: string;
  wtAutoMerge?: boolean;
  wtBaseDir?: string;
  wtForce?: boolean;
  shell?: string;
  editor?: string;
  apiKeys?: Record<string, string>;
  quickModels?: Record<string, QuickModelConfig>;
  promptToModel?: Record<string, string>;
  mcpServers?: Record<string, McpServerConfig>;
  acpServers?: Record<string, unknown>;
  acpHost?: string;
  acpPort?: number;
  editSystem?: EditSystem;
  taskMaxTurns?: number;
  denyRepeatedReads?: boolean;
  showCostAlways?: boolean;
  taskEnabled?: boolean;
  subagentModel?: string;
  subagentProvider?: string;
  colors?: ColorsConfig;
  chain?: ChainConfig;
  lsp?: LspConfig;
  rtk?: RtkConfig;
  advisor?: AdvisorConfig;
}

export function defaultConfig(): Config {
  return { retry: defaultRetryConfig() };
}

export function configFromJson(raw: Record<string, unknown>): Config {
  const cfg = defaultConfig();
  const str = (k: string): string | undefined =>
    typeof raw[k] === "string" ? (raw[k] as string) : undefined;
  const num = (k: string): number | undefined =>
    typeof raw[k] === "number" ? (raw[k] as number) : undefined;
  const bool = (k: string): boolean | undefined =>
    typeof raw[k] === "boolean" ? (raw[k] as boolean) : undefined;
  const strArr = (k: string): string[] | undefined =>
    Array.isArray(raw[k]) ? (raw[k] as unknown[]).map(String) : undefined;
  const strMap = (k: string): Record<string, string> | undefined =>
    raw[k] && typeof raw[k] === "object"
      ? (raw[k] as Record<string, string>)
      : undefined;

  cfg.model = str("model");
  cfg.provider = str("provider");
  cfg.maxTokens = num("max_tokens");
  cfg.temperature = num("temperature");
  if (raw["extra_body"] !== undefined) cfg.extraBody = raw["extra_body"];
  if (raw["retry"] && typeof raw["retry"] === "object") {
    cfg.retry = retryConfigFromJson(raw["retry"] as Record<string, unknown>);
  }
  cfg.noTools = bool("no_tools");
  cfg.tools = strArr("tools");
  cfg.noContextFiles = bool("no_context_files");
  cfg.contextWindow = num("context_window");
  cfg.reserveTokens = num("reserve_tokens");
  cfg.keepRecentTokens = num("keep_recent_tokens");
  cfg.maxAgentTurns = num("max_agent_turns");
  cfg.maxTextFileSize = num("max_text_file_size");
  cfg.maxReadLines = num("max_read_lines");
  cfg.maxBashOutputLines = num("max_bash_output_lines");
  cfg.maxGrepResults = num("max_grep_results");
  cfg.maxFindResults = num("max_find_results");
  cfg.maxListDirEntries = num("max_list_dir_entries");
  cfg.subagentMaxReadLines = num("subagent_max_read_lines");
  cfg.subagentMaxGrepResults = num("subagent_max_grep_results");
  cfg.subagentMaxFindResults = num("subagent_max_find_results");
  cfg.subagentMaxListDirEntries = num("subagent_max_list_dir_entries");
  cfg.compactEnabled = bool("compact_enabled");
  cfg.midTurnCompactThreshold = num("mid_turn_compact_threshold");
  cfg.alwaysShowWelcome = bool("always_show_welcome");
  cfg.autoUpdatePrompts = bool("auto-update-prompts");
  cfg.autoUpdateThemes = bool("auto-update-themes");
  if (raw["custom_providers"] && typeof raw["custom_providers"] === "object") {
    const map: Record<string, CustomProviderConfig> = {};
    for (const [k, v] of Object.entries(raw["custom_providers"] as Record<string, unknown>)) {
      if (v && typeof v === "object") map[k] = customProviderFromJson(v as Record<string, unknown>);
    }
    cfg.customProviders = map;
  }
  if (raw["permission"] !== undefined) cfg.permission = raw["permission"];
  if (raw["permission-regex"] !== undefined) cfg.permissionRegex = raw["permission-regex"];
  cfg.permissionAllow = strMap("permission-allow") as Record<string, string[]> | undefined;
  if (raw["permission-allow"] && typeof raw["permission-allow"] === "object") {
    cfg.permissionAllow = raw["permission-allow"] as Record<string, string[]>;
  }
  if (raw["permission-ask"] && typeof raw["permission-ask"] === "object") {
    cfg.permissionAsk = raw["permission-ask"] as Record<string, string[]>;
  }
  if (raw["permission-deny"] && typeof raw["permission-deny"] === "object") {
    cfg.permissionDeny = raw["permission-deny"] as Record<string, string[]>;
  }
  cfg.restrictive = bool("restrictive");
  cfg.acceptAll = bool("accept_all");
  cfg.yolo = bool("yolo");
  cfg.sandbox = bool("sandbox");
  cfg.sandboxBackend = str("sandbox-backend");
  cfg.sandboxRequired = bool("sandbox-required");
  cfg.sandboxExpose = strArr("sandbox-expose");
  cfg.sandboxNetwork = bool("sandbox-network");
  cfg.allowAllMcpCalls = bool("allow_all_mcp_calls");
  cfg.enableExaMcp = bool("enable-exa-mcp");
  cfg.enableContext7Mcp = bool("enable-context7-mcp");
  cfg.enableGrepappMcp = bool("enable-grepapp-mcp");
  cfg.defaultPermissionMode = str("default_permission_mode");
  cfg.permissionModes = strArr("permission-modes");
  if (typeof raw["show_tool_details"] === "boolean" || typeof raw["show_tool_details"] === "number") {
    cfg.showToolDetails = raw["show_tool_details"] as ShowToolDetails;
  }
  cfg.showReasoning = bool("show_reasoning");
  if (raw["statusline"] && typeof raw["statusline"] === "object") {
    cfg.statusline = statusLineFromJson(raw["statusline"] as Record<string, unknown>);
  }
  cfg.chatLeftMargin = num("chat_left_margin");
  cfg.mouseCapture = bool("mouse_capture");
  cfg.defaultPrompt = str("default_prompt");
  cfg.wtAutoMerge = bool("wt-auto-merge");
  cfg.wtBaseDir = str("wt-base-dir");
  cfg.wtForce = bool("wt-force");
  cfg.shell = str("shell");
  cfg.editor = str("editor");
  cfg.apiKeys = strMap("api_keys");
  if (raw["quick_models"] && typeof raw["quick_models"] === "object") {
    const map: Record<string, QuickModelConfig> = {};
    for (const [k, v] of Object.entries(raw["quick_models"] as Record<string, unknown>)) {
      if (v && typeof v === "object") map[k] = quickModelFromJson(v as Record<string, unknown>);
    }
    cfg.quickModels = map;
  }
  if (raw["prompt_to_model"] && typeof raw["prompt_to_model"] === "object") {
    cfg.promptToModel = raw["prompt_to_model"] as Record<string, string>;
  }
  if (raw["mcp_servers"] && typeof raw["mcp_servers"] === "object") {
    cfg.mcpServers = raw["mcp_servers"] as Record<string, McpServerConfig>;
  }
  if (raw["acp_servers"] && typeof raw["acp_servers"] === "object") {
    cfg.acpServers = raw["acp_servers"] as Record<string, unknown>;
  }
  cfg.acpHost = str("acp_host");
  cfg.acpPort = num("acp_port");
  if (typeof raw["edit_system"] === "string") {
    try {
      cfg.editSystem = parseEditSystem(raw["edit_system"]);
    } catch {

    }
  }
  cfg.taskMaxTurns = num("task_max_turns");
  cfg.denyRepeatedReads = bool("deny_repeated_reads");
  cfg.showCostAlways = bool("show_cost_always");
  cfg.taskEnabled = bool("task_enabled");
  cfg.subagentModel = str("subagent_model");
  cfg.subagentProvider = str("subagent_provider");
  if (raw["colors"] && typeof raw["colors"] === "object") {
    const c = raw["colors"] as Record<string, unknown>;
    const colors: ColorsConfig = {};
    if (typeof c["chat_background"] === "string") colors.chatBackground = c["chat_background"];
    if (typeof c["input_background"] === "string") colors.inputBackground = c["input_background"];
    if (typeof c["status_background"] === "string") colors.statusBackground = c["status_background"];
    if (c["roles"] && typeof c["roles"] === "object") colors.roles = c["roles"] as Record<string, string>;
    if (c["scheme_type"] === "full" || c["scheme_type"] === "ansi") colors.schemeType = c["scheme_type"];
    cfg.colors = colors;
  }
  if (raw["chain"] && typeof raw["chain"] === "object") {
    cfg.chain = chainFromJson(raw["chain"] as Record<string, unknown>);
  }
  if (raw["lsp"] && typeof raw["lsp"] === "object") {
    const l = raw["lsp"] as Record<string, unknown>;
    cfg.lsp = {
      enabled: l["enabled"] === true,
      servers: (l["servers"] && typeof l["servers"] === "object"
        ? l["servers"]
        : {}) as LspConfig["servers"],
    };
  }
  if (raw["rtk"] && typeof raw["rtk"] === "object") {
    const r = raw["rtk"] as Record<string, unknown>;
    cfg.rtk = { enabled: r["enabled"] === true, path: typeof r["path"] === "string" ? r["path"] : undefined };
  }
  if (raw["advisor"] && typeof raw["advisor"] === "object") {
    cfg.advisor = advisorFromJson(raw["advisor"] as Record<string, unknown>);
  }
  return cfg;
}

export function configToJson(cfg: Config): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const put = (k: string, v: unknown): void => {
    if (v !== undefined) out[k] = v;
  };
  put("model", cfg.model);
  put("provider", cfg.provider);
  put("max_tokens", cfg.maxTokens);
  put("temperature", cfg.temperature);
  put("extra_body", cfg.extraBody);
  out["retry"] = {
    max_attempts: cfg.retry.maxAttempts,
    initial_backoff_ms: cfg.retry.initialBackoffMs,
    max_backoff_ms: cfg.retry.maxBackoffMs,
  };
  put("no_tools", cfg.noTools);
  put("tools", cfg.tools);
  put("no_context_files", cfg.noContextFiles);
  put("context_window", cfg.contextWindow);
  put("reserve_tokens", cfg.reserveTokens);
  put("keep_recent_tokens", cfg.keepRecentTokens);
  put("max_agent_turns", cfg.maxAgentTurns);
  put("max_text_file_size", cfg.maxTextFileSize);
  put("max_read_lines", cfg.maxReadLines);
  put("max_bash_output_lines", cfg.maxBashOutputLines);
  put("max_grep_results", cfg.maxGrepResults);
  put("max_find_results", cfg.maxFindResults);
  put("max_list_dir_entries", cfg.maxListDirEntries);
  put("compact_enabled", cfg.compactEnabled);
  put("mid_turn_compact_threshold", cfg.midTurnCompactThreshold);
  put("always_show_welcome", cfg.alwaysShowWelcome);
  put("auto-update-prompts", cfg.autoUpdatePrompts);
  put("auto-update-themes", cfg.autoUpdateThemes);
  if (cfg.customProviders) {
    const map: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(cfg.customProviders)) {
      map[k] = {
        provider_type: v.providerType,
        base_url: v.baseUrl,
        ...(v.apiKeyEnv !== undefined ? { api_key_env: v.apiKeyEnv } : {}),
        ...(v.dangerAcceptInvalidCerts !== undefined ? { danger_accept_invalid_certs: v.dangerAcceptInvalidCerts } : {}),
        ...(v.apiStyle !== undefined ? { api_style: v.apiStyle } : {}),
        ...(v.headers ? { headers: v.headers } : {}),
        ...(v.timeoutSecs !== undefined ? { timeout_secs: v.timeoutSecs } : {}),
        ...(v.model !== undefined ? { model: v.model } : {}),
      };
    }
    out["custom_providers"] = map;
  }
  put("permission", cfg.permission);
  put("permission-regex", cfg.permissionRegex);
  put("permission-allow", cfg.permissionAllow);
  put("permission-ask", cfg.permissionAsk);
  put("permission-deny", cfg.permissionDeny);
  put("restrictive", cfg.restrictive);
  put("accept_all", cfg.acceptAll);
  put("yolo", cfg.yolo);
  put("sandbox", cfg.sandbox);
  put("sandbox-backend", cfg.sandboxBackend);
  put("sandbox-required", cfg.sandboxRequired);
  put("sandbox-expose", cfg.sandboxExpose);
  put("sandbox-network", cfg.sandboxNetwork);
  put("allow_all_mcp_calls", cfg.allowAllMcpCalls);
  put("enable-exa-mcp", cfg.enableExaMcp);
  put("enable-context7-mcp", cfg.enableContext7Mcp);
  put("enable-grepapp-mcp", cfg.enableGrepappMcp);
  put("default_permission_mode", cfg.defaultPermissionMode);
  put("permission-modes", cfg.permissionModes);
  put("show_tool_details", cfg.showToolDetails);
  put("show_reasoning", cfg.showReasoning);
  if (cfg.statusline) {
    out["statusline"] = {
      lines: cfg.statusline.lines.map((line) => ({
        segments: line.segments.map((s) => ({
          item: s.item,
          ...(s.color !== undefined ? { color: s.color } : {}),
          ...(s.bg !== undefined ? { bg: s.bg } : {}),
          ...(s.text !== undefined ? { text: s.text } : {}),
          ...(s.left !== undefined ? { left: s.left } : {}),
          ...(s.right !== undefined ? { right: s.right } : {}),
          ...(s.icon !== undefined ? { icon: s.icon } : {}),
          ...(s.always !== undefined ? { always: s.always } : {}),
        })),
      })),
    };
  }
  put("chat_left_margin", cfg.chatLeftMargin);
  put("mouse_capture", cfg.mouseCapture);
  put("default_prompt", cfg.defaultPrompt);
  put("wt-auto-merge", cfg.wtAutoMerge);
  put("wt-base-dir", cfg.wtBaseDir);
  put("wt-force", cfg.wtForce);
  put("shell", cfg.shell);
  put("editor", cfg.editor);
  put("api_keys", cfg.apiKeys);
  if (cfg.quickModels) {
    const map: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(cfg.quickModels)) map[k] = quickModelToJson(v);
    out["quick_models"] = map;
  }
  put("prompt_to_model", cfg.promptToModel);
  put("mcp_servers", cfg.mcpServers);
  put("acp_servers", cfg.acpServers);
  put("acp_host", cfg.acpHost);
  put("acp_port", cfg.acpPort);
  put("edit_system", cfg.editSystem);
  put("task_max_turns", cfg.taskMaxTurns);
  put("deny_repeated_reads", cfg.denyRepeatedReads);
  put("show_cost_always", cfg.showCostAlways);
  put("task_enabled", cfg.taskEnabled);
  put("subagent_model", cfg.subagentModel);
  put("subagent_provider", cfg.subagentProvider);
  if (cfg.colors) {
    out["colors"] = {
      ...(cfg.colors.chatBackground !== undefined ? { chat_background: cfg.colors.chatBackground } : {}),
      ...(cfg.colors.inputBackground !== undefined ? { input_background: cfg.colors.inputBackground } : {}),
      ...(cfg.colors.statusBackground !== undefined ? { status_background: cfg.colors.statusBackground } : {}),
      ...(cfg.colors.roles !== undefined ? { roles: cfg.colors.roles } : {}),
      scheme_type: cfg.colors.schemeType ?? "full",
    };
  }
  if (cfg.chain) {
    out["chain"] = {
      "brainstorm-to-plan": cfg.chain.brainstormToPlan,
      "plan-to-code": cfg.chain.planToCode,
      "code-to-review": cfg.chain.codeToReview,
    };
  }
  put("lsp", cfg.lsp);
  put("rtk", cfg.rtk);
  if (cfg.advisor) {
    out["advisor"] = {
      enabled: cfg.advisor.enabled,
      ...(cfg.advisor.model !== undefined ? { model: cfg.advisor.model } : {}),
      ...(cfg.advisor.maxUses !== undefined ? { max_uses: cfg.advisor.maxUses } : {}),
      human_handoff: cfg.advisor.humanHandoff,
      advisor_kilobytes_limit: cfg.advisor.advisorKilobytesLimit,
    };
  }
  return out;
}

export function customProvidersMap(cfg: Config): Record<string, CustomProviderConfig> {
  return cfg.customProviders ? { ...cfg.customProviders } : {};
}

export function isAnthropicNative(cfg: Config, provider: string, modelId: string): boolean {
  const kindName =
    cfg.customProviders?.[provider]?.providerType ?? provider;
  const kind = kindName.toLowerCase();
  if (kind === "anthropic") return true;
  
  return opencodeTransport(provider, modelId) === "messages";
}

export function resolveContextWindow(
  cfg: Config,
  provider: string,
  modelId: string,
  qm: Record<string, QuickModelConfig>,
): number {
  if (cfg.contextWindow !== undefined) return cfg.contextWindow;
  for (const qmc of Object.values(qm)) {
    if (qmc.model === modelId && qmc.contextWindow !== undefined) return qmc.contextWindow;
  }
  return catalogContextWindow(provider, modelId) ?? 128_000;
}

export function catalogContextWindowOf(provider: string, modelId: string): number | undefined {
  return catalogContextWindow(provider, modelId);
}

export function catalogInputOutputCostOf(
  provider: string,
  modelId: string,
): [number, number] | undefined {
  return catalogInputOutputCost(provider, modelId);
}

export function resolveReserveTokens(
  cfg: Config,
  modelId: string,
  qm: Record<string, QuickModelConfig>,
): number {
  if (cfg.reserveTokens !== undefined) return cfg.reserveTokens;
  for (const qmc of Object.values(qm)) {
    if (qmc.model === modelId && qmc.reserveTokens !== undefined) return qmc.reserveTokens;
  }
  return 8_192;
}

export function resolveKeepRecentTokens(cfg: Config): number {
  return cfg.keepRecentTokens ?? 10_000;
}

export function resolveChatLeftMargin(cfg: Config): number {
  return cfg.chatLeftMargin ?? 0;
}

export function resolveMouseCapture(cfg: Config): boolean {
  return cfg.mouseCapture ?? true;
}

export function resolveTemperature(
  cfg: Config,
  cli: Cli,
  modelId: string,
  qm: Record<string, QuickModelConfig>,
): number | undefined {
  const clamp = (t: number): number => Math.min(2, Math.max(0, t));
  if (cli.temperature !== undefined) return clamp(cli.temperature);
  for (const qmc of Object.values(qm)) {
    if (qmc.model === modelId && qmc.temperature !== undefined) return clamp(qmc.temperature);
  }
  return cfg.temperature !== undefined ? clamp(cfg.temperature) : undefined;
}

export function resolveExtraBody(
  cfg: Config,
  modelId: string,
  qm: Record<string, QuickModelConfig>,
): unknown {
  for (const qmc of Object.values(qm)) {
    if (qmc.model === modelId && qmc.extraBody !== undefined) return qmc.extraBody;
  }
  return cfg.extraBody;
}

export function resolveTemperatureFor(cli: Cli, cfg: Config, modelId: string): number | undefined {
  return resolveTemperature(cfg, cli, modelId, cfg.quickModels ?? {});
}

export function resolveExtraBodyFor(cfg: Config, modelId: string): unknown {
  return resolveExtraBody(cfg, modelId, cfg.quickModels ?? {});
}

export function resolveCompactEnabled(cfg: Config): boolean {
  return cfg.compactEnabled ?? false;
}

export function resolveMidTurnCompactThreshold(cfg: Config): number | undefined {
  const t = cfg.midTurnCompactThreshold;
  return t !== undefined && t > 0 && t <= 1 ? t : undefined;
}

export function resolveMaxReadLines(cfg: Config): number {
  return cfg.maxReadLines ?? 2000;
}

export function resolveMaxBashOutputLines(cfg: Config): number | undefined {
  return cfg.maxBashOutputLines;
}

export function resolveLsp(cfg: Config): LspConfig | undefined {
  return cfg.lsp && cfg.lsp.enabled ? cfg.lsp : undefined;
}

export function resolveRtk(cfg: Config): RtkConfig | undefined {
  return cfg.rtk && cfg.rtk.enabled ? cfg.rtk : undefined;
}

export function resolveMaxGrepResults(cfg: Config): number {
  return cfg.maxGrepResults ?? 200;
}

export function resolveMaxFindResults(cfg: Config): number {
  return cfg.maxFindResults ?? 200;
}

export function resolveMaxListDirEntries(cfg: Config): number | undefined {
  return cfg.maxListDirEntries ?? 150;
}

export function resolveSubagentMaxReadLines(cfg: Config): number {
  return cfg.subagentMaxReadLines ?? 2000;
}

export function resolveSubagentMaxGrepResults(cfg: Config): number {
  return cfg.subagentMaxGrepResults ?? 200;
}

export function resolveSubagentMaxFindResults(cfg: Config): number {
  return cfg.subagentMaxFindResults ?? 200;
}

export function resolveSubagentMaxListDirEntries(cfg: Config): number | undefined {
  return cfg.subagentMaxListDirEntries;
}

export function resolveAlwaysShowWelcome(cfg: Config): boolean {
  return cfg.alwaysShowWelcome ?? false;
}

export function resolveShowReasoning(cfg: Config): boolean {
  return cfg.showReasoning ?? false;
}

export function resolveAutoUpdatePrompts(cfg: Config): boolean | undefined {
  return cfg.autoUpdatePrompts;
}

export function resolveAutoUpdateThemes(cfg: Config): boolean | undefined {
  return cfg.autoUpdateThemes;
}

export function resolveShowCostAlways(cfg: Config): boolean {
  return cfg.showCostAlways ?? false;
}

export function resolvePromptModel(cfg: Config, promptName: string): string | undefined {
  const val = cfg.promptToModel?.[promptName];
  return val !== undefined && val.length > 0 ? val : undefined;
}

export function resolveEnableExaMcp(cfg: Config): boolean {
  return cfg.enableExaMcp ?? true;
}

export function resolveEnableContext7Mcp(cfg: Config): boolean {
  return cfg.enableContext7Mcp ?? false;
}

export function resolveEnableGrepappMcp(cfg: Config): boolean {
  return cfg.enableGrepappMcp ?? false;
}

export function buildPermissionConfig(cfg: Config): PermissionConfigs {
  const glob = permissionConfigFromJson(cfg.permission);
  const regex = permissionConfigFromJson(cfg.permissionRegex);
  const configs: PermissionConfigs = { glob, regex };
  const toMap = (rec: Record<string, string[]>): Map<string, string[]> =>
    new Map(Object.entries(rec));
  if (cfg.permissionAllow) configs.glob.allowEntries = toMap(cfg.permissionAllow);
  if (cfg.permissionAsk) configs.glob.askEntries = toMap(cfg.permissionAsk);
  if (cfg.permissionDeny) configs.glob.denyEntries = toMap(cfg.permissionDeny);
  return configs;
}
