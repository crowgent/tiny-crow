export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
}

export function defaultUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0 };
}

export interface RetryConfig {
  maxAttempts: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
}

export function defaultRetryConfig(): RetryConfig {
  return { maxAttempts: 3, initialBackoffMs: 500, maxBackoffMs: 10000 };
}

export type MessageRole = "user" | "assistant" | "system" | "toolCall" | "toolResult" | "subagentToolCall";

export interface ChatMessage {
  role: MessageRole;
  content: string;
  media?: MediaAttachment[];
}

export type MediaAttachment =
  | { kind: "image"; data: Uint8Array; mime: string; name?: string }
  | { kind: "audio"; data: Uint8Array; mime: string; name?: string }
  | { kind: "document"; data: Uint8Array; mime: string; name?: string };

export type StreamItem =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "toolCall"; id: string; name: string; args: unknown }
  | { kind: "toolResult"; callId: string; name: string; output: string }
  | { kind: "completionCall"; usage: Usage }
  | { kind: "subagentToolCall"; name: string; args: unknown }
  | { kind: "final"; output: string; usage: Usage; messages?: ChatMessage[] };

export interface AgentLike {
  stream(prompt: string, history: ChatMessage[], maxTurns?: number): AsyncIterable<StreamItem>;
}

export type AgentEvent =
  | { kind: "token"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "toolCall"; callId: string; name: string; args: unknown }
  | { kind: "toolResult"; callId: string; name: string; output: string }
  | { kind: "subagentToolCall"; name: string; args: unknown }
  | { kind: "error"; message: string }
  | { kind: "retrying"; attempt: number; max: number }
  | { kind: "completionCall"; inputTokens: number; outputTokens: number; cachedInputTokens: number; cacheCreationInputTokens: number }
  | { kind: "done"; response: string; inputTokens: number; outputTokens: number; cachedInputTokens: number; cacheCreationInputTokens: number };

export type BtwEvent =
  | { kind: "done"; id: number; response: string; inputTokens: number; outputTokens: number; cachedInputTokens: number; cacheCreationInputTokens: number }
  | { kind: "error"; id: number; message: string };

export interface SessionLike {
  messages: Array<{ role: string; content: string }>;
  compactions?: Array<{ summary: string }>;
  compactedContext?(): [string | undefined, number];
}

export function compactedContextOf(session: SessionLike): [string | undefined, number] {
  if (session.compactedContext) {
    // Session.compactedContext() returns null (not undefined) when there is
    // no compaction; normalise it so callers do not emit a phantom recap.
    const [summary, firstKept] = session.compactedContext() as unknown as [
      string | null | undefined,
      number,
    ];
    return [summary ?? undefined, firstKept];
  }
  const last = session.compactions?.[session.compactions.length - 1];
  if (!last) return [undefined, 0];
  for (let i = 0; i < session.messages.length; i++) {
    const msg = session.messages[i];
    if (msg.role === "system" && msg.content === last.summary) return [last.summary, i + 1];
  }
  return [undefined, 0];
}

export function convertHistory(session: SessionLike): ChatMessage[] {
  const [summary, firstKept] = compactedContextOf(session);
  const messages: ChatMessage[] = [];
  if (summary !== undefined) {
    messages.push({ role: "assistant", content: `[Recap of my prior work in this conversation]\n${summary}` });
  }
  for (const msg of session.messages.slice(firstKept)) {
    if (msg.role === "user") messages.push({ role: "user", content: msg.content });
    else if (msg.role === "assistant") messages.push({ role: "assistant", content: msg.content });
    else if (msg.role === "system") messages.push({ role: "assistant", content: msg.content });
    else if (msg.role === "toolCall" || msg.role === "tool_call") messages.push({ role: "assistant", content: `[ToolCall]: ${msg.content}` });
    else if (msg.role === "toolResult" || msg.role === "tool_result") messages.push({ role: "assistant", content: `[ToolResult]: ${msg.content}` });
    else if (msg.role === "subagentToolCall" || msg.role === "subagent_tool_call") messages.push({ role: "assistant", content: `[SubagentToolCall]: ${msg.content}` });
    else messages.push({ role: "assistant", content: msg.content });
  }
  return messages;
}

export function imageMediaType(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpeg";
  if (mime === "image/gif") return "gif";
  if (mime === "image/webp") return "webp";
  return "png";
}

export function audioMediaType(mime: string): string {
  if (mime === "audio/mpeg") return "mp3";
  if (mime === "audio/wav") return "wav";
  if (mime === "audio/ogg") return "ogg";
  if (mime === "audio/flac") return "flac";
  if (mime === "audio/mp4") return "m4a";
  if (mime === "audio/aac") return "aac";
  return "mp3";
}

export function documentMediaType(mime: string): string {
  if (mime === "application/pdf") return "pdf";
  return "pdf";
}

export function mediaToMessages(media: MediaAttachment[]): ChatMessage[] {
  return media.map((m) => {
    if (m.kind === "image") return { role: "user", content: "", media: [{ ...m, mime: imageMediaType(m.mime) }] };
    if (m.kind === "audio") return { role: "user", content: "", media: [{ ...m, mime: audioMediaType(m.mime) }] };
    return { role: "user", content: "", media: [{ ...m, mime: documentMediaType(m.mime) }] };
  });
}

export function buildBtwSnapshot(
  session: SessionLike,
  turnTrace: string[],
  mainRunning: boolean,
): ChatMessage[] {
  const snapshot = convertHistory(session);
  if (mainRunning && turnTrace.length > 0) {
    snapshot.push({
      role: "user",
      content:
        `(Context only — the main assistant is working in parallel right now. ` +
        `Its progress so far this turn:\n${turnTrace.join("\n")}\n` +
        `The last step may still be running. Use this only if the user's question is about what the main assistant is doing.)`,
    });
  }
  return snapshot;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryStreamChat(
  retryConfig: RetryConfig,
  start: () => Promise<AsyncIterable<StreamItem>>,
  onRetrying?: (attempt: number, max: number) => void,
): Promise<AsyncIterable<StreamItem>> {
  let attempt = 0;
  let backoff = retryConfig.initialBackoffMs;
  while (true) {
    try {
      return await start();
    } catch (e) {
      attempt += 1;
      if (attempt >= retryConfig.maxAttempts) throw e;
      onRetrying?.(attempt, retryConfig.maxAttempts);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, retryConfig.maxBackoffMs);
    }
  }
}

async function startStream(
  agent: AgentLike,
  prompt: string,
  history: ChatMessage[],
  retryConfig: RetryConfig,
  onRetrying?: (attempt: number, max: number) => void,
): Promise<AsyncIterable<StreamItem>> {
  return retryStreamChat(retryConfig, () => Promise.resolve(agent.stream(prompt, history)), onRetrying);
}

export interface LoopInfo {
  iteration: number;
  active: boolean;
}

export interface StopHook {
  dispatchStop(
    stopHookActive: boolean,
    loopIteration: number | undefined,
    loopActive: boolean | undefined,
  ): Promise<{ continue: boolean; reason?: string }>;
}

function queueToAsyncIterable<T>(push: (emit: (item: T) => void, finish: () => void) => { abort(): void }): {
  iterable: AsyncIterable<T>;
  abort(): void;
} {
  const queue: T[] = [];
  let waiting: ((value: IteratorResult<T>) => void) | undefined;
  let finished = false;
  const handle = push(
    (item) => {
      if (waiting) {
        const w = waiting;
        waiting = undefined;
        w({ value: item, done: false });
      } else {
        queue.push(item);
      }
    },
    () => {
      finished = true;
      if (waiting) {
        const w = waiting;
        waiting = undefined;
        w({ value: undefined as unknown as T, done: true });
      }
    },
  );
  const iterable: AsyncIterable<T> = {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next(): Promise<IteratorResult<T>> {
          if (queue.length > 0) return Promise.resolve({ value: queue.shift() as T, done: false });
          if (finished) return Promise.resolve({ value: undefined as unknown as T, done: true });
          return new Promise((resolve) => {
            waiting = resolve;
          });
        },
      };
    },
  };
  return { iterable, abort: () => handle.abort() };
}

export class AgentRunner {
  events: AsyncIterable<AgentEvent>;
  private abortFn: () => void;

  constructor(events: AsyncIterable<AgentEvent>, abortFn: () => void) {
    this.events = events;
    this.abortFn = abortFn;
  }

  abort(): void {
    this.abortFn();
  }

  [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
    return this.events[Symbol.asyncIterator]();
  }
}

export class BtwRunner {
  private abortFn: () => void;

  constructor(abortFn: () => void) {
    this.abortFn = abortFn;
  }

  abort(): void {
    this.abortFn();
  }
}

export function spawnBtw(
  agent: AgentLike,
  prompt: string,
  history: ChatMessage[],
  onEvent: (event: BtwEvent) => void,
  id: number,
  retryConfig: RetryConfig,
): BtwRunner {
  const controller = new AbortController();
  void (async () => {
    let stream: AsyncIterable<StreamItem>;
    try {
      stream = await startStream(agent, prompt, history, retryConfig);
    } catch (e) {
      onEvent({ kind: "error", id, message: e instanceof Error ? e.message : String(e) });
      return;
    }
    let acc = "";
    try {
      for await (const item of stream) {
        if (controller.signal.aborted) return;
        if (item.kind === "text") acc += item.text;
        else if (item.kind === "final") {
          const usage = item.usage;
          const response = item.output !== "" ? item.output : acc;
          onEvent({
            kind: "done",
            id,
            response,
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            cachedInputTokens: usage.cachedInputTokens ?? 0,
            cacheCreationInputTokens: usage.cacheCreationInputTokens ?? 0,
          });
          return;
        }
      }
    } catch (e) {
      onEvent({ kind: "error", id, message: e instanceof Error ? e.message : String(e) });
      return;
    }
    onEvent({ kind: "error", id, message: "side question ended without a response" });
  })();
  return new BtwRunner(() => controller.abort());
}

const MAX_EMPTY_RESPONSES = 3;
const MAX_STOP_BLOCKS = 8;

export function spawnAgent(
  agent: AgentLike,
  prompt: string,
  history: ChatMessage[],
  retryConfig: RetryConfig,
  loopInfo?: LoopInfo,
  stopHook?: StopHook,
): AgentRunner {
  let aborted = false;
  const { iterable, abort } = queueToAsyncIterable<AgentEvent>((emit, finish) => {
    void (async () => {
      let conversation: ChatMessage[] = [...history];
      let currentPrompt = prompt;
      let emptyResponseCount = 0;
      let stopHookActive = false;
      let consecutiveStopBlocks = 0;
      while (!aborted) {
        let stream: AsyncIterable<StreamItem>;
        try {
          stream = await startStream(agent, currentPrompt, conversation, retryConfig, (attempt, max) => {
            emit({ kind: "retrying", attempt, max });
          });
        } catch (e) {
          emit({ kind: "error", message: e instanceof Error ? e.message : String(e) });
          finish();
          return;
        }
        const pendingToolNames = new Map<string, string>();
        let finalItem: Extract<StreamItem, { kind: "final" }> | undefined;
        let streamError: string | undefined;
        try {
          for await (const item of stream) {
            if (aborted) {
              finish();
              return;
            }
            if (item.kind === "text") emit({ kind: "token", text: item.text });
            else if (item.kind === "reasoning") {
              if (item.text !== "") emit({ kind: "reasoning", text: item.text });
            } else if (item.kind === "toolCall") {
              pendingToolNames.set(item.id, item.name);
              emit({ kind: "toolCall", callId: item.id, name: item.name, args: item.args });
            } else if (item.kind === "toolResult") {
              const toolName = pendingToolNames.get(item.callId) ?? item.name;
              pendingToolNames.delete(item.callId);
              emit({ kind: "toolResult", callId: item.callId, name: toolName, output: item.output });
            } else if (item.kind === "subagentToolCall") {
              emit({ kind: "subagentToolCall", name: item.name, args: item.args });
            } else if (item.kind === "completionCall") {
              emit({
                kind: "completionCall",
                inputTokens: item.usage.inputTokens ?? 0,
                outputTokens: item.usage.outputTokens ?? 0,
                cachedInputTokens: item.usage.cachedInputTokens ?? 0,
                cacheCreationInputTokens: item.usage.cacheCreationInputTokens ?? 0,
              });
            } else if (item.kind === "final") {
              finalItem = item;
            }
          }
        } catch (e) {
          streamError = e instanceof Error ? e.message : String(e);
        }
        if (streamError !== undefined) {
          emit({ kind: "error", message: streamError });
          finish();
          return;
        }
        if (!finalItem) {
          emit({ kind: "error", message: "agent stream ended without a final response" });
          finish();
          return;
        }
        if (finalItem.messages) conversation = [...conversation, ...finalItem.messages];
        const usage = finalItem.usage;
        if (finalItem.output !== "") {
          if (stopHook) {
            const gate = await stopHook.dispatchStop(
              stopHookActive,
              loopInfo?.iteration,
              loopInfo?.active,
            );
            if (gate.continue) {
              consecutiveStopBlocks += 1;
              if (consecutiveStopBlocks <= MAX_STOP_BLOCKS) {
                stopHookActive = true;
                currentPrompt = gate.reason ?? "";
                continue;
              }
            }
          }
          emit({
            kind: "done",
            response: finalItem.output,
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            cachedInputTokens: usage.cachedInputTokens ?? 0,
            cacheCreationInputTokens: usage.cacheCreationInputTokens ?? 0,
          });
          finish();
          return;
        }
        emptyResponseCount += 1;
        if (emptyResponseCount >= MAX_EMPTY_RESPONSES) {
          emit({ kind: "error", message: "Agent returned empty response too many times, aborting." });
          finish();
          return;
        }
        currentPrompt = prompt;
      }
      finish();
    })();
    return {
      abort(): void {
        aborted = true;
        finish();
      },
    };
  });
  return new AgentRunner(iterable, abort);
}

export interface ToolInteraction {
  name: string;
  args: unknown;
  output: string;
  subagentCalls: SubagentCall[];
}

export interface SubagentCall {
  name: string;
  args: unknown;
}

export function pushSubagentCall(collected: SubagentCall[], event: AgentEvent): void {
  if (event.kind === "subagentToolCall") {
    collected.push({ name: event.name, args: event.args });
  }
}

export interface PrintOutcome {
  response: string;
  usage: Usage;
  toolInteractions: ToolInteraction[];
}

export function formatToolArgsSummary(argsJson: unknown): string {
  if (argsJson !== null && typeof argsJson === "object" && !Array.isArray(argsJson)) {
    const obj = argsJson as Record<string, unknown>;
    const firstKey = ["path", "file_path", "pattern", "command", "description", "content", "name", "question", "prompt"];
    for (const key of firstKey) {
      if (obj[key] !== undefined) {
        const val = obj[key];
        const s = typeof val === "string" ? val : JSON.stringify(val);
        if (s.length > 120) return `${s.slice(0, 117)}...`;
        return s;
      }
    }
    return "";
  }
  return String(argsJson);
}

export function truncateCjk(s: string, max: number, marker: string): string {
  if (s.length <= max) return s;
  let cut = max;
  while (cut > 0 && (s.charCodeAt(cut) & 0xc0) === 0x80) cut -= 1;
  return s.slice(0, cut) + marker;
}

export async function runPrint(
  agent: AgentLike,
  prompt: string,
  pureStdout: boolean,
  retryConfig: RetryConfig,
  history: ChatMessage[],
  loopInfo?: LoopInfo,
  stopHook?: StopHook,
): Promise<PrintOutcome> {
  let conversation = [...history];
  let currentPrompt = prompt;
  let fullResponse = "";
  const recordedInteractions: ToolInteraction[] = [];
  let pendingSubagentCalls: SubagentCall[] = [];
  let usage = defaultUsage();
  let continueTurn = true;
  let nextInstruction: string | undefined;
  let stopHookActive = false;
  let consecutiveStopBlocks = 0;
  while (continueTurn) {
    continueTurn = false;
    const stream = await startStream(agent, currentPrompt, conversation, retryConfig);
    const pendingCalls = new Map<string, [string, unknown]>();
    for await (const item of stream) {
      if (item.kind === "text") {
        fullResponse += item.text;
        process.stdout.write(item.text);
      } else if (item.kind === "reasoning") {
        process.stderr.write(item.text);
      } else if (item.kind === "toolCall") {
        if (pureStdout) {
          const summary = formatToolArgsSummary(item.args);
          console.log(`\n◈ ${item.name} ${summary}`);
        }
        pendingCalls.set(item.id, [item.name, item.args]);
      } else if (item.kind === "toolResult") {
        const [name, args] = pendingCalls.get(item.callId) ?? [item.name, null];
        pendingCalls.delete(item.callId);
        const output = item.output;
        if (pureStdout && output !== "") {
          console.log(`◈ ${name} result:`);
          const lines = output.split("\n");
          if (lines.length > 40) {
            console.log(lines.slice(0, 40).join("\n"));
            console.log(`(truncated ${lines.length - 40} more lines)`);
          } else {
            console.log(output);
          }
        }
        recordedInteractions.push({ name, args, output, subagentCalls: pendingSubagentCalls });
        pendingSubagentCalls = [];
      } else if (item.kind === "subagentToolCall") {
        pushSubagentCall(pendingSubagentCalls, { kind: "subagentToolCall", name: item.name, args: item.args });
      } else if (item.kind === "final") {
        usage = item.usage;
        if (item.messages) conversation = [...conversation, ...item.messages];
        if (stopHook) {
          const gate = await stopHook.dispatchStop(stopHookActive, loopInfo?.iteration, loopInfo?.active);
          if (gate.continue) {
            consecutiveStopBlocks += 1;
            if (consecutiveStopBlocks <= MAX_STOP_BLOCKS) {
              stopHookActive = true;
              nextInstruction = gate.reason;
              continueTurn = true;
            }
          }
        }
        break;
      }
    }
    if (continueTurn) {
      currentPrompt = nextInstruction ?? prompt;
      nextInstruction = undefined;
    }
  }
  console.log("");
  return { response: fullResponse, usage, toolInteractions: recordedInteractions };
}

export async function runSubagent(
  agent: AgentLike,
  prompt: string,
  maxTurns: number,
  eventTx: ((event: AgentEvent) => void) | undefined | null,
  retryConfig: RetryConfig,
): Promise<string> {
  const stream = await retryStreamChat(retryConfig, () =>
    Promise.resolve(agent.stream(prompt, [], maxTurns)),
  );
  let fullResponse = "";
  for await (const item of stream) {
    if (item.kind === "text") fullResponse += item.text;
    else if (item.kind === "toolCall") {
      eventTx?.({ kind: "subagentToolCall", name: item.name, args: item.args });
    } else if (item.kind === "final") {
      fullResponse = item.output;
      break;
    }
  }
  if (fullResponse === "") throw new Error("subagent returned empty response");
  return fullResponse;
}
