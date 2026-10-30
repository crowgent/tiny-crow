# Tiny Crow — Project Overview

## What this is

Tiny Crow is a compact terminal coding agent, built in TypeScript for
Node.js and executed straight from source thanks to Node 24's type
stripping — no build step, no bundler, no runtime dependencies. Give
it a codebase and a model, and it will read, write, edit, search, and
run commands there for you, pausing to ask whenever your permission
rules require it.

## What it does

- Talks to many model providers — OpenRouter, OpenAI, Anthropic,
  Gemini, Ollama, OpenCode Zen and Go, and any OpenAI-compatible
  endpoint you set up yourself — all through one provider layer.
- Hands the agent a complete toolkit: file reading, writing and
  editing, grep searching, file finding, directory listing, task
  tracking, and shell execution, together with language-server
  diagnostics.
- Checks every tool call against a permission system: six modes
  (restrictive, readonly, planwrite, guarded, standard, yolo), glob
  and regex rules per tool, an allowlist that lasts for the session,
  and detection of repeated identical calls (doom loops).
- Stores sessions on disk for saving, resuming, rewinding, redoing,
  and exporting; long conversations compact themselves automatically
  so they fit the model's context window.
- Draws a complete terminal interface: Markdown output, mouse
  selection and copy, scrollback, a status bar you can configure, and
  switchable system prompts (`code`, `plan`, `review`, `debug`, `ask`,
  `brainstorm`, and more) that change how the agent behaves.
- Grows through optional subsystems: MCP servers, ACP editor
  integration, lifecycle hooks, a second-model advisor, persistent
  Markdown memory, parallel read-only subagents, git worktrees,
  headless loops, multimodal input, prompt chaining, and status
  signals sent over a Unix socket for external status bars.

## Running it

Requirements: Node.js 24 or newer. Install the type-checking dev
dependencies once with `npm install` (TypeScript and `@types/node`
only — the program itself uses Node's standard library plus `fetch`).

```sh
npm start            # node src/main.ts — interactive TUI
node src/main.ts --help
node src/main.ts --version        # tiny-crow 1.8.5
node src/main.ts -p "hello"       # headless print mode
node src/main.ts --print-config   # resolved configuration and exit
npm run typecheck    # tsc --noEmit (must be clean)
npm test             # node --test tests/*.test.ts tests/hooks/*.test.ts
```

`package.json` scripts also include `dev` (`node --watch src/main.ts`),
`check` (alias of `typecheck`), `lint` (`tsc --noEmit`), and hook
install/remove helpers.

The version lives in `package.json` (`1.8.5`); it is the single source
of truth, and `npm run sync-version` reports it. See
`docs/PUBLISHING_RELEASES.md` for the release workflow.

## The shape of the code

The full layout, types, and data flow are documented in
`ARCHITECTURE.md` at the repository root. In brief:

| Area | Responsibility |
|---|---|
| `src/main.ts`, `src/cli.ts` | Where the program starts, how CLI flags are parsed, which mode runs |
| `src/provider.ts`, `src/auth.ts` | Provider clients and streaming, plus where API keys come from |
| `src/engine/`, `src/agent/` | The agent loop and runner, the builder, prompts, and core tools |
| `src/session/` | Session state, JSON storage, chat history, and compaction |
| `src/permission/` | Glob and regex rules, permission prompts, and doom-loop detection |
| `src/ui/` | The hand-rolled TUI: renderer, input editor, pickers, slash commands, status bar |
| `src/context/` | Prompt and theme loading, plus AGENTS.md / ARCHITECTURE.md context files |
| `src/config/` | Config loading (TOML/YAML/JSON) and the config types |
| `src/extras/` | Optional subsystems: loop, MCP, ACP, memory, subagents, worktrees, advisor, hooks, LSP, multimodal, prompt chains, status signals |
| `src/sandbox.ts` | Wrapping bash commands with `bwrap` / `zerobox` |
| `src/startup.ts`, `src/logging.ts`, `src/docs.ts` | Startup phases, structured logging, and the built-in docs lookup |

Control flows from CLI parsing, through config and context loading and
session loading, into one of the modes: interactive TUI (the default),
single-reply print mode, headless loop mode, or ACP server mode. In the
TUI, user input feeds the agent runner, whose streamed events go to the
renderer and into the session; tool calls pass through the hook
dispatcher and then the permission checker before executing.

Sessions are JSON files under `$TC_DATA_DIR` (or the operating system's
data directory) in `sessions/`; chat history is appended to
`chat_history.jsonl` in the same directory. Logs go to `logs/` as
`tiny-crow-<timestamp>_<pid>.log` when `-v` or `--log-file` is used.

## Configuration

Tiny Crow reads an optional config file — TOML, YAML, or JSON — resolved
in this order: `$TC_CONFIG_DIR`, then `~/.config/tiny-crow/`, then
`~/.local/share/tiny-crow/` (on macOS, `~/Library/Application
Support/tiny-crow/`). A project-local `.tiny-crow/config.toml` merges
over the global config. Every key, its type, and its default is
documented in `docs/CONFIG.md`; the highlights are provider and model
selection, quick models (named provider + model pairs), permission
rules, sandbox settings, MCP servers, status bar layout, colours, and
the advisor, LSP, and hook subsystems.

Prompts live in `~/.local/share/tiny-crow/prompts/` (plus project and
CLI tiers), themes in the matching `themes/` directories, and custom
prompts are plain Markdown files referenced by name. The agent also
loads `AGENTS.md` (or `CLAUDE.md`) and, when enabled, `ARCHITECTURE.md`
from the project and its ancestors; see `docs/ARCHITECTURE.md`.

## Data files

Data is data, not code, and lives under `data/`:

- `data/prompts/*.md` — the built-in system prompts
- `data/themes/*.json` — the built-in colour themes
- `data/models.json` — the model catalog, refreshed weekly from
  models.dev by `node scripts/gen-models-catalog.ts`
- `data/tiny-crow-transports.json` — the baked transport map used for
  OpenCode Zen / Go model routing
- `data/session_export.html` — the template for HTML session exports

## Scripts and packaging

`scripts/` holds TypeScript tooling, each wired to an npm script:

- `scripts/gen-models-catalog.ts` — fetch and filter the model catalog
  into `data/models.json` and `data/tiny-crow-transports.json`
- `scripts/setup-neovim.ts` — set up the Neovim integration
- `scripts/sync-version.ts` — report (and check) the version from
  `package.json` against the literals the program reads
- `scripts/install.ts` — install the `tiny-crow` command; `install.sh`
  is a thin wrapper that checks Node >= 24 first

Those scripts are run directly through the npm scripts (test, check,
run, and the rest) — there is no separate task-runner file; an earlier
justfile that mirrored them was removed as redundant. Distribution files live under `nix/` (with
`nix/package/tiny-crow.nix`, built on `nodejs_24`) and `packaging/`
(AUR, conda, and Homebrew formulas installing the Node app with a
`bin/tiny-crow` wrapper that runs `node src/main.ts`). CI, docs
deployment, releases, and the weekly model-catalog refresh live in
`.github/workflows/`.

## Testing it, and the contributor habits

Tests live in `tests/` as `*.test.ts` files (plus `tests/hooks/` and
`tests/hooks/corpus/` fixtures) and run with Node's built-in test
runner:

```sh
npm test             # node --test tests/*.test.ts tests/hooks/*.test.ts
npm run typecheck    # tsc --noEmit
```

Type safety is checked separately from the tests; never claim a change
works without both passing. Headless main-loop tests drive the real TUI
loop with no terminal and no network, rendering into a fake backend and
feeding scripted user events, while agent runs use a mock completion
model.

A few ground rules for contributors, also stated in `AGENTS.md`:

- Write tests when writing new non-TUI code.
- Update the `docs/` files when a change affects documented behaviour.
- If adding or editing slash commands, edit the slash-command `/`
  picker in the TUI.
- Running `npm test` creates an empty `target/` directory in the repo
  root (sandbox-mask tests use `cwd/target/` as scratch). It is debris,
  not a deliverable, and can be deleted after a test run.

## Known limits, stated plainly

- Live provider behaviour is covered by unit and integration tests
  with fakes and local processes, not against live vendor APIs.
- The sandbox is a seatbelt against mistakes, not a container for
  untrusted code; see `SECURITY.md` for exactly what it does and does
  not protect against, including the gaps around sockets, the home
  directory, and the tool-result channel.
- The `danger_accept_invalid_certs` toggle logs the same MITM warning
  it always did but cannot disable TLS verification under
  `node:fetch`.
- Nix and Homebrew recipes are syntax-reviewed, not executed
  on every machine; distribution archives need a real URL and checksum
  supplied at publish time (none is invented in the packaging files).
- Some internal type shapes are mirrored locally across modules rather
  than imported from one canonical export; behaviour is unaffected and
  the typecheck is clean, but a future cleanup pass could point them at
  a single source each.
- The `/mcp login` deferred outcome degrades to an error line instead
  of the login flow when handled through the app's slash-result path.
