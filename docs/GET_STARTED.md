---
description: "Get tiny-crow running: fetch the code, attach a model backend, and hold a first working conversation."
---

# From checkout to first conversation

You need no build, no compiler pass, and no package install that pulls in a runtime library.
If Node.js 24 or newer is on the machine, the TypeScript sources run as they are. This page
walks through fetching the code, attaching a model, and opening a conversation, and it
finishes with the everyday controls you will actually reach for.

The notes below assume Linux, macOS, or WSL. A native Windows setup is not maintained at the
moment, so Windows users should work inside WSL.

## Fetch the code and put it on your path

The quickest way needs `curl` and internet access. On Debian/Ubuntu, the installer adds Node.js
24+ automatically if it is missing or too old; that step requires root or `sudo`. On other
systems, install Node.js 24+ first. Root installs put the launcher in `/usr/local/bin`; regular
users get `~/.local/bin`. If needed, the installer adds its command directory to `.profile` and
`.bashrc` so it remains available in future shell sessions. Sources stay in
`~/.local/share/tiny-crow`:

```bash
curl -fsSL https://raw.githubusercontent.com/crowgent/tiny-crow/main/install.sh | bash
```

Or grab a copy and install the development tooling. Nothing at runtime depends on an outside
package, so this step only sets up the tools used while developing the agent itself.

```bash
git clone https://github.com/crowgent/tiny-crow.git
cd tiny-crow
npm install   # no runtime dependencies; installs dev tooling only
```

From the checkout you can start it with `npm start`, or run `node src/main.ts` directly. If
you would rather type a short name from anywhere, point a link at the entry point and add
its folder to your path:

```bash
ln -s "$PWD/src/main.ts" ~/.local/bin/tiny-crow
export PATH="$HOME/.local/bin:$PATH"
```

## Attach a model backend

Out of the box the agent talks to **OpenRouter**. One key there opens hundreds of models,
with no separate account per model family, and several models on that service cost nothing
to try.

### Make an OpenRouter key

1. Open [openrouter.ai/keys](https://openrouter.ai/keys) 2. Make a new key 3. Export it in
your shell:

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
```

Put the same export line in `~/.bashrc` or `~/.zshrc` if you want the key to survive new
terminal sessions.

### Pick a different backend instead

OpenRouter is a starting point, not a requirement. A mainstream hosted provider, a machine
on your own desk, and any server that speaks the OpenAI wire format all work. Export the
matching key for the backend you want:

- OpenAI: export `OPENAI_API_KEY`.
- Anthropic: export `ANTHROPIC_API_KEY`.
- Gemini: export `GEMINI_API_KEY`.
- Ollama: no key at all, since it runs locally.

Then tell the configuration which backend to prefer. The file lives at
`~/.local/share/tiny-crow/config.toml` on Linux and WSL, or in `~/Library/Application
Support/tiny-crow/` on macOS, unless `$TC_CONFIG_DIR` points elsewhere or a
`~/.config/tiny-crow/` file already exists. The full lookup order is in
[CONFIG.md](CONFIG.md). Inside that file, set the `provider` field to the backend you want.

A single run can override the configured backend without editing anything:

```bash
tiny-crow --provider anthropic
```

Custom endpoints, extra headers, and prompt caching are covered in
[Providers](PROVIDERS.md).

## Give a provider-plus-model pair one short name

Full model strings are long, and it is easy to attach a model to the wrong backend by
mistake. A quick model solves both annoyances at once: a single alias fixes the provider and
the model together.

Declare one in configuration, for example:

```
[quick_models.lookout]
provider="openrouter"
model="anthropic/claude-sonnet-4-6"
```

After that, make it the default by putting the alias in the `model` field of the
configuration file, or pick it interactively inside the agent with `/models`.

## Pick a model

On OpenRouter a model is named as `provider/model-name`. The most used models are listed
[here](https://openrouter.ai/models?order=top-weekly), and the free ones sorted by usage are
[here](https://openrouter.ai/models?order=top-weekly&max_price=0). You can change model in
the middle of a conversation with `/model`, giving the provider's own model name.

## Open your first conversation

That is everything the setup needs. Launch `tiny-crow`, take in the terminal interface,
write a message, and press Enter. Tokens stream back as the agent answers.

From here it can look through a codebase, read files, write new code, edit what exists, and
search for patterns, while you stay in charge of what it is permitted to touch.

## Commands worth learning first

Typing `/` into an empty message opens a picker with every command. These are the ones worth
learning first:

- `/help` — shows every command.
- `/models <name>` — moves to a different model through Quick
  Models, mid-session.
- `/clear` — wipes the current context and starts fresh.
- `/mode readonly` — restricts the agent to reading only.
- `/undo` — takes back the most recent exchange.
- `/redo` — brings back what the last undo removed.
- `/btw` — puts a question to the agent without disturbing the
  context.
- `/review` — asks the agent to look over the latest changes.
- `/sessions` — shows sessions you have worked in before.
- `/rename <name>` — gives the current session a new name.
- `/quit` — leaves the agent.

## Behaviour presets, chosen with a dot

A message that begins with `.` selects a preset for how the agent should act. Put text after
the preset name and it applies to that message alone; put nothing after it and it stays in
force for the rest of the session.

- `code` — writing and changing code (the default).
- `plan` — sketching a design before any code is written.
- `review` — going over changes.
- `ask` — questions and answers, with no tools involved.
- `brainstorm` — throwing ideas around and weighing options.
- `debug` — working through a fault step by step.
- `refactor` — reshaping code that already exists.

More presets ship with the agent. Run `/prompt` inside a session, or look at the root
[README](../README.md), for the whole built-in set, which also includes `frontend-design`,
`review-security`, `simplify`, `write-prompt`, `autoconfig`, `orchestrator`, and
`write-text`.

## Hand setup over to autoconfig

One preset, `autoconfig`, deserves a mention of its own. It can read and change your
tiny-crow configuration and read the docs for the project you are in. Once you have finished
this page, you can hand setup over to it and stop opening configuration files by hand.

## Moves on the keyboard

- `Ctrl+R` — switches reasoning/thinking on or off.
- `Ctrl+G` — opens the input in `$EDITOR`.
- `Ctrl+H` — starts `lazygit` (turn off with `--disable-lazygit`).
- `Ctrl+S` — saves the session immediately.
- `Ctrl+C` — stops the agent mid-response.
- `PgUp` / `PgDn` — moves through the chat history.
- `Home` / `End` — jumps to the very top or bottom.

## One-off runs and scripts

The same binary works without the interactive screen. These flags cover the common scripted
cases:

- `-p <msg>` — delivers a message.
- `-c` — picks up the most recent open session.
- `--name <name>` — names the new session.
- `--session <id-or-name>` — opens a session by ID prefix or name.
- `--read-only` — permits file reads and nothing else.
- `--yolo` — removes the limits placed on the agent.
- `--sandbox` — puts the agent inside a sandbox (Experimental).
- `--sandbox-required` — refuses bash commands if no sandbox
  backend is available (implies `--sandbox`).
- `--sandbox-expose <path>` — gives back read-only access to a masked credential path or
  subpath (repeatable).
- `--sandbox-network[=true|false]` — controls whether sandboxed bash commands can reach the
  host network (default: `true`; a bare flag or `=true` turns it on, `=false` leaves each
  command with only its own private loopback).
- `--worktree` — works inside a git worktree (Experimental).
- `--parallel` — works inside a self-managed git worktree
  (Experimental).
- `--load-prompt <prompt>` — starts with a named prompt.
- `--prompts-dir <path>` — adds an extra prompts directory, taking
  highest precedence (repeatable, last wins; `TC_PROMPTS_DIR`
  appends `:`-separated dirs).
- `--custom-mcp NAME=cmd args...` — adds a stdio MCP server (repeatable, overrides config).
- `--custom-mcp-http NAME=URL` — adds an HTTP MCP server
  (repeatable, overrides config).

## Pieces you can switch on later

The default build already contains everything described above. A handful of further pieces
are optional: lifecycle hooks (see CONFIG.md), a second-model advisor (`--advisor`),
attachments that carry images or PDFs in a message, and ACP editor integration (`--acp`).
CONFIG.md explains what each one does and how to turn it on.

## What to try next

You now have a running agent, a connected model, and the controls for a normal working
session. The next step is to poke around: read the configuration reference, try the `/`
picker, or ask the `autoconfig` preset a question about your own setup and see what it
suggests.

## The CROW terminal UI

Interactive runs open the CROW terminal UI: a large CROW banner on the
welcome screen, streaming assistant output, a bottom input line, a `/`
command picker, visible tool-call progress, and a status line showing the
provider, model, message count, and session cost. The picker shows 8
commands at a time and scrolls with the selection, with more-above and
more-below indicators when the list continues past the visible window.
When the picker is open, one Enter both picks and runs the highlighted
command. Commands such as /provider, /model, /models, /prompt, /theme,
/sessions, and /help open a selection panel inside the TUI: move with
the arrow keys, type to filter, Enter to choose, Esc to go back. In
setup mode (no provider key yet), /provider also asks for the key
inside the TUI and saves it, without ever showing the key on screen.
Once a provider is ready, setup mode switches to live chat in the
same process, with no quit and restart needed.

If no provider API key is configured yet, the terminal UI still opens and
shows setup guidance instead of exiting. Live chat needs a real key, which
you can configure with /provider inside the TUI or with `tiny-crow --setup`.

The banner stays fixed at the top while the feed scrolls below it, and the
screen repaints cleanly on resize. Typing `/` opens the command picker
above the input line in both the full UI and the no-key setup screen:
arrow keys move the selection, Enter selects a highlighted command (or
runs it when fully typed), Tab completes, and Esc closes the picker. In
the setup screen, `/help` lists the commands and notes that live use
needs a provider key.
