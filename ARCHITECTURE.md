# Tiny Crow architecture (release 1.8.5)

Tiny Crow is a compact TypeScript coding agent for Node.js 24 or later. Node's type stripping runs files under `src/` directly, without compilation; files under `tests/` run with Node's built-in test runner.

## Design principles

The terminal interface is hand-built rather than based on a widget library. It owns its line buffer, Markdown rendering, scrolling, and selection, and adds no runtime packages. A shared provider layer keeps agent logic independent of the model vendor. Permission rules support both glob and regex patterns, and a watchdog detects repeated tool calls without progress. As token use approaches the context-window limit, older messages are condensed and removed while a short summary is retained.

Optional behaviour is enabled through settings or runtime flags, not a separate build. Worktrees, MCP, subagents, the architecture-note loader, status signals, and logging are available by default. The headless loop, ACP serving, persistent memory, advisor, hooks, language servers, output filtering, multimodal input, and exporting are also runtime options. Hooks wrap tools rather than replacing permission checks: a hook rewrite can narrow a request, but cannot widen one that the checker would refuse.

## Startup and execution modes

All launches pass through `main()` in `src/main.ts`. It reads flags, loads settings, gathers context files, and restores a session, in that order. It then dispatches to the requested mode: print resolved settings and exit; start the ACP server with `--acp`; produce one reply with `--print`; run the headless iterative loop with `--loop`; or open the interactive terminal interface when no mode flag is supplied.

A prior session can be restored with `--resume`, `--continue`, or `--session <id>`. Other flags register the advisor tool, silence the hook dispatcher, dry-run one hook, or stream start, stop, and git-conflict notices over a Unix socket for an external status bar.

The interactive loop listens for keyboard and mouse input, resizes and pastes from the event thread, background agent prebuilding results, streaming agent events, pending permission questions, parallel `/btw` results, and periodic refresh ticks. The input editor handles typed text; submitted lines start the agent runner. The renderer draws streamed events and appends them to the session.

## Request lifecycle

A submitted line travels from the input editor to the agent runner alongside the active prompt and conversation. The runner calls the provider client, which invokes the model vendor API. Responses stream back as agent events: tokens, reasoning fragments, tool calls and results, subagent tool calls, errors, and a final completion marker.

The event handler paints those events into the renderer's viewport buffer, which becomes terminal draw commands. Before a tool runs, the hook dispatcher's pre-tool stage may allow it, ask, deny, or rewrite its arguments; the permission checker then returns its own allowed, ask, or denied verdict. An ask pauses for user approval or refusal. An allowed call runs the selected tool (such as shell, read, write, edit, or search) and then passes through the post-tool rewrite stage. When the completion marker arrives, the session is appended and saved.

Sessions are JSON files under the data directory: `$TC_DATA_DIR` when set, or the operating system's data directory otherwise, in a `tiny-crow`-suffixed folder under `sessions/`. Chat history is appended to `chat_history.jsonl` in the same data directory. Logs are written under `logs/` as `tiny-crow-<timestamp>_<pid>.log`; they appear only when verbose logging or an explicit log file is requested.

## Core types and responsibilities

- `Config` holds resolved settings for runtime behaviour; `Cli` holds command-line arguments, which take precedence over matching settings fields.
- The provider layer fronts all vendors (OpenAI, Anthropic, Gemini, Ollama, and OpenRouter). The agent provides one-shot print mode and a spawned streaming runner.
- `AgentEvent` represents streamed tokens, reasoning, tool calls and results, subagent tool calls, errors, and completion. `UserEvent` represents keys, scrolling, resizing, pasting, and mouse press, drag, and release.
- `Session` is the serialisable conversation record, including messages, compactions, costs, permission allowlist, and model and provider details.
- `PermissionChecker` owns the two-layer rules, repeated-call detection, and security-mode dispatch.
- `Renderer` owns the line-buffered viewport, Markdown painting, scrolling, and selection. All terminal output passes through its backend; tests use a fake backend with fixed geometry that captures frames.
- `InputEditor` owns the text buffer, cursor, history, kill ring, and picker integration.
- `ContextFiles` carries loaded agent instructions, prompts, themes, and architecture notes.
- `HookDispatcher` merges pre-tool verdicts with the most severe taking precedence, and enforces post-tool and lifecycle decisions. It wraps each tool outside that tool's own permission check.

## Source tree

| Location | Responsibility |
| --- | --- |
| `src/main.ts`, `src/cli.ts` | Entry point and flag definitions |
| `src/provider.ts`, `src/auth.ts` | Model-provider layer and API-key resolution |
| `src/engine/` | Agent event loop, tool dispatch, and streaming |
| `src/agent/` | Agent construction, spawning, streaming, subagents, system prompts, and tools (read, write, edit, shell, grep, file search, directory listing, todo, task, and advisor) |
| `src/session/` | Session state, JSON storage, and chat history |
| `src/permission/` | Glob and regex rules, repeated-call detection, permission prompts, and pattern handling |
| `src/ui/` | Event loop, raw-mode guard, renderer, input editor, pickers, status line, Markdown, event handler, grouped interface state, and slash commands including the `/` picker |
| `src/context/` | Embedded prompt themes and loading of agent and architecture notes |
| `src/config/` | TOML, YAML, and JSON config loading, environment handling, and types for quick models, custom providers, colours, and edit systems |
| `src/extras/` | Headless loop, MCP client, ACP server, persistent memory, parallel task delegation, git worktrees, architecture-note handling, external-model consultation, image/PDF ingestion, lifecycle hooks with trust-hash confirmation, language servers, output filtering, prompt-chain transitions, and Unix-socket status signals |
| `src/sandbox.ts` | Shell-command wrapping with `bwrap` or `zerobox` |
| `src/fs.ts`, `src/pricing.ts` | Filesystem helpers and token-price constants |
| `src/startup.ts` | Phased startup: settings, client, and context resolution, then optional subsystem setup |
| `src/logging.ts` | Structured logging |
| `src/docs.ts` | Built-in documentation lookup behind the getting-started guide and `--tutor` |

## Testing and verification

Tests are `*.test.ts` files under `tests/` and run through Node's built-in runner with `npm test`, which invokes `node --test` over the test files and hooks tests. Type safety is checked separately with `npm run typecheck` (`tsc --noEmit`). Both checks must pass before a change is considered good.

Headless main-loop tests exercise the real terminal loop without a terminal or network, drawing into a fake backend and feeding scripted user events. Agent runs use a mock completion model.

## Runtime and development dependencies

There are no runtime packages. Development tooling consists of `typescript` for `tsc --noEmit` and `@types/node` for Node.js type definitions. Other functionality uses Node.js built-ins, including `node:fs`, `node:child_process`, `node:readline`, `node:http(s)` for vendor API calls, and `node:test`. Settings are parsed from TOML, YAML, or JSON; sessions are serialised as JSON.
