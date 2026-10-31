<h1 align="center">Tiny Crow</h1>

<p align="center">
  <img src="assets/crow.png" alt="Tiny Crow" width="300">
</p>

<p align="center">
  A focused coding agent in your terminal.<br>
  Explore a codebase, plan a change, edit files, run tools, and keep your work moving—with the model and permission mode you choose.
</p>

<p align="center">
  <a href="https://nodejs.org/"> <img src="https://img.shields.io/badge/Node.js-24%2B-43853d?style=flat-square&logo=node.js&logoColor=white" alt="Node.js 24 or later"></a>
  <img src="https://img.shields.io/badge/TypeScript-native%20runtime-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript native runtime">
  <img src="https://img.shields.io/badge/License-MIT-376f5b?style=flat-square" alt="MIT License">
  <img src="https://img.shields.io/badge/Build-no%20build%20step-555?style=flat-square" alt="No build step">
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#what-you-can-do">Features</a> ·
  <a href="#connect-a-model">Providers</a> ·
  <a href="#work-your-way">Prompts and permissions</a> ·
  <a href="#documentation">Documentation</a>
</p>

---

## At a glance

Tiny Crow is a TypeScript terminal coding agent that runs directly on Node.js 24 or later. It has no build step and no runtime dependencies. Use it interactively, give it a focused one-shot task, or resume a previous session.

| Project | Details |
| --- | --- |
| Current version | `1.8.5` |
| Runtime | Node.js `24+` |
| License | MIT |
| Interface | Terminal UI |
| Source | TypeScript, run directly by Node.js |

## Quick start

### 1. Install Tiny Crow

The command requires `curl` and an internet connection. On Debian/Ubuntu, the installer automatically installs Node.js 24+ if it is missing or too old; this step requires root or `sudo`. On other systems, install Node.js 24+ first. When run as root, the launcher goes to `/usr/local/bin`; regular-user installs use `~/.local/bin`. If the selected directory is missing from `PATH`, the installer adds it to the current user's `.profile` and `.bashrc` for future sessions. The source stays in `~/.local/share/tiny-crow`.

```bash
curl -fsSL https://raw.githubusercontent.com/crowgent/tiny-crow/main/install.sh | bash
```

Or clone the repository and install its development tools:

```bash
git clone https://github.com/crowgent/tiny-crow.git
cd tiny-crow
npm install
```

### 2. Set a model provider

OpenRouter is the default provider. Export its API key before starting Tiny Crow:

```bash
export OPENROUTER_API_KEY="your-api-key"
```

Use the provider’s own key variable if you choose a different provider. See [Providers](#connect-a-model).

### 3. Start a session

```bash
npm start
```

A few useful alternatives:

```bash
npm start -- -p "Summarise this codebase"  # Answer once, then exit
npm start -- -c                            # Continue the latest session
npm start -- --no-color                    # Use a monochrome interface
npm start -- --provider anthropic          # Select a provider
```

For day-to-day development, `npm run dev` restarts the entry point when source files change.

## What you can do

<table>
  <tr>
    <td width="50%"><strong>Work with code</strong><br>Read, search, write, and edit project files; run shell commands; track work with task tools.</td>
    <td width="50%"><strong>Choose your workflow</strong><br>Switch between coding, planning, debugging, review, security review, refactoring, and other built-in prompt modes.</td>
  </tr>
  <tr>
    <td><strong>Keep context across sessions</strong><br>Save, reopen, and resume sessions. Automatic compaction helps long conversations stay within the model context window.</td>
    <td><strong>Control permissions</strong><br>Choose a permission mode, configure per-tool rules, and review operations that need approval.</td>
  </tr>
  <tr>
    <td><strong>Extend the agent</strong><br>Connect MCP tools over stdio or HTTP, use built-in WebFetch and WebSearch tools, and configure lifecycle hooks.</td>
    <td><strong>Work in parallel</strong><br>Delegate codebase exploration to subagents, run repeatable loops, and move between Git worktrees.</td>
  </tr>
  <tr>
    <td><strong>Use project context</strong><br>Load `AGENTS.md`, `CLAUDE.md`, and—when enabled—`ARCHITECTURE.md` guidance from the project or parent directories.</td>
    <td><strong>Use rich terminal capabilities</strong><br>View rendered Markdown, scroll through output, use mouse selection and copy, and optionally display model reasoning.</td>
  </tr>
  <tr>
    <td><strong>Bring visual context</strong><br>Attach images and PDFs to messages.</td>
    <td><strong>Integrate with other tools</strong><br>Use ACP server mode in compatible editors and publish run-state signals over a Unix socket.</td>
  </tr>
</table>

## Connect a model

Tiny Crow includes seven provider backends. OpenRouter is the default; Ollama does not require an API key.

| Provider | Provider name | Default key variable |
| --- | --- | --- |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` |
| OpenAI | `openai` | `OPENAI_API_KEY` |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` |
| Gemini | `gemini` or `google` | `GEMINI_API_KEY` |
| Ollama | `ollama` | Not required |
| OpenCode Zen | `opencode-zen` | `OPENCODE_API_KEY` (optional; without it, only free models work) |
| OpenCode Go | `opencode-go` | `OPENCODE_API_KEY` |

Choose a provider and model with command-line flags:

```bash
tiny-crow --provider openai --model gpt-4o
```

`TC_PROVIDER` and `TC_MODEL` are the environment-variable equivalents of `--provider` and `--model`. Services that speak the OpenAI wire format can be added as custom providers in the configuration file. See the [provider guide](docs/PROVIDERS.md) for endpoints, key lookup, transports, and prompt caching.

## Work your way

### Prompt modes

Use `/prompt` to list or switch modes. Each mode gives the agent a different task posture.

| Mode | Designed for |
| --- | --- |
| `code` | Implementing changes with file and shell tools and a test-first workflow |
| `plan` | Exploring a task and writing a plan without changing code |
| `review` | Reviewing correctness, design, tests, and impact |
| `debug` | Finding a root cause before proposing a fix |
| `ask` | Read-only codebase questions |
| `brainstorm` | Exploring ideas without writing code |
| `frontend-design` | Designing distinctive interfaces |
| `review-security` | Looking for exploitable vulnerabilities |
| `simplify` | Clarifying code without changing behaviour |
| `refactor` | Improving structure without changing behaviour |
| `autoconfig` | Reading documentation and adjusting configuration or prompts |
| `orchestrator` | Coordinating larger tasks with parallel subprocesses |
| `write-prompt` | Creating or improving agent prompts |
| `write-text` | Writing clear technical text |
| `default` | Selecting a suitable workflow for the task |
| `work` | Handling office workflows across supported local and connected tools |

Custom prompts are Markdown files in `$XDG_CONFIG_HOME/tiny-crow/prompts/`, discovered by filename. Tiny Crow can also offer configurable transitions between `brainstorm`, `plan`, `code`, and `/review`.

### Permission modes

| Mode | Summary |
| --- | --- |
| `restrictive` | Ask about every operation. |
| `readonly` | Allow read-only tools; refuse writes, edits, shell, and other operations. |
| `planwrite` | Like `readonly`, but allow writing `PLAN*.md` files. |
| `guarded` | Allow reads and ask before other operations. |
| `standard` (default) | Allow path tools in the working directory; ask about outside paths and unrecognised shell commands. |
| `yolo` | Allow operations except destructive shell commands, which still prompt. |

Permission rules can further restrict or allow individual tools using glob patterns. `--dangerously-skip-permissions` bypasses every permission check; use it only when you understand the risk.

## Commands you will use

| Command | Action |
| --- | --- |
| `/help` | List available commands |
| `/model` | Choose a model |
| `/thinking` | Adjust reasoning level |
| `/prompt` | List or change prompt modes |
| `/mode` | Choose a permission mode |
| `/session` | List, save, or load sessions |
| `/loop` | Repeat a prompt on a schedule |
| `/queue` | View or manage input held while the agent is busy |
| `/btw` | Ask a read-only side question without interrupting the main agent |
| `/review` | Run a one-shot review in read-only mode |
| `/hooks` | Inspect hook dispatcher status and configuration |
| `/advisor` | Inspect or change advisor settings |
| `/clear` | Clear the conversation |

## Configure and extend

The configuration file controls providers, models, permissions, MCP servers, hooks, and other settings. Run `/prompt autoconfig` for guided setup, or open [docs/CONFIG.md](docs/CONFIG.md) for the complete reference.

Tiny Crow also supports plain-text memory, per-project context, external lifecycle hooks, custom providers, MCP servers, subagents, Git worktrees, advisor workflows, and status signals. Explore the [architecture guide](docs/ARCHITECTURE.md) to understand how the pieces fit together.

## Development

```bash
npm install
npm run typecheck
npm test
```

| Script | Purpose |
| --- | --- |
| `npm start` | Start the agent |
| `npm run dev` | Restart on source changes |
| `npm run typecheck` | Run TypeScript checks |
| `npm run lint` | Run the typechecker |
| `npm test` | Run the test suite |

Tiny Crow has no separate build step. The `npm run check` command is an alias for `npm run typecheck`.

## Documentation

| Guide | What it covers |
| --- | --- |
| [Getting started](docs/GET_STARTED.md) | Installation, provider setup, and your first session |
| [Configuration](docs/CONFIG.md) | Configuration locations, keys, and defaults |
| [Commands](docs/COMMANDS.md) | Slash commands and command-line options |
| [Providers](docs/PROVIDERS.md) | Built-in and custom providers |
| [Architecture](docs/ARCHITECTURE.md) | Agent design and repository structure |
| [Memory](docs/MEMORY.md) | Memory, notes, and scratchpad |
| [Subagents](docs/SUBAGENTS.md) | Delegation and parallel work |
| [Hashedit](docs/HASHEDIT.md) | The hashedit edit system |
| [Status signals](docs/STATUS_SIGNALS.md) | Unix socket events and integrations |
| [Releases](docs/PUBLISHING_RELEASES.md) | Publishing and release workflow |
| [Security policy](SECURITY.md) | Vulnerability reporting and security handling |
| [Code of conduct](CODE_OF_CONDUCT.md) | Community standards |
| [Repository guidance](AGENTS.md) | Contributor and coding-agent guidance |

## Compatibility

Tiny Crow requires Node.js 24 or later. Windows has not been tested; behaviour there is unknown.

## License

Tiny Crow is licensed under the [MIT License](LICENSE).

## TUI credit

The terminal UI in `src/pitui/` is based on and adapted from the TUI library
in [earendil-works/pi](https://github.com/earendil-works/pi/tree/main/packages/tui)
(`packages/tui`), used under its MIT License (Copyright (c) 2025 Mario Zechner).
The full license text is kept in [`src/pitui/LICENSE`](src/pitui/LICENSE), and
the original third-party notices inside that code are retained there.
