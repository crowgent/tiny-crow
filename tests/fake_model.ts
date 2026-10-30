export interface FakeRequest {
  history: unknown[];
  prompt: string;
}

export class FakeModel {
  private turns: string[][];
  private index = 0;
  requests: FakeRequest[] = [];

  constructor(turns: string[][]) {
    this.turns = turns;
  }

  async streamChat(
    history: unknown[],
    prompt: string,
  ): Promise<{ text: string; chunks: string[] }> {
    this.requests.push({ history: [...history], prompt });
    const chunks = this.turns[this.index] ?? [];
    this.index++;
    return { text: chunks.join(""), chunks };
  }

  historyAt(turn: number): unknown[] {
    const req = this.requests[turn];
    if (!req) {
      throw new Error(
        `model was called only ${this.requests.length} time(s); no request captured at turn ${turn}`,
      );
    }
    return req.history;
  }
}

export function textTurns(turns: string[][]): FakeModel {
  return new FakeModel(turns);
}

export function textChunks(chunks: string[]): FakeModel {
  return textTurns([chunks]);
}

export function historyAt(model: FakeModel, turn: number): unknown[] {
  return model.historyAt(turn);
}
