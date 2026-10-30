# zerostack-ts

Minimal coding agent TUI, ported to TypeScript on Node.js.

## Features

- **Multi-provider**: OpenRouter, OpenAI, Anthropic, Gemini, Ollama, plus custom providers
- **Standard tools**: all of the standard tools exposed to coding agents
- **Permission system**: configurable modes with per-tool patterns, session allowlists, and configurable mode-to-rule application policies
- **Session management**: save/load/resume sessions, auto-compaction to stay within context windows
- **Terminal UI**: markdown rendering, mouse selection/copy, scrollback, reasoning visibility toggle
- **Prompts system**: switch between system prompt modes at runtime (`code`, `plan`, `review`, `debug`, etc.) to tailor the agent's behavior to the task
- **MCP support**: connect MCP servers for extended tooling
- **Integrated web search**: allows for WebFetch and WebSearch tools
- **Integrated loop system**: looping capabilities for long-horizon tasks
- **Integrated Git Worktrees integration**: use `/worktree` to move the agent from one worktree to another
- **ACP support**: Agent Communication Protocol server — lets editors connect to zerostack-ts as an ACP agent
- **Persistent memory**: plain-Markdown memory across sessions: a global MEMORY.md plus per-project daily logs, scratchpad, and notes, injected into the system prompt each session
- **Lifecycle hooks**: observe or gate tool calls, prompts, and session lifecycle events via external commands
- **Advisor**: a second model the agent can consult mid-session for strategic guidance, with an optional human-handoff mode
- **Multimodal input**: attach images and PDFs to messages
- **Subagents**: parallel and fast, used for exploring the codebase
- **ARCHITECTURE.md**: a companion file for AGENTS.md, offering shared core knowledge for all agents working on the same codebase
- **Prompt chaining**: offers to advance brainstorm → plan → code → review as each phase finishes, config-gated per transition
- **Status signals**: emits run-state events (start, stop, git-conflict, permission waits) over a Unix socket for external status bars or tooling

**NOTE**: Windows support is not tested in any way.

## Installation

Requires Node.js >= 24. No build step: the sources run directly with Node's TypeScript support.

```bash
git clone <this repository>
cd zerostack-ts
npm install   # no runtime dependencies; installs dev tooling only
```

To put a `zerostack-ts` command on your PATH, link the entry point:

```bash
ln -s "$PWD/src/main.ts" ~/.local/bin/zerostack-ts
```

Make sure `~/.local/bin` is on your PATH:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Quick start

```bash
# Set your API key (OpenRouter is default)
export OPENROUTER_API_KEY=<your key>

# Interactive session (default prompt: code)
npm start

# Monochrome TUI
npm start -- --no-color

# One-shot mode
npm start -- -p "Explain this project"

# Continue last session
npm start -- -c

# Explicit provider/model
npm start -- --provider openrouter --model deepseek/deepseek-v4-flash
```

During development, `npm run dev` restarts the entry point on file changes.

## Configuration

See `docs/CONFIG.md` for config file location, accepted keys, provider
aliases, permission rules, and MCP server configuration.

You can run `/prompt autoconfig` in order to use a specialized agent that allows to navigate the documentation and customize your setup.

## Prompts system

zerostack-ts includes a set of built-in system prompts that change the agent's behavior and tone.
You can switch between different prompts or list all registered prompts using `/prompt`.

Built-in prompts:

| Prompt                | Description                                                              |
| --------------------- | ------------------------------------------------------------------------ |
| **`code`** (default)  | Coding mode with full file and bash tool access, TDD workflow            |
| **`plan`**            | Planning-only mode — explores and produces a plan without writing code   |
| **`review`**          | Code review mode — reviews for correctness, design, testing, and impact  |
| **`debug`**           | Debug mode — finds root cause before proposing fixes                     |
| **`ask`**             | Read-only mode — only read/grep/find_files permitted, no writes or bash        |
| **`brainstorm`**      | Design-only mode — explores ideas and presents designs without code      |
| **`frontend-design`** | Frontend design mode — distinctive, production-grade UI                  |
| **`review-security`** | Security review mode — finds exploitable vulnerabilities                 |
| **`simplify`**        | Code simplification mode — refines for clarity without changing behavior |
| **`write-prompt`**    | Prompt writing mode — creates and optimizes agent prompts                |
| **`refactor`**        | Refactoring mode — restructures code for design and maintainability while preserving behavior |
| **`autoconfig`**      | Configuration mode — reads docs and edits your config/prompts, writes no code |
| **`orchestrator`**    | Orchestration mode — combines direct tool use with parallel subprocess invocations for heavier work |
| **`write-text`**      | Technical-writing mode — drafts and reviews unambiguous text in Simplified Technical English |

You can also create custom prompts by placing markdown files in
`$XDG_CONFIG_HOME/zerostack/prompts/` and referencing them by name.

Additionally, the agent automatically loads `AGENTS.md` or `CLAUDE.md` from the
project root or any ancestor directory, injecting their contents into the
system prompt. When enabled, `ARCHITECTURE.md` is also loaded
the same way, providing high-level design context to speed up exploration.
Use `-n` / `--no-context-files` to disable all context file loading.

### Prompt chaining

When `brainstorm`, `plan`, or `code` finishes, zerostack-ts can offer to advance
to the next phase (`brainstorm` → `plan` → `code` → `/review`), asking
`Continue to plan? [Y/N/B]`-style at each step: `Y` advances, `N` stays put,
and `B` ("but ...") advances with an extra instruction appended. Each
transition is enabled independently in config.

## Permission system

zerostack-ts has six permission modes:

| Mode | CLI flag | Behavior |
|------|----------|----------|
| **restrictive** | `-R` / `--restrictive` | Ask for every operation. Config rules are ignored by default (can be enabled via `permission-modes`). |
| **readonly** | `--read-only` | Allow read/grep/find_files/list_dir. Deny writes, edits, bash, and everything else. Config rules ignored by default. |
| **planwrite** | | Like readonly, plus allow writing `PLAN*.md` files. |
| **guarded** | `--guarded` | Allow read tools. Ask for writes, edits, bash, and everything else. Config rules apply. |
| **standard** | (default) | Allow path tools (read/write/edit/list_dir) within the working directory and subdirectories. Safe bash commands (ls, cat, git log) auto-allowed. Ask for external paths and unrecognized commands. Config rules apply and override mode defaults. |
| **yolo** | `--yolo` | Allow everything, but prompt for destructive bash commands (rm, dd, mkfs, etc.). Config rules apply. |

The `--dangerously-skip-permissions` flag completely bypasses all permission
checks, allowing every tool operation without any guard. This is not a mode
and cannot be toggled at runtime.

Permissions can be configured per-tool with granular glob patterns in the
config file. For example, you can allow `write **.rs` automatically while
always asking before writing to other files.

A **session allowlist** persists approved decisions for the duration of the
session, so you don't have to repeatedly confirm the same operation.

**Doom-loop detection**: the same identical tool call repeated 5 times in a
row triggers a coaching message (for allowed calls) or a prompt/denial
depending on your config, preventing runaway agents from spamming operations.

## Slash commands

The most important slash commands:

- `/model` — Switch model
- `/thinking` — Set thinking level
- `/clear` — Clear conversation
- `/session` — List/save/load sessions
- `/loop` — Schedule recurring prompts
- `/prompt` — List or change the agent's prompt
- `/mode` — Set the permission system's mode
- `/queue` — Manage input queued while the agent is busy
- `/btw` — Ask a quick side question in parallel without interrupting the agent
- `/review` — Run a one-shot code review in readonly mode, then restore the previous prompt
- `/hooks` — Show whether a hook dispatcher is installed and what it's configured for
- `/advisor` — Show or change advisor status (enabled, mode, model, max uses)

To see all of the commands, use `/help`.

## Input queue

You can keep typing while the agent is running. Plain text is not sent right
away and never starts a second concurrent run; it is queued and replayed as the
next prompt once the current run finishes. Each queued line is shown as
`queued: <text>`.

Manage the queue with `/queue`, which works even while a run is active:

- `/queue ls` lists the pending inputs (bare `/queue` does the same)
- `/queue clear` empties the queue
- `/queue pop` removes the last queued input, to undo a mis-typed line

Commands (input starting with `/`, `.`, or `!`) are not queued while a run is
active: wait for it to finish, or press Ctrl-C. Ctrl-C cancels the running agent
for real, including any child processes it spawned, and clears the queue.

## Side questions (`/btw`)

`/btw <message>` asks a quick "by the way" question in parallel with the main
agent, without interrupting it. It forks the current context and answers using
four read-only tools (`read`, `grep`, `find_files`, `list_dir`); it cannot write
files or run commands. It then prints the reply inline.
Nothing is written to conversation history, and its token usage is tracked
separately in the status bar as `btw:…`.

You can point a question at a specific file with `@`: pick `/btw` from the
command menu, then type `@` to open the file picker (for example `/btw` then
`@src/main.ts` then "how does this work?"), and `/btw` reads the file you
reference.

## Session management

Sessions are saved to `$XDG_DATA_HOME/zerostack/sessions/` (override with
`ZS_DATA_DIR`). Use `-c` to resume the most recent session, `-r` to browse and
select one, or `--session <id>` to load a specific session.

## Scripts

| npm script | Replaces | Purpose |
|---|---|---|
| `npm start` | `just run` | Run the agent |
| `npm run dev` | dev loop | Run with restart on file changes |
| `npm run typecheck` | `just check` | Strict typecheck, no emit |
| `npm run lint` | `just check` | Lint via the typechecker |
| `npm run check` | `just check` | Alias for typecheck |
| `npm test` | `just test` | Run the `node:test` suite in `tests/` |
| `npm run sync-version` | `just sync-version` | Report the version from `package.json` (single source of truth) |
| `npm run install-hook` | `just install-hook` | Install the pre-commit hook |
| `npm run remove-hook` | `just remove-hook` | Remove the pre-commit hook |

There is no Rust, Cargo, or Nix build system in this port. The release-only
justfile recipes (tagging, checksum updates for distro packages, publishing)
have no npm equivalent here and are intentionally not carried over.

## License

GPL-3.0 — see [LICENSE](LICENSE).
