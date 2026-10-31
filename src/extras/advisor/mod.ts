export const ADVISOR_SYSTEM_PROMPT =
  "You are an expert advisor called by a coding assistant for strategic guidance. " +
  "The assistant is driving a real coding session with file read/write/edit, " +
  "bash, grep, and other tools at its disposal.\n\n" +
  "Below is the full conversation so far, followed by the assistant's question. " +
  "Your role:\n" +
  "- Review the conversation to understand what has happened\n" +
  "- Provide a clear plan, approach, or course correction\n" +
  "- Focus on architecture, design decisions, edge cases, and risk\n" +
  "- Keep guidance concise: aim for 150-300 words unless the question demands more\n" +
  "- Do NOT produce user-facing output or call any tools yourself\n\n" +
  "The assistant will continue the task after receiving your advice. " +
  "Give it the strategic direction it needs to proceed correctly.";

export interface AdvisorSessionMessage {
  role: "user" | "assistant" | "system" | "tool_call" | "tool_result" | "subagent_tool_call";
  content: string;
}

export type MessageRoleString = AdvisorSessionMessage["role"];

export interface HandoffRequest {
  question: string;
  
  reply: (response: string) => void;
}

export function createHandoffRequest(question: string): {
  request: HandoffRequest;
  promise: Promise<string>;
} {
  let resolveFn: (response: string) => void = () => {};
  const promise = new Promise<string>((resolve) => {
    resolveFn = resolve;
  });
  return { request: { question, reply: resolveFn }, promise };
}

export type HandoffSender = (request: HandoffRequest) => Promise<void> | void;

export interface AdvisorClient {
  
  complete(prompt: string, systemPrompt: string): Promise<string>;
}

export interface AdvisorToolConfig {
  client: AdvisorClient | null;
  advisorModel: string;
  humanHandoff: boolean;
  maxUses?: number | null;
  handoffTx?: HandoffSender | null;
  enabled: boolean;
  kilobytesLimit: number;
}

let config: AdvisorToolConfig | null = null;
let sessionMessages: AdvisorSessionMessage[] = [];

export function initConfig(cfg: AdvisorToolConfig): void {
  config = cfg;
}

export function withConfig<R>(f: (cfg: AdvisorToolConfig) => R): R {
  if (!config) throw new Error("advisor config not initialized");
  return f(config);
}

export function isEnabled(): boolean {
  return config !== null && config.enabled;
}

export function updateClient(client: AdvisorClient): void {
  if (config) config.client = client;
}

export function setSessionMessages(msgs: AdvisorSessionMessage[]): void {
  sessionMessages = [...msgs];
}

export function getSessionMessages(): AdvisorSessionMessage[] {
  return [...sessionMessages];
}

export interface AdvisorArgs {
  question: string;
}

export function advisorDescription(): string {
  const humanHandoff = config?.humanHandoff ?? false;
  if (humanHandoff) {
    return (
      "Consult the user for strategic guidance. " +
      "Call this before substantive work, before writing, before committing to an " +
      "interpretation, when stuck, or when considering a change of approach. " +
      "The user sees your full conversation so far. " +
      "Describe your question clearly — include relevant context, what you're " +
      "trying to do, what you've tried, and what you need guidance on."
    );
  }
  return (
    "Consult an expert advisor model for strategic guidance. " +
    "The advisor receives your full conversation transcript automatically. " +
    "Call this before substantive work, before writing, before committing to an " +
    "interpretation, when stuck, or when considering a change of approach. " +
    "Describe your question clearly — the advisor already sees the full " +
    "conversation, so focus your question on the specific decision you need help with."
  );
}

export const ADVISOR_PARAMETERS = {
  type: "object",
  properties: {
    question: {
      type: "string",
      description:
        "Your question for the advisor. The advisor already sees the full conversation transcript. Focus on the specific decision, approach, or problem you need guidance on.",
    },
  },
  required: ["question"],
} as const;

export function formatConversation(
  msgs: AdvisorSessionMessage[],
  kilobytesLimit: number,
): string {
  const perSide = Math.floor((kilobytesLimit * 1024) / 2);
  const roleLabel = (role: AdvisorSessionMessage["role"]): string => {
    switch (role) {
      case "user":
        return "User";
      case "assistant":
        return "Assistant";
      case "system":
        return "System";
      case "tool_call":
        return "ToolCall";
      case "tool_result":
        return "ToolResult";
      case "subagent_tool_call":
        return "SubagentToolCall";
    }
  };
  const formatLine = (msg: AdvisorSessionMessage): string =>
    `[${roleLabel(msg.role)}]: ${msg.content}`;

  let headEnd = 0;
  let headChars = 0;
  for (let i = 0; i < msgs.length; i++) {
    const line = formatLine(msgs[i]!);
    const needed = headChars > 0 ? line.length + 2 : line.length;
    if (headChars + needed > perSide) break;
    headChars += needed;
    headEnd = i + 1;
  }
  let tailStart = msgs.length;
  let tailChars = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const line = formatLine(msgs[i]!);
    const needed = tailChars > 0 ? line.length + 2 : line.length;
    if (tailChars + needed > perSide) break;
    tailChars += needed;
    tailStart = i;
  }
  if (msgs.length === 0) return "";
  let result = "";
  for (let i = 0; i < headEnd; i++) {
    if (i > 0) result += "\n\n";
    result += formatLine(msgs[i]!);
  }
  if (headEnd < tailStart) {
    result += "\n\n[... conversation omitted ...]\n\n";
  } else if (headEnd > 0 && headEnd < msgs.length) {
    result += "\n\n";
  }
  const tailBegin = Math.max(headEnd, tailStart);
  for (let i = tailBegin; i < msgs.length; i++) {
    if (i > tailBegin) result += "\n\n";
    result += formatLine(msgs[i]!);
  }
  return result;
}

export async function runAdvisorCompletion(
  client: AdvisorClient,
  question: string,
  messages: AdvisorSessionMessage[],
  kilobytesLimit: number,
  suffix?: string,
): Promise<string> {
  const conversation = formatConversation(messages, kilobytesLimit);
  const prompt = `## Conversation\n\n${conversation}\n\n## Assistant's question\n\n${question}`;
  let preamble = ADVISOR_SYSTEM_PROMPT;
  if (suffix) preamble += `\n\n---\n\n${suffix}`;
  const response = await advisorCall(client, prompt, preamble);
  return response === "" ? "[Advisor returned empty response]" : response;
}

async function advisorCall(
  client: AdvisorClient,
  prompt: string,
  systemPrompt: string,
): Promise<string> {
  return client.complete(prompt, systemPrompt);
}

export class AdvisorTool {
  private uses = 0;

  async call(args: AdvisorArgs): Promise<string> {
    if (args.question === "") {
      throw new Error("advisor: question must not be empty");
    }
    const cfg = withConfig((c) => c);
    if (cfg.maxUses !== null && cfg.maxUses !== undefined) {
      if (this.uses >= cfg.maxUses) {
        throw new Error("Advisor call limit reached for this request");
      }
      this.uses += 1;
    } else {
      this.uses += 1;
    }
    if (cfg.humanHandoff) {
      if (!cfg.handoffTx) {
        throw new Error("Human handoff unavailable (non-interactive mode)");
      }
      const { request, promise } = createHandoffRequest(args.question);
      try {
        await cfg.handoffTx(request);
      } catch {
        throw new Error("Handoff channel closed");
      }
      const response = await promise;
      return response === "" ? "[User provided no response]" : response;
    }
    if (!cfg.client) {
      throw new Error("Advisor model not configured");
    }
    try {
      return await runAdvisorCompletion(
        cfg.client,
        args.question,
        sessionMessages,
        cfg.kilobytesLimit,
      );
    } catch (err) {
      throw new Error(
        `Advisor call failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  get usesCount(): number {
    return this.uses;
  }
}
