// Typed deferred actions, previously encoded as error strings. Handlers
// throw a SlashDeferredError carrying one of these outcomes; the event loop
// catches it and performs the deferred work (compression, init, review,
// editor, MCP login) instead of treating it as a failure.

/** Typed deferred actions previously encoded as error strings. */
export type SlashOutcome =
  | { kind: "deferCompress"; instructions?: string }
  | { kind: "deferInit" }
  | { kind: "deferReview"; message: string }
  | { kind: "deferEditor"; path: string }
  | { kind: "deferMcpLogin"; server: string };

export function formatSlashOutcome(outcome: SlashOutcome): string {
  switch (outcome.kind) {
    case "deferCompress":
      return `defer compress: ${outcome.instructions === undefined ? "undefined" : JSON.stringify(outcome.instructions)}`;
    case "deferInit":
      return "defer init";
    case "deferReview":
      return `defer review: ${outcome.message}`;
    case "deferEditor":
      return `defer editor: ${outcome.path}`;
    case "deferMcpLogin":
      return `defer mcp login: ${outcome.server}`;
  }
}

export class SlashDeferredError extends Error {
  readonly outcome: SlashOutcome;

  constructor(outcome: SlashOutcome) {
    super(formatSlashOutcome(outcome));
    this.name = "SlashDeferredError";
    this.outcome = outcome;
  }
}

export function isSlashDeferredError(error: unknown): error is SlashDeferredError {
  return error instanceof SlashDeferredError;
}
