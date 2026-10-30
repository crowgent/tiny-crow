export type ChainPhase = "brainstorm" | "plan" | "code";

export const CHAIN_PHASES: ChainPhase[] = ["brainstorm", "plan", "code"];

export function chainPhaseFromPromptName(name: string): ChainPhase | null {
  if (name === "brainstorm" || name === "plan" || name === "code") return name;
  return null;
}

export function nextPromptName(phase: ChainPhase): string {
  switch (phase) {
    case "brainstorm":
      return "plan";
    case "plan":
      return "code";
    case "code":
      return "review";
  }
}

export function transitionMessage(phase: ChainPhase): string {
  switch (phase) {
    case "brainstorm":
      return "Based on the brainstorm above, create a detailed implementation plan.";
    case "plan":
      return "Implement the plan above. Write code, tests, and verify.";
    case "code":
      return "Review the changes for correctness, design, testing, and security.";
  }
}

export interface ChainConfig {
  brainstormToPlan: boolean;
  planToCode: boolean;
  codeToReview: boolean;
}

export function isChainPhaseEnabled(phase: ChainPhase, cfg: ChainConfig): boolean {
  switch (phase) {
    case "brainstorm":
      return cfg.brainstormToPlan;
    case "plan":
      return cfg.planToCode;
    case "code":
      return cfg.codeToReview;
  }
}

export function chainLabel(phase: ChainPhase): string {
  switch (phase) {
    case "brainstorm":
      return "Continue to plan? [Y/N/B]";
    case "plan":
      return "Continue to code? [Y/N/B]";
    case "code":
      return "Run /review? [Y/N/B]";
  }
}

export type ChainDecision =
  | { kind: "Decline" }
  | { kind: "Accept"; extra: string | null }
  | { kind: "NotChain" };

export function parseChainDecision(input: string): ChainDecision {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();
  if (lower === "n" || lower === "no") return { kind: "Decline" };
  if (lower === "y" || lower === "yes") return { kind: "Accept", extra: null };
  for (const prefix of ["but ", "b ", "yes but ", "yes b ", "y but ", "y b "]) {
    if (lower.startsWith(prefix)) {
      const extra = trimmed.slice(prefix.length).trim();
      if (extra === "") return { kind: "NotChain" };
      return { kind: "Accept", extra };
    }
  }
  return { kind: "NotChain" };
}
