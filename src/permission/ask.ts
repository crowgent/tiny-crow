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

export class AskChannel {
  #queue: AskRequest[] = [];
  #waiters: Array<(request: AskRequest) => void> = [];

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
