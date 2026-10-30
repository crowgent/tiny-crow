# How Tiny Crow Is Built — v1.8.5

Tiny Crow is a compact coding agent in TypeScript, running on Node.js
24 or newer with type stripping. There is no build step: everything
under `src/` executes as written, and everything under `tests/` runs
under Node's built-in test runner.

## Layout of the tree

| Path | What lives there |
|---|---|
| `src/main.ts` | Entry point, CLI dispatch, mode routing |
| `src/cli.ts` | CLI argument definitions |
| `src/provider.ts` | The LLM provider layer (OpenAI, Anthropic, Gemini, Ollama, OpenRouter) |
| `src/auth.ts` | API key resolution |
| `src/event.ts` | `AgentEvent` (streaming LLM output) and `UserEvent` (TUI input) |
| `src/engine/` | The agent engine: event loop, tool dispatch, streaming |
| `src/agent/` | Agent lifecycle: `builder.ts` (construction + tool injection), `runner.ts` (spawn, stream, subagent execution), `prompt.ts` (system prompts), `tools/` (read, write, edit, bash, grep, find_files, list_dir, todo; plus `TaskTool` and `AdvisorTool`) |
| `src/session/` | Session state: `mod.ts` (messages, compactions, costs), `storage.ts` (JSON file I/O), `chat_history.ts` |
| `src/permission/` | Safety: `checker.ts` (glob + regex rules, doom-loop detection), `ask.ts` (user prompt UI), `pattern.ts` |
| `src/ui/` | The hand-rolled TUI: `app.ts` (event loop), `terminal.ts` (raw mode guard), `renderer.ts` (line buffer + viewport), `input/` (text editor + pickers), `statusline.ts`, `markdown.ts`, `event_handler.ts`, `state.ts` (grouped TUI state), `slash/` (slash commands, including the `/` picker) |
| `src/context/` | Context gathering: embedded prompt themes (`prompts.ts`, `themes.ts`), AGENTS.md/ARCHITECTURE.md loading |
| `src/config/` | Configuration: `load.ts` (TOML/YAML/JSON from disk + env), `types.ts` (QuickModel, CustomProvider, Colors, EditSystem) |
| `src/extras/` | Optional subsystems: `loop/` (headless), `mcp/` (MCP client), `acp/` (ACP server), `memory/` (persistent memory), `subagents/` (parallel task delegation), `git_worktree/`, `archmd/`, `advisor/` (external model consultation, `/advisor`), `multimodal/` (image/PDF ingestion), `hooks/` (lifecycle hook dispatch: `PreToolUse`/`PostToolUse`/`Stop`/`UserPromptSubmit`/session + subagent events, trust-hash confirmation), `lsp/` (language servers), `rtk.ts` (output filtering), `chain/` (brainstorm → plan → code prompt transitions), `status_signals.ts` (Unix-socket start/stop/git-conflict signals) |
| `src/sandbox.ts` | `bwrap`/`zerobox` command wrapping |
| `src/fs.ts` | Filesystem utilities |
| `src/pricing.ts` | Token pricing constants |
| `src/startup.ts` | Startup phases: config/client/context resolution, then optional-subsystem initialisation |
| `src/logging.ts` | Structured logging (`--log-level`, `TC_LOG`, `-v` log files) |
| `src/docs.ts` | Built-in documentation lookup (GET_STARTED guide, `--tutor`) |

## The central types, and how they relate

- **`Config`** — the resolved configuration; it drives all runtime
  behaviour.
- **`Cli`** — command-line arguments, which override `Config` fields.
- **Provider client / agent** — one provider layer wraps every
  provider's client (OpenAI, Anthropic, Gemini, Ollama, OpenRouter).
  The agent offers print mode (one reply, then exit) and the spawned
  streaming runner.
- **`AgentEvent`** — `Token`, `Reasoning`, `ToolCall`, `ToolResult`,
  `SubagentToolCall`, `Error`, `Done`.
- **`UserEvent`** — `Key`, `ScrollUp/Down`, `Resize`, `Paste`,
  `MouseDown/Drag/Up`.
- **`Session`** — serialisable state: messages, compactions, costs,
  permission allowlist, model/provider info.
- **`PermissionChecker`** — two-layer (glob + regex) rules, doom-loop
  detection, security-mode dispatch.
- **`Renderer`** — line-buffered viewport, Markdown rendering,
  scroll/selection. Every byte of terminal I/O passes through the
  renderer backend; tests use a fake backend with fixed geometry that
  captures frames.
- **`InputEditor`** — text buffer, cursor, history, kill-ring, picker
  integration.
- **`ContextFiles`** — loaded agents, prompts, themes, architecture docs.
- **`HookDispatcher`** — combines `PreToolUse` verdicts
  (`Allow`/`Defer`/`Ask`/`Deny`, most severe wins) and applies
  `PostToolUse`/lifecycle decisions (`Continue`/`Block`/`Rewrite`).
  It wraps every tool outside that tool's own `PermissionChecker`
  check, so a `PreToolUse` rewrite can only narrow a request — it can
  never grant a permission the checker would otherwise deny.

## Testing

- Tests live in `tests/` as `*.test.ts` files and run with Node's
  built-in runner: `npm test` (`node --test tests/*.test.ts
  tests/hooks/*.test.ts`).
- Type safety is checked separately with `npm run typecheck`
  (`tsc --noEmit`). Never claim a change works without both.
- Headless main-loop tests drive the real TUI loop with no terminal
  and no network, rendering into a fake backend and feeding scripted
  `UserEvent`s; agent runs use a mock completion model.

## How control flows

```
CLI parse → config load → context load → session load
  │
  ├── --print-config → print and exit
  ├── --acp → ACP server mode
  ├── --print → single agent reply, then exit
  ├── --loop → headless iterative loop mode
  └── (default) → interactive TUI
```

### The interactive TUI loop

The loop watches for: user events (keyboard/mouse/resize/paste from
the event thread), background agent prebuild results, streaming agent
events, permission `Ask` requests, parallel `/btw` side-question
results, and a periodic refresh (spinner animation), polling briefly
when nothing else is ready.

Dispatch in brief: `InputEditor` handling → submitted text starts the
agent runner → streamed events are written to the `Renderer` and
appended to the `Session`.

## How data flows

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

Sessions are serialised to JSON files under `$TC_DATA_DIR` (or the OS
data dir) suffixed with `tiny-crow`, in `sessions/`. Chat history is
appended to `chat_history.jsonl` in the same data dir. Logs go to
`logs/` as `tiny-crow-<timestamp>_<pid>.log` when `-v` or `--log-file`
is used.

## Design choices

1. **A custom TUI, no widget framework** — the project owns its line
   buffer, Markdown renderer, and scroll/selection handling, keeping
   the terminal UI self-contained with zero runtime dependencies.
2. **One provider layer** — a single abstraction wraps each provider
   variant, so agent code never branches on providers.
3. **Permissions in two layers (glob + regex)** — glob for the fast
   path, regex for complex patterns. Doom-loop detection watches for
   repeated identical tool calls.
4. **Session compaction** — as token count nears the context window,
   old messages are summarised and dropped, keeping a summary prefix.
5. **Optional subsystems behind flags, not builds** — `git-worktree`,
   `mcp`, `subagents`, `archmd`, `status-signals`, and `logging` ship
   in the default build; `loop`, `acp`, `memory`, `advisor`, `hooks`,
   `lsp`, `rtk`, `multimodal`, and `export` are optional subsystems
   switched on through configuration or CLI flags (see
   `docs/CONFIG.md`). They are implemented behind runtime flags, not
   separate builds.
6. **Hooks wrap tools; they never replace permission checks** — the
   hook dispatcher decorates every tool at construction time and runs
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
TOML/YAML/JSON, and sessions are serialised as JSON.

## Entry points

- **`main()`** (`src/main.ts`) — every mode dispatches from here
- **`--print`** / `-p` — one reply, then exit
- **`--loop`** — iterative prompt/validate loop
- **`--acp`** — ACP server mode
- **Default (no flags)** — interactive TUI
- **`--resume`** / **`--continue`** / **`--session <id>`** — load a
  prior session before entering TUI/print
- **`--advisor`** — register the advisor tool so the agent can consult
  a second model for strategic guidance mid-session
- **`--no-hooks`** / **`--hooks-test`** — disable the hook dispatcher,
  or dry-run a single hook invocation and exit
- **`--status-socket`** — emit `start`/`stop`/`git-conflict` events
  over a Unix socket for external status bars
