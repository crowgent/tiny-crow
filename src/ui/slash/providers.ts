import {
  cliResolveProvider,
  customProvidersMap,
  quickModelsMap,
  sessionUpdateContextWindow,
  writeError,
  writeOk,
  writeResult,
  type ModelEntry,
  type SlashCtx,
} from "./mod.ts";

export const KNOWN_BUILTIN_PROVIDERS = [
  "openrouter",
  "openai",
  "anthropic",
  "gemini",
  "ollama",
  "opencode-zen",
  "opencode-go",
] as const;

const modelCache = new Map<string, ModelEntry[]>();

function isAgentModel(ctx: SlashCtx, entry: ModelEntry): boolean {
  return ctx.isAgentModel?.(entry) ?? true;
}

export async function fetchModelsCached(
  provider: string,
  isCustom: boolean,
  ctx: SlashCtx,
  refresh: boolean,
): Promise<ModelEntry[]> {
  if (!refresh) {
    const hit = modelCache.get(provider);
    if (hit !== undefined) return hit;
    if (!isCustom) {
      const entries = ctx.catalogEntries?.(provider);
      if (entries !== undefined) {
        const models = entries.filter((m) => isAgentModel(ctx, m));
        modelCache.set(provider, models);
        return models;
      }
    }
  }
  let models: ModelEntry[];
  if (isCustom) {
    if (ctx.fetchCustomModelsRaw === undefined) {
      throw new Error(`custom provider '${provider}' model list not available`);
    }
    const [m, pricing] = await ctx.fetchCustomModelsRaw(
      provider,
      ctx.cli.apiKey,
      customProvidersMap(ctx.cfg),
      ctx.cfg.apiKeys,
    );
    models = m.filter((entry) => isAgentModel(ctx, entry));
    for (const entry of models) {
      const info = pricing.get(entry.id);
      if (info !== undefined) {
        entry.inputPrice = info.inputCost;
        entry.outputPrice = info.outputCost;
      }
    }
    modelCache.set(provider, models);
    return models;
  }
  if (ctx.client.listModels === undefined) {
    throw new Error(`model list not available for provider '${provider}'`);
  }
  models = (await ctx.client.listModels()).filter((m) => isAgentModel(ctx, m));
  if (provider === "openrouter" && ctx.fetchLiveModelInfo !== undefined) {
    try {
      const prices = await ctx.fetchLiveModelInfo(
        provider,
        ctx.cli.apiKey,
        customProvidersMap(ctx.cfg),
        ctx.cfg.apiKeys,
      );
      for (const m of models) {
        const info = prices.get(m.id);
        if (info !== undefined) {
          m.inputPrice = info.inputCost;
          m.outputPrice = info.outputCost;
        }
      }
    } catch {

    }
  }
  modelCache.set(provider, models);
  return models;
}

export function cachedModelIds(provider: string): string[] {
  return (modelCache.get(provider) ?? []).map((m) => m.id);
}

export async function warmModelCache(
  provider: string,
  isCustom: boolean,
  ctx: SlashCtx,
): Promise<string[]> {
  try {
    await fetchModelsCached(provider, isCustom, ctx, false);
  } catch {

  }
  return cachedModelIds(provider);
}

function lookupPricingFromCache(
  ctx: SlashCtx,
  provider: string,
  modelId: string,
): [number, number] | undefined {
  const models = modelCache.get(provider) ?? [];
  for (const m of models) {
    if (m.id !== modelId) continue;
    if (m.inputPrice !== undefined && m.outputPrice !== undefined) {
      return [m.inputPrice, m.outputPrice];
    }
    const entries = ctx.catalogEntries?.(provider);
    const entry = entries?.find((e) => e.id === modelId);
    if (entry?.inputPrice !== undefined && entry?.outputPrice !== undefined) {
      return [entry.inputPrice, entry.outputPrice];
    }
  }
  return undefined;
}

async function applyLivePricing(
  ctx: SlashCtx,
  modelId: string,
): Promise<void> {
  const isOpenRouter = ctx.session.provider === "openrouter";
  const isCustom = customProvidersMap(ctx.cfg)[ctx.session.provider] !== undefined;
  if (!isOpenRouter && !isCustom) return;
  if (ctx.fetchLiveModelInfo === undefined) return;
  try {
    const prices = await ctx.fetchLiveModelInfo(
      ctx.session.provider,
      ctx.cli.apiKey,
      customProvidersMap(ctx.cfg),
      ctx.cfg.apiKeys,
    );
    const info = prices.get(modelId);
    if (info === undefined) return;
    ctx.session.inputTokenCost = info.inputCost;
    ctx.session.outputTokenCost = info.outputCost;
    if (
      ctx.cfg.contextWindow === undefined &&
      ctx.catalogContextWindow?.(ctx.session.provider, modelId) === undefined &&
      info.contextLength !== undefined
    ) {
      sessionUpdateContextWindow(ctx.session, info.contextLength);
    }
  } catch {

  }
}

async function applyModel(ctx: SlashCtx, modelId: string): Promise<void> {
  ctx.session.model = modelId;
  await ctx.rebuildAgent();
  const cw = resolveCtxWindow(ctx, modelId);
  if (cw !== undefined) sessionUpdateContextWindow(ctx.session, cw);
  const pricing = lookupPricingFromCache(ctx, ctx.session.provider, modelId);
  if (pricing !== undefined) {
    ctx.session.inputTokenCost = pricing[0];
    ctx.session.outputTokenCost = pricing[1];
  } else {
    await applyLivePricing(ctx, modelId);
  }
  writeOk(ctx.renderer, `switched to model: ${modelId}`);
}

function resolveCtxWindow(ctx: SlashCtx, modelId: string): number | undefined {
  const qm = quickModelsMap(ctx.cfg);
  const direct = ctx.cfg.resolveContextWindow?.(
    ctx.session.provider,
    modelId,
    qm,
  );
  if (direct !== undefined) return direct;
  return ctx.cfg.contextWindow;
}

export async function handle(parts: string[], ctx: SlashCtx): Promise<void> {
  switch (parts[0]) {
    case "/provider":
      await handleProvider(parts, ctx);
      break;
    case "/model":
      await handleModel(parts, ctx);
      break;
    case "/models":
      await handleModels(parts, ctx);
      break;
    case "/models-add":
      await handleModelsAdd(parts, ctx);
      break;
    case "/model-subagent":
      await handleModelSubagent(parts, ctx);
      break;
    case "/models-subagent":
      await handleModelsSubagent(parts, ctx);
      break;
    default:
      break;
  }
}

async function handleProvider(parts: string[], ctx: SlashCtx): Promise<void> {
  if (parts.length < 2) {
    writeOk(ctx.renderer, `current provider: ${ctx.session.provider}`);
    return;
  }
  const newProvider = parts[1].trim();
  const knownBuiltin = ctx.parseProvider?.(newProvider) ??
    (KNOWN_BUILTIN_PROVIDERS as readonly string[]).includes(newProvider);
  if (!knownBuiltin && customProvidersMap(ctx.cfg)[newProvider] === undefined) {
    writeError(ctx.renderer, `unknown provider: '${newProvider}'`);
    return;
  }

  const def = ctx.defaultModelForProvider?.(newProvider, ctx.cfg);
  if (def !== undefined) {
    ctx.session.model = def[0];
    if (def[1] !== undefined) {
      ctx.session.inputTokenCost = def[1][0];
      ctx.session.outputTokenCost = def[1][1];
    }
  }
  await ctx.rebuildAgentWithClient(newProvider, ctx.reasoningEnabled);
  ctx.session.provider = newProvider;
  const cw = resolveCtxWindow(ctx, ctx.session.model);
  if (cw !== undefined) sessionUpdateContextWindow(ctx.session, cw);
  writeOk(
    ctx.renderer,
    `switched to provider: ${newProvider} (model: ${ctx.session.model})`,
  );
}

async function handleModel(parts: string[], ctx: SlashCtx): Promise<void> {
  if (parts.length < 2) {
    writeOk(ctx.renderer, `current model: ${ctx.session.model}`);
    return;
  }
  const newModel = parts[1].trim();
  ctx.session.model = newModel;
  await ctx.rebuildAgent();
  const resolvedProvider = cliResolveProvider(ctx.cli, ctx.cfg);
  if (resolvedProvider !== undefined) ctx.session.provider = resolvedProvider;
  const cw = resolveCtxWindow(ctx, newModel);
  if (cw !== undefined) sessionUpdateContextWindow(ctx.session, cw);
  const pricing = lookupPricingFromCache(ctx, ctx.session.provider, newModel);
  if (pricing !== undefined) {
    ctx.session.inputTokenCost = pricing[0];
    ctx.session.outputTokenCost = pricing[1];
  } else {
    await applyLivePricing(ctx, newModel);
  }
  writeOk(ctx.renderer, `switched to model: ${newModel}`);
}

async function handleModels(parts: string[], ctx: SlashCtx): Promise<void> {
  const qm = quickModelsMap(ctx.cfg);
  const provider = ctx.session.provider;
  const isCustom = customProvidersMap(ctx.cfg)[provider] !== undefined;
  const refresh = parts[1]?.trim() === "refresh";

  if (parts.length >= 2 && !refresh) {
    const arg = parts[1].trim();
    const q = qm[arg];
    if (q !== undefined) {
      await ctx.rebuildAgentWithClient(q.provider, ctx.reasoningEnabled);
      await applyModel(ctx, q.model);
      ctx.session.provider = q.provider;
      ctx.session.inputTokenCost = q.inputTokenCost;
      ctx.session.outputTokenCost = q.outputTokenCost;
      writeResult(
        ctx.renderer,
        `  quick model ${arg} — $${q.inputTokenCost.toFixed(4)}/M in  $${q.outputTokenCost.toFixed(4)}/M out`,
      );
      return;
    }
    await applyModel(ctx, arg);
    return;
  }

  try {
    const models = await fetchModelsCached(provider, isCustom, ctx, refresh);
    ctx.input.setLiveModelNames(cachedModelIds(provider));
    if (refresh) {
      writeResult(
        ctx.renderer,
        `model list refreshed — quick models: ${Object.keys(qm).length}, ${provider} models: ${models.length}`,
      );
    } else {
      const sorted = Object.keys(qm).sort();
      writeOk(
        ctx.renderer,
        `quick models (current: ${ctx.session.provider} | ${ctx.session.model}):`,
      );
      if (sorted.length === 0) {
        writeResult(ctx.renderer, "  (none — add with /models-add)");
      }
      for (const name of sorted) {
        const q = qm[name];
        writeResult(
          ctx.renderer,
          `  ${name}  (${q.provider} / ${q.model})  $${q.inputTokenCost.toFixed(4)}/M in  $${q.outputTokenCost.toFixed(4)}/M out`,
        );
      }
      if (models.length > 0) {
        writeOk(ctx.renderer, `available from ${provider} (${models.length}):`);
        const CAP = 50;
        for (const m of models.slice(0, CAP)) {
          const ctxWin = m.contextLength !== undefined
            ? `  [${Math.floor(m.contextLength / 1000)}k ctx]`
            : "";
          const label = m.display === m.id ? m.id : `${m.display} (${m.id})`;
          writeResult(ctx.renderer, `  ${label}${ctxWin}`);
        }
        if (models.length > CAP) {
          writeResult(
            ctx.renderer,
            `  … ${models.length - CAP} more — type /models <filter> or use the picker`,
          );
        }
      }
    }
  } catch (e) {
    if (refresh) {
      writeError(
        ctx.renderer,
        `model list refresh failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } else if (isCustom) {
      writeResult(
        ctx.renderer,
        "  (live model list unavailable; type the model id directly)",
      );
    }
  }
}

async function handleModelsAdd(parts: string[], ctx: SlashCtx): Promise<void> {
  const usage =
    "usage: /models-add <name> <provider> <model> [input_cost_per_M output_cost_per_M]";
  if (parts.length < 3) {
    writeOk(ctx.renderer, usage);
    return;
  }
  const name = parts[1].trim();

  const restTokens = parts.length >= 5
    ? parts.slice(2).map((t) => t.trim())
    : parts[2].trim().split(/\s+/);
  const provider = restTokens[0] ?? "";
  const model = restTokens[1] ?? "";
  const inputCost = restTokens[2] !== undefined ? Number(restTokens[2]) : 0;
  const outputCost = restTokens[3] !== undefined ? Number(restTokens[3]) : 0;
  if (
    name === "" ||
    provider === "" ||
    model === "" ||
    Number.isNaN(inputCost) ||
    Number.isNaN(outputCost)
  ) {
    writeOk(ctx.renderer, usage);
    return;
  }
  try {
    if (ctx.saveQuickModel !== undefined) {
      ctx.saveQuickModel(name, provider, model, inputCost, outputCost);
    } else {
      const qm = ctx.cfg.quickModels ?? {};
      qm[name] = { provider, model, inputTokenCost: inputCost, outputTokenCost: outputCost };
      ctx.cfg.quickModels = qm;
    }
    writeOk(
      ctx.renderer,
      `saved quick model: ${name} (${provider} / ${model})  $${inputCost}/M in  $${outputCost}/M out`,
    );
  } catch (e) {
    writeError(
      ctx.renderer,
      `failed to save quick model: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

async function handleModelSubagent(parts: string[], ctx: SlashCtx): Promise<void> {
  const sub = ctx.subagent;
  if (sub === undefined) {
    writeError(ctx.renderer, "subagent support not available");
    return;
  }
  if (parts.length < 2) {
    writeOk(
      ctx.renderer,
      `current subagent model: ${sub.providerName()} / ${sub.modelName()}`,
    );
    return;
  }
  const newModel = parts[1].trim();
  const model = ctx.client.completionModel?.(newModel) ?? newModel;
  await modelForSubagent(ctx, model);
  sub.setModelName(newModel);
  writeOk(ctx.renderer, `switched subagent to model: ${newModel}`);
}

async function handleModelsSubagent(parts: string[], ctx: SlashCtx): Promise<void> {
  const sub = ctx.subagent;
  if (sub === undefined) {
    writeError(ctx.renderer, "subagent support not available");
    return;
  }
  const qm = quickModelsMap(ctx.cfg);
  const sorted = Object.keys(qm).sort();
  if (parts.length < 2) {
    if (sorted.length === 0) {
      writeOk(
        ctx.renderer,
        `current subagent: ${sub.providerName()} / ${sub.modelName()} (no quick models defined)`,
      );
    } else {
      writeOk(
        ctx.renderer,
        `quick models (current subagent: ${sub.providerName()} | ${sub.modelName()}):`,
      );
      for (const name of sorted) {
        const q = qm[name];
        writeResult(
          ctx.renderer,
          `  ${name}  (${q.provider} / ${q.model})  $${q.inputTokenCost.toFixed(4)}/M in  $${q.outputTokenCost.toFixed(4)}/M out`,
        );
      }
    }
    return;
  }
  const name = parts[1].trim();
  const q = qm[name];
  if (q !== undefined) {
    const currentProvider = ctx.client.providerName?.() ?? ctx.session.provider;
    if (q.provider !== currentProvider) {
      if (ctx.createClient === undefined) {
        writeError(ctx.renderer, `cannot create client for provider '${q.provider}'`);
        return;
      }
      const newClient = await ctx.createClient(q.provider);
      const model = newClient.completionModel?.(q.model) ?? q.model;
      await modelForSubagent(ctx, model);
      sub.setClientAndModel(newClient, q.model);
    } else {
      const model = ctx.client.completionModel?.(q.model) ?? q.model;
      await modelForSubagent(ctx, model);
      sub.setModelName(q.model);
    }
    writeOk(
      ctx.renderer,
      `switched subagent to quick model: ${name} (${q.provider} / ${q.model})  $${q.inputTokenCost.toFixed(4)}/M in  $${q.outputTokenCost.toFixed(4)}/M out`,
    );
  } else {
    writeError(ctx.renderer, `unknown quick model: '${name}'`);
    if (sorted.length > 0) {
      writeOk(ctx.renderer, "available quick models:");
      for (const n of sorted) {
        writeResult(ctx.renderer, `  ${n}`);
      }
    }
  }
}

async function modelForSubagent(ctx: SlashCtx, model: unknown): Promise<void> {
  const sub = ctx.subagent;
  if (sub?.buildExploreAgent === undefined) return;
  const maxTurns = ctx.cfg.taskMaxTurns ?? 20;
  try {
    await sub.buildExploreAgent(model, maxTurns, ctx.cfg);
  } catch {

  }
}
