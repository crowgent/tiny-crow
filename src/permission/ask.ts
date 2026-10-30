/**
 * The interactive permission prompt flow. The checker returns `Ask`; the
 * caller creates an AskRequest, hands it to the UI (via an AskChannel),
 * and awaits the user's decision. This replaces the Rust tokio mpsc +
 * oneshot pair with a promise resolved by `reply()`.
 */
export type UserDecision =
  | { kind: "allowOnce" }
  | { kind: "allowAlways"; pattern: string }
  | { kind: "deny" };

export class AskRequest {
  readonly tool: string;
  readonly input: string;
  readonly decision: Promise<UserDecision>;
  #resolve!: (decision: UserDecision) => void;

  constructor(tool: string, input: string) {
    this.tool = tool;
    this.input = input;
    this.decision = new Promise<UserDecision>((resolve) => {
      this.#resolve = resolve;
    });
  }

  reply(decision: UserDecision): void {
    this.#resolve(decision);
  }
}

/** A FIFO queue of pending permission prompts, mirroring the mpsc channel. */
export class AskChannel {
  #queue: AskRequest[] = [];
  #waiters: Array<(request: AskRequest) => void> = [];

  /** Enqueues a prompt and returns a promise for the user's decision. */
  ask(tool: string, input: string): Promise<UserDecision> {
    const request = new AskRequest(tool, input);
    const waiter = this.#waiters.shift();
    if (waiter !== undefined) {
      waiter(request);
    } else {
      this.#queue.push(request);
    }
    return request.decision;
  }

  /** Takes the next pending prompt, or waits until one arrives. */
  next(): Promise<AskRequest> {
    const queued = this.#queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise<AskRequest>((resolve) => {
      this.#waiters.push(resolve);
    });
  }

  get pendingCount(): number {
    return this.#queue.length;
  }
}

export type AskSender = AskChannel;
export type AskReceiver = AskChannel;
