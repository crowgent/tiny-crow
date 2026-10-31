import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { atomicWrite, expandTilde } from "../fs.ts";
import {
  configFromJson,
  configToJson,
  defaultAdvisorConfig,
  defaultChainConfig,
  defaultConfig,
  resolveEnableContext7Mcp,
  resolveEnableExaMcp,
  resolveEnableGrepappMcp,
  type Config,
  type QuickModelConfig,
} from "./mod.ts";
import { parseEditSystem } from "./types.ts";

export const LOCAL_CONFIG_PATH = ".tiny-crow/config.toml";
const CONFIG_CANDIDATES = ["config.toml", "config.yaml", "config.yml", "config.json"] as const;

export function homeDir(): string | undefined {
  return process.env["HOME"] || os.homedir() || undefined;
}

export function dataDir(): string {
  const override = process.env["TC_DATA_DIR"];
  if (override) return expandTilde(override);
  const xdg = process.env["XDG_DATA_HOME"];
  if (xdg) return path.join(xdg, "tiny-crow");
  const home = homeDir();
  if (home) {
    if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "tiny-crow");
    return path.join(home, ".local", "share", "tiny-crow");
  }
  return path.join(".", "tiny-crow");
}

export function configDirPath(): string {
  const override = process.env["TC_CONFIG_DIR"];
  if (override) return expandTilde(override);
  return dataDir();
}

export function pickExisting(dir: string): string {
  for (const name of CONFIG_CANDIDATES) {
    const p = path.join(dir, name);
    if (existsSync(p)) return p;
  }
  return path.join(dir, CONFIG_CANDIDATES[0]);
}

function resolveConfigPath(): string {
  if (process.env["TC_CONFIG_DIR"]) {
    return pickExisting(expandTilde(process.env["TC_CONFIG_DIR"]!));
  }
  const xdgConfig = process.env["XDG_CONFIG_HOME"];
  const candidates: string[] = [];
  if (xdgConfig) candidates.push(path.join(xdgConfig, "tiny-crow"));
  else {
    const home = homeDir();
    if (home) {
      candidates.push(
        process.platform === "darwin"
          ? path.join(home, "Library", "Application Support", "tiny-crow")
          : path.join(home, ".config", "tiny-crow"),
      );
    }
  }
  for (const dir of candidates) {
    const picked = pickExisting(dir);
    if (existsSync(picked)) return picked;
  }
  return pickExisting(dataDir());
}

export function configFilePath(): string {
  return resolveConfigPath();
}

export function defaultQuickModels(): Record<string, QuickModelConfig> {
  return {
    "deepseek-v4-flash": {
      provider: "openrouter",
      model: "deepseek/deepseek-v4-flash",
      inputTokenCost: 0.0983,
      outputTokenCost: 0.1966,
    },
    "deepseek-v4-pro": {
      provider: "openrouter",
      model: "deepseek/deepseek-v4-pro",
      inputTokenCost: 0.435,
      outputTokenCost: 0.87,
    },
  };
}

export function quickModelsMap(cfg: Config): Record<string, QuickModelConfig> {
  return cfg.quickModels ? { ...cfg.quickModels } : {};
}

const EMPTY_QUICK_MODELS: Record<string, QuickModelConfig> = {};

export function quickModelsMapRef(cfg: Config): Record<string, QuickModelConfig> {
  return cfg.quickModels ?? EMPTY_QUICK_MODELS;
}

type TomlValue = string | number | boolean | TomlValue[] | { [k: string]: TomlValue };

function stripTomlComment(line: string): string {
  let inStr: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inStr) {
      if (ch === "\\" && inStr === '"') i++;
      else if (ch === inStr) inStr = undefined;
    } else if (ch === '"' || ch === "'") {
      inStr = ch;
    } else if (ch === "#") {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseTomlScalar(raw: string): TomlValue {
  const s = raw.trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return JSON.parse(s) as string;
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
    return s.slice(1, -1);
  }
  if (s === "true") return true;
  if (s === "false") return false;
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevel(inner).map((part) => parseTomlScalar(part));
  }
  if (s.startsWith("{") && s.endsWith("}")) {
    const inner = s.slice(1, -1).trim();
    const obj: { [k: string]: TomlValue } = {};
    if (inner) {
      for (const part of splitTopLevel(inner)) {
        const eq = part.indexOf("=");
        if (eq < 0) continue;
        obj[parseTomlKey(part.slice(0, eq).trim())] = parseTomlScalar(part.slice(eq + 1));
      }
    }
    return obj;
  }
  const num = Number(s.replace(/_/g, ""));
  if (s !== "" && !Number.isNaN(num) && /^[+-]?[\d._]+$/.test(s.replace(/_/g, ""))) return num;
  return s;
}

function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inStr: string | undefined;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      cur += ch;
      if (ch === "\\" && inStr === '"') {
        if (i + 1 < s.length) cur += s[++i];
      } else if (ch === inStr) inStr = undefined;
    } else if (ch === '"' || ch === "'") {
      inStr = ch;
      cur += ch;
    } else if (ch === "[" || ch === "{") {
      depth++;
      cur += ch;
    } else if (ch === "]" || ch === "}") {
      depth--;
      cur += ch;
    } else if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function parseTomlKey(raw: string): string {
  const k = raw.trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    return k.slice(1, -1);
  }
  return k;
}

function setDotted(
  root: { [k: string]: TomlValue },
  dotted: string,
  value: TomlValue,
): void {
  const parts = dotted.split(".").map(parseTomlKey);
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    const existing = cur[p];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      cur[p] = {};
    }
    cur = cur[p] as { [k: string]: TomlValue };
  }
  cur[parts[parts.length - 1]!] = value;
}

export function parseToml(text: string): Record<string, unknown> {
  const root: { [k: string]: TomlValue } = {};
  let current: { [k: string]: TomlValue } = root;
  const lines = text.split(/\r?\n/);
  for (let li = 0; li < lines.length; li++) {
    let line = stripTomlComment(lines[li]!).trim();
    if (!line) continue;
    
    if (/=\s*"""/.test(line)) {
      const start = line.indexOf('"""');
      let joined = line.slice(start + 3);
      while (!joined.includes('"""') && li + 1 < lines.length) {
        joined += "\n" + lines[++li];
      }
      const end = joined.indexOf('"""');
      const value = joined.slice(0, end);
      const keyPart = line.slice(0, line.indexOf("=")).trim();
      setDotted(current, keyPart, value);
      continue;
    }
    if (line.startsWith("[[") && line.endsWith("]]")) {
      const dotted = line.slice(2, -2).trim();
      const parts = dotted.split(".").map(parseTomlKey);
      let cur: { [k: string]: TomlValue } = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i]!;
        const existing = cur[p];
        if (!existing || typeof existing !== "object" || Array.isArray(existing)) cur[p] = {};
        cur = cur[p] as { [k: string]: TomlValue };
      }
      const last = parts[parts.length - 1]!;
      const arr = cur[last];
      const table: { [k: string]: TomlValue } = {};
      if (Array.isArray(arr)) arr.push(table);
      else cur[last] = [table];
      current = table;
      continue;
    }
    if (line.startsWith("[") && line.endsWith("]")) {
      const dotted = line.slice(1, -1).trim();
      const parts = dotted.split(".").map(parseTomlKey);
      let cur: { [k: string]: TomlValue } = root;
      for (const p of parts) {
        const existing = cur[p];
        if (Array.isArray(existing)) {
          cur = existing[existing.length - 1] as { [k: string]: TomlValue };
        } else {
          if (!existing || typeof existing !== "object") cur[p] = {};
          cur = cur[p] as { [k: string]: TomlValue };
        }
      }
      current = cur;
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) throw new Error(`invalid TOML line: ${line}`);
    const key = line.slice(0, eq).trim();
    const value = parseTomlScalar(line.slice(eq + 1));
    setDotted(current, key, value);
  }
  return root as Record<string, unknown>;
}

function tomlScalar(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  if (Array.isArray(v)) return `[${v.map(tomlScalar).join(", ")}]`;
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).map(
      ([k, val]) => `${k} = ${tomlScalar(val)}`,
    );
    return `{ ${entries.join(", ")} }`;
  }
  return JSON.stringify(String(v));
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function toToml(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  const writeTable = (prefix: string, table: Record<string, unknown>): void => {
    const scalars: Array<[string, unknown]> = [];
    const subtables: Array<[string, Record<string, unknown>]> = [];
    const arrayTables: Array<[string, Array<Record<string, unknown>>]> = [];
    for (const [k, v] of Object.entries(table)) {
      if (Array.isArray(v) && v.length > 0 && v.every(isPlainObject)) {
        arrayTables.push([k, v as Array<Record<string, unknown>>]);
      } else if (isPlainObject(v)) {
        subtables.push([k, v]);
      } else {
        scalars.push([k, v]);
      }
    }
    for (const [k, v] of scalars) lines.push(`${k} = ${tomlScalar(v)}`);
    for (const [k, v] of subtables) {
      lines.push("");
      lines.push(`[${prefix ? `${prefix}.` : ""}${k}]`);
      writeTable(prefix ? `${prefix}.${k}` : k, v);
    }
    for (const [k, arr] of arrayTables) {
      for (const item of arr) {
        lines.push("");
        lines.push(`[[${prefix ? `${prefix}.` : ""}${k}]]`);
        writeTable(prefix ? `${prefix}.${k}` : k, item);
      }
    }
  };
  writeTable("", obj);
  return lines.join("\n") + "\n";
}

function parseYamlScalar(raw: string): unknown {
  const s = raw.trim();
  if (s === "" || s === "~" || s === "null" || s === "Null" || s === "NULL") return null;
  if (s === "true" || s === "True") return true;
  if (s === "false" || s === "False") return false;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, -1);
    }
  }
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevel(inner).map((p) => parseYamlScalar(p));
  }
  if (s.startsWith("{") && s.endsWith("}")) {
    const inner = s.slice(1, -1).trim();
    const obj: Record<string, unknown> = {};
    if (inner) {
      for (const part of splitTopLevel(inner)) {
        const idx = part.indexOf(":");
        if (idx >= 0) obj[part.slice(0, idx).trim()] = parseYamlScalar(part.slice(idx + 1));
      }
    }
    return obj;
  }
  const num = Number(s);
  if (s !== "" && !Number.isNaN(num) && /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return num;
  return s;
}

interface YamlLine {
  indent: number;
  text: string;
}

export function parseYaml(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    return parsed as Record<string, unknown>;
  }
  const lines: YamlLine[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    lines.push({ indent, text: rawLine.trim() });
  }

  const unquoteKey = (raw: string): string => {
    const t = raw.trim();
    if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1);
    if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
      try {
        return JSON.parse(t) as string;
      } catch {
        return t.slice(1, -1);
      }
    }
    return t;
  };
  let pos = 0;
  const parseBlock = (indent: number): unknown => {
    if (pos >= lines.length) return {};
    const first = lines[pos]!;
    if (first.indent < indent) return {};
    if (first.text.startsWith("- ") || first.text === "-") {
      const arr: unknown[] = [];
      while (pos < lines.length && lines[pos]!.indent === indent && (lines[pos]!.text.startsWith("- ") || lines[pos]!.text === "-")) {
        const itemText = lines[pos]!.text.slice(1).trim();
        pos++;
        if (!itemText) {
          arr.push(parseBlock(indent + 1));
        } else if (itemText.includes(":")) {
          
          const map: Record<string, unknown> = {};
          const idx = itemText.indexOf(":");
          const k = unquoteKey(itemText.slice(0, idx));
          const v = itemText.slice(idx + 1).trim();
          map[k] = v ? parseYamlScalar(v) : (pos < lines.length && lines[pos]!.indent > indent ? parseBlock(lines[pos]!.indent) : null);
          while (pos < lines.length && lines[pos]!.indent > indent && !lines[pos]!.text.startsWith("- ")) {
            const l = lines[pos]!;
            const cIdx = l.text.indexOf(":");
            if (cIdx < 0) {
              pos++;
              continue;
            }
            const kk = unquoteKey(l.text.slice(0, cIdx));
            const vv = l.text.slice(cIdx + 1).trim();
            pos++;
            map[kk] = vv ? parseYamlScalar(vv) : (pos < lines.length && lines[pos]!.indent > l.indent ? parseBlock(lines[pos]!.indent) : null);
          }
          arr.push(map);
        } else {
          arr.push(parseYamlScalar(itemText));
        }
      }
      return arr;
    }
    const obj: Record<string, unknown> = {};
    while (pos < lines.length && lines[pos]!.indent === indent && !lines[pos]!.text.startsWith("- ")) {
      const l = lines[pos]!;
      const idx = l.text.indexOf(":");
      if (idx < 0) {
        pos++;
        continue;
      }
      const k = unquoteKey(l.text.slice(0, idx));
      const v = l.text.slice(idx + 1).trim();
      pos++;
      if (v) obj[k] = parseYamlScalar(v);
      else if (pos < lines.length && lines[pos]!.indent > indent) obj[k] = parseBlock(lines[pos]!.indent);
      else obj[k] = null;
    }
    return obj;
  };
  const result = parseBlock(lines[0]?.indent ?? 0);
  return (result && typeof result === "object" && !Array.isArray(result)
    ? result
    : {}) as Record<string, unknown>;
}

function parseConfigText(content: string, isToml: boolean): Record<string, unknown> {
  if (isToml) return parseToml(content);
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {

    }
  }
  return parseYaml(content);
}

export function deepMergeJson(
  base: Record<string, unknown>,
  over: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const existing = out[k];
    if (
      existing && typeof existing === "object" && !Array.isArray(existing) &&
      v && typeof v === "object" && !Array.isArray(v)
    ) {
      out[k] = deepMergeJson(
        existing as Record<string, unknown>,
        v as Record<string, unknown>,
      );
    } else {
      out[k] = v;
    }
  }
  return out;
}

const OVERRIDE_STRING_FIELDS = new Set([
  "model", "provider", "sandbox-backend", "default_permission_mode",
  "default_prompt", "shell", "editor", "wt-base-dir",
]);
const OVERRIDE_NUMBER_FIELDS = new Set([
  "max_tokens", "temperature", "context_window", "reserve_tokens",
  "keep_recent_tokens", "max_agent_turns", "max_text_file_size",
  "max_read_lines", "max_bash_output_lines", "max_grep_results",
  "max_find_results", "max_list_dir_entries", "subagent_max_read_lines",
  "subagent_max_grep_results", "subagent_max_find_results",
  "subagent_max_list_dir_entries", "mid_turn_compact_threshold",
  "chat_left_margin",
]);
const OVERRIDE_BOOLEAN_FIELDS = new Set([
  "no_tools", "no_context_files", "compact_enabled", "always_show_welcome",
  "auto-update-prompts", "auto-update-themes", "restrictive", "accept_all",
  "yolo", "sandbox", "sandbox-required", "sandbox-network",
  "allow_all_mcp_calls", "enable-exa-mcp", "enable-context7-mcp",
  "enable-grepapp-mcp", "show_reasoning", "mouse_capture",
  "wt-auto-merge", "wt-force",
]);
const OVERRIDE_STRING_ARRAY_FIELDS = new Set([
  "tools", "sandbox-expose", "permission-modes",
]);
const OVERRIDE_RETRY_NUMBER_FIELDS = new Set([
  "max_attempts", "initial_backoff_ms", "max_backoff_ms",
]);

function validateOverrideTypes(local: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(local)) {
    if (value === null || value === undefined) continue;
    if (OVERRIDE_STRING_FIELDS.has(key) && typeof value !== "string") {
      throw new Error(`local override: '${key}' must be a string`);
    }
    if (OVERRIDE_NUMBER_FIELDS.has(key) && typeof value !== "number") {
      throw new Error(`local override: '${key}' must be a number`);
    }
    if (OVERRIDE_BOOLEAN_FIELDS.has(key) && typeof value !== "boolean") {
      throw new Error(`local override: '${key}' must be a boolean`);
    }
    if (OVERRIDE_STRING_ARRAY_FIELDS.has(key)) {
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
        throw new Error(`local override: '${key}' must be an array of strings`);
      }
    }
    if (key === "show_tool_details" && typeof value !== "boolean" && typeof value !== "number") {
      throw new Error(`local override: 'show_tool_details' must be a boolean or number`);
    }
    if (key === "retry" && typeof value === "object" && !Array.isArray(value)) {
      for (const [rk, rv] of Object.entries(value as Record<string, unknown>)) {
        if (OVERRIDE_RETRY_NUMBER_FIELDS.has(rk) && typeof rv !== "number") {
          throw new Error(`local override: 'retry.${rk}' must be a number`);
        }
      }
    }
  }
}

export function mergeConfigOverride(base: Config, localToml: string): Config {
  const local = parseToml(localToml);
  validateOverrideTypes(local);
  const baseJson = configToJson(base);
  const merged = deepMergeJson(baseJson, local);
  return configFromJson(merged);
}

export function unknownKeys(file: unknown, cfg: Config): string[] {
  if (!file || typeof file !== "object" || Array.isArray(file)) return [];
  const known = configToJson(cfg);
  return Object.keys(file as Record<string, unknown>).filter((k) => !(k in known));
}

function warnUnknownKeys(source: string, file: unknown, cfg: Config): void {
  for (const key of unknownKeys(file, cfg)) {
    console.error(
      `warning: ${source}: unknown config key '${key}' (typo, or requires a feature not compiled in)`,
    );
  }
}

export function richDefaultConfig(): Config {
  const cfg = defaultConfig();
  cfg.quickModels = defaultQuickModels();
  cfg.provider = "openrouter";
  cfg.model = "deepseek-v4-pro";
  cfg.maxTokens = 16384;
  cfg.compactEnabled = false;
  cfg.maxTextFileSize = 1_048_576;
  cfg.editSystem = parseEditSystem("similarity");
  cfg.defaultPermissionMode = "standard";
  cfg.defaultPrompt = "code";
  cfg.chain = defaultChainConfig();
  cfg.subagentMaxReadLines = 2000;
  cfg.subagentMaxGrepResults = 200;
  cfg.subagentMaxFindResults = 200;
  cfg.advisor = defaultAdvisorConfig();
  cfg.statusline = {
    lines: [
      {
        segments: [
          { item: "cwd", color: "grey" },
          { item: "separator", text: "  " },
          { item: "git_branch", color: "grey", left: "(", right: ")" },
          { item: "separator", text: " | " },
          { item: "model", color: "grey" },
          { item: "separator", text: "  |  " },
          { item: "context_used", color: "grey" },
          { item: "separator", text: "/" },
          { item: "context_max", color: "grey" },
          { item: "separator", text: " " },
          { item: "context_percentage", color: "grey" },
          { item: "separator", text: "  ⇑" },
          { item: "tokens_input", color: "grey" },
          { item: "separator", text: " ⇓" },
          { item: "tokens_output", color: "grey" },
          { item: "flex_separator" },
          { item: "loop", color: "grey" },
          { item: "separator", text: " " },
          { item: "mode", color: "grey" },
          { item: "separator", text: " " },
          { item: "cost", color: "grey" },
          { item: "separator", text: " " },
          { item: "btw", color: "grey" },
          { item: "separator", text: " " },
          { item: "prompt", color: "grey" },
        ],
      },
    ],
  };
  return cfg;
}

function loadFromPath(filePath: string): Config {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (e) {
    console.error(
      `error: failed to read config file (${filePath}): ${e}\n` +
        `Fix the file or remove it to use defaults.`,
    );
    process.exit(1);
  }
  const isToml = path.extname(filePath) === ".toml";
  let parsed: Record<string, unknown>;
  try {
    parsed = parseConfigText(content!, isToml);
  } catch (e) {
    console.error(
      `error: ${filePath} is not a valid config: ${e}\n` +
        `Fix the file or remove it to use defaults.`,
    );
    process.exit(1);
  }
  const cfg = configFromJson(parsed!);
  warnUnknownKeys(filePath, parsed, cfg);
  return cfg;
}

export function load(): [Config, boolean] {
  const filePath = resolveConfigPath();
  const isFirstStartup = !existsSync(filePath);
  let cfg: Config;
  if (isFirstStartup) {
    console.info(`first startup, writing default config to ${filePath}`);
    const parent = path.dirname(filePath);
    try {
      mkdirSync(parent, { recursive: true });
    } catch {

    }
    const def = richDefaultConfig();
    if (path.extname(filePath) === ".toml") {
      try {
        writeFileSync(filePath, toToml(configToJson(def)));
      } catch {

      }
    }
    cfg = def;
  } else {
    cfg = loadFromPath(filePath);
  }
  applyLocalOverride(cfg);
  injectMcpDefaults(cfg);
  return [cfg, isFirstStartup];
}

export function applyLocalOverride(cfg: Config): void {
  const localPath = LOCAL_CONFIG_PATH;
  if (!existsSync(localPath)) return;
  let content: string;
  try {
    content = readFileSync(localPath, "utf-8");
  } catch (e) {
    console.error(`error: failed to read project config (${localPath}): ${e}`);
    process.exit(1);
  }
  let fileValue: Record<string, unknown> | undefined;
  try {
    fileValue = parseToml(content!);
  } catch {
    fileValue = undefined;
  }
  try {
    const merged = mergeConfigOverride(cfg, content!);
    console.info(`applied project-local config override from ${localPath}`);
    console.error(`note: applied project-local config override from ${localPath}`);
    if (fileValue) warnUnknownKeys(LOCAL_CONFIG_PATH, fileValue, merged);
    Object.assign(cfg, merged);
  } catch (e) {
    console.error(
      `error: ${localPath} is not a valid config: ${e}\n` +
        `Fix the file or remove it to use defaults.`,
    );
    process.exit(1);
  }
}

export function injectMcpDefaults(cfg: Config): void {
  const servers: Record<string, unknown> = { ...(cfg.mcpServers ?? {}) };
  if (resolveEnableExaMcp(cfg)) {
    if (!("Exa Web Search" in servers)) {
      const headers: Record<string, string> = {};
      if (process.env["EXA_API_KEY"]) headers["x-api-key"] = process.env["EXA_API_KEY"]!;
      servers["Exa Web Search"] = { url: "https://mcp.exa.ai/mcp", headers };
    }
  } else {
    delete servers["Exa Web Search"];
  }
  if (resolveEnableContext7Mcp(cfg)) {
    if (!("Context7" in servers)) {
      const headers: Record<string, string> = {};
      if (process.env["CONTEXT7_API_KEY"]) {
        headers["authorization"] = `Bearer ${process.env["CONTEXT7_API_KEY"]}`;
      }
      servers["Context7"] = { url: "https://mcp.context7.com/mcp", headers };
    }
  } else {
    delete servers["Context7"];
  }
  if (resolveEnableGrepappMcp(cfg)) {
    if (!("Grep.app" in servers)) {
      const headers: Record<string, string> = {};
      if (process.env["GREP_APP_API_KEY"]) {
        headers["authorization"] = `Bearer ${process.env["GREP_APP_API_KEY"]}`;
      }
      servers["Grep.app"] = { url: "https://mcp.grep.app", headers };
    }
  } else {
    delete servers["Grep.app"];
  }
  cfg.mcpServers = servers as Config["mcpServers"];
}

export async function saveConfig(cfg: Config): Promise<void> {
  const copy: Config = { ...cfg };
  if (copy.mcpServers) {
    const servers = { ...copy.mcpServers };
    delete servers["Exa Web Search"];
    delete servers["Context7"];
    delete servers["Grep.app"];
    copy.mcpServers = servers;
  }
  const filePath = resolveConfigPath();
  const parent = path.dirname(filePath);
  mkdirSync(parent, { recursive: true });
  const content =
    path.extname(filePath) === ".toml"
      ? toToml(configToJson(copy))
      : JSON.stringify(configToJson(copy), null, 2) + "\n";
  await atomicWrite(filePath, content);
}

export async function saveQuickModel(
  name: string,
  provider: string,
  model: string,
  inputTokenCost: number,
  outputTokenCost: number,
): Promise<void> {
  const filePath = resolveConfigPath();
  let cfg: Config = defaultConfig();
  if (existsSync(filePath)) {
    const content = readFileSync(filePath, "utf-8");
    const isToml = path.extname(filePath) === ".toml";
    cfg = configFromJson(parseConfigText(content, isToml));
  }
  const quickModels = { ...(cfg.quickModels ?? {}) };
  quickModels[name] = {
    provider,
    model,
    inputTokenCost,
    outputTokenCost,
  };
  cfg.quickModels = quickModels;
  const parent = path.dirname(filePath);
  mkdirSync(parent, { recursive: true });
  const content =
    path.extname(filePath) === ".toml"
      ? toToml(configToJson(cfg))
      : JSON.stringify(configToJson(cfg), null, 2) + "\n";
  await atomicWrite(filePath, content);
}
