export interface KeyEvent {
  code: string;
  modifiers: string[];
  kind?: string;
}

export type AgentEvent =
  | { kind: "token"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "toolCall"; callId: string; name: string; args: unknown }
  | { kind: "toolResult"; callId: string; name: string; output: string }
  | { kind: "subagentToolCall"; name: string; args: unknown }
  | { kind: "error"; message: string }
  | { kind: "retrying"; attempt: number; max: number }
  | {
      kind: "completionCall";
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens: number;
      cacheCreationInputTokens: number;
    }
  | {
      kind: "done";
      response: string;
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens: number;
      cacheCreationInputTokens: number;
    };

export type BtwEvent =
  | {
      kind: "done";
      id: number;
      response: string;
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens: number;
      cacheCreationInputTokens: number;
    }
  | { kind: "error"; id: number; message: string };

export type UserEvent =
  | { kind: "key"; event: KeyEvent }
  | { kind: "scrollUp" }
  | { kind: "scrollDown" }
  | { kind: "resize" }
  | { kind: "paste"; text: string }
  | { kind: "focusGained" }
  | { kind: "mouseDown"; row: number; col: number }
  | { kind: "mouseDrag"; row: number; col: number }
  | { kind: "mouseUp"; row: number; col: number }
  | { kind: "mcpLoginDone"; server: string; error?: string };
