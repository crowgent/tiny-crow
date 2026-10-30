import {
  C_ERROR,
  resolveMouseCapture,
  writeOk,
  writeResult,
  type SlashCtx,
} from "./mod.ts";

export function handleWelcome(
  renderer: SlashCtx["renderer"],
  showLazygit: boolean,
  showWelcomeFn?: (renderer: SlashCtx["renderer"], showLazygit: boolean) => void,
): void {
  if (showWelcomeFn !== undefined) {
    showWelcomeFn(renderer, showLazygit);
  } else {
    writeOk(renderer, "welcome: quickstart guide not wired to a renderer yet");
  }
}

export function handleTutor(
  renderer: SlashCtx["renderer"],
  mouseCapture: boolean,
  showGetStarted?: () => void,
  suspendTui?: <T>(mouseCapture: boolean, fn: () => T) => T,
): void {
  try {
    const run = suspendTui ?? ((_m: boolean, fn: () => void) => fn());
    if (showGetStarted !== undefined) run(mouseCapture, showGetStarted);
  } catch (e) {
    renderer.writeLine(e instanceof Error ? e.message : String(e), C_ERROR);
  }
}

export function handle(_parts: string[], ctx: SlashCtx): void {
  writeOk(ctx.renderer, "commands:");
  const lines: string[] = [
    "  /add [path]            add file(s) to context",
    "  /drop <path>           remove file from context",
    "  /drop-all              remove all added files from context",
    "  /init [force]          create AGENTS.md for this project",
    "  /memory [status|search|read|write|editor|clear]  manage memory",
    "  /clear [/new]          clear screen",
    "  /provider [name]       show or switch provider",
    "  /models                list quick models",
    "  /models <name>         switch to a quick model",
    "  /models-add <n> <p> <m> save a quick model",
    "  /sessions              list recent sessions",
    "  /sessions <id>         load a session (by ID prefix)",
    "  /sessions delete <id>  delete a session",
    "  /export [file]         export session to HTML (or .jsonl)",
    "  /import <file>         import a session from JSONL or JSON",
    "  /share                 share session as a secret GitHub gist",
    "  /reasoning             toggle LLM reasoning ability",
    "  /thinking              alias for /reasoning",
    "  /mode                  show/change security mode",
    "  /mode <mode>           set mode (standard|restrictive|readonly|guarded|yolo)",
    "  /toggle                show toggleable features",
    "  /toggle todo [on|off]  toggle todo-list tools",
    "  /mcp                   list MCP servers and tools",
    "  /mcp <server>          list tools of an MCP server",
    "  /mcp login <server>    OAuth login to an MCP server",
    "  /mcp logout <server>   remove a server's stored OAuth token",
    "  /clear [/new]          clear screen",
    "  /undo                  undo last exchange",
    "  /redo                  restore the last /undo or rewind",
    "  /rewind                rewind to an earlier turn (picker)",
    "  /retry                 retry last prompt",
    "  /queue                 list input queued while agent is busy",
    "  /queue clear           clear the queue",
    "  /queue pop             remove the last queued input",
    "  /btw <message>         ask a side question in parallel (no session trace)",
    "  /review [msg]          review code (auto message if omitted)",
    "  /compress [/compact]   compress conversation history",
    "  /compress [instr]      compress with custom instructions",
    "  /editsys [mode]        edit system (similarity | hashedit)",
    "  /advisor               show advisor status",
    "  /advisor on|off        enable or disable advisor",
    "  /advisor handoff [on|off]  toggle human handoff mode",
    "  /advisor model <name>  set advisor model",
    "  /advisor max-uses <n>  set max advisor calls per request",
    "  /advisor context-limit <n>  set max KB sent to advisor",
    "  /loop [prompt]         start iterative coding loop",
    "  /loop stop             stop the loop",
    "  /prompt                list available prompts",
    "  /prompt <name>         activate a prompt",
    "  /prompt default        clear active prompt",
    "  /rename <name>         rename current session",
    "  /theme                 list available themes",
    "  /theme <name>          activate a theme",
    "  /theme default         clear active theme",
    "  /regen-prompts        restore built-in prompts to global dir",
    "  /regen-themes         restore built-in themes to config dir",
    "  /worktree <name>       create a git worktree on <name> branch and cd into it",
    "  /wt-merge [branch]     merge worktree branch into [branch] (default: main/master)",
    "  /wt-exit               exit worktree and return to main repo",
    "  /hooks                 show configured hook events and handlers",
    "  /history               show global chat history",
    "  /quit [/exit]          exit tiny-crow",
    "  /welcome               show the quickstart guide",
    "  /tutor                 open GET_STARTED.md in less",
    "  /tutorial              alias for /welcome",
    "  /help                  show this message",
    "",
    "  /model-subagent [name] show or switch subagent model",
    "  /models-subagent       list quick models for subagent",
    "  /models-subagent <n>   switch subagent to a quick model",
  ];
  for (const line of lines) writeResult(ctx.renderer, line);
  writeOk(ctx.renderer, "keys:");
  const keys: string[] = [
    "  PgUp/PgDn             scroll chat history",
    "  Ctrl+Up/Ctrl+Down      scroll chat one line",
    "  Home/End               jump to top/bottom",
    "  @<query>               file picker (Tab/Enter select, Esc cancel)",
    "  mouse drag             select text (copies to clipboard on release)",
    "  Esc (while selected)   clear selection (no copy)",
    "  Ctrl+R                 toggle reasoning",
    "  Alt+M                  quick-model switcher",
    "  Alt+P                  prompt switcher",
    "  Ctrl+C / Ctrl+D        interrupt/quit",
    "  mouse scroll           scroll chat (requires mouse_capture)",
  ];
  for (const line of keys) writeResult(ctx.renderer, line);
}

export { resolveMouseCapture };
