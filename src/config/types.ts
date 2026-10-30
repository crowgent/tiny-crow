export interface QuickModelConfig {
  provider: string;
  model: string;
  inputTokenCost?: number;
  outputTokenCost?: number;
  reserveTokens?: number;
  temperature?: number;
  extraBody?: unknown;
  contextWindow?: number;
}

export function defaultQuickModelConfig(
  provider: string,
  model: string,
): QuickModelConfig {
  return { provider, model, inputTokenCost: 0, outputTokenCost: 0 };
}

export interface StatusLineSegment {
  item: string;
  color?: string;
  bg?: string;
  text?: string;
  left?: string;
  right?: string;
  icon?: boolean | string;
  always?: boolean;
}

export interface StatusLineLine {
  segments: StatusLineSegment[];
}

export interface StatusLineConfig {
  lines: StatusLineLine[];
}

export type IconSpec = boolean | string;

export type ApiStyle = "responses" | "completions";

export interface CustomProviderConfig {
  providerType: string;
  baseUrl: string;
  apiKeyEnv?: string;
  dangerAcceptInvalidCerts?: boolean;
  apiStyle?: ApiStyle;
  headers?: Record<string, string>;
  timeoutSecs?: number;
  model?: string;
}

export type EditSystem = "similarity" | "hashedit";

export const EDIT_SYSTEMS: readonly EditSystem[] = ["similarity", "hashedit"];

export function parseEditSystem(s: string): EditSystem {
  if (s === "similarity" || s === "hashedit") return s;
  throw new Error(
    `unknown edit system '${s}' (valid: similarity, hashedit)`,
  );
}

export function editSystemToString(system: EditSystem): string {
  return system;
}

export type SchemeType = "full" | "ansi";

export interface ColorsConfig {
  chatBackground?: string;
  inputBackground?: string;
  statusBackground?: string;
  roles?: Record<string, string>;
  schemeType?: SchemeType;
}

export interface ChainConfig {
  brainstormToPlan: boolean;
  planToCode: boolean;
  codeToReview: boolean;
}

export function defaultChainConfig(): ChainConfig {
  return { brainstormToPlan: true, planToCode: true, codeToReview: false };
}

export interface LspServerConfig {
  command: string;
  args: string[];
  extensions: string[];
  env: Record<string, string>;
  initialization?: unknown;
  disabled: boolean;
}

export interface LspConfig {
  enabled: boolean;
  servers: Record<string, LspServerConfig>;
}

export function defaultLspConfig(): LspConfig {
  return { enabled: false, servers: {} };
}

export interface RtkConfig {
  enabled: boolean;
  path?: string;
}

export interface AdvisorConfig {
  enabled: boolean;
  model?: string;
  maxUses?: number;
  humanHandoff: boolean;
  advisorKilobytesLimit: number;
}

export function defaultAdvisorConfig(): AdvisorConfig {
  return {
    enabled: false,
    model: "deepseek-v4-pro",
    maxUses: 3,
    humanHandoff: true,
    advisorKilobytesLimit: 256,
  };
}

export function quickModelFromJson(raw: Record<string, unknown>): QuickModelConfig {
  const q: QuickModelConfig = {
    provider: String(raw["provider"] ?? ""),
    model: String(raw["model"] ?? ""),
    inputTokenCost: typeof raw["input_token_cost"] === "number" ? raw["input_token_cost"] : 0,
    outputTokenCost: typeof raw["output_token_cost"] === "number" ? raw["output_token_cost"] : 0,
  };
  if (typeof raw["reserve_tokens"] === "number") q.reserveTokens = raw["reserve_tokens"];
  if (typeof raw["temperature"] === "number") q.temperature = raw["temperature"];
  if (raw["extra_body"] !== undefined) q.extraBody = raw["extra_body"];
  if (typeof raw["context_window"] === "number") q.contextWindow = raw["context_window"];
  return q;
}

export function quickModelToJson(q: QuickModelConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {
    provider: q.provider,
    model: q.model,
    input_token_cost: q.inputTokenCost ?? 0,
    output_token_cost: q.outputTokenCost ?? 0,
  };
  if (q.reserveTokens !== undefined) out["reserve_tokens"] = q.reserveTokens;
  if (q.temperature !== undefined) out["temperature"] = q.temperature;
  if (q.extraBody !== undefined) out["extra_body"] = q.extraBody;
  if (q.contextWindow !== undefined) out["context_window"] = q.contextWindow;
  return out;
}

export function statusLineFromJson(raw: Record<string, unknown>): StatusLineConfig {
  const lines = Array.isArray(raw["lines"]) ? raw["lines"] : [];
  return {
    lines: lines.map((line) => {
      const l = line as Record<string, unknown>;
      const segments = Array.isArray(l["segments"]) ? l["segments"] : [];
      return {
        segments: segments.map((seg) => {
          const s = seg as Record<string, unknown>;
          const out: StatusLineSegment = { item: String(s["item"] ?? "") };
          if (typeof s["color"] === "string") out.color = s["color"];
          if (typeof s["bg"] === "string") out.bg = s["bg"];
          if (typeof s["text"] === "string") out.text = s["text"];
          if (typeof s["left"] === "string") out.left = s["left"];
          if (typeof s["right"] === "string") out.right = s["right"];
          if (typeof s["icon"] === "boolean" || typeof s["icon"] === "string") out.icon = s["icon"];
          if (typeof s["always"] === "boolean") out.always = s["always"];
          return out;
        }),
      };
    }),
  };
}

export function customProviderFromJson(raw: Record<string, unknown>): CustomProviderConfig {
  const c: CustomProviderConfig = {
    providerType: String(raw["provider_type"] ?? ""),
    baseUrl: String(raw["base_url"] ?? ""),
  };
  if (typeof raw["api_key_env"] === "string") c.apiKeyEnv = raw["api_key_env"];
  if (typeof raw["danger_accept_invalid_certs"] === "boolean") {
    c.dangerAcceptInvalidCerts = raw["danger_accept_invalid_certs"];
  }
  if (raw["api_style"] === "responses" || raw["api_style"] === "completions") {
    c.apiStyle = raw["api_style"];
  }
  if (raw["headers"] && typeof raw["headers"] === "object") {
    c.headers = raw["headers"] as Record<string, string>;
  }
  if (typeof raw["timeout_secs"] === "number") c.timeoutSecs = raw["timeout_secs"];
  if (typeof raw["model"] === "string") c.model = raw["model"];
  return c;
}

export function chainFromJson(raw: Record<string, unknown>): ChainConfig {
  const d = defaultChainConfig();
  if (typeof raw["brainstorm-to-plan"] === "boolean") d.brainstormToPlan = raw["brainstorm-to-plan"];
  if (typeof raw["plan-to-code"] === "boolean") d.planToCode = raw["plan-to-code"];
  if (typeof raw["code-to-review"] === "boolean") d.codeToReview = raw["code-to-review"];
  return d;
}

export function advisorFromJson(raw: Record<string, unknown>): AdvisorConfig {
  const d = defaultAdvisorConfig();
  if (typeof raw["enabled"] === "boolean") d.enabled = raw["enabled"];
  if (typeof raw["model"] === "string") d.model = raw["model"];
  if (typeof raw["max_uses"] === "number") d.maxUses = raw["max_uses"];
  if (typeof raw["human_handoff"] === "boolean") d.humanHandoff = raw["human_handoff"];
  if (typeof raw["advisor_kilobytes_limit"] === "number") {
    d.advisorKilobytesLimit = raw["advisor_kilobytes_limit"];
  }
  return d;
}
