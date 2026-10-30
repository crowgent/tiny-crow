export const ANTHROPIC_CACHE_WRITE_MULT = 1.25;
export const ANTHROPIC_CACHE_READ_MULT = 0.1;

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
