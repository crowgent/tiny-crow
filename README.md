![Tiny Crow](assets/crow.png)

# Tiny Crow

A TypeScript terminal coding agent that runs directly from source on Node.js 24 or later. It has no build step and no runtime dependencies.

**Version:** 1.8.5 · **License:** GPL-3.0 · **Runtime:** Node.js 24+

[Quick start](#quick-start) · [Supported features](#supported-features) · [Providers](#providers) · [Prompts](#prompts) · [Permission modes](#permission-modes) · [Commands](#commands) · [Documentation](#documentation) · [License](#license)

---

## Quick start

### Install with the installer

Requires Node.js 24+ and `curl`. The installer places a `tiny-crow` launcher in `~/.local/bin` and keeps the sources in `~/.local/share/tiny-crow`:

```bash
curl -fsSL https://raw.githubusercontent.com/crowgent/tiny-crow/main/install.sh | bash
```

### Install from a clone

```bash
git clone https://github.com/crowgent/tiny-crow.git
cd tiny-crow
npm install   # development tooling only; the agent needs no runtime packages
```

To invoke the source entry point by name, link it into a directory on your `PATH`:

```bash
ln -s "$PWD/src/main.ts" ~/.local/bin/tiny-crow
export PATH="$HOME/.local/bin:$PATH"
```

### Start a session

OpenRouter is the default provider. Set its API key, then start the interactive agent:

```bash
export OPENROUTER_API_KEY=<your key>
npm start
```

Other useful invocations:

```bash
npm start -- --no-color
npm start -- -p "Summarise this codebase"
npm start -- -c
npm start -- --provider openrouter --model anthropic/claude-sonnet-4-6
```

These run a monochrome interface, request a single answer and exit, continue the latest session, and select a provider/model respectively. For development, `npm run dev` relaunches the entry point whenever a source file changes.

**Platform note:** Windows has not been tried; behaviour there is unknown.

---

## Supported features

- **Multiple model backends:** seven built-in backends, plus custom providers, behind one provider layer.
- **Agent tools:** file reading, writing and editing, search, shell execution, and task tracking.
- **Persistent sessions:** save, reopen, and resume sessions; automatic compaction keeps long conversations within the context window.
- **Terminal interface:** Markdown rendering, mouse selection and copy, scrollback, and a switch for displaying model reasoning.
- **MCP and web tools:** connect external tools over stdio or HTTP; WebFetch and WebSearch are built in.
- **Plain-text memory:** a global `MEMORY.md`, per-project daily logs, a scratchpad, and notes are included in the session system prompt.
- **Lifecycle hooks:** external commands can observe or gate tool calls, prompts, and session events.
- **Advisor:** consult a second model for strategic advice during a session, or route the question to you instead.
- **Multimodal input:** attach images and PDFs to messages.
- **Subagents:** use quick parallel helpers to explore a codebase.
- **Repeatable loops:** repeat a prompt until a goal is reached.
- **Git worktrees:** move between worktrees with `/worktree`.
- **ACP server mode:** editors can drive Tiny Crow through the Agent Communication Protocol.
- **Status signals:** emit run-state events (started, stopped, git conflict, or waiting on permission) over a Unix socket for status bars and other tooling.
- **Prompt chaining:** configure transitions between phases such as brainstorm, plan, code, and review.

---

## Providers

| Backend | Name in config | Default key variable |
| --- | --- | --- |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` |
| OpenAI | `openai` | `OPENAI_API_KEY` |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` |
| Gemini | `gemini` / `google` | `GEMINI_API_KEY` |
| Ollama | `ollama` | No key required |
| OpenCode Zen | `opencode-zen` | `OPENCODE_API_KEY` (optional; without a key, only free models work) |
| OpenCode Go | `opencode-go` | `OPENCODE_API_KEY` |

Choose a provider in the config file, with a command-line flag, or through an environment variable:

```bash
tiny-crow --provider anthropic
tiny-crow --provider openai --model gpt-4o
```

`TC_PROVIDER` is the environment-variable equivalent of `--provider`, and `TC_MODEL` is the equivalent of `--model`.

Any service that speaks the OpenAI wire format—including a vLLM server, LiteLLM proxy, local model, or enterprise gateway—can be configured under `custom_providers`:

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

See [docs/PROVIDERS.md](docs/PROVIDERS.md) for provider details, key lookup, transports, and prompt caching.

---

## Prompts

Use `/prompt` to list or switch between built-in prompts. Each prompt sets the agent's posture for a task.

| Prompt | Purpose |
| --- | --- |
| `code` (default) | Coding with full file and shell access and a test-first workflow |
| `plan` | Explore and write a plan without changing anything |
| `review` | Review code for correctness, design, tests, and impact |
| `debug` | Find a root cause before suggesting a fix |
| `ask` | Read-only access: read, grep, and find files; no writes or shell |
| `brainstorm` | Explore and present ideas without writing code |
| `frontend-design` | Design distinctive, production-quality interfaces |
| `review-security` | Hunt for exploitable vulnerabilities |
| `simplify` | Clarify code without changing behaviour |
| `write-prompt` | Write and improve agent prompts |
| `refactor` | Restructure for design and maintainability without changing behaviour |
| `autoconfig` | Read docs and adjust config and prompts without writing code |
| `orchestrator` | Handle heavy work with direct tool use and parallel subprocesses |
| `write-text` | Produce clear, unambiguous technical writing in Simplified Technical English |
| `default` | Assess the task and apply a suitable workflow |
| `work` | Autonomous office work across mail, drive, chat, docs, and media tools |

Custom prompts are Markdown files in `$XDG_CONFIG_HOME/tiny-crow/prompts/`, discovered by filename.

The agent reads `AGENTS.md` or `CLAUDE.md` from the project root or any parent directory. When enabled, it also reads `ARCHITECTURE.md` from those locations, adding project conventions and design context to the system prompt. Use `-n` / `--no-context-files` to disable context-file loading.

### Prompt phase transitions

When `brainstorm`, `plan`, or `code` ends, Tiny Crow can offer the next phase (`brainstorm` → `plan` → `code` → `/review`) and ask `Continue to plan? [Y/N/B]`. `Y` continues, `N` stays in the current phase, and `B` (“but …”) continues with an additional instruction. Each transition can be enabled or disabled independently in config.

---

## Permission modes

| Mode | Flag | Behaviour |
| --- | --- | --- |
| `restrictive` | `-R` / `--restrictive` | Ask about every operation. Config rules are ignored unless enabled through `permission-modes`. |
| `readonly` | `--read-only` | Permit only reads, greps, file search, and directory listings. Refuse writes, edits, shell, and all other operations. |
| `planwrite` | — | Like readonly, but writing `PLAN*.md` files is permitted. |
| `guarded` | `--guarded` | Allow reads; ask before writes, edits, shell, and all other operations. Config rules apply. |
| `standard` (default) | — | Allow path tools in the working directory and below. Auto-allow safe shell commands (such as `ls`, `cat`, and `git log`); ask about paths outside it and unrecognised commands. Config rules apply and override mode defaults. |
| `yolo` | `--yolo` | Allow everything except destructive shell commands (such as `rm`, `dd`, and `mkfs`), which still prompt. Config rules apply. |

**Warning:** `--dangerously-skip-permissions` skips every check outright. It is not a mode and cannot be switched while running.

Config permissions can be set per tool using glob patterns—for example, auto-allowing `write **.ts` while asking before any other write. Approvals are remembered for the rest of the session (the session allowlist), so the same operation is not repeatedly prompted.

**Doom-loop detection:** Five identical tool calls in a row trigger a coaching message for allowed calls, or a prompt/denial depending on config, to stop a runaway agent from repeating itself.

---

## Commands

| Command | Purpose |
| --- | --- |
| `/model` | Choose a different model |
| `/thinking` | Adjust the thinking level |
| `/clear` | Clear the conversation |
| `/session` | List, save, or load sessions |
| `/loop` | Schedule recurring prompts |
| `/prompt` | List prompts or change the agent prompt |
| `/mode` | Choose a permission mode |
| `/queue` | View or manage input held while the agent is busy |
| `/btw` | Ask a quick side question in parallel without interrupting the agent |
| `/review` | Run a one-shot review in readonly mode, then return to the previous prompt |
| `/hooks` | Show whether a hook dispatcher is installed and its configuration |
| `/advisor` | Show or change advisor status (enabled, mode, model, and maximum uses) |

Run `/help` to list all commands.

<details>
<summary>Typing while the agent is busy</summary>

Text entered during a run is held rather than sent immediately or used to start a concurrent run. When the current run finishes, queued lines are replayed as the next prompt. Each line is shown as `queued: <text>`.

Use `/queue` to manage held input, including during a run:

```bash
/queue ls      # list pending inputs (bare /queue does the same)
/queue clear   # clear all held input
/queue pop     # drop the last queued input, undoing a mistyped line
```

Inputs beginning with `/`, `.`, or `!` are commands and cannot be queued as text. Wait for the run to finish or press Ctrl-C. Ctrl-C cancels the running agent, including child processes, and clears the queue.
</details>

<details>
<summary>Side questions with /btw</summary>

`/btw <message>` asks a side agent a quick question while the main agent continues. It forks the current context and uses four read-only tools (`read`, `grep`, `find_files`, `list_dir`); it cannot write files or run commands. The answer appears inline, is not added to conversation history, and its token usage is tracked separately in the status bar as `btw:…`.

To point the question at a file, choose `/btw` from the command menu and type `@` to open the file picker. For example, choose `/btw`, select `@src/agent/runner.ts`, then ask “how does this work?” The command reads the selected file.
</details>

<details>
<summary>Sessions on disk</summary>

Sessions are stored in `$XDG_DATA_HOME/tiny-crow/sessions/` (override with `TC_DATA_DIR`). Resume the latest with `-c`, browse and choose one with `-r`, or load a specific session with `--session <id>`.
</details>

---

## Development scripts

| Script | Purpose |
| --- | --- |
| `npm start` | Run the agent |
| `npm run dev` | Restart on source file changes |
| `npm run typecheck` | Strict typecheck with no output |
| `npm run lint` | Lint via the typechecker |
| `npm run check` | Alias for typecheck |
| `npm test` | Run the `node:test` suite in `tests/` |
| `npm run sync-version` | Report the version from `package.json` (the single source of truth) |
| `npm run install-hook` | Install the pre-commit hook |
| `npm run remove-hook` | Remove the pre-commit hook |

There is no separate build system. Release-only recipes from the old setup (tagging, checksum updates for distro packages, and publishing) have no npm equivalent and were deliberately not carried over.

---

## Configuration

See [docs/CONFIG.md](docs/CONFIG.md) for configuration file locations, supported keys, provider aliases, permission rules, and MCP server setup.

For guided setup, run `/prompt autoconfig` in a session. A specialised agent reads the documentation and adjusts your configuration.

---

## Documentation

| Document | Subject |
| --- | --- |
| [docs/GET_STARTED.md](docs/GET_STARTED.md) | Installation, model connection, and first session |
| [docs/CONFIG.md](docs/CONFIG.md) | Configuration keys, types, and defaults |
| [docs/COMMANDS.md](docs/COMMANDS.md) | Slash commands |
| [docs/PROVIDERS.md](docs/PROVIDERS.md) | Providers, custom endpoints, key lookup, and caching |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Agent design and structure |
| [docs/MEMORY.md](docs/MEMORY.md) | Memory, notes, and scratchpad |
| [docs/SUBAGENTS.md](docs/SUBAGENTS.md) | Subagents and parallel work |
| [docs/HASHEDIT.md](docs/HASHEDIT.md) | The hashedit edit system |
| [docs/STATUS_SIGNALS.md](docs/STATUS_SIGNALS.md) | Status-bar and socket signals |
| [docs/PUBLISHING_RELEASES.md](docs/PUBLISHING_RELEASES.md) | Publishing and releases |
| [SECURITY.md](SECURITY.md) | Security policy |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Community code of conduct |
| [AGENTS.md](AGENTS.md) | Repository contribution guidance |

---

## License

GPL-3.0. See the full text in [LICENSE](LICENSE).
