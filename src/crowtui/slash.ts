export const SLASH_COMMANDS: string[] = [
  "provider",
  "model",
  "models",
  "models-add",
  "model-subagent",
  "models-subagent",
  "prompt",
  "theme",
  "regen-prompts",
  "regen-themes",
  "reasoning",
  "thinking",
  "mode",
  "toggle",
  "mcp",
  "editsys",
  "advisor",
  "sessions",
  "rename",
  "clear",
  "new",
  "undo",
  "redo",
  "rewind",
  "retry",
  "quit",
  "exit",
  "history",
  "export",
  "import",
  "share",
  "help",
  "welcome",
  "tutorial",
  "tutor",
  "add",
  "drop",
  "drop-all",
  "init",
  "review",
  "memory",
  "compress",
  "compact",
  "loop",
  "worktree",
  "wt-merge",
  "wt-exit",
  "hooks",
  "docs",
  "btw",
  "queue",
];

export function slashCandidates(prefix: string): string[] {
  const lower = prefix.toLowerCase();
  return SLASH_COMMANDS.filter((name) => name.startsWith(lower));
}

export const PROVIDER_NAMES: string[] = [
  "openrouter",
  "openai",
  "anthropic",
  "gemini",
  "ollama",
  "opencode-zen",
  "opencode-go",
];

const COMMAND_DESCRIPTIONS: Record<string, string> = {
  provider: "show or switch provider",
  model: "show or switch model",
  models: "list quick models, switch by name",
  "models-add": "save the current model as a quick model",
  "model-subagent": "show or switch the subagent model",
  "models-subagent": "list subagent quick models",
  prompt: "show or switch prompt mode",
  theme: "show or switch color theme",
  "regen-prompts": "refresh prompt files from disk",
  "regen-themes": "refresh theme files from disk",
  reasoning: "toggle reasoning display",
  thinking: "set thinking level",
  mode: "switch permission mode",
  toggle: "toggle a setting",
  mcp: "manage MCP servers",
  editsys: "edit the system prompt",
  advisor: "ask the advisor a question",
  sessions: "list recent sessions",
  rename: "rename the session",
  clear: "clear the screen",
  new: "start a new session",
  undo: "undo the last turn",
  redo: "redo an undone turn",
  rewind: "rewind to an earlier turn",
  retry: "retry the last turn",
  quit: "leave the TUI",
  exit: "leave the TUI",
  history: "show message history",
  export: "export the session",
  import: "import a session",
  share: "share the session",
  help: "list commands",
  welcome: "show the welcome screen",
  tutorial: "show the tutorial",
  tutor: "show the getting started guide",
  add: "add a file to context",
  drop: "drop a file from context",
  "drop-all": "drop all files from context",
  init: "create an AGENTS.md for this project",
  review: "review the current changes",
  memory: "manage saved memory",
  compress: "summarize and compact history",
  compact: "compact history",
  loop: "run the agent in a loop",
  worktree: "manage worktrees",
  "wt-merge": "merge the worktree back",
  "wt-exit": "leave the worktree",
  hooks: "manage hooks",
  docs: "show documentation",
  btw: "ask a side question",
  queue: "manage the queued messages",
};

export function slashDescription(name: string): string {
  return COMMAND_DESCRIPTIONS[name] ?? "";
}

export function pickerWindow(
  names: string[],
  selected: number,
  size: number,
): { rows: string[]; selected: number } {
  if (names.length === 0) return { rows: [], selected: 0 };
  const windowSize = Math.max(1, size);
  const sel = ((selected % names.length) + names.length) % names.length;
  let start = 0;
  if (sel >= windowSize) start = sel - windowSize + 1;
  if (start > names.length - windowSize) start = Math.max(0, names.length - windowSize);
  const rows: string[] = [];
  if (start > 0) rows.push(`  ↑ ${start} more above`);
  for (const name of names.slice(start, start + windowSize)) rows.push(`  /${name}`);
  const below = names.length - (start + windowSize);
  if (below > 0) rows.push(`  ↓ ${below} more below`);
  return { rows, selected: (start > 0 ? 1 : 0) + (sel - start) };
}
