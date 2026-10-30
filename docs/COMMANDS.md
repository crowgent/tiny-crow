---
description: "Every tiny-crow slash command, input prefix, and keyboard shortcut in the terminal UI, grouped by what it is for."
---

# The full command reference, by job

All of the slash commands in this reference run from the TUI input
prompt. They are grouped here by the job they do, rather than by the
order in which they were added, so you can find the control for the
thing you are actually trying to do.

## Working with the conversation itself

- `/compress [instructions]` — shrinks the conversation history
  to free context window space.
- `/compact` — another name for `/compress`.
- `/editsys` — reports the edit system in force, similarity or
  hashedit.
- `/editsys similarity` — edits with SEARCH/REPLACE and fuzzy
  matching (the default).
- `/editsys hashedit` — edits with CRC-32 tags (cheaper on tokens,
  guarded by compare-and-swap).
- `/btw <message>` — puts a side question in parallel, leaving the
  main conversation untouched. It copies the current context
  (including a main-agent turn that is already running), answers
  with read-only tools only (read/grep/find_files/list_dir, no
  writes or bash), and prints the answer inline. It works while the
  main agent is running, writes nothing to history, and shows its
  token cost separately as `btw:$…`. Pressing Ctrl-C stops a running
  `/btw` without disturbing the main agent.
- `/reasoning` — switches LLM reasoning on or off (the model must
  support it).
- `/thinking` — another name for `/reasoning`.
- `/review [msg]` — runs a single code review. It turns on the
  `review` prompt in readonly mode, submits a review message, then
  returns to the previous prompt. With no message, it drafts one
  from the session and worktree context.
- `/toggle` — lists the features that can be toggled.
- `/toggle todo [on|off]` — switches the todo-list tools on or off.

## Moving between and around sessions

This group covers starting over, stepping back, finding an old
conversation, and getting a session out of the agent in a portable
form.

- `/clear` — wipes the current session, messages, tokens, and
  compactions included.
- `/new` — another name for `/clear`.
- `/undo` — drops the latest exchange, user message and assistant
  reply together.
- `/redo` — brings back what the latest `/undo` or `/rewind` took
  away.
- `/rewind` — opens a picker for jumping back to an earlier point
  in the session.
- `/retry` — puts the last user message back in the editor so it
  can be changed.
- `/quit` — leaves tiny-crow.
- `/exit` — another name for `/quit`.
- `/sessions` — shows recent saved sessions, up to 20 of them.
- `/sessions <id-or-name>` — opens a session by ID prefix or by
  name.
- `/sessions delete <id-or-name>` — removes a session by ID prefix
  or by name.
- `/rename <name>` — gives the current session a different name.
- `/history` — shows the global chat history, the last 10 entries
  across sessions.
- `/export [file]` — writes the current session as a standalone
  HTML page (by default `tiny-crow-session-<id>.html`), or as JSONL
  if the filename ends in `.jsonl`. Included in this build.
- `/import <file>` — brings a session in from a JSONL export (or a
  native session JSON file), saves it, and opens it. Included in
  this build.
- `/share` — publishes the HTML export as a secret GitHub gist and
  prints its URL. Needs `GITHUB_TOKEN` or `GH_TOKEN`. Included in
  this build.
- `/queue` — lists input that arrived while the agent was busy
  (identical to `/queue ls`).
- `/queue clear` — empties that queue.
- `/queue pop` — takes the last queued input off the queue.
- `/welcome` — brings back the welcome/onboarding screen.
- `/tutorial` — another name for `/welcome`.

## Switching provider and model

- `/provider` — reports which provider is currently in use.
- `/provider <name>` — moves to another provider.
- `/model` — reports which model is currently in use.
- `/model <name>` — moves to another model.
- `/models` — lists every quick model from the config.
- `/models <name>` — moves to a named quick model.
- `/models-add <name> <provider> <model>` — writes a new quick
  model into the config file.

## Files you hand to the conversation

- `/add` — lists files already in context, with their sizes.
- `/add <path>` — hands a file to the agent's context, by absolute
  or relative path.
- `/drop <path>` — takes a file back out of context.
- `/drop-all` — takes every added file back out of context.

A file added this way travels with the conversation on each request.
That is handy for reference docs or code you want the agent to keep
in mind without pasting it into the chat itself.

## Setting up a project

- `/init` — asks the agent to draft an AGENTS.md file for the
  current project.
- `/init force` — writes over an AGENTS.md that is already there.

This needs a `code` prompt to be present. Run `/regen-prompts`
to bring back the built-in prompts, or write a custom `code.md`
prompt of your own.

## Safety levels

- `/mode` — reports the safety level in force right now.
- `/mode standard` — path tools may work inside the working
  directory; outside paths prompt first. Config rules still apply.
- `/mode restrictive` — every operation prompts first. Config rules
  are skipped.
- `/mode readonly` — reads only; writes, edits, bash, and
  everything else are refused.
- `/mode guarded` — reads are free; writes, edits, bash, and
  everything else prompt first.
- `/mode yolo` — everything is allowed; only destructive bash
  commands prompt. Config rules still apply.

A prompt can choose a safety level on its own: put `%%mode=<mode>`
on its first line and the level switches when the prompt is
activated. Activating a prompt that carries
`%%mode=last_user_mode` returns to the level last chosen explicitly
through `/mode` or startup config. See the prompts section below.

## Prompts, themes, and a read-only sample

- `/prompt` — lists the prompts available.
- `/prompt <name>` — turns on a named prompt. A `%%mode=` line in
  the prompt file is applied as well (see below).
- `/prompt default` — turns the active prompt off.

A prompt file may carry a `%%mode=<mode>` directive on its
**first line**, which switches the safety level as soon as the
prompt is turned on. The allowed levels are `standard`,
`restrictive`, `readonly`, `guarded`, and `yolo`, and
`%%mode=last_user_mode` restores the level the user last set through
`/mode` or startup config. That directive line is removed from the
prompt text before the agent ever sees it.

A sample `ask.md` file:

```markdown
%%mode=readonly

## Reading Only

You are in read-only mode. Read files and explore, and change nothing.
```

- `/theme` — lists the themes available.
- `/theme <name>` — turns on a named theme.
- `/theme default` — turns the active theme off and returns to
  config colours.
- `/regen-prompts` — writes the built-in prompts back into the
  prompts directory.
- `/regen-themes` — writes the built-in themes back into the themes
  directory.

## The hook dispatcher

Hooks ship in this build; the full configuration reference is in
[CONFIG.md](CONFIG.md#hooks).

- `/hooks` — reports whether a hook dispatcher is installed and,
  for each configured event, how many handlers it has.

From the shell, rather than as a slash command, you can dry-run
`PreToolUse` hooks for a tool with
`tiny-crow --hooks-test <tool> [--hooks-test-input <json>]`. That
runs no session and makes no model call. The hooks reference in
[CONFIG.md](CONFIG.md#hooks) covers the whole configuration.

## Memory

Memory ships in this build, and its tools appear once memory is
turned on (see MEMORY.md).

- `/memory` — reports memory status (MEMORY.md, scratchpad, daily
  log).
- `/memory status` — the same status check, spelled out.
- `/memory search <query>` — searches every memory file, matching
  keywords without regard to case.
- `/memory read long_term` — reads the global MEMORY.md file.
- `/memory read scratchpad` — reads the project scratchpad, meaning
  its open checklist items.
- `/memory read daily [date]` — reads a daily log, today's by
  default, or a YYYY-MM-DD date for an older one.
- `/memory read note <name>` — reads a named note.
- `/memory write long_term <content>` — adds content to the global
  MEMORY.md.
- `/memory write scratchpad <content>` — adds content to the
  project scratchpad.
- `/memory write daily <content>` — adds content to today's daily
  log.
- `/memory write note:<name> <content>` — adds content to a named
  note.
- `/memory editor` — opens MEMORY.md in the system `$EDITOR`.
- `/memory clear scratchpad` — wipes every scratchpad item.
- `/memory clear daily` — wipes every entry from today.

Long-term memory (MEMORY.md) and open scratchpad items are fed into
every request automatically. Daily logs from today and yesterday
are fed in as well. Notes and older daily logs stay out of the
automatic feed and are reached through `/memory read` and
`memory_search`.

## MCP servers

- `/mcp` — lists connected MCP servers and how many tools each one
  offers.
- `/mcp <server>` — lists the tools of one MCP server.
- `/mcp login <server>` — runs the OAuth 2.0 login flow for a URL
  server, then reconnects it.
- `/mcp logout <server>` — deletes a server's stored OAuth token.

## Advisor

- `/advisor` — reports advisor status: enabled or not, mode, model,
  and max uses.
- `/advisor on` — turns the advisor tool on.
- `/advisor off` — turns the advisor tool off.
- `/advisor handoff` — flips human handoff mode.
- `/advisor handoff on` — turns human handoff mode on, so calls go
  to the user.
- `/advisor handoff off` — turns human handoff mode off, so the
  advisor model answers.
- `/advisor model <name>` — changes the advisor model.
- `/advisor max-uses <n>` — caps advisor calls per request (0 means
  no cap).
- `/advisor context-limit <n>` — caps how many kilobytes of
  conversation context reach the advisor.

## Subagents

Subagents ship in this build; see [SUBAGENTS.md](SUBAGENTS.md).

- `/model-subagent` — reports the model subagents currently use.
- `/model-subagent <name>` — changes the subagent model.
- `/models-subagent` — lists quick models that subagents can use.
- `/models-subagent <name>` — moves subagents onto a named quick
  model.

## Worktrees

- `/worktree <name>` — creates a git worktree on a fresh branch and
  moves into it. It refuses branches that already exist and paths
  that are already occupied; names must be a single word, with no
  spaces, slashes, or leading dashes.
- `/wt-merge [branch]` — merges the worktree branch back into the
  target branch with a local `--squash` merge and no push. The
  worktree and branch are removed only once the merge is verified;
  an aborted merge leaves everything in place.
- `/wt-exit` — leaves the worktree and returns to the main repo.

## Loops

- `/loop [prompt]` — begins the iterative coding loop.
- `/loop stop` — ends the loop that is running.
- `/loop status` — reports the loop's current status.

## Running a shell command straight from the prompt

Start a message with `!` and it runs as a shell command instead of
going to the agent. Its output is captured and kept in the session
history as an Assistant message. This works in the TUI and in
`--print` mode alike.

- `!ls -la` — lists files in the current directory.
- `!git status` — checks git status without asking the agent.
- `!npm test` — runs tests and keeps the output.
- `!` — an empty command reports an error.

To run a command and then talk about what it produced, type
`!<command>` first so the output lands in history as an Assistant
message, then send an ordinary message asking the agent about it.

## Prompt shortcuts

Start a message with `.` to switch prompts quickly, or to ask a
single question under a different prompt.

- `.` — opens the prompt picker (the same as the `/prompt`
  picker).
- `.ask` — switches to the `ask` prompt (the same as
  `/prompt ask`).
- `.plan what files changed?` — uses the `plan` prompt for this one
  query, then restores the previous prompt and safety level.

The `.[prompt] [msg]` form is a one-shot: it sets the prompt,
submits the message, and once the reply is in, restores the
previous prompt and `last_user_mode`.

## Keyboard shortcuts

- `Enter` — sends the message.
- `Alt+Enter` / `Shift+Enter` — adds a newline.
- `Ctrl+C` / `Ctrl+D` — stops the current agent response, or quits.
- `Ctrl+W` — deletes the word before the cursor.
- `Ctrl+U` / `Ctrl+K` — deletes to the start / end of the line.
- `Ctrl+Y` — pastes back the most recently deleted text.
- `Ctrl+A` / `Ctrl+E` — jumps to the start / end of the line.
- `Ctrl+B` / `Ctrl+F` — moves one character left / right.
- `Ctrl+Left` / `Ctrl+Right` — moves one word left / right.
- `Ctrl+P` / `Ctrl+N` — moves to the previous / next line (history
  on the first / last line).
- `Alt+B` / `Alt+F` — moves one word left / right.
- `Alt+D` / `Alt+Y` — deletes the next word / cycles the kill ring.
- `Ctrl+G` — opens the current input in the system editor
  (`$EDITOR`).
- `Ctrl+H` — starts `lazygit` (the git TUI) in the project
  directory. Turn off with `--disable-lazygit`.
- `Alt+M` — opens the quick-model switcher (fuzzy filter, `Tab`
  flips between Quick and Provider, `Enter` applies at once through
  `/models <name>`).
- `Alt+P` — opens the prompt switcher (fuzzy filter, `Enter`
  applies at once through `/prompt <name>`, including `%%mode=`
  and `[prompt_to_model]`).
- `Tab` — inserts two spaces.
- `@` at word start — opens the file picker.
- `Up / Down` — steps through command history.
- `PageUp / PageDown` — scrolls the viewport.
- `Home / End` — scrolls to the top / bottom.
- `Escape` — closes the active picker, or cancels.

## Finding help

- `/help` — prints the full help text, with every command and
  keybinding.
