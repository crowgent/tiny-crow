# Tiny Crow project and porting overview

## Project summary

Tiny Crow is a compact terminal coding agent written in TypeScript for Node.js. Node.js 24's type stripping executes it directly from source, with no build step, bundler, or runtime dependencies. Given a codebase and a model, it can read, write, edit, search, and run commands in that codebase, pausing whenever its permission rules require approval.

## Capabilities

Tiny Crow supports OpenRouter, OpenAI, Anthropic, Gemini, Ollama, OpenCode Zen, OpenCode Go, and user-configured OpenAI-compatible endpoints through one provider layer. The agent toolkit includes file reading, writing and editing, grep, file finding, directory listing, task tracking, shell execution, and language-server diagnostics.

Every tool call is checked by a permission system with six modes (`restrictive`, `readonly`, `planwrite`, `guarded`, `standard`, and `yolo`), per-tool glob and regex rules, a session-long allowlist, and repeated-call (doom-loop) detection. Sessions can be saved, resumed, rewound, redone, and exported. Long conversations compact automatically to fit the model context window.

The terminal interface provides Markdown output, mouse selection and copy, scrollback, a configurable status bar, and switchable system prompts such as `code`, `plan`, `review`, `debug`, `ask`, and `brainstorm`. Optional subsystems include MCP servers, ACP editor integration, lifecycle hooks, a second-model advisor, persistent Markdown memory, parallel read-only subagents, git worktrees, headless loops, multimodal input, prompt chaining, and Unix-socket status signals for external status bars.

## Running and checking the project

**Requirement:** Node.js 24 or newer. Install development dependencies once with `npm install`. These are only TypeScript and `@types/node`; the program itself uses Node's standard library and `fetch`.

```sh
npm start                         # node src/main.ts — interactive TUI
node src/main.ts --help
node src/main.ts --version        # tiny-crow 1.8.5
node src/main.ts -p "hello"       # headless print mode
node src/main.ts --print-config   # resolved configuration, then exit
npm run typecheck                 # tsc --noEmit (must be clean)
npm test                          # node --test tests/*.test.ts tests/hooks/*.test.ts
```

Other `package.json` scripts include `dev` (`node --watch src/main.ts`), `check` (an alias for `typecheck`), `lint` (`tsc --noEmit`), and hook install/remove helpers.

The version is declared in `package.json` (`1.8.5`), the single source of truth; `npm run sync-version` reports it. See [docs/PUBLISHING_RELEASES.md](docs/PUBLISHING_RELEASES.md) for the release workflow.

## Code layout and execution flow

The full layout, types, and data flow are described in the root [ARCHITECTURE.md](ARCHITECTURE.md).

| Area | Responsibility |
| --- | --- |
| `src/main.ts`, `src/cli.ts` | Program entry point, CLI parsing, and mode selection |
| `src/provider.ts`, `src/auth.ts` | Provider clients and streaming; API-key sources |
| `src/engine/`, `src/agent/` | Agent loop and runner, builder, prompts, and core tools |
| `src/session/` | Session state, JSON storage, chat history, and compaction |
| `src/permission/` | Glob and regex rules, permission prompts, and doom-loop detection |
| `src/ui/` | Hand-built TUI: renderer, input editor, pickers, slash commands, and status bar |
| `src/context/` | Prompt and theme loading, plus `AGENTS.md` / `ARCHITECTURE.md` context files |
| `src/config/` | TOML/YAML/JSON config loading and config types |
| `src/extras/` | Optional loop, MCP, ACP, memory, subagents, worktrees, advisor, hooks, LSP, multimodal, prompt chains, and status signals |
| `src/sandbox.ts` | Bash-command wrapping with `bwrap` / `zerobox` |
| `src/startup.ts`, `src/logging.ts`, `src/docs.ts` | Startup phases, structured logging, and built-in documentation lookup |

Control flows from CLI parsing through config, context, and session loading into one of four modes: interactive TUI (default), single-reply print mode, headless loop mode, or ACP server mode. In the TUI, input feeds the agent runner; streamed events go to the renderer and session. Tool calls pass through the hook dispatcher and then the permission checker before execution.

Sessions are JSON files under `$TC_DATA_DIR` (or the operating system's data directory) in `sessions/`. Chat history is appended to `chat_history.jsonl` in the same directory. Logs are stored in `logs/` as `tiny-crow-<timestamp>_<pid>.log` when `-v` or `--log-file` is used.

## Configuration and data

The optional config file can use TOML, YAML, or JSON. Resolution order is `$TC_CONFIG_DIR`, then `~/.config/tiny-crow/`, then `~/.local/share/tiny-crow/` (on macOS, `~/Library/Application Support/tiny-crow/`). A project-local `.tiny-crow/config.toml` merges over the global config. [docs/CONFIG.md](docs/CONFIG.md) documents every key, type, and default; highlights include provider and model selection, quick models (named provider/model pairs), permission rules, sandbox settings, MCP servers, status-bar layout, colours, and advisor, LSP, and hook subsystems.

Prompts live in `~/.local/share/tiny-crow/prompts/` along with project and CLI tiers; themes live in corresponding `themes/` directories. Custom prompts are plain Markdown files referenced by name. The agent also loads `AGENTS.md` (or `CLAUDE.md`) and, when enabled, `ARCHITECTURE.md` from the project and its ancestors. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Data files are kept under `data/`:

| Path | Purpose |
| --- | --- |
| `data/prompts/*.md` | Built-in system prompts |
| `data/themes/*.json` | Built-in colour themes |
| `data/models.json` | Model catalog, refreshed weekly from models.dev by `node scripts/gen-models-catalog.ts` |
| `data/tiny-crow-transports.json` | Baked transport map used for OpenCode Zen / Go model routing |

## Tooling and distribution

The `scripts/` directory contains TypeScript tooling wired to npm scripts: `gen-models-catalog.ts` fetches and filters the model catalog into `data/models.json` and `data/tiny-crow-transports.json`; `setup-neovim.ts` configures the Neovim integration; `sync-version.ts` reports and checks the version in `package.json` against literals read by the program; and `install.ts` installs the `tiny-crow` command. `install.sh` is a thin wrapper that checks for Node.js 24 or newer first.

Scripts run directly through npm scripts; there is no separate task-runner file. An earlier justfile that mirrored them was removed as redundant. There are no distribution recipes for Nix, AUR, conda, or Homebrew: they were removed as unused because no workflow or install route used them and their download references did not match the release tarball. The install route is the git clone plus `npm install` flow in the README, and releases ship the Node tarball. CI, docs deployment, releases, and the weekly model-catalog refresh are in `.github/workflows/`.

## Tests and contributor practices

Tests are `*.test.ts` files in `tests/`, with additional fixtures in `tests/hooks/` and `tests/hooks/corpus/`. Run them with Node's built-in runner:

```sh
npm test             # node --test tests/*.test.ts tests/hooks/*.test.ts
npm run typecheck    # tsc --noEmit
```

Tests and type checking are separate; do not claim a change works unless both pass. Headless main-loop tests drive the real TUI loop without a terminal or network, render into a fake backend, and feed scripted user events. Agent runs use a mock completion model.

Contributor practices, also recorded in [AGENTS.md](AGENTS.md): add tests with new non-TUI code; update `docs/` when documented behaviour changes; and update the TUI slash-command `/` picker when adding or editing slash commands. Running `npm test` creates an empty `target/` directory at the repository root (sandbox-mask tests use `cwd/target/` as scratch). It is test debris, not a deliverable, and can be deleted after the run.

## Known limitations

- Live-provider behaviour is covered by unit and integration tests using fakes and local processes, not live vendor APIs.
- The sandbox is a seatbelt against mistakes, not a container for untrusted code. See [SECURITY.md](SECURITY.md) for its guarantees and gaps, including sockets, the home directory, and the tool-result channel.
- The `danger_accept_invalid_certs` toggle logs the same MITM warning as before, but cannot disable TLS verification under `node:fetch`.
- Some internal type shapes are mirrored locally across modules instead of imported from one canonical export. Behaviour is unaffected and type checking is clean, but a future cleanup could point them to a single source each.
- The `/mcp login` deferred outcome becomes an error line instead of the login flow when handled through the app's slash-result path.
