// Token pricing.

export const ANTHROPIC_CACHE_WRITE_MULT = 1.25;
export const ANTHROPIC_CACHE_READ_MULT = 0.1;

/**
 * Effective (billable) input-token count, folding Anthropic's cache tiers
 * into a single number priced at the base input rate. Anthropic's reported
 * input_tokens excludes both cached and cache-creation tokens, but both are
 * billed (reads at 0.10x, writes at 1.25x). Every other provider folds the
 * cached subset into input_tokens, so this is a no-op for them.
 */
export function billableInputTokens(
  anthropicNative: boolean,
  inputTokens: number,
  cachedInputTokens: number,
  cacheCreationInputTokens: number,
): number {
  if (anthropicNative) {
    return Math.round(
      inputTokens +
        cacheCreationInputTokens * ANTHROPIC_CACHE_WRITE_MULT +
        cachedInputTokens * ANTHROPIC_CACHE_READ_MULT,
    );
  }
  return inputTokens;
}

/**
 * Estimate cost for given token counts and per-million-token prices.
 * inputTokens is the billable input count (see billableInputTokens).
 */
export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  inputTokenCost: number,
  outputTokenCost: number,
): number {
  return (
    (inputTokens * inputTokenCost) / 1_000_000 +
    (outputTokens * outputTokenCost) / 1_000_000
  );
}
