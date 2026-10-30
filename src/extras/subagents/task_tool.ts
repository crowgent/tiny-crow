// `task` tool: run one explore subagent per prompt, in parallel, and
// combine their (truncated) responses in prompt order.
import { truncateCjk } from "../truncate.ts";
import { withConfig, cloneSubagentEventTx } from "./mod.ts";
import { dispatchSubagentStart, dispatchSubagentStop } from "../hooks/mod.ts";

/** Per-subagent wall-clock timeout (300 s, matching the Rust constant). */
export const SUBAGENT_TIMEOUT_MS = 300 * 1000;
/** Hard cap on a single subagent's response, protecting the main context. */
export const MAX_SUBAGENT_RESPONSE_BYTES = 128 * 1024;

export interface TaskArgs {
  /** One or more exploration prompts; multiple run in parallel. */
  prompts: string[];
}

/**
 * Runner supplied by the agent slice: executes one explore prompt and
 * returns its final text. Kept injectable so this file never depends on
 * a provider framework type.
 */
export type SubagentRunner = (prompt: string, index: number) => Promise<string>;

export const TASK_DESCRIPTION =
  "Search and investigate the codebase via a fresh-context subagent. " +
  "Use for any cross-file question: where is X used, how does Y work, " +
  "find/list/count all X across the codebase, what calls Z, audit Q. " +
  "The subagent reads, greps, finds files, lists directories, accesses memory, " +
  "and returns a verified summary. " +
  "More reliable than running multiple grep/read calls yourself; the subagent " +
  "enumerates completely without truncation gaps or synthesis errors across partial views. " +
  "Multiple prompts run in parallel. " +
  "Skip only for known-location work: reading one identified file, " +
  "editing in a known location, grepping for a literal you will act on immediately.";

export const TASK_PARAMETERS = {
  type: "object",
  properties: {
    prompts: {
      type: "array",
      items: { type: "string" },
      description:
        "Investigation prompt for the subagent. Use one for a focused question, or multiple to run independent investigations in parallel. Examples: 'List all tests in this project', 'Where is config loaded?', 'How does the agent loop work?'",
    },
  },
  required: ["prompts"],
} as const;

async function withTimeout(
  runner: SubagentRunner,
  prompt: string,
  index: number,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve("[timeout: subagent exceeded 300s]"), SUBAGENT_TIMEOUT_MS);
  });
  try {
    return await Promise.race([runner(prompt, index), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Combine per-task outputs into a single Markdown string, ordered by the
 * original prompt index. Multiple tasks get `## Task N:` headings; a
 * single task is emitted as-is.
 */
export function combineResults(outputs: Array<[number, string, string]>): string {
  let combined = "";
  outputs.forEach(([_, promptText, response], idx) => {
    if (outputs.length > 1) {
      if (idx > 0) combined += "\n";
      const label = [...promptText].slice(0, 60).join("");
      combined += `## Task ${idx + 1}: ${label}\n\n`;
    }
    combined += response;
    if (!combined.endsWith("\n")) combined += "\n";
  });
  return combined;
}

export class TaskTool {
  private runner: SubagentRunner | null;

  constructor(runner: SubagentRunner | null = null) {
    this.runner = runner;
  }

  async call(args: TaskArgs, runnerOverride?: SubagentRunner): Promise<string> {
    if (args.prompts.length === 0) {
      throw new Error("task: prompts must not be empty");
    }
    const runner = runnerOverride ?? this.runner;
    if (!runner) {
      throw new Error(
        "task: subagent runner not configured (call init() in the subagents module and supply a runner)",
      );
    }
    // Validate that subagent config exists, mirroring the Rust with_config
    // access (client/model/max_turns are read by the agent slice's runner).
    try {
      withConfig((cfg) => cfg);
    } catch {
      // Config is optional for a directly-supplied runner; the runner
      // itself carries the model/agent it needs.
    }
    void cloneSubagentEventTx;

    const indexed = await Promise.all(
      args.prompts.map(async (promptText, i) => {
        let effectivePrompt = promptText;
        try {
          const extra = await dispatchSubagentStart("explore");
          if (extra !== null) effectivePrompt = `${extra}\n\n${promptText}`;
        } catch {
          // No dispatcher installed: proceed unchanged.
        }
        let response: string;
        try {
          response = await withTimeout(runner, effectivePrompt, i);
          const stopGate = await dispatchSubagentStop("explore", false);
          if (
            stopGate.kind === "Continue" &&
            !response.startsWith("[timeout:") &&
            !response.startsWith("[error:")
          ) {
            const continuation = `${response}\n\n${stopGate.reason}`;
            response = await withTimeout(runner, continuation, i);
          }
        } catch (err) {
          response = `[error: ${err instanceof Error ? err.message : String(err)}]`;
        }
        const truncated = truncateCjk(
          response,
          MAX_SUBAGENT_RESPONSE_BYTES,
          `\n…[subagent response truncated at ${MAX_SUBAGENT_RESPONSE_BYTES}B]`,
        );
        return [i, promptText, truncated] as [number, string, string];
      }),
    );
    indexed.sort((a, b) => a[0] - b[0]);
    return combineResults(indexed);
  }
}
