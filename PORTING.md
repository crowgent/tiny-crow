# zerostack-ts — Porting notes

A complete TypeScript port of zerostack (Rust coding-agent TUI) to Node.js,
written in idiomatic TypeScript and run directly with Node 24 type stripping
— no build step, no bundler, no external runtime dependencies.

## Source

- Original repository: `https://github.com/gi-dellav/zerostack` (read-only
  source at `~/workspace/zerostack`; it was never modified — `git status`
  there is clean at the end of this port).
- Source commit: `6f48f5a` — "Merge pull request #330 from
  xavierforge/chore/refresh-model-catalog", branch `main`.
- Original version: zerostack `1.8.5` (kept as the `zerostack-ts` version).
- Original size: 208 Rust files, 62,647 lines (123 non-test files /
  42,260 lines + 85 test files / 20,387 lines).
- Port size: 123 TypeScript source files / 41,863 lines (includes the
  centrally-added production slash wiring in `src/startup.ts`), 81 test
  files + 2 test helpers / 13,062 lines, 1,136 test cases.

## How to run

Requirements: Node.js >= 24 (developed against v24.22.1). Install the
type-checking dev dependencies once with `npm install` (typescript and
`@types/node` only — the program itself uses Node stdlib + `fetch`).

```sh
npm start            # node src/main.ts — interactive TUI
node src/main.ts --help
node src/main.ts --version        # zerostack-ts 1.8.5
node src/main.ts -p "hello"       # headless print mode
node src/main.ts --print-config   # resolved configuration and exit
npm run typecheck    # tsc --noEmit (must be clean)
npm test             # node --test tests/*.test.ts tests/hooks/*.test.ts
```

`package.json` scripts also include `dev` (`node --watch src/main.ts`),
`check` (alias of `typecheck`), `lint` (`tsc --noEmit`), and hook
install/remove helpers converted from the original justfile. The original
`install.sh` / `scripts/*.sh` / `justfile` / Nix / packaging files were
converted into these npm scripts plus the install section in `README.md`;
no Cargo, Nix, or Rust build files are shipped as the build system.

## What was ported (behaviour)

- CLI parsing (hand-rolled parser with the same flags as the clap CLI),
  config load (TOML/YAML/JSON, including small TOML/YAML parsers),
  auth resolution (CLI key > env > config, Ollama keyless, Zen fallback).
- Provider clients via direct `fetch` + SSE streaming: OpenRouter, OpenAI
  (Responses + Chat Completions), Anthropic messages, Gemini streaming,
  Ollama NDJSON, custom OpenAI-compatible gateways, and OpenCode Zen/Go
  transports (baked transport map from `data/opencode-transports.json`).
- Agent loop, runner, builder, prompts, engine, and all tools, for real:
  bash, read, write, edit, grep, find_files, list_dir, todo, lsp, crc,
  normalize — plus permission checker/modes, session save/resume/
  compaction/rewind/redo, sandbox masking, and pricing.
- MCP JSON-RPC over stdio + Streamable HTTP + OAuth 2.0/PKCE, LSP client
  + registry + JSON-RPC, ACP server (NDJSON stdio / TCP), hooks
  dispatcher, subagents, git worktrees, Markdown memory, status signals
  over a Unix socket, headless/loop/export modes.
- TUI in raw-mode ANSI terminal code (`src/ui/terminal.ts`, no external
  TUI framework): app loop, renderer, markdown-to-ANSI, feed, statusline,
  state, events, input editing, pickers (file/command/models/rewind/
  switcher), all slash commands, permission prompts, and the setup wizard.
- Data files are data, not code, and were copied verbatim:
  `data/prompts/*.md` (16), `data/themes/*.json` (17),
  `data/models.json`, `data/opencode-transports.json` (byte-identical,
  verified with `diff -r`). `data/session_export.html` was not copied.

## Feature gating (compile-time flags -> runtime flags)

Rust `#[cfg(feature = ...)]` gates do not exist in TypeScript. Gated
features are implemented behind runtime config flags instead of being
omitted: `acp`, `memory`, `hooks`, `advisor`, `lsp`, `mcp`, `multimodal`,
`rtk`, `loop`, and `export` all have working implementations that activate
from configuration (e.g. hooks via `loadDispatcher(noHooksFlag, headless)`
and `disableAllHooks`, memory via the memory store, advisor via its config).
No ported behaviour is behind a stub.

## Credits removal

All personal/promotional credits were removed from code, README, docs,
and UI strings: author name, personal handle, personal emails, ko-fi /
donate / sponsor links, blog links, star-history badges, and
"inspired by pi/opencode" credit lines. User-facing strings use
`zerostack-ts`. Functional provider/tool names (OpenAI, Anthropic, etc.)
are intact. Verified by grep over `src/`, `tests/`, and `README.md`:
zero matches for those credit strings, zero `TODO`/`FIXME`/
`not implemented` stubs (the only `TODO` matches are the legitimate
`todo_write` tool name and `TODO_LIST` identifier).

**LICENSE exception (the one exception):** `LICENSE` is copied verbatim
and unchanged from the original (GPL-3.0). Its copyright notice was
deliberately NOT stripped, because GPL-3.0 requires it to stay. Verified
byte-identical with `diff`.

## Verification (run by the coordinator, not just slice reports)

- Coverage: `find zerostack/src -name '*.rs'` vs
  `find zerostack-ts/src -name '*.ts'` — exact 1:1 match, **zero gaps**
  (see table below). Every `src/foo.rs` maps to `src/foo.ts` and every
  `src/foo/bar.rs` to `src/foo/bar.ts`; `mod.rs` maps to `mod.ts`.
- Typecheck: `./node_modules/.bin/tsc --noEmit` → exit 0, zero errors.
- Tests: `npm test` → **1,136 passed, 0 failed, 0 skipped, 0 cancelled**.
  Every Rust test file maps to a `tests/*.test.ts` file (81 test files;
  the 4 remaining Rust test files are helpers: `fake_model.rs`,
  `sandbox_support.rs`, `tests/mod.rs`, `tests/hooks/mod.rs`, ported as
  `tests/fake_model.ts` and `tests/sandbox_support.ts` plus local helpers).
  Note: `node --test tests/` does not work on Node v24.22.1 (it tries to
  load the directory itself as a module), so the `test` script is
  `node --test tests/*.test.ts tests/hooks/*.test.ts` — the only
  `package.json` change the test slice had to make.
- Live smoke checks: `node src/main.ts --help`, `--version`
  (`zerostack-ts 1.8.5`), and `--print-config` all run cleanly.
- Source untouched: `git status` in `~/workspace/zerostack` is clean.
  Nothing was pushed to GitHub; no credentials were stored.

## Known honest limits

1. **Local type mirrors (not behaviour gaps).** Several slices defined
   structural types locally instead of importing the canonical module
   (e.g. `Session`/`Config`/`AgentEvent`/`AskRequest`/`RtkConfig`/
   `ContextFiles` shapes duplicated between ui/state, config/mod,
   agent/runner, and session/mod; `config/mod.ts`'s `McpServerConfig`
   is an opaque type while extras/mcp owns the real union; `startup.ts`
   uses a structural `SessionLike`). Tests work around the duplicates
   with casts. A future cleanup pass could re-point these at one
   canonical export each; behaviour is unaffected and the typecheck is
   clean.
2. **Production slash wiring was added centrally after the slices.**
   The ui slice defaulted to "unknown slash command" when no handler was
   injected, and `main.ts` did not wire one. `startup.ts`
   `dispatchInteractive` now adapts the real `handleSlash` dispatcher
   (with session store, memory store, hooks dispatcher, loop factory,
   provider/client/agent factories, export, and MCP logout) and converts
   deferred outcomes and `/quit` (via the App's existing "Interrupted"
   convention) correctly. `/mcp login`'s deferred outcome is not handled
   by `App.handleSlashResult`, so it degrades to an error line instead
   of the login flow.
3. **Approximations, all faithful by design:**
   - Rust enums became const objects + union types, because Node 24
     type stripping rejects TS enums.
   - Trust-store hashes use FNV-1a-64 instead of Rust's `DefaultHasher`
     (SipHash, not stable across processes), so trust-store files are
     not interchangeable with Rust's — the sensitivity properties match.
   - HTML export uses a minimal Markdown renderer (no external deps)
     instead of pulldown-cmark; structure, escaping, and template
     substitution match.
   - Markdown-to-ANSI in the TUI is hand-rolled (headings, code, quotes,
     lists incl. task lists, tables, links, rules); exotic Markdown
     (reference links, footnotes, nested lists) may differ cosmetically.
   - Grep/find use JS `RegExp` (Rust regex syntax differs in edge cases);
     edit byte ranges are computed in JS string-index space (identical
     for ASCII; multibyte-safe because indices derive from string ops).
   - `node:fetch` has no equivalent of reqwest's
     `danger_accept_invalid_certs`, so that toggle logs the same MITM
     warning but cannot disable TLS verification.
   - Data/config directory names use `zerostack-ts` in the new extras
     code (memory, trust store, archmd, loop transcripts); internal
     paths/env vars (`.zerostack/`, `ZS_*`) are unchanged for config
     compatibility, and `ZS_DATA_DIR`/`ZS_CONFIG_DIR` overrides behave
     as in Rust.
   - `ui/events.ts` carries `ZEROSTACK_TS_VERSION = "0.1.0"` as a
     stand-in for the Rust `CARGO_PKG_VERSION` macro; the canonical
     version is `1.8.5` in `package.json` and the CLI.
   - `parseCliArgs` does not skip `argv[0]` (callers pass flag-only argv);
     `configFromJson` stays lenient except in `mergeConfigOverride`.
4. **Small src fixes made while porting tests** (all proven by a ported
   Rust assertion, listed here for auditability): trailing-newline
   `lines()` semantics in agent/tools/normalize, null compaction summary
   and snake_case role tags in agent/runner, Ctrl+Shift+J paste-newline
   handling in ui/mod, blank table-row filtering in ui/markdown,
   `..` in tilde expansion and output-command drain/group-kill in
   sandbox, dead-child EPIPE handling and handshake-failure child kill
   in extras/mcp/client, quoted YAML keys and wrong-type override
   validation in config/load, switcher-kind handling in ui/app,
   root-`""` walker yield in ui/pickers/file, and guard disposal in
   ui/permission_handler.
5. **Test-suite scratch dir:** running `npm test` creates an empty
   `target/` directory in the repo root (sandbox-mask tests use
   `cwd/target/` as scratch). It is debris, not a deliverable, and can
   be deleted after a test run.
6. **Live provider behaviour is not end-to-end verified** (no API keys
   were used): provider streaming, MCP/OAuth logins, and LSP servers are
   covered by unit/integration tests with fakes and local processes, not
   against live vendor APIs.

## File coverage

Every non-test Rust file has exactly one TypeScript counterpart:

| Rust file | TypeScript file |
|---|---|
| `src/agent/builder.rs` | `src/agent/builder.ts` |
| `src/agent/mod.rs` | `src/agent/mod.ts` |
| `src/agent/prompt.rs` | `src/agent/prompt.ts` |
| `src/agent/runner.rs` | `src/agent/runner.ts` |
| `src/agent/tools/bash.rs` | `src/agent/tools/bash.ts` |
| `src/agent/tools/crc.rs` | `src/agent/tools/crc.ts` |
| `src/agent/tools/edit.rs` | `src/agent/tools/edit.ts` |
| `src/agent/tools/find_files.rs` | `src/agent/tools/find_files.ts` |
| `src/agent/tools/grep.rs` | `src/agent/tools/grep.ts` |
| `src/agent/tools/list_dir.rs` | `src/agent/tools/list_dir.ts` |
| `src/agent/tools/lsp.rs` | `src/agent/tools/lsp.ts` |
| `src/agent/tools/mod.rs` | `src/agent/tools/mod.ts` |
| `src/agent/tools/normalize.rs` | `src/agent/tools/normalize.ts` |
| `src/agent/tools/read.rs` | `src/agent/tools/read.ts` |
| `src/agent/tools/todo.rs` | `src/agent/tools/todo.ts` |
| `src/agent/tools/write.rs` | `src/agent/tools/write.ts` |
| `src/auth.rs` | `src/auth.ts` |
| `src/cli.rs` | `src/cli.ts` |
| `src/config/load.rs` | `src/config/load.ts` |
| `src/config/mod.rs` | `src/config/mod.ts` |
| `src/config/types.rs` | `src/config/types.ts` |
| `src/context/mod.rs` | `src/context/mod.ts` |
| `src/context/prompts.rs` | `src/context/prompts.ts` |
| `src/context/resources.rs` | `src/context/resources.ts` |
| `src/context/themes.rs` | `src/context/themes.ts` |
| `src/docs.rs` | `src/docs.ts` |
| `src/engine/mod.rs` | `src/engine/mod.ts` |
| `src/engine/sink.rs` | `src/engine/sink.ts` |
| `src/event.rs` | `src/event.ts` |
| `src/extras/acp/config.rs` | `src/extras/acp/config.ts` |
| `src/extras/acp/mod.rs` | `src/extras/acp/mod.ts` |
| `src/extras/advisor/mod.rs` | `src/extras/advisor/mod.ts` |
| `src/extras/archmd/mod.rs` | `src/extras/archmd/mod.ts` |
| `src/extras/chain/mod.rs` | `src/extras/chain/mod.ts` |
| `src/extras/export.rs` | `src/extras/export.ts` |
| `src/extras/git_worktree/mod.rs` | `src/extras/git_worktree/mod.ts` |
| `src/extras/hooks/channel.rs` | `src/extras/hooks/channel.ts` |
| `src/extras/hooks/decorator.rs` | `src/extras/hooks/decorator.ts` |
| `src/extras/hooks/dispatcher.rs` | `src/extras/hooks/dispatcher.ts` |
| `src/extras/hooks/envelope.rs` | `src/extras/hooks/envelope.ts` |
| `src/extras/hooks/mod.rs` | `src/extras/hooks/mod.ts` |
| `src/extras/hooks/normalize.rs` | `src/extras/hooks/normalize.ts` |
| `src/extras/hooks/settings.rs` | `src/extras/hooks/settings.ts` |
| `src/extras/hooks/subprocess.rs` | `src/extras/hooks/subprocess.ts` |
| `src/extras/hooks/trust.rs` | `src/extras/hooks/trust.ts` |
| `src/extras/loop/headless.rs` | `src/extras/loop/headless.ts` |
| `src/extras/loop/mod.rs` | `src/extras/loop/mod.ts` |
| `src/extras/loop/plan.rs` | `src/extras/loop/plan.ts` |
| `src/extras/loop/transcript.rs` | `src/extras/loop/transcript.ts` |
| `src/extras/lsp/client.rs` | `src/extras/lsp/client.ts` |
| `src/extras/lsp/mod.rs` | `src/extras/lsp/mod.ts` |
| `src/extras/lsp/registry.rs` | `src/extras/lsp/registry.ts` |
| `src/extras/lsp/rpc.rs` | `src/extras/lsp/rpc.ts` |
| `src/extras/mcp/client.rs` | `src/extras/mcp/client.ts` |
| `src/extras/mcp/config.rs` | `src/extras/mcp/config.ts` |
| `src/extras/mcp/mod.rs` | `src/extras/mcp/mod.ts` |
| `src/extras/mcp/oauth.rs` | `src/extras/mcp/oauth.ts` |
| `src/extras/mcp/tool.rs` | `src/extras/mcp/tool.ts` |
| `src/extras/memory/mod.rs` | `src/extras/memory/mod.ts` |
| `src/extras/mod.rs` | `src/extras/mod.ts` |
| `src/extras/multimodal/mod.rs` | `src/extras/multimodal/mod.ts` |
| `src/extras/rtk.rs` | `src/extras/rtk.ts` |
| `src/extras/status_signals.rs` | `src/extras/status_signals.ts` |
| `src/extras/subagents/builder.rs` | `src/extras/subagents/builder.ts` |
| `src/extras/subagents/mod.rs` | `src/extras/subagents/mod.ts` |
| `src/extras/subagents/prompt.rs` | `src/extras/subagents/prompt.ts` |
| `src/extras/subagents/task_tool.rs` | `src/extras/subagents/task_tool.ts` |
| `src/extras/truncate.rs` | `src/extras/truncate.ts` |
| `src/fs.rs` | `src/fs.ts` |
| `src/logging.rs` | `src/logging.ts` |
| `src/main.rs` | `src/main.ts` |
| `src/models_catalog.rs` | `src/models_catalog.ts` |
| `src/permission/ask.rs` | `src/permission/ask.ts` |
| `src/permission/checker.rs` | `src/permission/checker.ts` |
| `src/permission/mod.rs` | `src/permission/mod.ts` |
| `src/permission/pattern.rs` | `src/permission/pattern.ts` |
| `src/pricing.rs` | `src/pricing.ts` |
| `src/print.rs` | `src/print.ts` |
| `src/provider.rs` | `src/provider.ts` |
| `src/retry.rs` | `src/retry.ts` |
| `src/sandbox.rs` | `src/sandbox.ts` |
| `src/session/chat_history.rs` | `src/session/chat_history.ts` |
| `src/session/mod.rs` | `src/session/mod.ts` |
| `src/session/storage.rs` | `src/session/storage.ts` |
| `src/setup/mod.rs` | `src/setup/mod.ts` |
| `src/startup.rs` | `src/startup.ts` |
| `src/ui/app.rs` | `src/ui/app.ts` |
| `src/ui/event_handler.rs` | `src/ui/event_handler.ts` |
| `src/ui/events.rs` | `src/ui/events.ts` |
| `src/ui/feed.rs` | `src/ui/feed.ts` |
| `src/ui/input/cursor.rs` | `src/ui/input/cursor.ts` |
| `src/ui/input/mod.rs` | `src/ui/input/mod.ts` |
| `src/ui/input/pickers.rs` | `src/ui/input/pickers.ts` |
| `src/ui/markdown.rs` | `src/ui/markdown.ts` |
| `src/ui/mod.rs` | `src/ui/mod.ts` |
| `src/ui/permission_handler.rs` | `src/ui/permission_handler.ts` |
| `src/ui/pickers/file.rs` | `src/ui/pickers/file.ts` |
| `src/ui/pickers/handlers.rs` | `src/ui/pickers/handlers.ts` |
| `src/ui/pickers/list.rs` | `src/ui/pickers/list.ts` |
| `src/ui/pickers/mod.rs` | `src/ui/pickers/mod.ts` |
| `src/ui/pickers/models.rs` | `src/ui/pickers/models.ts` |
| `src/ui/pickers/rewind.rs` | `src/ui/pickers/rewind.ts` |
| `src/ui/pickers/switcher.rs` | `src/ui/pickers/switcher.ts` |
| `src/ui/renderer.rs` | `src/ui/renderer.ts` |
| `src/ui/roles.rs` | `src/ui/roles.ts` |
| `src/ui/slash/add.rs` | `src/ui/slash/add.ts` |
| `src/ui/slash/content.rs` | `src/ui/slash/content.ts` |
| `src/ui/slash/docs.rs` | `src/ui/slash/docs.ts` |
| `src/ui/slash/features.rs` | `src/ui/slash/features.ts` |
| `src/ui/slash/help.rs` | `src/ui/slash/help.ts` |
| `src/ui/slash/hooks.rs` | `src/ui/slash/hooks.ts` |
| `src/ui/slash/init.rs` | `src/ui/slash/init.ts` |
| `src/ui/slash/memory.rs` | `src/ui/slash/memory.ts` |
| `src/ui/slash/mod.rs` | `src/ui/slash/mod.ts` |
| `src/ui/slash/outcome.rs` | `src/ui/slash/outcome.ts` |
| `src/ui/slash/providers.rs` | `src/ui/slash/providers.ts` |
| `src/ui/slash/review.rs` | `src/ui/slash/review.ts` |
| `src/ui/slash/session.rs` | `src/ui/slash/session.ts` |
| `src/ui/slash/settings.rs` | `src/ui/slash/settings.ts` |
| `src/ui/state.rs` | `src/ui/state.ts` |
| `src/ui/statusline.rs` | `src/ui/statusline.ts` |
| `src/ui/terminal.rs` | `src/ui/terminal.ts` |
| `src/ui/utils.rs` | `src/ui/utils.ts` |
