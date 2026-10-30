# Architecture — zerostack-ts v1.8.5

Minimal coding agent in TypeScript, running on Node.js 24 or newer with
type stripping. No build step: the sources under `src/` run directly,
and tests under `tests/` run with Node's built-in test runner.

## Directory Layout

| Path | Responsibility |
|---|---|
| `src/main.ts` | Entry point, CLI dispatch, mode routing |
| `src/cli.ts` | CLI argument definition |
| `src/provider.ts` | LLM provider abstraction (OpenAI, Anthropic, Gemini, Ollama, OpenRouter) |
| `src/auth.ts` | API key resolution |
| `src/event.ts` | `AgentEvent` (streaming LLM output) and `UserEvent` (TUI input) |
| `src/engine/` | Agent engine: event loop, tool dispatch, streaming |
| `src/agent/` | Agent lifecycle: `builder.ts` (agent construction + tool injection), `runner.ts` (spawn, stream, subagent execution), `prompt.ts` (system prompts), `tools/` (core tool implementations: read, write, edit, bash, grep, find_files, list_dir, todo; plus `TaskTool` and `AdvisorTool`) |
| `src/session/` | Session state: `mod.ts` (messages, compactions, costs), `storage.ts` (JSON file I/O), `chat_history.ts` |
| `src/permission/` | Security: `checker.ts` (glob+regex rules, doom-loop detection), `ask.ts` (user prompt UI), `pattern.ts` |
| `src/ui/` | Custom TUI: `app.ts` (event loop), `terminal.ts` (raw mode guard), `renderer.ts` (line buffer + viewport), `input/` (text editor + pickers), `statusline.ts`, `markdown.ts`, `event_handler.ts`, `state.ts` (grouped TUI state), `slash/` (slash commands, including the `/` picker) |
| `src/context/` | Context gathering: embedded prompt themes (`prompts.ts`, `themes.ts`), AGENTS.md/ARCHITECTURE.md loading |
| `src/config/` | Configuration: `load.ts` (TOML/YAML/JSON from disk+env), `types.ts` (QuickModel, CustomProvider, Colors, EditSystem) |
| `src/extras/` | Optional subsystems: `loop/` (headless), `mcp/` (MCP client), `acp/` (ACP server), `memory/` (persistent memory), `subagents/` (parallel task delegation), `git_worktree/`, `archmd/`, `advisor/` (external model consultation, `/advisor`), `multimodal/` (image/PDF ingestion), `hooks/` (lifecycle hook dispatch: `PreToolUse`/`PostToolUse`/`Stop`/`UserPromptSubmit`/session+subagent events, trust-hash confirmation), `lsp/` (language servers), `rtk.ts` (output filtering), `chain/` (brainstorm→plan→code prompt transitions), `status_signals.ts` (Unix-socket start/stop/git-conflict signals) |
| `src/sandbox.ts` | `bwrap`/`zerobox` command wrapping |
| `src/fs.ts` | Filesystem utilities |
| `src/pricing.ts` | Token pricing constants |
| `src/startup.ts` | Startup phases: config/client/context resolution, then optional-subsystem initialization |
| `src/logging.ts` | Structured logging (`--log-level`, `ZS_LOG`, `-v` log files) |
| `src/docs.ts` | Built-in documentation lookup (GET_STARTED guide, `--tutor`) |

## Key Types & Relationships

- **`Config`** — central resolved config, drives all runtime behavior.
- **`Cli`** — CLI args, override `Config` fields.
- **Provider client / agent** — a single provider abstraction wraps each
  provider's client (OpenAI, Anthropic, Gemini, Ollama, OpenRouter).
  The agent provides print mode (single reply, then exit) and the
  spawned streaming runner.
- **`AgentEvent`** — `Token`, `Reasoning`, `ToolCall`, `ToolResult`,
  `SubagentToolCall`, `Error`, `Done`.
- **`UserEvent`** — `Key`, `ScrollUp/Down`, `Resize`, `Paste`,
  `MouseDown/Drag/Up`.
- **`Session`** — serializable state: messages, compactions, costs,
  permission allowlist, model/provider info.
- **`PermissionChecker`** — dual-layer (glob + regex) rules, doom-loop
  detection, security-mode dispatch.
- **`Renderer`** — line-buffered viewport, markdown rendering,
  scroll/selection. All terminal I/O goes through the renderer backend;
  tests use a fake backend with fixed geometry that captures frames.
- **`InputEditor`** — text buffer, cursor, history, kill-ring, picker
  integration.
- **`ContextFiles`** — loaded agents, prompts, themes, architecture docs.
- **`HookDispatcher`** — merges `PreToolUse` verdicts (`Allow`/`Defer`/
  `Ask`/`Deny`, most severe wins) and applies `PostToolUse`/lifecycle
  decisions (`Continue`/`Block`/`Rewrite`). It wraps every tool outside
  each tool's own `PermissionChecker` check, so a `PreToolUse` rewrite
  can only narrow a request, never grant a permission the checker
  would otherwise deny.

## Testing

- Tests live in `tests/` as `*.test.ts` files and run with Node's
  built-in runner: `npm test` (`node --test tests/*.test.ts
  tests/hooks/*.test.ts`).
- Type safety is checked separately with `npm run typecheck`
  (`tsc --noEmit`). Never claim a change works without both.
- Headless main-loop tests drive the real TUI loop without a terminal
  or network, rendering into a fake backend and receiving scripted
  `UserEvent`s; agent runs use a mock completion model.

## Control Flow

```
CLI parse → config load → context load → session load
  │
  ├── --print-config → print and exit
  ├── --acp → ACP server mode
  ├── --print → single agent reply, then exit
  ├── --loop → headless iterative loop mode
  └── (default) → interactive TUI
```

### Interactive TUI Event Loop

The loop selects over: user events (keyboard/mouse/resize/paste from
the event thread), background agent prebuild results, streaming agent
events, permission `Ask` requests, parallel `/btw` side-question
results, and a periodic refresh (spinner animation), polling briefly
when nothing else is ready.

Key dispatch: `InputEditor` handling → submitted text triggers the
agent runner → streamed events are handled by writing to the
`Renderer` and appending to the `Session`.

## Data Flow

```
User input → InputEditor (buffer) → agent runner (prompt + history)
  │
  ▼
Agent → provider client (LLM API)
  │
  ▼ streaming
AgentEvent stream (Token, ToolCall, ToolResult, ...)
  │
  ├── event handler → Renderer (viewport buffer) → terminal draw commands
  ├── ToolCall → HookDispatcher PreToolUse → {Allow, Ask, Deny, rewritten input}
  │     └── tool call → PermissionChecker.check() → {Allowed, Ask, Denied}
  │           ├── Ask → permission handler (user approves/rejects via UI)
  │           └── Allowed → tool execution (bash/read/write/edit/grep/etc.) → PostToolUse rewrite
  └── Done → Session.append() → session storage save
```

Sessions are serialized to JSON files under `$ZS_DATA_DIR` (or the OS
data dir) suffixed with `zerostack`, in `sessions/`. Chat history is
appended to `chat_history.jsonl` in the same data dir. Logs go to
`logs/` as `zerostack-ts-<timestamp>_<pid>.log` when `-v` or
`--log-file` is used.

## Design Decisions

1. **Custom TUI, no widget framework** — the project has its own line
   buffer, markdown renderer, and scroll/selection handling, keeping
   the terminal UI self-contained with no runtime dependencies.
2. **Single provider abstraction** — one provider layer wraps each
   provider variant, so the agent code never branches on providers.
3. **Permission: dual-layer (glob + regex) rules** — glob for the fast
   path, regex for complex patterns. Doom-loop detection tracks
   repeated identical tool calls.
4. **Session compaction** — when token count approaches the context
   window, old messages are summarized and dropped, preserving a
   summary prefix.
5. **Optional subsystems** — `git-worktree`, `mcp`, `subagents`,
   `archmd`, `status-signals`, `logging` ship in the default build;
   `loop`, `acp`, `memory`, `advisor`, `hooks`, `lsp`, `rtk`,
   `multimodal`, `export` are optional subsystems enabled through
   their configuration or CLI flags (see `docs/CONFIG.md`). They are
   implemented behind runtime flags, not separate builds.
6. **Hooks wrap tools, they don't replace permission checks** — the
   hook dispatcher decorates every tool at construction time; it runs
   strictly outside each tool's own `PermissionChecker` call.

## Dependencies

There are no runtime dependencies. Development tooling only:

| Package | Use |
|---|---|
| `typescript` | Type checking (`tsc --noEmit`) |
| `@types/node` | Node.js type definitions |

The program uses Node.js built-ins throughout: `node:fs`,
`node:child_process`, `node:readline`, `node:http(s)` for provider API
calls, and `node:test` for the test suite. Config is parsed from
TOML/YAML/JSON, and sessions are serialized as JSON.

## Entry Points

- **`main()`** (`src/main.ts`) — all modes dispatch from here
- **`--print`** / `-p` — single reply, then exit
- **`--loop`** — iterative prompt/validate loop
- **`--acp`** — ACP server mode
- **Default (no flags)** — interactive TUI
- **`--resume`** / **`--continue`** / **`--session <id>`** — loads a
  prior session before entering TUI/print
- **`--advisor`** — registers the advisor tool so the agent can consult
  a second model for strategic guidance mid-session
- **`--no-hooks`** / **`--hooks-test`** — disables the hook dispatcher,
  or dry-runs a single hook invocation and exits
- **`--status-socket`** — emits `start`/`stop`/`git-conflict` events
  over a Unix socket for external status bars
