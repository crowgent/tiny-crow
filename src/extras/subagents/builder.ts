import { explorePrompt } from "./prompt.ts";
import { toolsAllowlistOrDefault } from "./mod.ts";

export function subagentMemoryTools(): string[] {
  return ["memory_read", "memory_search"];
}

export interface ExploreAgentDescriptor {
  
  preamble: string;
  
  toolNames: string[];
  maxTurns: number;
  additionalParams?: unknown;
  model: unknown;
}

export interface ExploreAgentOptions {
  model: unknown;
  maxTurns: number;
  maxTextFileSize?: number;
  maxReadLines?: number;
  maxGrepResults?: number;
  maxFindResults?: number;
  maxListDirEntries?: number | null;
  additionalParams?: unknown;
  
  architecture?: string;
  
  suffix?: string;
  includeMemoryTools?: boolean;
}

function buildExploreAgentInner(options: ExploreAgentOptions): ExploreAgentDescriptor {
  let preamble = explorePrompt(options.includeMemoryTools ?? true);
  if (options.architecture && options.architecture !== "") {
    preamble += `\n\n${options.architecture}`;
  }
  if (options.suffix) {
    preamble += `\n\n---\n\n${options.suffix}`;
  }
  let toolNames = ["read", "grep", "find_files", "list_dir"];
  if (options.includeMemoryTools ?? true) {
    toolNames = [...toolNames, ...subagentMemoryTools()];
  }

  const allowlist = toolsAllowlistOrDefault()
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (allowlist.length > 0) {
    const allowed = new Set(allowlist);
    toolNames = toolNames.filter((t) => allowed.has(t));
  }
  return {
    preamble,
    toolNames,
    maxTurns: options.maxTurns,
    additionalParams: options.additionalParams,
    model: options.model,
  };
}

export interface SubagentConfigLike {
  maxTextFileSize?: number;
  resolveSubagentMaxReadLines?: () => number;
  resolveSubagentMaxGrepResults?: () => number;
  resolveSubagentMaxFindResults?: () => number;
  resolveSubagentMaxListDirEntries?: () => number | null;
}

export function buildExploreAgent(
  model: unknown,
  maxTurns: number,
  cfg: SubagentConfigLike,
  architecture?: string,
  extra?: { additionalParams?: unknown; suffix?: string; includeMemoryTools?: boolean },
): ExploreAgentDescriptor {
  return buildExploreAgentInner({
    model,
    maxTurns,
    maxTextFileSize: cfg.maxTextFileSize ?? 10 * 1024 * 1024,
    maxReadLines: cfg.resolveSubagentMaxReadLines?.() ?? 2000,
    maxGrepResults: cfg.resolveSubagentMaxGrepResults?.() ?? 100,
    maxFindResults: cfg.resolveSubagentMaxFindResults?.() ?? 100,
    maxListDirEntries: cfg.resolveSubagentMaxListDirEntries?.() ?? null,
    additionalParams: extra?.additionalParams,
    architecture,
    suffix: extra?.suffix,
    includeMemoryTools: extra?.includeMemoryTools,
  });
}
