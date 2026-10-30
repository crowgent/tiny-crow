// Explore-agent construction: preamble + read-only tool set + allowlist.
import { explorePrompt } from "./prompt.ts";
import { toolsAllowlistOrDefault } from "./mod.ts";

/**
 * The memory tools a subagent is granted: read-only access ONLY
 * (`memory_read`, `memory_search`). `memory_write` and `memory_edit` are
 * deliberately absent, so a subagent can never mutate memory.
 */
export function subagentMemoryTools(): string[] {
  return ["memory_read", "memory_search"];
}

export interface ExploreAgentDescriptor {
  /** Full system preamble, including architecture and suffix when present. */
  preamble: string;
  /** Tool names the agent may call, after allowlist filtering. */
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
  /** Rendered architecture document (archmd feature, runtime flag via presence). */
  architecture?: string;
  /** Suffix text loaded from the session store (SUFFIX.md equivalent). */
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
  // Respect the --tools allowlist (intersection, no warnings for
  // valid-but-not-applicable tools).
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

/**
 * Build the explore agent descriptor from a config-slice object. The
 * agent slice turns this descriptor into a runnable agent (provider
 * model + tool server); the descriptor itself carries every decision
 * the Rust builder made: limits, preamble, allowlist, and params.
 */
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
