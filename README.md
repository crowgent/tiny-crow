![Tiny Crow](assets/crow.png)

# Tiny Crow

> A terminal coding agent in TypeScript — no build step, no runtime
> dependencies, and the sources run directly under Node.js 24 or newer.

**Version:** 1.8.5 · **License:** GPL-3.0 · **Runtime:** Node.js 24+

[Quick start](#quick-start) · [Providers](#providers) · [Prompts](#prompts) ·
[Permission modes](#permission-modes) · [Commands](#commands) ·
[Documentation](#documentation) · [License](#license)

---

## Quick start

```bash
git clone https://github.com/crowgent/tiny-crow.git
cd tiny-crow
npm install   # dev tooling only; the agent itself needs no runtime packages
```

To invoke it by name, link the entry point into a directory already on
your path:

```bash
ln -s "$PWD/src/main.ts" ~/.local/bin/tiny-crow
export PATH="$HOME/.local/bin:$PATH"
```

Then launch it:

```bash
export OPENROUTER_API_KEY=<your key>   # OpenRouter is the default provider

npm start                                        # interactive session, code prompt
npm start -- --no-color                           # monochrome interface
npm start -- -p "Summarise this codebase"         # single answer, then exit
npm start -- -c                                   # pick up the latest session
npm start -- --provider openrouter --model anthropic/claude-sonnet-4-6
```

> **Note:** For day-to-day development, `npm run dev` relaunches the
> entry point each time a source file changes.
>
> **Note:** Windows has not been tried at all, so behaviour there is
> unknown.

---

## What it can do

- **A wide choice of models** — seven built-in backends, plus providers
  of your own definition, all behind one layer.
- **The standard agent toolkit** — file reading, writing and editing,
  searching, shell execution, and task tracking.
- **Durable sessions** — save, reopen and resume work, with automatic
  compaction keeping long conversations within the context window.
- **A full terminal interface** — Markdown rendering, mouse selection
  and copy, scrollback, and a switch for displaying model reasoning.
- **MCP support** — external tools connected over stdio or HTTP.
- **Web tools** — WebFetch and WebSearch built in.
- **Plain-text memory** — a global MEMORY.md, per-project daily logs, a
  scratchpad and notes, all folded into the session's system prompt.
- **Lifecycle hooks** — outside commands that can observe or gate tool
  calls, prompts and session events.
- **An advisor** — a second model consulted for strategic advice during
  a session, with the option of routing the question to you instead.
- **Multimodal input** — images and PDFs attached to messages.
- **Subagents** — quick parallel helpers for exploring a codebase.
- **Repeatable loops** — run a prompt again and again until a goal is
  reached, for work that takes a while.
- **Worktree hopping** — move between git worktrees with `/worktree`.
- **ACP server mode** — editors can drive Tiny Crow through the Agent
  Communication Protocol.
- **Status signals** — run-state events (started, stopped, git
  conflict, waiting on a permission) over a Unix socket, for status
  bars and other tooling.
- **Prompt chaining** — when one phase ends, be offered the next:
  brainstorm, then plan, then code, then review, each link switchable
  in config.

---

## Providers

| Backend | Name in config | Key variable by default |
| --- | --- | --- |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` |
| OpenAI | `openai` | `OPENAI_API_KEY` |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` |
| Gemini | `gemini` / `google` | `GEMINI_API_KEY` |
| Ollama | `ollama` | No key required |
| OpenCode Zen | `opencode-zen` | `OPENCODE_API_KEY` (optional — without a key only the free models work) |
| OpenCode Go | `opencode-go` | `OPENCODE_API_KEY` |

A provider can be picked three ways — a line in the config file, a
command-line flag, or an environment variable:

```bash
tiny-crow --provider anthropic
tiny-crow --provider openai --model gpt-4o
```

> `TC_PROVIDER` is the environment-variable equivalent of `--provider`,
> and `TC_MODEL` is the equivalent of `--model`.

Anything else that speaks the OpenAI wire format — a vLLM server, a
LiteLLM proxy, a local model, an enterprise gateway — can be added as
a custom provider under the `custom_providers` key in the config file:

```json
{
  "custom_providers": {
    "local-llm": {
      "provider_type": "openai",
      "base_url": "http://localhost:9000/v1",
      "api_key_env": "LOCAL_LLM_API_KEY",
      "model": "mistral-small"
    }
  }
}
```

Full provider details, including key lookup, transports, and prompt
caching, are in [docs/PROVIDERS.md](docs/PROVIDERS.md).

---

## Prompts

Use `/prompt` to list the built-in prompts or switch between them.
Each prompt changes the agent's posture for the job at hand.

| Prompt | What it does |
| --- | --- |
| `code` (default) | Coding, with full file and shell access and a test-first workflow |
| `plan` | Planning only: explore and write a plan, change nothing |
| `review` | Reviewing code for correctness, design, tests, and impact |
| `debug` | Tracking down a root cause before suggesting any fix |
| `ask` | Read-only: read, grep, and find files only, no writes or shell |
| `brainstorm` | Design only: explore ideas and present them, write no code |
| `frontend-design` | Distinctive, production-quality interface design |
| `review-security` | Hunting for exploitable vulnerabilities |
| `simplify` | Making code clearer without changing what it does |
| `write-prompt` | Writing and improving agent prompts |
| `refactor` | Restructuring for design and maintainability, behaviour unchanged |
| `autoconfig` | Setup mode: reads docs, edits config and prompts, writes no code |
| `orchestrator` | Heavy work: direct tool use plus parallel subprocesses |
| `write-text` | Technical writing: clear, unambiguous text in Simplified Technical English |
| `default` | Assesses the task and applies the workflow that fits it best |
| `work` | Autonomous office work across mail, drive, chat, docs, and media tools |

Prompts of your own are Markdown files in
`$XDG_CONFIG_HOME/tiny-crow/prompts/`, picked up by file name.

The agent also reads `AGENTS.md` or `CLAUDE.md` from the project root
or any parent directory, and — when switched on — `ARCHITECTURE.md`
the same way, so project conventions and design context reach the
system prompt on their own. Pass `-n` / `--no-context-files` to stop
all context-file loading.

### Moving from one phase to the next

When `brainstorm`, `plan`, or `code` ends, Tiny Crow can offer the
next step (`brainstorm` → `plan` → `code` → `/review`), asking
`Continue to plan? [Y/N/B]` at each step: `Y` moves on, `N` stays put,
and `B` ("but …") moves on with an extra instruction attached. Each
transition can be turned on or off on its own in config.

---

## Permission modes

| Mode | Flag | Behaviour |
| --- | --- | --- |
| `restrictive` | `-R` / `--restrictive` | Every operation is asked about. Config rules are ignored unless you enable them via `permission-modes` |
| `readonly` | `--read-only` | Only reads, greps, file search, and directory listings. Writes, edits, shell, and everything else are refused |
| `planwrite` | — | As readonly, except writing `PLAN*.md` files is permitted |
| `guarded` | `--guarded` | Reads go through. Writes, edits, shell, and everything else ask first. Config rules apply |
| `standard` (default) | — | Path tools are allowed inside the working directory and below it. Safe shell commands (ls, cat, git log) are auto-allowed. Paths outside and unrecognised commands ask first. Config rules apply and override the mode defaults |
| `yolo` | `--yolo` | Everything is allowed, except destructive shell commands (rm, dd, mkfs, and similar) still prompt. Config rules apply |

> **Warning:** `--dangerously-skip-permissions` skips every check
> outright. It is not a mode, and it cannot be switched while running.

In the config file, permissions can be set per tool with glob patterns —
for example, auto-allowing `write **.ts` while asking before any other
write. Approvals you give are remembered for the rest of the session
(the session allowlist), so the same operation is not asked about over
and over.

> **Doom-loop detection:** the identical tool call five times in a row
> triggers a coaching message (for allowed calls) or a prompt/denial
> depending on config, stopping a runaway agent from repeating itself.

---

## Commands

| Command | What it does |
| --- | --- |
| `/model` | Pick a different model |
| `/thinking` | Adjust the thinking level |
| `/clear` | Wipe the conversation |
| `/session` | List, save, or load sessions |
| `/loop` | Schedule recurring prompts |
| `/prompt` | List prompts or switch the agent's prompt |
| `/mode` | Pick the permission mode |
| `/queue` | See or manage input held while the agent is busy |
| `/btw` | Put a quick side question in parallel, without interrupting the agent |
| `/review` | Run a one-shot code review in readonly mode, then return to the previous prompt |
| `/hooks` | Show whether a hook dispatcher is installed and what it is configured for |
| `/advisor` | Show or change advisor status (enabled, mode, model, max uses) |

`/help` lists everything.

<details>
<summary>Typing while the agent is busy</summary>

You can keep typing during a run. Plain text is not sent straight away
and never starts a second run next to the first; it is held and played
back as the next prompt once the current run finishes. Each held line
shows as `queued: <text>`.

`/queue` manages the held input, and works even mid-run:

```bash
/queue ls      # lists pending inputs (bare /queue does the same)
/queue clear   # clears all held input
/queue pop     # drops the last queued input, for undoing a mistyped line
```

Inputs beginning with `/`, `.`, or `!` are commands rather than
queueable text: wait for the run to end, or press Ctrl-C. Ctrl-C
cancels the running agent for real — child processes included — and
clears the queue.
</details>

<details>
<summary>Side questions with /btw</summary>

`/btw <message>` puts a quick "by the way" question to a side agent
while the main one carries on undisturbed. It forks the current
context and answers using four read-only tools (`read`, `grep`,
`find_files`, `list_dir`); it cannot write files or run commands. The
answer prints inline, nothing is added to conversation history, and
its token usage is tracked separately in the status bar as `btw:…`.

To aim a question at a file, use `@`: pick `/btw` from the command
menu, then type `@` to open the file picker (for example `/btw` then
`@src/agent/runner.ts` then "how does this work?"), and `/btw` reads
the file you pointed at.
</details>

<details>
<summary>Sessions on disk</summary>

Sessions live in `$XDG_DATA_HOME/tiny-crow/sessions/` (override with
`TC_DATA_DIR`). Resume the most recent with `-c`, browse and pick one
with `-r`, or load a specific session with `--session <id>`.
</details>

---

## npm scripts

| Script | What it does |
| --- | --- |
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

---

## Customising it

Everything about configuration — where the config file lives, which
keys it takes, provider aliases, permission rules, MCP server setup —
is covered in `docs/CONFIG.md`.

There is also a shortcut: inside a session, `/prompt autoconfig`
hands setup to a specialised agent that reads the documentation and
adjusts your configuration for you.

---

## Documentation

| Document | Covers |
| --- | --- |
| [docs/GET_STARTED.md](docs/GET_STARTED.md) | Install, connect a model, first session |
| [docs/CONFIG.md](docs/CONFIG.md) | Every configuration key, type, and default |
| [docs/COMMANDS.md](docs/COMMANDS.md) | Every slash command |
| [docs/PROVIDERS.md](docs/PROVIDERS.md) | Providers, custom endpoints, key lookup, caching |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the agent is put together |
| [docs/MEMORY.md](docs/MEMORY.md) | Memory, notes, and scratchpad |
| [docs/SUBAGENTS.md](docs/SUBAGENTS.md) | Subagents and parallel work |
| [docs/HASHEDIT.md](docs/HASHEDIT.md) | The hashedit edit system |
| [docs/STATUS_SIGNALS.md](docs/STATUS_SIGNALS.md) | Status-bar and socket signals |
| [docs/PUBLISHING_RELEASES.md](docs/PUBLISHING_RELEASES.md) | Publishing and releases |
| [SECURITY.md](SECURITY.md) | Security policy |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Community code of conduct |
| [AGENTS.md](AGENTS.md) | Working in this repository |

---

## License

GPL-3.0 — the full text is in [LICENSE](LICENSE).
