// Provider clients: direct HTTP + streaming completions for OpenRouter,
// OpenAI, Anthropic, Gemini, Ollama, custom OpenAI-compatible gateways and
// the OpenCode gateways (Zen / Go). This is the TypeScript counterpart of
// the Rust provider module; the rig client is replaced by fetch + SSE/NDJSON
// parsing with the same model, request and response handling.
//
// Local definitions note: the config, auth, session, agent-builder and
// runner slices own the canonical Config / ProviderKind / AgentBuild /
// AgentRunner types in the full port. The small interfaces below (marked
// "local") mirror those shapes so this file typechecks and runs standalone;
// the coordinator should reconcile them with the owning slices rather than
// duplicating them long-term.

export type ProviderKind =
  | "openrouter"
  | "openai"
  | "anthropic"
  | "gemini"
  | "ollama"
  | "opencode-zen"
  | "opencode-go";

export function providerKindFromName(name: string): ProviderKind | null {
  switch (name.toLowerCase()) {
    case "openrouter":
      return "openrouter";
    case "openai":
    case "custom":
      return "openai";
    case "anthropic":
      return "anthropic";
    case "gemini":
    case "google":
      return "gemini";
    case "ollama":
      return "ollama";
    case "opencode-zen":
      return "opencode-zen";
    case "opencode-go":
      return "opencode-go";
    default:
      return null;
  }
}

export function providerKindSlug(kind: ProviderKind): string {
  return kind;
}

export function providerKindEnvVar(kind: ProviderKind): string {
  switch (kind) {
    case "openai":
      return "OPENAI_API_KEY";
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "gemini":
      return "GEMINI_API_KEY";
    case "ollama":
      return "OLLAMA_API_KEY";
    case "openrouter":
      return "OPENROUTER_API_KEY";
    case "opencode-zen":
    case "opencode-go":
      return "OPENCODE_API_KEY";
  }
}

export type ApiStyle = "responses" | "completions";

/** Local mirror of the config slice's CustomProviderConfig. */
export interface CustomProviderConfig {
  providerType: string;
  baseUrl: string;
  apiKeyEnv?: string | null;
  dangerAcceptInvalidCerts?: boolean | null;
  apiStyle?: ApiStyle | null;
  headers?: Record<string, string>;
  timeoutSecs?: number | null;
  model?: string | null;
}

export type CustomProvidersMap = Map<string, CustomProviderConfig> | Record<string, CustomProviderConfig>;

export function customProvidersGet(
  map: CustomProvidersMap | undefined | null,
  name: string,
): CustomProviderConfig | undefined {
  if (!map) return undefined;
  if (map instanceof Map) return map.get(name);
  return map[name];
}

export function customProvidersEntries(
  map: CustomProvidersMap | undefined | null,
): Array<[string, CustomProviderConfig]> {
  if (!map) return [];
  if (map instanceof Map) return [...map.entries()];
  return Object.entries(map);
}

/** Local mirror of the config slice's quick-model entry. */
export interface QuickModel {
  provider: string;
  model: string;
  inputTokenCost: number;
  outputTokenCost: number;
}

/** Minimal config shape used by defaultModelForProvider. Accepts either the
 *  config slice's method-style object or a plain record. */
export interface ConfigLike {
  customProvidersMap?: () => CustomProvidersMap;
  customProviders?: CustomProvidersMap;
  quickModelsMap?: () => Map<string, QuickModel> | Record<string, QuickModel>;
  quickModels?: Map<string, QuickModel> | Record<string, QuickModel>;
}

function configCustomProviders(cfg: ConfigLike): CustomProvidersMap | undefined {
  if (typeof cfg.customProvidersMap === "function") return cfg.customProvidersMap();
  return cfg.customProviders;
}

function configQuickModels(cfg: ConfigLike): Array<[string, QuickModel]> {
  const m =
    typeof cfg.quickModelsMap === "function" ? cfg.quickModelsMap() : cfg.quickModels;
  if (!m) return [];
  if (m instanceof Map) return [...m.entries()];
  return Object.entries(m);
}

export interface ProviderConfig {
  kind: ProviderKind;
  baseUrl: string | null;
  apiKeyEnv: string | null;
  dangerAcceptInvalidCerts: boolean;
}

export function resolveProviderConfig(
  name: string,
  customProviders: CustomProvidersMap,
): ProviderConfig {
  const custom = customProvidersGet(customProviders, name);
  if (custom) {
    const kind = providerKindFromName(custom.providerType);
    if (!kind) {
      throw new Error(
        `Unknown provider type: ${custom.providerType}. Run \`tiny-crow --setup\` to configure providers.`,
      );
    }
    return {
      kind,
      baseUrl: custom.baseUrl,
      apiKeyEnv: custom.apiKeyEnv ?? null,
      dangerAcceptInvalidCerts: custom.dangerAcceptInvalidCerts ?? false,
    };
  }
  const kind = providerKindFromName(name);
  if (!kind) {
    throw new Error(
      `Unknown provider: '${name}'. Supported: openrouter, openai, anthropic, gemini, ollama, opencode-zen, opencode-go. Run \`tiny-crow --setup\` to configure providers.`,
    );
  }
  let baseUrl: string | null = null;
  if (kind === "opencode-zen") baseUrl = `${OPENCODE_ZEN_ROOT}/v1`;
  if (kind === "opencode-go") baseUrl = `${OPENCODE_GO_ROOT}/v1`;
  return { kind, baseUrl, apiKeyEnv: null, dangerAcceptInvalidCerts: false };
}

/** Re-exported compatibility helper. */
export function parseProvider(name: string): ProviderKind | null {
  return providerKindFromName(name);
}

export function defaultModelForProvider(
  provider: string,
  cfg: ConfigLike,
): [string, [number, number] | null] | null {
  const custom = customProvidersGet(configCustomProviders(cfg), provider);
  if (custom?.model) return [custom.model, null];
  const quick = configQuickModels(cfg).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [, q] of quick) {
    if (q.provider === provider) {
      return [q.model, [q.inputTokenCost, q.outputTokenCost]];
    }
  }
  let m: string | null = null;
  switch (provider) {
    case "anthropic":
      m = "claude-sonnet-4-6";
      break;
    case "openai":
      m = "gpt-5.1";
      break;
    case "gemini":
    case "google":
      m = "gemini-2.5-pro";
      break;
    case "openrouter":
      m = "openrouter/auto";
      break;
    case "ollama":
      m = "llama3.1";
      break;
    case "opencode-zen":
    case "opencode-go":
      m = "kimi-k2.6";
      break;
    default:
      return null;
  }
  return [m, null];
}

export function resolveBaseUrl(config: ProviderConfig): string | null {
  return config.baseUrl;
}

export const OPENCODE_ZEN_ROOT = "https://opencode.ai/zen";
export const OPENCODE_GO_ROOT = "https://opencode.ai/zen/go";
export const OPENCODE_SESSION_HEADER = "x-opencode-session";

export function isOpencodeProvider(name: string): boolean {
  return name === "opencode-zen" || name === "opencode-go";
}

let opencodeSessionIdValue: string | null = null;

export function setOpencodeSessionId(id: string): void {
  if (opencodeSessionIdValue === null) opencodeSessionIdValue = id;
}

export function opencodeSessionId(): string {
  if (opencodeSessionIdValue === null) {
    opencodeSessionIdValue = crypto.randomUUID();
  }
  return opencodeSessionIdValue;
}

export function opencodeSessionHeaderValue(id: string): string {
  if (/[\r\n]/.test(id) || id.length === 0) {
    throw new Error(`invalid OpenCode session id: ${id}`);
  }
  return id;
}

export function opencodeSessionHeader(): string {
  return opencodeSessionHeaderValue(opencodeSessionId());
}

export type OpencodeTransport = "chat" | "responses" | "messages";

// Baked per-model transport map for the OpenCode gateways, carried over
// from the Rust embedded catalog (same provider/model -> transport rows).
const OPENCODE_TRANSPORTS_DATA = {
  "opencode-go": {
    "deepseek-v4-flash": "chat",
    "deepseek-v4-flash-vision-exp": "chat",
    "deepseek-v4-pro": "chat",
    "deepseek-v4.1-flash": "chat",
    "glm-5.1": "chat",
    "glm-5.2": "chat",
    "glm-5.3": "chat",
    "glm-5.3-flash": "chat",
    "gpt-5.6-luna": "responses",
    "grok-4.6": "responses",
    "hy3": "chat",
    "hy4-preview": "chat",
    "kimi-k2.6": "chat",
    "kimi-k2.7-code": "chat",
    "kimi-k3": "chat",
    "longcat-2.0": "chat",
    "mimo-v2.5": "chat",
    "mimo-v2.5-pro": "chat",
    "minimax-m2.7": "messages",
    "minimax-m3": "messages",
    "muse-spark-1.2-contributor": "responses",
    "muse-spark-1.3-contributor": "responses",
    "qwen3.6-plus": "chat",
    "qwen3.7-max": "chat",
    "qwen3.7-plus": "chat",
    "qwen3.8-flash": "messages",
    "qwen3.8-max": "chat"
  },
  "opencode-zen": {
    "big-pickle": "chat",
    "claude-fable-5": "messages",
    "claude-fable-5-1": "messages",
    "claude-haiku-4-5": "messages",
    "claude-opus-4-5": "messages",
    "claude-opus-4-6": "messages",
    "claude-opus-4-7": "messages",
    "claude-opus-4-8": "messages",
    "claude-opus-5": "messages",
    "claude-sonnet-4": "messages",
    "claude-sonnet-4-5": "messages",
    "claude-sonnet-4-6": "messages",
    "claude-sonnet-5": "messages",
    "deepseek-v4-flash": "chat",
    "deepseek-v4-flash-vision-exp": "chat",
    "deepseek-v4-pro": "chat",
    "glm-5": "chat",
    "glm-5.1": "chat",
    "glm-5.2": "chat",
    "glm-5.3": "chat",
    "glm-5.3-flash": "chat",
    "gpt-5": "responses",
    "gpt-5-codex": "responses",
    "gpt-5-nano": "responses",
    "gpt-5.1": "responses",
    "gpt-5.1-codex": "responses",
    "gpt-5.1-codex-max": "responses",
    "gpt-5.1-codex-mini": "responses",
    "gpt-5.2": "responses",
    "gpt-5.2-codex": "responses",
    "gpt-5.3-codex": "responses",
    "gpt-5.3-codex-spark": "responses",
    "gpt-5.4": "responses",
    "gpt-5.4-mini": "responses",
    "gpt-5.4-nano": "responses",
    "gpt-5.4-pro": "responses",
    "gpt-5.5": "responses",
    "gpt-5.5-pro": "responses",
    "gpt-5.6-luna": "responses",
    "gpt-5.6-sol": "responses",
    "gpt-5.6-terra": "responses",
    "gpt-6-astra": "responses",
    "grok-4.5": "responses",
    "grok-4.6": "responses",
    "grok-build-0.1": "responses",
    "kimi-k2.5": "chat",
    "kimi-k2.6": "chat",
    "kimi-k2.7-code": "chat",
    "kimi-k3": "chat",
    "ling-3.0-flash-fin-free": "chat",
    "mimo-v2.5-free": "chat",
    "minimax-m2.5": "chat",
    "minimax-m2.7": "chat",
    "minimax-m3": "chat",
    "muse-spark-1.2": "responses",
    "muse-spark-1.2-contributor-free": "responses",
    "muse-spark-1.3": "responses",
    "muse-spark-1.3-contributor-free": "responses",
    "nemotron-3-ultra-free": "chat",
    "nemotron-3.5-lightning-free": "chat",
    "qwen3.5-plus": "messages",
    "qwen3.6-plus": "messages"
  }
};

const OPENCODE_TRANSPORTS: Record<string, Record<string, OpencodeTransport>> =
  OPENCODE_TRANSPORTS_DATA as Record<string, Record<string, OpencodeTransport>>;

export function opencodeTransport(
  provider: string,
  modelId: string,
): OpencodeTransport | null {
  return OPENCODE_TRANSPORTS[provider]?.[modelId] ?? null;
}

export function resolveOpencodeTransport(
  provider: string,
  modelId: string,
): OpencodeTransport {
  const t = opencodeTransport(provider, modelId);
  if (t) return t;
  console.warn(
    `unknown model '${modelId}' for provider '${provider}'; assuming chat completions transport`,
  );
  return "chat";
}

/** Extra OpenRouter body params pinning a Claude model to the Anthropic
 *  direct route (the only route honouring cache_control breakpoints). */
export function openrouterAnthropicRouting(modelId: string): Record<string, unknown> | null {
  const slug = modelId.startsWith("~") ? modelId.slice(1) : modelId;
  if (!slug.startsWith("anthropic/")) return null;
  return { provider: { order: ["Anthropic"], allow_fallbacks: true } };
}

/** Shallow-merge user extra_body over provider-internal routing params.
 *  Top-level keys from extra win; null when both are absent. */
export function mergeExtraBody(
  base: Record<string, unknown> | null | undefined,
  extra: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (base && extra) return { ...base, ...extra };
  return base ?? extra ?? null;
}

/** Expands a value that is exactly "${VAR}" to the env var's value. */
export function expandEnv(value: string): string {
  const m = /^\$\{([^}]+)\}$/.exec(value);
  if (!m) return value;
  const v = process.env[m[1]];
  if (v === undefined) {
    throw new Error(
      `Environment variable '${m[1]}' (referenced in a custom provider header) is not set`,
    );
  }
  return v;
}

export type HttpPurpose = "completion" | "metadata";

export const CONNECT_TIMEOUT_MS = 5_000;
export const DEFAULT_METADATA_TIMEOUT_MS = 8_000;
export const COMPLETION_IDLE_TIMEOUT_MS = 300_000;

export function httpTotalTimeout(
  purpose: HttpPurpose,
  custom: CustomProviderConfig | undefined | null,
): number | null {
  if (custom?.timeoutSecs != null) return custom.timeoutSecs * 1000;
  if (purpose === "metadata") return DEFAULT_METADATA_TIMEOUT_MS;
  return null;
}

export interface HttpClientOptions {
  userAgent: string;
  headers: Record<string, string>;
  timeoutMs: number | null;
  dangerAcceptInvalidCerts: boolean;
  poolMaxIdlePerHost: number;
}

export function baseClientOptions(): HttpClientOptions {
  return {
    userAgent: "tiny-crow/1.0.5",
    headers: {},
    timeoutMs: null,
    dangerAcceptInvalidCerts: false,
    poolMaxIdlePerHost: 8,
  };
}

/** Builds the shared HTTP options for a purpose, mirroring the Rust
 *  pooled-client builder (user agent, custom headers with ${VAR} expansion,
 *  OpenCode session header, per-purpose deadline, TLS toggle). Node's fetch
 *  has no connection-pool or insecure-TLS knobs, so the pool settings are
 *  advisory and the TLS toggle is reported via a warning, as in Rust. */
export function buildHttpClient(
  providerName: string,
  dangerAcceptInvalidCerts: boolean,
  custom: CustomProviderConfig | undefined | null,
  baseUrl: string | null | undefined,
  purpose: HttpPurpose,
): HttpClientOptions {
  const opts = baseClientOptions();
  if (isLocalhost(baseUrl)) opts.poolMaxIdlePerHost = 0;
  if (custom && custom.headers && Object.keys(custom.headers).length > 0) {
    for (const [name, raw] of Object.entries(custom.headers)) {
      opts.headers[name] = expandEnv(raw);
    }
  }
  if (isOpencodeProvider(providerName)) {
    opts.headers[OPENCODE_SESSION_HEADER] = opencodeSessionHeader();
  }
  opts.timeoutMs = httpTotalTimeout(purpose, custom);
  if (dangerAcceptInvalidCerts) {
    console.warn(
      `TLS certificate verification DISABLED for provider '${providerName}' (danger_accept_invalid_certs = true). Connections are vulnerable to MITM.`,
    );
    opts.dangerAcceptInvalidCerts = true;
  }
  return opts;
}

export function isLocalhost(url: string | null | undefined): boolean {
  if (!url) return false;
  return (
    url.startsWith("http://localhost") ||
    url.startsWith("http://127.") ||
    url.startsWith("http://[::1]")
  );
}

/** Local mirror of the auth slice's resolver: CLI key > env var (or the
 *  custom provider's api_key_env) > config keys (slug, then custom name) >
 *  Ollama keyless / Zen public fallback. */
export class AuthResolver {
  providerKind: ProviderKind;
  apiKeyEnvOverride: string | null = null;
  cliKey: string | null = null;
  configApiKeys: Map<string, string> | Record<string, string> | null = null;
  customProviderName: string | null = null;

  constructor(kind: ProviderKind) {
    this.providerKind = kind;
  }

  withCliKey(key: string | undefined | null): this {
    if (key) this.cliKey = key;
    return this;
  }

  withEnvOverride(envVar: string | undefined | null): this {
    if (envVar) this.apiKeyEnvOverride = envVar;
    return this;
  }

  withConfigKeys(
    keys: Map<string, string> | Record<string, string> | undefined | null,
  ): this {
    this.configApiKeys = keys ?? null;
    return this;
  }

  withCustomProviderName(name: string | undefined | null): this {
    if (name) this.customProviderName = name;
    return this;
  }

  resolve(): string {
    if (this.cliKey) return this.cliKey;
    const envVar = this.apiKeyEnvOverride ?? providerKindEnvVar(this.providerKind);
    const fromEnv = process.env[envVar];
    if (fromEnv) return fromEnv;
    if (this.configApiKeys) {
      const slug = providerKindSlug(this.providerKind);
      const bySlug =
        this.configApiKeys instanceof Map
          ? this.configApiKeys.get(slug)
          : this.configApiKeys[slug];
      if (bySlug) return bySlug;
      if (this.customProviderName) {
        const byName =
          this.configApiKeys instanceof Map
            ? this.configApiKeys.get(this.customProviderName)
            : this.configApiKeys[this.customProviderName];
        if (byName) return byName;
      }
    }
    if (this.providerKind === "ollama") return "";
    if (this.providerKind === "opencode-zen") return "public";
    throw new Error(
      `No API key found. Set the ${envVar} environment variable, add it to config.api_keys under '${providerKindSlug(this.providerKind)}' or '${this.customProviderName ?? "provider_name"}', pass --api-key, or run \`tiny-crow --setup\` to configure interactively.`,
    );
  }

  resolveOptional(): string | null {
    try {
      return this.resolve();
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Chat types
// ---------------------------------------------------------------------------

export type MessageRole = "user" | "assistant" | "system" | "tool" | "toolCall" | "toolResult" | "subagentToolCall";

export interface SessionMessage {
  role: MessageRole;
  content: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  name?: string;
}

export function sessionRoleTag(role: MessageRole): string {
  switch (role) {
    case "user":
      return "User";
    case "assistant":
      return "Assistant";
    case "system":
      return "System";
    case "toolCall":
      return "ToolCall";
    case "toolResult":
      return "ToolResult";
    case "subagentToolCall":
      return "SubagentToolCall";
    default:
      return "User";
  }
}

export function serializeConversation(messages: SessionMessage[]): string {
  return messages
    .map((m) => `[${sessionRoleTag(m.role)}]: ${m.content}\n\n`)
    .join("");
}

export interface CompletionOptions {
  preamble?: string;
  temperature?: number | null;
  maxTokens?: number | null;
  extraBody?: Record<string, unknown> | null;
  signal?: AbortSignal;
  tools?: unknown[];
}

export interface CompletionModel {
  provider: string;
  modelName: string;
  complete(messages: ChatMessage[], options?: CompletionOptions): Promise<string>;
  stream(messages: ChatMessage[], options?: CompletionOptions): AsyncGenerator<string>;
}

// ---------------------------------------------------------------------------
// SSE / NDJSON parsing
// ---------------------------------------------------------------------------

async function* readSseEvents(
  response: Response,
): AsyncGenerator<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of rawEvent.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") return;
          try {
            const parsed = JSON.parse(data) as Record<string, unknown>;
            yield parsed;
          } catch {
            // Non-JSON SSE payloads (e.g. Gemini errors) are skipped here;
            // HTTP status handling above surfaces real failures.
          }
        }
      }
    }
    if (buffer.trim().length > 0) {
      for (const line of buffer.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          yield JSON.parse(data) as Record<string, unknown>;
        } catch {
          // ignore trailing partial event
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function* readNdjsonLines(response: Response): AsyncGenerator<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          yield JSON.parse(line) as Record<string, unknown>;
        } catch {
          // ignore partial line
        }
      }
    }
    const tail = buffer.trim();
    if (tail) {
      try {
        yield JSON.parse(tail) as Record<string, unknown>;
      } catch {
        // ignore
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function textOf(v: unknown): string {
  return typeof v === "string" ? v : "";
}

async function throwOnHttpError(response: Response, context: string): Promise<void> {
  if (response.ok) return;
  const text = await response.text().catch(() => "");
  throw new Error(`${context}: HTTP ${response.status}: ${text.trim().slice(0, 500)}`);
}

// ---------------------------------------------------------------------------
// One provider model: request/response handling per transport
// ---------------------------------------------------------------------------

export type OpenAiRoute = "responses" | "chat";

export interface ProviderModelConfig {
  provider: string;
  kind: ProviderKind;
  modelName: string;
  apiKey: string;
  baseUrl: string;
  route: OpenAiRoute;
  extraBody?: Record<string, unknown> | null;
  httpOptions: HttpClientOptions;
  opencodeProvider?: "opencode-zen" | "opencode-go" | null;
}

const DEFAULT_BASE_URLS: Record<ProviderKind, string> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com",
  ollama: "http://localhost:11434",
  "opencode-zen": `${OPENCODE_ZEN_ROOT}/v1`,
  "opencode-go": `${OPENCODE_GO_ROOT}/v1`,
};

function authHeaders(cfg: ProviderModelConfig): Record<string, string> {
  const headers: Record<string, string> = { ...cfg.httpOptions.headers };
  headers["User-Agent"] = cfg.httpOptions.userAgent;
  if (cfg.kind === "anthropic" || cfg.opencodeProvider) {
    // Anthropic transport (including the OpenCode messages transport) uses
    // x-api-key; the OpenCode chat/responses transports use Bearer below.
    if (cfg.opencodeProvider && cfg.route === "chat") {
      if (cfg.apiKey) headers["Authorization"] = `Bearer ${cfg.apiKey}`;
    } else if (cfg.kind === "anthropic") {
      if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;
      headers["anthropic-version"] = "2023-06-01";
    }
  } else if (cfg.kind === "gemini") {
    if (cfg.apiKey) headers["x-goog-api-key"] = cfg.apiKey;
  } else if (cfg.apiKey) {
    headers["Authorization"] = `Bearer ${cfg.apiKey}`;
  }
  return headers;
}

function openAiMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

export class ProviderModel implements CompletionModel {
  provider: string;
  modelName: string;
  readonly config: ProviderModelConfig;

  constructor(config: ProviderModelConfig) {
    this.config = config;
    this.provider = config.provider;
    this.modelName = config.modelName;
  }

  private opencodeRoute(): OpencodeTransport {
    if (!this.config.opencodeProvider) return this.config.route === "responses" ? "responses" : "chat";
    return resolveOpencodeTransport(this.config.opencodeProvider, this.config.modelName);
  }

  private effectiveKind(): "openai-chat" | "openai-responses" | "anthropic" | "gemini" | "ollama" {
    if (this.config.opencodeProvider) {
      const t = this.opencodeRoute();
      if (t === "messages") return "anthropic";
      if (t === "responses") return "openai-responses";
      return "openai-chat";
    }
    switch (this.config.kind) {
      case "anthropic":
        return "anthropic";
      case "gemini":
        return "gemini";
      case "ollama":
        return "ollama";
      case "openai":
      case "openrouter":
        return this.config.route === "responses" ? "openai-responses" : "openai-chat";
      case "opencode-zen":
      case "opencode-go":
        return "openai-chat";
    }
  }

  private baseUrlFor(kind: string): string {
    if (kind === "anthropic" && this.config.opencodeProvider) {
      return this.config.opencodeProvider === "opencode-zen" ? OPENCODE_ZEN_ROOT : OPENCODE_GO_ROOT;
    }
    return this.config.baseUrl.replace(/\/$/, "");
  }

  private async postJson(
    url: string,
    body: Record<string, unknown>,
    options?: CompletionOptions,
  ): Promise<Response> {
    const headers = authHeaders(this.config);
    headers["Content-Type"] = "application/json";
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: options?.signal,
    });
    await throwOnHttpError(response, `provider ${this.provider} request`);
    return response;
  }

  async complete(messages: ChatMessage[], options: CompletionOptions = {}): Promise<string> {
    let out = "";
    for await (const chunk of this.stream(messages, options)) out += chunk;
    return out;
  }

  async *stream(
    messages: ChatMessage[],
    options: CompletionOptions = {},
  ): AsyncGenerator<string> {
    const kind = this.effectiveKind();
    const extra = options.extraBody ?? this.config.extraBody ?? null;
    if (kind === "openai-chat") yield* this.streamOpenAiChat(messages, options, extra);
    else if (kind === "openai-responses") yield* this.streamOpenAiResponses(messages, options, extra);
    else if (kind === "anthropic") yield* this.streamAnthropic(messages, options, extra);
    else if (kind === "gemini") yield* this.streamGemini(messages, options, extra);
    else yield* this.streamOllama(messages, options, extra);
  }

  private async *streamOpenAiChat(
    messages: ChatMessage[],
    options: CompletionOptions,
    extra: Record<string, unknown> | null,
  ): AsyncGenerator<string> {
    const base = this.baseUrlFor("openai-chat");
    const body: Record<string, unknown> = {
      model: this.config.modelName,
      messages: openAiMessages(messages),
      stream: true,
      ...(options.preamble ? {} : {}),
      ...(options.temperature != null ? { temperature: options.temperature } : {}),
      ...(options.maxTokens != null ? { max_tokens: options.maxTokens } : {}),
      ...(extra ?? {}),
    };
    const response = await this.postJson(`${base}/chat/completions`, body, options);
    for await (const event of readSseEvents(response)) {
      const choices = asArray(event["choices"]);
      const delta = asRecord(asRecord(choices[0])?.["delta"]);
      const text = textOf(delta?.["content"]);
      if (text) yield text;
      const message = asRecord(asRecord(choices[0])?.["message"]);
      const mText = textOf(message?.["content"]);
      if (mText) yield mText;
    }
  }

  private async *streamOpenAiResponses(
    messages: ChatMessage[],
    options: CompletionOptions,
    extra: Record<string, unknown> | null,
  ): AsyncGenerator<string> {
    const base = this.baseUrlFor("openai-responses");
    const input = messages.map((m) => ({
      role: m.role === "tool" ? "user" : m.role,
      content: m.content,
    }));
    const body: Record<string, unknown> = {
      model: this.config.modelName,
      input,
      stream: true,
      ...(options.temperature != null ? { temperature: options.temperature } : {}),
      ...(options.maxTokens != null ? { max_output_tokens: options.maxTokens } : {}),
      ...(extra ?? {}),
    };
    const response = await this.postJson(`${base}/responses`, body, options);
    for await (const event of readSseEvents(response)) {
      const type = textOf(event["type"]);
      if (type === "response.output_text.delta") {
        const text = textOf(event["delta"]);
        if (text) yield text;
      } else if (type === "response.completed" || type === "response.output_text.done") {
        const resp = asRecord(event["response"]);
        const output = asArray(resp?.["output"]);
        for (const item of output) {
          const content = asArray(asRecord(item)?.["content"]);
          for (const part of content) {
            const text = textOf(asRecord(part)?.["text"]);
            if (text && type === "response.completed") {
              // Completed carries the full text; delta events already
              // streamed it, so only yield when nothing streamed yet.
              // This branch is handled by the caller accumulating deltas;
              // yielding here would duplicate, so skip.
            }
          }
        }
      }
    }
  }

  private async *streamAnthropic(
    messages: ChatMessage[],
    options: CompletionOptions,
    extra: Record<string, unknown> | null,
  ): AsyncGenerator<string> {
    const base = this.baseUrlFor("anthropic");
    const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
    const convo = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "tool" ? "user" : m.role, content: m.content }));
    const body: Record<string, unknown> = {
      model: this.config.modelName,
      max_tokens: options.maxTokens ?? 4096,
      messages: convo,
      stream: true,
      ...(systemParts.length > 0 ? { system: systemParts.join("\n\n") } : {}),
      ...(options.temperature != null ? { temperature: options.temperature } : {}),
      ...(extra ?? {}),
    };
    const headers = authHeaders(this.config);
    if (this.config.opencodeProvider) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
      headers["x-api-key"] = this.config.apiKey;
      headers["anthropic-version"] = "2023-06-01";
    }
    headers["Content-Type"] = "application/json";
    const response = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });
    await throwOnHttpError(response, `provider ${this.provider} request`);
    for await (const event of readSseEvents(response)) {
      const type = textOf(event["type"]);
      if (type === "content_block_delta") {
        const delta = asRecord(event["delta"]);
        const text = textOf(delta?.["text"]);
        if (text) yield text;
      }
    }
  }

  private async *streamGemini(
    messages: ChatMessage[],
    options: CompletionOptions,
    extra: Record<string, unknown> | null,
  ): AsyncGenerator<string> {
    const base = this.baseUrlFor("gemini");
    const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
    const body: Record<string, unknown> = {
      contents,
      ...(systemParts.length > 0
        ? { systemInstruction: { parts: [{ text: systemParts.join("\n\n") }] } }
        : {}),
      ...(options.temperature != null
        ? { generationConfig: { temperature: options.temperature } }
        : {}),
      ...(extra ?? {}),
    };
    const url = `${base}/v1beta/models/${encodeURIComponent(this.config.modelName)}:streamGenerateContent?alt=sse`;
    const headers = authHeaders(this.config);
    headers["Content-Type"] = "application/json";
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });
    await throwOnHttpError(response, `provider ${this.provider} request`);
    for await (const event of readSseEvents(response)) {
      const candidates = asArray(event["candidates"]);
      const content = asRecord(asRecord(candidates[0])?.["content"]);
      const parts = asArray(content?.["parts"]);
      for (const part of parts) {
        const text = textOf(asRecord(part)?.["text"]);
        if (text) yield text;
      }
    }
  }

  private async *streamOllama(
    messages: ChatMessage[],
    options: CompletionOptions,
    extra: Record<string, unknown> | null,
  ): AsyncGenerator<string> {
    const base = this.baseUrlFor("ollama");
    const body: Record<string, unknown> = {
      model: this.config.modelName,
      messages: openAiMessages(messages),
      stream: true,
      ...(options.temperature != null ? { options: { temperature: options.temperature } } : {}),
      ...(extra ?? {}),
    };
    const response = await this.postJson(`${base}/api/chat`, body, options);
    for await (const event of readNdjsonLines(response)) {
      const message = asRecord(event["message"]);
      const text = textOf(message?.["content"]);
      if (text) yield text;
    }
  }
}

// ---------------------------------------------------------------------------
// Model wrappers mirroring the Rust AnyModel / OpenAiModel / OpenRouterModel
// ---------------------------------------------------------------------------

export interface OpenRouterModel {
  model: ProviderModel;
  extra: Record<string, unknown> | null;
}

export type OpenAiModel =
  | { route: "responses"; model: ProviderModel }
  | { route: "completions"; model: ProviderModel };

export type AnyModel =
  | { kind: "openrouter"; value: OpenRouterModel }
  | { kind: "openai"; value: OpenAiModel }
  | { kind: "anthropic"; value: ProviderModel }
  | { kind: "gemini"; value: ProviderModel }
  | { kind: "ollama"; value: ProviderModel };

export function anyModelProviderModel(model: AnyModel): ProviderModel {
  switch (model.kind) {
    case "openrouter":
      return model.value.model;
    case "openai":
      return model.value.model;
    default:
      return model.value;
  }
}

export function anyModelExtraBody(model: AnyModel): Record<string, unknown> | null {
  return model.kind === "openrouter" ? model.value.extra : null;
}

// ---------------------------------------------------------------------------
// AnyClient
// ---------------------------------------------------------------------------

export interface ModelEntry {
  id: string;
  display: string;
  contextLength: number | null;
  kind: string | null;
  inputPrice: number | null;
  outputPrice: number | null;
}

export function isAgentModel(m: ModelEntry): boolean {
  if (m.kind) {
    const t = m.kind.toLowerCase();
    if (["embed", "image", "audio", "video", "moderation", "rerank", "tts", "speech"].some((k) => t.includes(k))) {
      return false;
    }
  }
  const id = m.id.toLowerCase();
  const deny = [
    "embedding", "embed-", "text-embedding", "gemini-embedding", "whisper", "transcribe",
    "tts", "-audio", "realtime", "speech", "dall-e", "gpt-image", "image-generation",
    "imagen", "sora", "veo", "moderation", "rerank", "aqa", "davinci-002", "babbage-002",
  ];
  return !deny.some((d) => id.includes(d));
}

export function resolveApiStyle(
  baseUrl: string | null | undefined,
  custom: CustomProviderConfig | undefined | null,
): ApiStyle {
  if (custom?.apiStyle) return custom.apiStyle;
  return baseUrl ? "completions" : "responses";
}

export class AnyClient {
  readonly providerNameValue: string;
  readonly kind: ProviderKind;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly apiStyle: ApiStyle;
  readonly httpOptions: HttpClientOptions;
  readonly custom: CustomProviderConfig | undefined;

  constructor(
    kind: ProviderKind,
    providerName: string,
    apiKey: string,
    baseUrl: string,
    apiStyle: ApiStyle,
    httpOptions: HttpClientOptions,
    custom?: CustomProviderConfig,
  ) {
    this.kind = kind;
    this.providerNameValue = providerName;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.apiStyle = apiStyle;
    this.httpOptions = httpOptions;
    this.custom = custom;
  }

  providerName(): string {
    return this.providerNameValue;
  }

  completionModel(name: string): AnyModel {
    const httpOptions = this.httpOptions;
    if (this.kind === "openrouter") {
      const extra = openrouterAnthropicRouting(name);
      const model = new ProviderModel({
        provider: "openrouter",
        kind: "openrouter",
        modelName: name,
        apiKey: this.apiKey,
        baseUrl: this.baseUrl,
        route: "chat",
        extraBody: extra,
        httpOptions,
      });
      return { kind: "openrouter", value: { model, extra } };
    }
    if (this.kind === "openai") {
      const route: OpenAiRoute = this.apiStyle === "completions" ? "chat" : "responses";
      const model = new ProviderModel({
        provider: "openai",
        kind: "openai",
        modelName: name,
        apiKey: this.apiKey,
        baseUrl: this.baseUrl,
        route,
        httpOptions,
      });
      return {
        kind: "openai",
        value: route === "responses" ? { route: "responses", model } : { route: "completions", model },
      };
    }
    if (this.kind === "anthropic" || this.kind === "gemini" || this.kind === "ollama") {
      const model = new ProviderModel({
        provider: this.kind,
        kind: this.kind,
        modelName: name,
        apiKey: this.apiKey,
        baseUrl: this.baseUrl,
        route: "chat",
        httpOptions,
      });
      return { kind: this.kind, value: model };
    }
    // OpenCode gateways are handled by OpencodeClient below; this branch is
    // unreachable for clients built by createClient.
    throw new Error(`completionModel not supported for provider ${this.kind}`);
  }

  async listModels(): Promise<ModelEntry[]> {
    const base = this.baseUrl.replace(/\/$/, "");
    const headers = authHeaders({
      provider: this.kind,
      kind: this.kind,
      modelName: "",
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      route: "chat",
      httpOptions: this.httpOptions,
    });
    if (this.kind === "anthropic") {
      const response = await fetch(`${base}/v1/models`, { headers, signal: AbortSignal.timeout(DEFAULT_METADATA_TIMEOUT_MS) });
      await throwOnHttpError(response, "list models");
      const data = (await response.json()) as Record<string, unknown>;
      return asArray(data["data"]).map((raw) => {
        const r = asRecord(raw) ?? {};
        return {
          id: textOf(r["id"]),
          display: textOf(r["display_name"]) || textOf(r["id"]),
          contextLength: null,
          kind: typeof r["type"] === "string" ? (r["type"] as string) : null,
          inputPrice: null,
          outputPrice: null,
        };
      });
    }
    if (this.kind === "gemini") {
      const response = await fetch(`${base}/v1beta/models`, { headers, signal: AbortSignal.timeout(DEFAULT_METADATA_TIMEOUT_MS) });
      await throwOnHttpError(response, "list models");
      const data = (await response.json()) as Record<string, unknown>;
      return asArray(data["models"]).map((raw) => {
        const r = asRecord(raw) ?? {};
        const full = textOf(r["name"]);
        const id = full.startsWith("models/") ? full.slice("models/".length) : full;
        return { id, display: id, contextLength: null, kind: null, inputPrice: null, outputPrice: null };
      });
    }
    if (this.kind === "ollama") {
      const response = await fetch(`${base}/api/tags`, { headers, signal: AbortSignal.timeout(DEFAULT_METADATA_TIMEOUT_MS) });
      await throwOnHttpError(response, "list models");
      const data = (await response.json()) as Record<string, unknown>;
      return asArray(data["models"]).map((raw) => {
        const r = asRecord(raw) ?? {};
        const id = textOf(r["name"]);
        return { id, display: id, contextLength: null, kind: null, inputPrice: null, outputPrice: null };
      });
    }
    const response = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(DEFAULT_METADATA_TIMEOUT_MS) });
    await throwOnHttpError(response, "list models");
    const data = (await response.json()) as Record<string, unknown>;
    return asArray(data["data"]).map((raw) => {
      const r = asRecord(raw) ?? {};
      const id = textOf(r["id"]);
      const ctx = typeof r["context_length"] === "number" ? (r["context_length"] as number) : null;
      return { id, display: id, contextLength: ctx, kind: null, inputPrice: null, outputPrice: null };
    });
  }

  async compressMessages(
    modelName: string,
    messages: SessionMessage[],
    previousSummary: string | null | undefined,
    instructions: string | null | undefined,
    suffix?: string | null,
  ): Promise<string> {
    const conversation = serializeConversation(messages);
    const prompt = COMPACTION_PROMPT.replace("{conversation}", conversation)
      .replace("{previous_summary}", previousSummary ?? "(none)")
      .replace("{instructions}", instructions ?? "(none)");
    const model = this.completionModel(modelName);
    return summarizeWithModel(model, prompt, suffix ?? null);
  }
}

export const COMPACTION_PROMPT = `You are a conversation summarizer for a coding session. Distill the following conversation into a concise summary.

Focus on:
- The user's goal and what they are trying to accomplish
- Key decisions that were made and why
- What work has been completed
- What is currently in progress or blocked
- Files that were read or modified
- Important context needed to continue working seamlessly

Previous summary (for iterative context):
{previous_summary}

Additional instructions: {instructions}

Conversation to summarize:
---
{conversation}
---

Format the summary as structured text covering: Goal, Progress, Key Decisions, Next Steps, and Critical Context. Be concise but include all essential details.`;

async function summarizeWithModel(
  model: AnyModel,
  prompt: string,
  suffix: string | null,
): Promise<string> {
  const providerModel = anyModelProviderModel(model);
  let preamble = "You are a conversation summarizer.";
  if (suffix) preamble += `\n\n---\n\n${suffix}`;
  const messages: ChatMessage[] = [
    { role: "system", content: preamble },
    { role: "user", content: prompt },
  ];
  const response = await providerModel.complete(messages);
  if (!response) throw new Error("Compression returned empty response");
  return response;
}

/** OpenCode gateway client: one key, three transports, resolved per model. */
export class OpencodeClient {
  readonly provider: "opencode-zen" | "opencode-go";
  readonly apiKey: string;
  readonly httpOptions: HttpClientOptions;

  constructor(provider: "opencode-zen" | "opencode-go", apiKey: string, httpOptions: HttpClientOptions) {
    this.provider = provider;
    this.apiKey = apiKey;
    this.httpOptions = httpOptions;
  }

  completionModel(name: string): AnyModel {
    const transport = resolveOpencodeTransport(this.provider, name);
    const root = this.provider === "opencode-zen" ? OPENCODE_ZEN_ROOT : OPENCODE_GO_ROOT;
    if (transport === "messages") {
      const model = new ProviderModel({
        provider: this.provider,
        kind: "anthropic",
        modelName: name,
        apiKey: this.apiKey,
        baseUrl: root,
        route: "chat",
        httpOptions: this.httpOptions,
        opencodeProvider: this.provider,
      });
      return { kind: "anthropic", value: model };
    }
    const route: OpenAiRoute = transport === "responses" ? "responses" : "chat";
    const model = new ProviderModel({
      provider: this.provider,
      kind: "openai",
      modelName: name,
      apiKey: this.apiKey,
      baseUrl: `${root}/v1`,
      route,
      httpOptions: this.httpOptions,
      opencodeProvider: this.provider,
    });
    return {
      kind: "openai",
      value: route === "responses" ? { route: "responses", model } : { route: "completions", model },
    };
  }

  async listModels(): Promise<ModelEntry[]> {
    const root = this.provider === "opencode-zen" ? OPENCODE_ZEN_ROOT : OPENCODE_GO_ROOT;
    const headers: Record<string, string> = {
      ...this.httpOptions.headers,
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      [OPENCODE_SESSION_HEADER]: opencodeSessionHeader(),
    };
    const response = await fetch(`${root}/v1/models`, { headers, signal: AbortSignal.timeout(DEFAULT_METADATA_TIMEOUT_MS) });
    await throwOnHttpError(response, "list models");
    const data = (await response.json()) as Record<string, unknown>;
    return asArray(data["data"]).map((raw) => {
      const r = asRecord(raw) ?? {};
      const id = textOf(r["id"]);
      return { id, display: id, contextLength: typeof r["context_length"] === "number" ? (r["context_length"] as number) : null, kind: null, inputPrice: null, outputPrice: null };
    });
  }
}

export type AnyClientLike = AnyClient | OpencodeClient;

export function createClient(
  providerName: string,
  apiKey: string | undefined | null,
  customProviders: CustomProvidersMap,
  configApiKeys?: Map<string, string> | Record<string, string> | null,
): AnyClient | OpencodeClient {
  const config = resolveProviderConfig(providerName, customProviders);
  const custom = customProvidersGet(customProviders, providerName);
  const key = new AuthResolver(config.kind)
    .withCliKey(apiKey)
    .withEnvOverride(config.apiKeyEnv)
    .withConfigKeys(configApiKeys ?? null)
    .withCustomProviderName(providerName)
    .resolve();
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URLS[config.kind];
  const httpOptions = buildHttpClient(
    providerName,
    config.dangerAcceptInvalidCerts,
    custom,
    baseUrl,
    "completion",
  );
  if (config.kind === "opencode-zen" || config.kind === "opencode-go") {
    return new OpencodeClient(config.kind, key, httpOptions);
  }
  const apiStyle = resolveApiStyle(config.baseUrl, custom);
  return new AnyClient(config.kind, providerName, key, baseUrl, apiStyle, httpOptions, custom);
}

// ---------------------------------------------------------------------------
// Manual / live model listings for custom gateways
// ---------------------------------------------------------------------------

export interface OpenRouterModelInfo {
  inputCost: number;
  outputCost: number;
  contextLength: number | null;
}

export function parseManualModels(body: string | Uint8Array): ModelEntry[] {
  const text = typeof body === "string" ? body : new TextDecoder().decode(body);
  const resp = JSON.parse(text) as Record<string, unknown>;
  return asArray(resp["data"]).map((raw) => {
    const r = asRecord(raw) ?? {};
    const id = textOf(r["id"]);
    const ctx = typeof r["context_length"] === "number" ? (r["context_length"] as number) : null;
    return { id, display: id, contextLength: ctx, kind: null, inputPrice: null, outputPrice: null };
  });
}

export function parseModelInfos(body: string | Uint8Array): Map<string, OpenRouterModelInfo> {
  const text = typeof body === "string" ? body : new TextDecoder().decode(body);
  const resp = JSON.parse(text) as Record<string, unknown>;
  const map = new Map<string, OpenRouterModelInfo>();
  for (const raw of asArray(resp["data"])) {
    const r = asRecord(raw) ?? {};
    const pricing = asRecord(r["pricing"]);
    const num = (v: unknown): number => {
      if (typeof v === "number") return v;
      if (typeof v === "string") return Number.parseFloat(v) || 0;
      return 0;
    };
    const input = pricing ? num(pricing["prompt"]) : 0;
    const output = pricing ? num(pricing["completion"]) : 0;
    const ctx = typeof r["context_length"] === "number" ? (r["context_length"] as number) : null;
    const id = textOf(r["id"]);
    if (input > 0 || output > 0 || ctx != null) {
      map.set(id, { inputCost: input * 1_000_000, outputCost: output * 1_000_000, contextLength: ctx });
    }
  }
  return map;
}

async function getBytesWithRetry(
  url: string,
  bearer: string | null,
  httpOptions: HttpClientOptions,
): Promise<string> {
  const maxAttempts = 3;
  let backoff = 500;
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const headers: Record<string, string> = { ...httpOptions.headers, "User-Agent": httpOptions.userAgent };
      if (bearer) headers["Authorization"] = `Bearer ${bearer}`;
      const response = await fetch(url, {
        headers,
        signal: httpOptions.timeoutMs != null ? AbortSignal.timeout(httpOptions.timeoutMs) : undefined,
      });
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = response.headers.get("retry-after") ?? "";
        throw new Error(
          retryAfter ? `HTTP ${response.status} retry-after: ${retryAfter}` : `HTTP ${response.status}`,
        );
      }
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const err = new Error(`HTTP ${response.status}: ${text.trim()}`) as Error & { notRetryable?: boolean };
        err.notRetryable = true;
        throw err;
      }
      return await response.text();
    } catch (e) {
      lastError = e as Error;
      const notRetryable = (e as Error & { notRetryable?: boolean }).notRetryable === true;
      if (notRetryable || attempt === maxAttempts) break;
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 5000);
    }
  }
  throw lastError ?? new Error("request failed");
}

export async function fetchCustomModelsRaw(
  providerName: string,
  cliKey: string | undefined | null,
  customProviders: CustomProvidersMap,
  configApiKeys?: Map<string, string> | Record<string, string> | null,
): Promise<[ModelEntry[], Map<string, OpenRouterModelInfo>]> {
  const config = resolveProviderConfig(providerName, customProviders);
  const base = config.baseUrl;
  if (!base) throw new Error("no base_url");
  const key = new AuthResolver(config.kind)
    .withCliKey(cliKey)
    .withEnvOverride(config.apiKeyEnv)
    .withConfigKeys(configApiKeys ?? null)
    .withCustomProviderName(providerName)
    .resolveOptional();
  const custom = customProvidersGet(customProviders, providerName);
  const httpOptions = buildHttpClient(providerName, config.dangerAcceptInvalidCerts, custom, base, "metadata");
  const url = `${base.replace(/\/$/, "")}/models`;
  const body = await getBytesWithRetry(url, key && key.length > 0 ? key : null, httpOptions);
  const models = parseManualModels(body);
  let pricing: Map<string, OpenRouterModelInfo>;
  try {
    pricing = parseModelInfos(body);
  } catch {
    pricing = new Map();
  }
  return [models, pricing];
}

export async function listModelsManual(
  providerName: string,
  cliKey: string | undefined | null,
  customProviders: CustomProvidersMap,
  configApiKeys?: Map<string, string> | Record<string, string> | null,
): Promise<ModelEntry[]> {
  const [models] = await fetchCustomModelsRaw(providerName, cliKey, customProviders, configApiKeys);
  return models;
}

export async function fetchLiveModelInfo(
  providerName: string,
  apiKey: string | undefined | null,
  customProviders: CustomProvidersMap,
  configApiKeys?: Map<string, string> | Record<string, string> | null,
): Promise<Map<string, OpenRouterModelInfo>> {
  const config = resolveProviderConfig(providerName, customProviders);
  const key = new AuthResolver(config.kind)
    .withCliKey(apiKey)
    .withEnvOverride(config.apiKeyEnv)
    .withConfigKeys(configApiKeys ?? null)
    .withCustomProviderName(providerName)
    .resolveOptional();
  const custom = customProvidersGet(customProviders, providerName);
  const base = config.baseUrl ?? "https://openrouter.ai/api/v1";
  const httpOptions = buildHttpClient(providerName, config.dangerAcceptInvalidCerts, custom, base, "metadata");
  const url = `${base.replace(/\/$/, "")}/models`;
  const body = await getBytesWithRetry(url, key && key.length > 0 ? key : null, httpOptions);
  return parseModelInfos(body);
}

// ---------------------------------------------------------------------------
// AnyAgent: completion dispatch. The agentic tool loop lives in the runner
// slice; here runPrint / runSubagent perform a single completion over the
// prompt + history, and spawnRunner / spawnBtw expose the same events as a
// stream so the runner slice can drive the loop around them.
// ---------------------------------------------------------------------------

export interface RetryConfigLike {
  maxAttempts?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
}

/** Local mirror of the agent-builder slice's build options. */
export interface AgentBuild {
  preamble?: string | null;
  temperature?: number | null;
  extraBody?: Record<string, unknown> | null;
  reasoningEnabled?: boolean;
  tools?: unknown[];
  [key: string]: unknown;
}

export interface PrintOutcome {
  output: string;
}

export type AgentEvent =
  | { type: "token"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "done"; output: string }
  | { type: "error"; message: string };

export interface AgentRunner {
  events: AsyncIterable<AgentEvent>;
  abort: () => void;
}

export type BtwRunner = AgentRunner;

function toChatMessages(history: ChatMessage[], prompt: string): ChatMessage[] {
  return [...history, { role: "user" as const, content: prompt }];
}

async function runCompletion(
  model: AnyModel,
  build: AgentBuild,
  prompt: string,
  history: ChatMessage[],
): Promise<string> {
  const providerModel = anyModelProviderModel(model);
  const messages: ChatMessage[] = [];
  if (build.preamble) messages.push({ role: "system", content: build.preamble });
  messages.push(...toChatMessages(history, prompt));
  const extra = mergeExtraBody(anyModelExtraBody(model), build.extraBody ?? null);
  return providerModel.complete(messages, {
    temperature: build.temperature ?? null,
    extraBody: extra,
  });
}

async function* streamCompletion(
  model: AnyModel,
  build: AgentBuild,
  prompt: string,
  history: ChatMessage[],
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const providerModel = anyModelProviderModel(model);
  const messages: ChatMessage[] = [];
  if (build.preamble) messages.push({ role: "system", content: build.preamble });
  messages.push(...toChatMessages(history, prompt));
  const extra = mergeExtraBody(anyModelExtraBody(model), build.extraBody ?? null);
  let output = "";
  try {
    for await (const chunk of providerModel.stream(messages, {
      temperature: build.temperature ?? null,
      extraBody: extra,
      signal,
    })) {
      output += chunk;
      yield { type: "token", text: chunk };
    }
    yield { type: "done", output };
  } catch (e) {
    yield { type: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

export class AnyAgent {
  readonly model: AnyModel;
  readonly build: AgentBuild;

  constructor(model: AnyModel, build: AgentBuild) {
    this.model = model;
    this.build = build;
  }

  async runPrint(
    prompt: string,
    _pureStdout: boolean,
    _retryConfig: RetryConfigLike,
    history: ChatMessage[],
    _loopInfo?: unknown,
  ): Promise<PrintOutcome> {
    const output = await runCompletion(this.model, this.build, prompt, history);
    return { output };
  }

  async runSubagent(
    prompt: string,
    _maxTurns: number,
    _eventTx?: unknown,
    _retryConfig?: RetryConfigLike,
  ): Promise<string> {
    return runCompletion(this.model, this.build, prompt, []);
  }

  spawnRunner(prompt: string, history: ChatMessage[], _retryConfig: RetryConfigLike, _loopInfo?: unknown): AgentRunner {
    const controller = new AbortController();
    const events = streamCompletion(this.model, this.build, prompt, history, controller.signal);
    return { events, abort: () => controller.abort() };
  }

  spawnBtw(
    prompt: string,
    history: ChatMessage[],
    _eventTx: unknown,
    _id: number,
    _retryConfig: RetryConfigLike,
  ): BtwRunner {
    return this.spawnRunner(prompt, history, _retryConfig);
  }
}

export type OpenAiAgent =
  | { route: "responses"; agent: AnyAgent }
  | { route: "completions"; agent: AnyAgent };

export async function buildAgent(model: AnyModel, build: AgentBuild): Promise<AnyAgent> {
  if (model.kind === "openrouter") {
    const merged: AgentBuild = {
      ...build,
      extraBody: mergeExtraBody(model.value.extra, build.extraBody ?? null),
    };
    return new AnyAgent(model, merged);
  }
  return new AnyAgent(model, build);
}

export function buildBtwAgent(model: AnyModel, build: AgentBuild): AnyAgent {
  if (model.kind === "openrouter") {
    const merged: AgentBuild = {
      ...build,
      extraBody: mergeExtraBody(model.value.extra, build.extraBody ?? null),
    };
    return new AnyAgent(model, merged);
  }
  return new AnyAgent(model, build);
}

export function spawnBlockedRunner(feedback: string): AgentRunner {
  async function* events(): AsyncGenerator<AgentEvent> {
    yield { type: "error", message: feedback };
  }
  return { events: events(), abort: () => undefined };
}
