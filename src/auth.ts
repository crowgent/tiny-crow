// API-key resolution (port of src/auth.rs).
// Priority: CLI argument > environment variable > config file
// (provider slug, then custom provider name). Ollama needs no key;
// the Zen gateway serves its free models with a public credential.

export type ProviderKind =
  | "openrouter"
  | "openai"
  | "anthropic"
  | "gemini"
  | "ollama"
  | "opencode-zen"
  | "opencode-go";

export function providerKindFromName(name: string): ProviderKind | undefined {
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
      return undefined;
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

export interface AuthResolverOptions {
  cliKey?: string;
  apiKeyEnvOverride?: string;
  configApiKeys?: Record<string, string>;
  customProviderName?: string;
}

export class AuthResolver {
  readonly providerKind: ProviderKind;
  readonly apiKeyEnvOverride?: string;
  readonly cliKey?: string;
  readonly configApiKeys?: Record<string, string>;
  readonly customProviderName?: string;

  constructor(kind: ProviderKind, opts: AuthResolverOptions = {}) {
    this.providerKind = kind;
    this.apiKeyEnvOverride = opts.apiKeyEnvOverride
      ? opts.apiKeyEnvOverride
      : undefined;
    this.cliKey = opts.cliKey && opts.cliKey.length > 0 ? opts.cliKey : undefined;
    this.configApiKeys = opts.configApiKeys;
    this.customProviderName =
      opts.customProviderName && opts.customProviderName.length > 0
        ? opts.customProviderName
        : undefined;
  }

  static create(kind: ProviderKind): AuthResolver {
    return new AuthResolver(kind);
  }

  withCliKey(key?: string): AuthResolver {
    return new AuthResolver(this.providerKind, {
      apiKeyEnvOverride: this.apiKeyEnvOverride,
      cliKey: key,
      configApiKeys: this.configApiKeys,
      customProviderName: this.customProviderName,
    });
  }

  withEnvOverride(envVar?: string): AuthResolver {
    return new AuthResolver(this.providerKind, {
      apiKeyEnvOverride: envVar,
      cliKey: this.cliKey,
      configApiKeys: this.configApiKeys,
      customProviderName: this.customProviderName,
    });
  }

  withConfigKeys(keys?: Record<string, string>): AuthResolver {
    return new AuthResolver(this.providerKind, {
      apiKeyEnvOverride: this.apiKeyEnvOverride,
      cliKey: this.cliKey,
      configApiKeys: keys ? { ...keys } : undefined,
      customProviderName: this.customProviderName,
    });
  }

  withCustomProviderName(name?: string): AuthResolver {
    return new AuthResolver(this.providerKind, {
      apiKeyEnvOverride: this.apiKeyEnvOverride,
      cliKey: this.cliKey,
      configApiKeys: this.configApiKeys,
      customProviderName: name,
    });
  }

  resolve(getEnv: (name: string) => string | undefined = (n) => process.env[n]): string {
    if (this.cliKey !== undefined) {
      console.warn(
        `API key provided via --api-key is visible in process listings. ` +
          `Use the ${providerKindEnvVar(this.providerKind)} environment variable instead.`,
      );
      return this.cliKey;
    }

    const envVar =
      this.apiKeyEnvOverride ?? providerKindEnvVar(this.providerKind);
    const fromEnv = getEnv(envVar);
    if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;

    if (this.configApiKeys) {
      const slug = providerKindSlug(this.providerKind);
      const bySlug = this.configApiKeys[slug];
      if (bySlug !== undefined && bySlug.length > 0) return bySlug;
      if (this.customProviderName !== undefined) {
        const byCustom = this.configApiKeys[this.customProviderName];
        if (byCustom !== undefined && byCustom.length > 0) return byCustom;
      }
    }

    if (this.providerKind === "ollama") return "";
    if (this.providerKind === "opencode-zen") return "public";

    throw new Error(
      `No API key found. Set the ${envVar} environment variable, ` +
        `add it to config.api_keys under '${providerKindSlug(this.providerKind)}' ` +
        `or '${this.customProviderName ?? "provider_name"}', pass --api-key, ` +
        `or run \`zerostack-ts --setup\` to configure interactively.`,
    );
  }
}
