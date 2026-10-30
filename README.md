# Tiny Crow

A small terminal coding agent, written in TypeScript for Node.js. It runs
straight from source — no build step, no runtime dependencies.

## What it can do

- **Many providers**: OpenRouter, OpenAI, Anthropic, Gemini, Ollama, and
  providers you define yourself
- **The usual agent tools**: reading, writing, editing, searching, shell
  commands, and task tracking
- **Permissions you can tune**: several modes, per-tool glob patterns, a
  per-session allowlist, and a policy for how mode rules combine
- **Sessions that persist**: save, reopen, and resume work, with automatic
  compaction so long conversations stay inside the context window
- **A terminal interface**: rendered Markdown, mouse selection and copy,
  scrollback, and a toggle for showing the model's reasoning
- **Switchable system prompts**: change the agent's stance mid-session
  (`code`, `plan`, `review`, `debug`, and more) to fit the job at hand
- **MCP servers**: plug in external tools over stdio or HTTP
- **Web access**: built-in WebFetch and WebSearch tools
- **Loops**: repeat a prompt until a goal is met, for long-running work
- **Git worktrees**: hop between worktrees with `/worktree`
- **ACP server mode**: editors can talk to Tiny Crow over the Agent
  Communication Protocol
- **Plain-text memory**: a global MEMORY.md plus per-project daily logs,
  a scratchpad, and notes, folded into each session's system prompt
- **Lifecycle hooks**: let outside commands watch or gate tool calls,
  prompts, and session events
- **An advisor**: a second model the agent can ask for strategic advice
  mid-session, optionally handing the question to you instead
- **Multimodal messages**: attach images and PDFs
- **Subagents**: fast, parallel helpers for exploring a codebase
- **ARCHITECTURE.md support**: a companion to AGENTS.md, giving every
  agent on a project the same high-level design context
- **Prompt chaining**: when a phase ends, be offered the next one —
  brainstorm, then plan, then code, then review — with each step
  switchable in config
- **Status signals**: run-state events (started, stopped, git conflict,
  waiting on a permission) sent over a Unix socket for status bars and
  other tooling

Windows has not been tested at all.

## Installing

You need Node.js 24 or newer. The sources run directly under Node's
TypeScript support.

```bash
git clone <this repository>
cd tiny-crow
npm install   # installs dev tooling only; there are no runtime dependencies
```

To get a `tiny-crow` command on your PATH, link the entry point:

```bash
ln -s "$PWD/src/main.ts" ~/.local/bin/tiny-crow
```

And make sure `~/.local/bin` is on your PATH:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## First run

```bash
# Set your API key (OpenRouter is the default provider)
export OPENROUTER_API_KEY=<your key>

# Interactive session (default prompt: code)
npm start

# Monochrome TUI
npm start -- --no-color

# One-shot mode
npm start -- -p "Explain this project"

# Continue last session
npm start -- -c

# Pick a provider and model explicitly
npm start -- --provider openrouter --model deepseek/deepseek-v4-flash
```

While developing, `npm run dev` restarts the entry point whenever a
file changes.

## Configuring

`docs/CONFIG.md` covers where the config file lives, which keys it
accepts, provider aliases, permission rules, and MCP server setup.

Inside a session, `/prompt autoconfig` hands setup to a specialised
agent that reads the documentation and adjusts your configuration for
you.

## Prompts

Tiny Crow ships with built-in system prompts that reshape how the agent
behaves. List them or switch with `/prompt`.

| Prompt                | What it is for                                                         |
| --------------------- | ---------------------------------------------------------------------- |
| **`code`** (default)  | Coding, with full file and shell access and a test-first workflow      |
| **`plan`**            | Planning only — explore and write a plan, change nothing               |
| **`review`**          | Reviewing code for correctness, design, tests, and impact              |
| **`debug`**           | Tracking down a root cause before suggesting any fix                   |
| **`ask`**             | Read-only — read, grep, and find files only, no writes or shell        |
| **`brainstorm`**      | Design only — explore ideas and present them, write no code            |
| **`frontend-design`** | Distinctive, production-quality interface design                       |
| **`review-security`** | Hunting for exploitable vulnerabilities                                |
| **`simplify`**        | Making code clearer without changing what it does                      |
| **`write-prompt`**    | Writing and improving agent prompts                                    |
| **`refactor`**        | Restructuring for design and maintainability, behaviour unchanged      |
| **`autoconfig`**      | Setup mode — reads docs, edits config and prompts, writes no code      |
| **`orchestrator`**    | Heavy work — direct tool use plus parallel subprocesses                |
| **`write-text`**      | Technical writing — clear, unambiguous text in Simplified Technical English |

Your own prompts are Markdown files placed in
`$XDG_CONFIG_HOME/tiny-crow/prompts/`, referenced by file name.

The agent also loads `AGENTS.md` or `CLAUDE.md` from the project root
or any ancestor directory, and — when enabled — `ARCHITECTURE.md` the
same way, so project conventions and design context land in the system
prompt automatically. Pass `-n` / `--no-context-files` to turn all
context-file loading off.

### Chaining prompts

When `brainstorm`, `plan`, or `code` finishes, Tiny Crow can offer to
move on (`brainstorm` → `plan` → `code` → `/review`), prompting
`Continue to plan? [Y/N/B]` at each step: `Y` moves on, `N` stays, and
`B` ("but …") moves on with an extra instruction attached. Every
transition can be switched on or off separately in config.

## Permissions

Six modes:

| Mode | CLI flag | Behaviour |
|------|----------|-----------|
| **restrictive** | `-R` / `--restrictive` | Ask about every operation. Config rules are ignored by default (enable them via `permission-modes`). |
| **readonly** | `--read-only` | Reads, greps, file search, and directory listings only. Writes, edits, shell, and everything else are denied. Config rules ignored by default. |
| **planwrite** | | Like readonly, except writing `PLAN*.md` files is allowed. |
| **guarded** | `--guarded` | Reads allowed. Writes, edits, shell, and everything else ask first. Config rules apply. |
| **standard** | (default) | Path tools (read/write/edit/list_dir) allowed inside the working directory and below it. Safe shell commands (ls, cat, git log) are auto-allowed. Outside paths and unrecognised commands ask first. Config rules apply and override the mode defaults. |
| **yolo** | `--yolo` | Everything allowed, except destructive shell commands (rm, dd, mkfs, and similar) still prompt. Config rules apply. |

`--dangerously-skip-permissions` bypasses every check entirely. It is
not a mode and cannot be toggled while running.

In the config file, permissions can be set per tool with glob patterns —
for instance, auto-allowing `write **.ts` while asking before any other
write.

Approvals you give are remembered for the rest of the session (the
session allowlist), so the same operation is not re-asked endlessly.

**Doom-loop detection**: the identical tool call five times in a row
triggers a coaching message (for allowed calls) or a prompt/denial
depending on config, stopping a runaway agent from repeating itself.

## Slash commands

The ones you will reach for most:

- `/model` — Switch model
- `/thinking` — Set thinking level
- `/clear` — Clear conversation
- `/session` — List/save/load sessions
- `/loop` — Schedule recurring prompts
- `/prompt` — List or change the agent's prompt
- `/mode` — Set the permission mode
- `/queue` — Manage input queued while the agent is busy
- `/btw` — Ask a quick side question in parallel without interrupting the agent
- `/review` — Run a one-shot code review in readonly mode, then restore the previous prompt
- `/hooks` — Show whether a hook dispatcher is installed and what it is configured for
- `/advisor` — Show or change advisor status (enabled, mode, model, max uses)

`/help` lists everything.

## Typing while the agent works

Keep typing while a run is in progress. Plain text is not sent
immediately and never starts a second run alongside the first; it is
queued and replayed as the next prompt when the current run ends. Each
queued line appears as `queued: <text>`.

`/queue` manages the queue, and works even mid-run:

- `/queue ls` lists pending inputs (bare `/queue` does the same)
- `/queue clear` empties the queue
- `/queue pop` drops the last queued input, for undoing a mistyped line

Inputs starting with `/`, `.`, or `!` are commands, not queueable text:
wait for the run to finish, or press Ctrl-C. Ctrl-C cancels the running
agent for real — child processes included — and clears the queue.

## Side questions (`/btw`)

`/btw <message>` asks a quick "by the way" question alongside the main
agent, without interrupting it. It forks the current context and answers
with four read-only tools (`read`, `grep`, `find_files`, `list_dir`); it
cannot write files or run commands. The answer is printed inline, nothing
is added to conversation history, and its token usage is tracked
separately in the status bar as `btw:…`.

To point a question at a file, use `@`: pick `/btw` from the command
menu, then type `@` to open the file picker (for example `/btw` then
`@src/main.ts` then "how does this work?"), and `/btw` reads the file
you referenced.

## Sessions

Sessions live in `$XDG_DATA_HOME/tiny-crow/sessions/` (override with
`TC_DATA_DIR`). Resume the most recent with `-c`, browse and pick one
with `-r`, or load a specific session with `--session <id>`.

## npm scripts

| Script | Purpose |
|---|---|
| `npm start` | Run the agent |
| `npm run dev` | Run with restart on file changes |
| `npm run typecheck` | Strict typecheck, no emit |
| `npm run lint` | Lint via the typechecker |
| `npm run check` | Alias for typecheck |
| `npm test` | Run the `node:test` suite in `tests/` |
| `npm run sync-version` | Report the version from `package.json` (single source of truth) |
| `npm run install-hook` | Install the pre-commit hook |
| `npm run remove-hook` | Remove the pre-commit hook |

There is no separate build system here. Release-only recipes from the
old setup (tagging, checksum updates for distro packages, publishing)
have no npm equivalent and were deliberately not carried over.

## License

GPL-3.0 — see [LICENSE](LICENSE).
