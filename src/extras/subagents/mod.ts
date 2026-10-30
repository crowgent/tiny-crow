// Subagent configuration registry (process-global, like the Rust static).
export { explorePrompt, EXPLORE_PROMPT } from "./prompt.ts";

/** Minimal client surface a subagent run needs from the provider slice. */
export interface SubagentClient {
  /** Return a model handle for `modelName` (provider slice's model object). */
  completionModel(modelName: string): unknown;
}

/** Event sink for subagent activity (agent slice's event channel). */
export type SubagentEventSender = (event: unknown) => void;

export interface SubagentConfig {
  client: SubagentClient;
  modelName: string;
  maxTurns: number;
  /** Opaque config object from the config slice. */
  config: Record<string, unknown>;
  toolsAllowlist: string[];
  /** Rendered architecture document, when the archmd feature is enabled. */
  architecture?: string;
}

let config: SubagentConfig | null = null;
let eventTx: SubagentEventSender | null = null;

export function setSubagentEventTx(tx: SubagentEventSender): void {
  eventTx = tx;
}

export function cloneSubagentEventTx(): SubagentEventSender | null {
  return eventTx;
}

/** Run `f` against the registered config; throws when `init` has not run. */
export function withConfig<R>(f: (cfg: SubagentConfig) => R): R {
  if (!config) {
    throw new Error("subagents: SubagentConfig not initialized (call init() first)");
  }
  return f(config);
}

export function toolsAllowlistOrDefault(): string[] {
  return config ? [...config.toolsAllowlist] : [];
}

export function init(
  client: SubagentClient,
  modelName: string,
  maxTurns: number,
  configObj: Record<string, unknown>,
  toolsAllowlist: string[],
  architecture?: string,
): void {
  config = { client, modelName, maxTurns, config: configObj, toolsAllowlist, architecture };
}

export function setClientAndModel(client: SubagentClient, modelName: string): void {
  if (config) {
    config.client = client;
    config.modelName = modelName;
  }
}

export function setModelName(modelName: string): void {
  if (config) config.modelName = modelName;
}
