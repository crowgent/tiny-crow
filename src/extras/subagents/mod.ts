export { explorePrompt, EXPLORE_PROMPT } from "./prompt.ts";

export interface SubagentClient {
  
  completionModel(modelName: string): unknown;
}

export type SubagentEventSender = (event: unknown) => void;

export interface SubagentConfig {
  client: SubagentClient;
  modelName: string;
  maxTurns: number;
  
  config: Record<string, unknown>;
  toolsAllowlist: string[];
  
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
