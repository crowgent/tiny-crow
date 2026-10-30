---
description: "Get started with tiny-crow: install the minimal TypeScript coding agent, configure an LLM provider, and run your first session."
---

# Getting Started with Tiny Crow

This guide takes you from a fresh checkout to a working session: install
the agent, connect a model, and learn the commands you will use every
day.

It is written for Linux, macOS, and WSL. On Windows, use WSL — native
Windows support is not currently maintained.

## Installing

There is no build step: Node.js 24 or newer runs the TypeScript sources
directly.

```bash
git clone <this repository>
cd tiny-crow
npm install   # no runtime dependencies; installs dev tooling only
```

Then either run it with `npm start`, or link the entry point onto your
PATH:

```bash
ln -s "$PWD/src/main.ts" ~/.local/bin/tiny-crow
export PATH="$HOME/.local/bin:$PATH"
```

## Connecting a provider

Tiny Crow defaults to **OpenRouter**, which gives access to hundreds of
models through one API key, without a separate signup per provider.
OpenRouter also offers free models, which is what this setup uses.

### Getting an OpenRouter key

1. Go to [openrouter.ai/keys](https://openrouter.ai/keys)
2. Create a key
3. Set it as an environment variable:

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
```

Add that line to `~/.bashrc` or `~/.zshrc` to make it permanent.

### Using a different provider

OpenRouter is only the default. Mainstream providers, local inference
engines, and any OpenAI-compatible server are all supported — just set
the matching environment variable:

| Provider   | Env var               |
| ---------- | --------------------- |
| OpenAI     | `OPENAI_API_KEY`      |
| Anthropic  | `ANTHROPIC_API_KEY`   |
| Gemini     | `GEMINI_API_KEY`      |
| Ollama     | (none — local)        |

Then change the default provider in your config file
(`~/.local/share/tiny-crow/config.toml` on Linux/WSL or
`~/Library/Application Support/tiny-crow/` on macOS, unless overridden
by `$TC_CONFIG_DIR` or an existing `~/.config/tiny-crow/` file — see
[CONFIG.md](CONFIG.md) for the full precedence) by setting
`provider = [provider_name]`.

To use a non-default provider for one run only, pass the flag:

```bash
tiny-crow --provider anthropic
```

See [Providers](PROVIDERS.md) for custom endpoints, header
configuration, and prompt caching details.

## Choosing a model

OpenRouter models use the `provider/model-name` format: the most-used
models are listed [here](https://openrouter.ai/models?order=top-weekly),
and free models sorted by usage
[here](https://openrouter.ai/models?order=top-weekly&max_price=0).

Switch models mid-session with the `/model` command, using the
provider's model name.

## Quick models: short names for provider + model pairs

Typing full model strings gets tedious, and it is easy to pair a model
with the wrong provider. Quick models fix both problems: one alias sets
the provider and the model together.

Add one in the configuration like this:

```
[quick_models.fast]
provider = "openrouter"
model = "deepseek/deepseek-v4-flash"
```

From there, set the `model` field in the configuration file to make it
the default, or use `/models` for an interactive picker inside the
agent.

## Your first session

You are ready. Run `tiny-crow`, look at the TUI, type a message, press
Enter, and the agent answers with streaming tokens.

It can read, write, edit, and search your codebase, while you keep full
control over what it is allowed to do.

## Everyday commands

Press `/` on an empty message to pick any command. The most useful:

| Command | What it does |
| ------- | ------------ |
| `/help` | List all commands |
| `/models <name>` | Switch model mid-session using Quick Models |
| `/clear` | Start with a fresh context |
| `/mode readonly` | Lock down to read-only |
| `/undo` | Undo the last exchange |
| `/redo` | Redo the last undo action |
| `/btw` | Ask a question to the agent without changing the context |
| `/review` | Ask the agent to review the last changes made |
| `/sessions` | List older sessions |
| `/rename <name>` | Rename the current session |
| `/quit` | Exit |

## Prompts: changing how the agent behaves

Type `.` at the start of a message to use a prompt: if text follows, the
prompt applies to that message only; if not, it becomes the default for
the rest of the session.

| Prompt | Use for |
| ------ | ------- |
| `code` | Writing and editing code (default) |
| `plan` | Designing before writing |
| `review` | Reviewing changes |
| `ask` | Q&A — no tools, just answers |
| `brainstorm` | Ideation, exploring options |
| `debug` | Systematic debugging |
| `refactor` | Restructuring existing code |

That is the short list. Run `/prompt` in the agent (or see the root
[README](../README.md)) for the full set of built-in prompts,
including `frontend-design`, `review-security`, `simplify`, `write-prompt`,
`autoconfig`, `orchestrator`, and `write-text`.

## Autoconfig: let the agent do the setup

There is one special prompt, `autoconfig`, that has full access to your
tiny-crow configuration and to the project's documentation. After
reading this guide, you may decide never to read documentation or a
configuration file again — just load `autoconfig` and everything will
be managed.

## Keybindings

| Keys | Action |
| ---- | ------ |
| `Ctrl+R` | Toggle reasoning/thinking |
| `Ctrl+G` | Open input in `$EDITOR` |
| `Ctrl+H` | Launches `lazygit` (disable with `--disable-lazygit`) |
| `Ctrl+S` | Force-save session |
| `Ctrl+C` | Interrupt the agent |
| `PgUp` / `PgDn` | Scroll chat |
| `Home` / `End` | Jump to top/bottom |

## CLI flags for scripts and one-off runs

| Flag | Action |
| ---- | ------ |
| `-p <msg>` | Sends a message |
| `-c` | Continues from last open session |
| `--name <name>` | Set a name for the new session |
| `--session <id-or-name>` | Load session by ID prefix or name |
| `--read-only` | Only reads files |
| `--yolo` | No limitations given to the agent |
| `--sandbox` | Run the agent inside a sandbox (Experimental) |
| `--sandbox-required` | Refuse bash commands when the sandbox backend is unavailable (implies `--sandbox`) |
| `--sandbox-expose <path>` | Restore read-only access to a masked credential path or subpath (repeatable) |
| `--sandbox-network[=true\|false]` | Whether sandboxed bash commands can reach the host network (default: `true`; bare flag or `=true` enables it, `=false` leaves each command only its own private loopback) |
| `--worktree` | Run the agent inside a git worktree (Experimental) |
| `--parallel` | Run the agent inside a self-managed git worktree (Experimental) |
| `--load-prompt <prompt>` | Use a specific prompt |
| `--prompts-dir <path>` | Extra prompts directory, highest precedence (repeatable, last wins; `TC_PROMPTS_DIR` appends `:`-separated dirs) |
| `--custom-mcp NAME=cmd args...` | Add a stdio MCP server (repeatable, overrides config) |
| `--custom-mcp-http NAME=URL` | Add an HTTP MCP server (repeatable, overrides config) |

## Optional subsystems

Everything above ships in the default build. A few extras are
available as optional subsystems: lifecycle hooks (see CONFIG.md),
a second-model advisor (`--advisor`), image/PDF message attachments,
and ACP editor integration (`--acp`). See CONFIG.md for what each one
does and how to enable it.

## Where to go next

Thanks for reading the *Getting Started* guide to the end. Discover
more about configuration and the agent's built-in commands by reading
the documentation, by asking the `autoconfig` prompt questions, or by
experimenting with the `/` interactive picker.
