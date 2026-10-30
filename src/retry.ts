// Retry with exponential backoff and jitter.

export interface RetryConfig {
  maxAttempts: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
}

export function defaultRetryConfig(): RetryConfig {
  return { maxAttempts: 3, initialBackoffMs: 500, maxBackoffMs: 10_000 };
}

export function retryConfigFromJson(raw: Record<string, unknown>): RetryConfig {
  const d = defaultRetryConfig();
  if (typeof raw["max_attempts"] === "number") d.maxAttempts = raw["max_attempts"];
  if (typeof raw["initial_backoff_ms"] === "number") d.initialBackoffMs = raw["initial_backoff_ms"];
  if (typeof raw["max_backoff_ms"] === "number") d.maxBackoffMs = raw["max_backoff_ms"];
  return d;
}

let jitterCounter = 0;

export function simpleJitter(rangeMs: number): number {
  // Cheap diffusion over time + counter, mirroring the Rust hash/xorshift
  // mix. No external random crate is needed.
  const range = Math.max(1, rangeMs);
  let x = (Date.now() * 2654435761 + (jitterCounter += 1) * 40503) >>> 0;
  x ^= x >>> 12;
  x ^= (x << 25) >>> 0;
  x ^= x >>> 27;
  return (x >>> 0) % range;
}

function parseRetryAfterNumber(rest: string): number | undefined {
  let numStr = "";
  let inNum = false;
  for (const ch of rest) {
    if (ch >= "0" && ch <= "9") {
      numStr += ch;
      inNum = true;
    } else if (inNum) {
      break;
    }
  }
  const secs = Number.parseInt(numStr, 10);
  if (Number.isFinite(secs) && secs > 0 && secs < 3600) return secs;
  return undefined;
}

/** Extract a `Retry-After` delay (seconds) from an error message, if any. */
export function retryAfter(error: unknown): number | undefined {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  const lower = msg.toLowerCase();
  for (const token of ["retry-after", "retry after"]) {
    const idx = lower.indexOf(token);
    if (idx >= 0) {
      const secs = parseRetryAfterNumber(lower.slice(idx + token.length));
      if (secs !== undefined) return secs * 1000;
    }
  }
  return undefined;
}

const RETRYABLE_CODES = ["429", "503", "502", "504", "500"];
const RETRYABLE_PHRASES = [
  "stream ended",
  "connection",
  "timeout",
  "timed out",
  "reset by peer",
  "broken pipe",
  "dns",
  "rate limit",
  "too many requests",
  "service unavailable",
  "temporarily unavailable",
  "internal server error",
  "bad gateway",
  "gateway timeout",
  "error sending request",
];

export function isRetryable(error: unknown): boolean {
  let current: unknown = error;
  while (current !== undefined && current !== null) {
    const msg = current instanceof Error ? current.message : String(current);
    if (RETRYABLE_CODES.some((c) => msg.includes(c))) return true;
    const lower = msg.toLowerCase();
    if (RETRYABLE_PHRASES.some((p) => lower.includes(p))) return true;
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(
  config: RetryConfig,
  error: unknown,
  backoffMs: number,
): number {
  const maxBackoff = config.maxBackoffMs;
  const base = Math.min(retryAfter(error) ?? backoffMs, maxBackoff * 2);
  return base + simpleJitter(Math.floor(base / 4) + 1);
}

export async function withRetry<T>(
  config: RetryConfig,
  fn: () => Promise<T>,
): Promise<T> {
  let attempt = 0;
  let backoff = config.initialBackoffMs;
  const maxBackoff = config.maxBackoffMs;
  for (;;) {
    attempt += 1;
    try {
      return await fn();
    } catch (e) {
      if (attempt >= config.maxAttempts || !isRetryable(e)) throw e;
      const delay = backoffDelay(config, e, backoff);
      console.warn(
        `retryable error (attempt ${attempt}/${config.maxAttempts}): ${e}. Retrying in ${delay}ms...`,
      );
      await sleep(delay);
      backoff = Math.min(backoff * 2, maxBackoff);
    }
  }
}

/**
 * Retry a streaming call: only the first item decides. If the first item
 * errors retryably, the factory is re-invoked; once a first item succeeds
 * (or the stream is empty) the resulting async iterable is returned as-is.
 * Mirrors retry_stream_chat, adapted to AsyncIterable.
 */
export async function retryStreamChat<T>(
  config: RetryConfig,
  factory: () => Promise<AsyncIterable<T>>,
): Promise<AsyncIterable<T>> {
  let attempt = 0;
  let backoff = config.initialBackoffMs;
  const maxBackoff = config.maxBackoffMs;
  for (;;) {
    attempt += 1;
    const stream = await factory();
    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.done) {
      return (async function* () {})();
    }
    const firstValue = first.value;
    if (firstValue instanceof Error) {
      const e = firstValue;
      if (attempt >= config.maxAttempts || !isRetryable(e)) throw e;
      const delay = backoffDelay(config, e, backoff);
      console.warn(
        `retryable error on first stream item (attempt ${attempt}/${config.maxAttempts}): ${e}. Retrying in ${delay}ms`,
      );
      await sleep(delay);
      backoff = Math.min(backoff * 2, maxBackoff);
      continue;
    }
    return (async function* () {
      yield firstValue;
      yield* { [Symbol.asyncIterator]: () => iterator };
    })();
  }
}
