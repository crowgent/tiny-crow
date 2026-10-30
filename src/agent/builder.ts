import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import { LSP_PROMPT, MEMORY_TOOLS_PROMPT, RTK_PROMPT, SYSTEM_PROMPT, TODO_TOOLS_PROMPT } from "./prompt.ts";
import type {
  AskSenderLike,
  PermCheckLike,
  Tool,
} from "./tools/mod.ts";
import { BashTool } from "./tools/bash.ts";
import type { RtkLike, SandboxLike } from "./tools/bash.ts";
import { EditTool } from "./tools/edit.ts";
import { FindFilesTool } from "./tools/find_files.ts";
import { GrepTool } from "./tools/grep.ts";
import { ListDirTool } from "./tools/list_dir.ts";
import { ReadTool } from "./tools/read.ts";
import { WriteTodoList } from "./tools/todo.ts";
import { WriteTool } from "./tools/write.ts";
import { LspTool } from "./tools/lsp.ts";
import type { LspManagerLike } from "./tools/lsp.ts";

export interface ContextFilesLike {
  agents?: string;
  architecture?: string;
  currentPrompt?: string;
  extraFiles: string[];
  memory?: string;
  prompts?: Map<string, string> | Record<string, string>;
  currentPromptName?: string;
  themes?: Map<string, string> | Record<string, string>;
  currentThemeName?: string;
  extraPromptsDirs?: string[];
  oneShotRestore?: string;
  chainDeclined?: string[];
}

export interface CliLike {
  resolveNoTools(cfg: ConfigLike): boolean;
  resolveMaxTokens(cfg: ConfigLike): number;
  resolveMaxAgentTurns(cfg: ConfigLike): number;
  resolveTools(cfg: ConfigLike): string[];
  resolveModel?(cfg: ConfigLike): string;
  resolveProvider?(cfg: ConfigLike): string;
  noSession?: boolean;
  apiKey?: string;
}

export interface ConfigLike {
  maxTextFileSize?: number;
  resolveMaxReadLines(): number;
  resolveMaxBashOutputLines(): number | undefined | null;
  resolveMaxGrepResults(): number;
  resolveMaxFindResults(): number;
  resolveMaxListDirEntries(): number | undefined | null;
  resolveShowReasoning?(): boolean;
  taskEnabled?: boolean;
  allowAllMcpCalls?: boolean;
  [key: string]: unknown;
}

export interface Features {
  lspEnabled?: boolean;
  rtkEnabled?: boolean;
  memoryEnabled?: boolean;
  subagentsEnabled?: boolean;
  advisorEnabled?: boolean;
  mcpEnabled?: boolean;
  archmdEnabled?: boolean;
  hooksEnabled?: boolean;
  exportEnabled?: boolean;
  worktreeEnabled?: boolean;
  loopEnabled?: boolean;
  multimodalEnabled?: boolean;
}

export interface DynamicTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  call(args: unknown): Promise<string>;
}

export function dynamicTool<TArgs>(tool: Tool<TArgs, string>): DynamicTool {
  const name = tool.name;
  const description = tool.description();
  const parameters = tool.parameters();
  return {
    name,
    description,
    parameters,
    async call(args: unknown): Promise<string> {
      try {
        return await tool.call(args as TArgs);
      } catch (e) {
        throw e instanceof Error ? e : new Error(String(e));
      }
    },
  };
}

export function loadSuffix(): string | undefined {
  const fromEnv = process.env.TINY_CROW_SUFFIX_FILE;
  if (fromEnv) {
    try {
      const text = readFileSync(fromEnv, "utf8");
      return text.trim() === "" ? undefined : text;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function estimateTokens(text: string): number {
  let wide = 0;
  let narrow = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x1100 && code <= 0x11ff) ||
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xa000 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef) ||
      (code >= 0x20000 && code <= 0x3ffff)
    ) {
      wide += 1;
    } else {
      narrow += 1;
    }
  }
  return Math.max(Math.floor((wide * 9) / 10) + Math.floor(narrow / 4), 1);
}

const MAX_EXTRA_FILE_BYTES = 524_288;

export interface BuildPreambleOptions {
  suffix?: string;
  memoryEnabled?: boolean;
  archmdEnabled?: boolean;
}

export function buildPreamble(
  context: ContextFilesLike,
  reasoningEnabled: boolean,
  options: BuildPreambleOptions = {},
): string {
  const reasoningPrefix = reasoningEnabled
    ? "You reason carefully and think step-by-step.\n\n"
    : "You respond concisely without showing your reasoning.\n\n";
  const suffix = options.suffix ?? loadSuffix();
  const contextAgents = context.agents ?? "";
  const contextArchitecture = context.architecture ?? "";
  const contextPrompt = context.currentPrompt ?? "";
  let currentDir = "";
  try {
    currentDir = cwd();
  } catch {
    currentDir = "";
  }
  const extraFilesDirect: Array<[string, string]> = [];
  for (const p of context.extraFiles) {
    try {
      const content = readFileSync(p, "utf8");
      let truncated = content;
      if (Buffer.byteLength(content, "utf8") > MAX_EXTRA_FILE_BYTES) {
        let bytes = 0;
        let end = 0;
        for (const ch of content) {
          const len = Buffer.byteLength(ch, "utf8");
          if (bytes + len > MAX_EXTRA_FILE_BYTES) break;
          bytes += len;
          end += ch.length;
        }
        truncated = content.slice(0, end) + "\n\n[truncated — file exceeded preamble size limit]";
      }
      extraFilesDirect.push([`Content of ${p}:\n`, truncated]);
    } catch {
      /* unreadable extra files are skipped, as in the original */
    }
  }
  let preamble = "";
  preamble += reasoningPrefix;
  preamble += SYSTEM_PROMPT;
  preamble += "\n";
  preamble += TODO_TOOLS_PROMPT;
  if (contextAgents !== "") {
    preamble += "\n\n";
    preamble += contextAgents;
  }
  if (options.archmdEnabled && contextArchitecture !== "") {
    preamble += "\n\n";
    preamble += contextArchitecture;
  }
  if (contextPrompt !== "") {
    preamble += "\n\n---\n\n";
    preamble += contextPrompt;
  }
  if (currentDir !== "") {
    preamble += "\n\nCurrent working directory: ";
    preamble += currentDir;
  }
  for (const [header, truncated] of extraFilesDirect) {
    preamble += "\n\n---\n\n";
    preamble += header;
    preamble += truncated;
  }
  if (options.memoryEnabled) {
    if (context.memory !== undefined && context.memory !== "") {
      preamble += "\n\n---\n\n";
      preamble += context.memory;
    }
    preamble += MEMORY_TOOLS_PROMPT;
  }
  if (suffix !== undefined) {
    preamble += "\n\n---\n\n";
    preamble += suffix;
  }
  return preamble;
}

export function estimateOverhead(
  context: ContextFilesLike,
  reasoningEnabled: boolean,
  options: BuildPreambleOptions = {},
): number {
  return estimateTokens(buildPreamble(context, reasoningEnabled, options));
}

export function filterToolsByAllowlist(tools: DynamicTool[], allowlist: string[]): DynamicTool[] {
  const cleaned = allowlist.map((s) => s.trim()).filter((s) => s !== "");
  if (cleaned.length === 0) return tools;
  const allowed = new Set(cleaned);
  const available = tools.map((t) => t.name);
  for (const name of allowed) {
    if (!available.includes(name)) {
      const suggestion = available.find((t) => t.toLowerCase() === name.toLowerCase());
      console.error(
        `warning: --tools: unknown tool '${name}'${suggestion ? ` (did you mean '${suggestion}'?)` : ""} (ignored)`,
      );
    }
  }
  const filtered = tools.filter((t) => allowed.has(t.name));
  if (filtered.length === 0) {
    console.error(`warning: --tools filter left no tools; available: ${available.join(", ")}`);
  }
  return filtered;
}

export interface AgentBuild {
  cli: CliLike;
  cfg: ConfigLike;
  context: ContextFilesLike;
  permission?: PermCheckLike | null;
  askTx?: AskSenderLike | null;
  sandbox: SandboxLike;
  reasoningEnabled: boolean;
  temperature?: number | null;
  extraBody?: unknown;
  mcpManager?: McpManagerLike | null;
  features?: Features;
  lspManager?: LspManagerLike | null;
  rtk?: RtkLike | null;
  extraTools?: DynamicTool[];
  taskTool?: DynamicTool | null;
  memoryTools?: DynamicTool[];
  advisorTool?: DynamicTool | null;
}

export interface McpManagerLike {
  collectTools(permission: PermCheckLike | undefined | null, askTx: AskSenderLike | undefined | null): Promise<DynamicTool[]>;
}

export interface AgentConfig {
  preamble: string;
  maxTokens: number;
  maxTurns: number;
  temperature?: number;
  additionalParams?: unknown;
  tools: DynamicTool[];
}

export async function buildAgentInner(build: AgentBuild): Promise<AgentConfig> {
  const { cli, cfg, context, permission, askTx, sandbox, reasoningEnabled, temperature, extraBody } = build;
  const features = build.features ?? {};
  const lspManager = features.lspEnabled ? build.lspManager ?? null : null;
  const rtk = features.rtkEnabled ? build.rtk ?? null : null;
  let preamble = buildPreamble(context, reasoningEnabled, {
    memoryEnabled: features.memoryEnabled,
    archmdEnabled: features.archmdEnabled,
  });
  if (lspManager) preamble += LSP_PROMPT;
  if (rtk) preamble += RTK_PROMPT;
  const maxTokens = cli.resolveMaxTokens(cfg);
  const maxTurns = cli.resolveMaxAgentTurns(cfg);
  if (cli.resolveNoTools(cfg)) {
    return { preamble, maxTokens, maxTurns, temperature: temperature ?? undefined, additionalParams: extraBody, tools: [] };
  }
  const maxTextFileSize = cfg.maxTextFileSize;
  const maxReadLines = cfg.resolveMaxReadLines();
  const maxBashOutputLines = cfg.resolveMaxBashOutputLines();
  const maxGrepResults = cfg.resolveMaxGrepResults();
  const maxFindResults = cfg.resolveMaxFindResults();
  const maxListDirEntries = cfg.resolveMaxListDirEntries();
  const writeTool = new WriteTool(permission, askTx, maxTextFileSize).withLsp(lspManager);
  const editTool = new EditTool(permission, askTx).withLsp(lspManager);
  const baseTools: DynamicTool[] = [
    dynamicTool(new ReadTool(permission, askTx, maxTextFileSize, maxReadLines)),
    dynamicTool(writeTool),
    dynamicTool(editTool),
    dynamicTool(new BashTool(permission, askTx, sandbox, maxBashOutputLines ?? undefined, rtk)),
    dynamicTool(new GrepTool(permission, askTx, maxGrepResults)),
    dynamicTool(new FindFilesTool(permission, askTx, maxFindResults)),
    dynamicTool(new ListDirTool(permission, askTx, maxListDirEntries ?? undefined)),
    dynamicTool(new WriteTodoList(permission, askTx)),
  ];
  let allTools: DynamicTool[] = [...baseTools];
  if (features.subagentsEnabled && (cfg.taskEnabled ?? true) && build.taskTool) {
    allTools.push(build.taskTool);
  }
  if (features.memoryEnabled && build.memoryTools) {
    allTools.push(...build.memoryTools);
  }
  if (build.mcpManager && features.mcpEnabled) {
    if ((cfg.allowAllMcpCalls ?? false) && permission) {
      const checker = permission as PermCheckLike & { setAllowAllMcpCalls?(v: boolean): void };
      checker.setAllowAllMcpCalls?.(true);
    }
    const mcpTools = await build.mcpManager.collectTools(permission, askTx);
    allTools.push(...mcpTools);
  }
  if (features.advisorEnabled && build.advisorTool) {
    allTools.push(build.advisorTool);
  }
  if (lspManager) {
    allTools.push(dynamicTool(new LspTool(lspManager)));
  }
  if (build.extraTools) allTools.push(...build.extraTools);
  allTools = filterToolsByAllowlist(allTools, cli.resolveTools(cfg));
  return {
    preamble,
    maxTokens,
    maxTurns,
    temperature: temperature ?? undefined,
    additionalParams: extraBody,
    tools: allTools,
  };
}

export const BTW_SYSTEM_PROMPT: string = `You are a fast side-assistant for quick "by the way" questions during a coding session. The user pressed /btw to ask you something in parallel with the main assistant, WITHOUT interrupting it.

Your only job: answer the user's question directly, briefly, and helpfully, using the conversation so far and the project context below. Reply in the user's language.

Match your length to the question: greetings, thanks, or yes/no questions get a ONE-LINE reply. Do NOT volunteer project setup, build, run, or test instructions unless the user explicitly asks how to build or run. The project context below is background for answering; it is NOT a script to recite.

This is a read-only side channel: you have read-only tools (read, grep, find_files, list_dir) to look things up, but you CANNOT write files, run commands, or change anything, and your reply is NOT saved to the conversation. Use the read tools when answering needs a file you do not already have in context, and keep it to what the question asks. Do NOT attempt or plan the main task, and do NOT tell the user to wait for the main assistant; just answer what they asked.`;

export const BTW_MAX_TURNS = 8;

export function buildBtwAgentInner(build: AgentBuild): AgentConfig {
  const { cli, cfg, context, permission, askTx, temperature, extraBody } = build;
  let currentDir = "";
  try {
    currentDir = cwd();
  } catch {
    currentDir = "";
  }
  let preamble = BTW_SYSTEM_PROMPT;
  const hasCtx = (context.agents !== undefined && context.agents !== "") || currentDir !== "";
  if (hasCtx) preamble += "\n\n## Project context (for reference)\n";
  if (context.agents !== undefined && context.agents !== "") {
    preamble += "\n";
    preamble += context.agents;
  }
  if (build.features?.archmdEnabled && context.architecture !== undefined && context.architecture !== "") {
    preamble += "\n\n";
    preamble += context.architecture;
  }
  if (context.currentPrompt !== undefined && context.currentPrompt !== "") {
    preamble += "\n\n";
    preamble += context.currentPrompt;
  }
  if (currentDir !== "") {
    preamble += "\n\nCurrent working directory: ";
    preamble += currentDir;
  }
  if (build.features?.memoryEnabled && context.memory !== undefined && context.memory !== "") {
    preamble += "\n\n---\n\n";
    preamble += context.memory;
  }
  const suffix = loadSuffix();
  if (suffix !== undefined) {
    preamble += "\n\n---\n\n";
    preamble += suffix;
  }
  const maxTokens = cli.resolveMaxTokens(cfg);
  if (cli.resolveNoTools(cfg)) {
    return {
      preamble,
      maxTokens,
      maxTurns: 1,
      temperature: temperature ?? undefined,
      additionalParams: extraBody,
      tools: [],
    };
  }
  const maxTextFileSize = cfg.maxTextFileSize;
  const maxReadLines = cfg.resolveMaxReadLines();
  const maxGrepResults = cfg.resolveMaxGrepResults();
  const maxFindResults = cfg.resolveMaxFindResults();
  const maxListDirEntries = cfg.resolveMaxListDirEntries();
  let readTools: DynamicTool[] = [
    dynamicTool(new ReadTool(permission, askTx, maxTextFileSize, maxReadLines)),
    dynamicTool(new GrepTool(permission, askTx, maxGrepResults)),
    dynamicTool(new FindFilesTool(permission, askTx, maxFindResults)),
    dynamicTool(new ListDirTool(permission, askTx, maxListDirEntries ?? undefined)),
  ];
  const allowlist = cli.resolveTools(cfg);
  const cleaned = allowlist.map((s) => s.trim()).filter((s) => s !== "");
  if (cleaned.length > 0) {
    const allowed = new Set(cleaned);
    readTools = readTools.filter((t) => allowed.has(t.name));
  }
  return {
    preamble,
    maxTokens,
    maxTurns: BTW_MAX_TURNS,
    temperature: temperature ?? undefined,
    additionalParams: extraBody,
    tools: readTools,
  };
}
