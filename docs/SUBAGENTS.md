---
description: "Parallel read-only subagents in tiny-crow: the task tool, model and provider overrides, and per-agent tool limits."
---

# Subagents: read-only codebase exploration

## The idea

Subagents let the main agent hand a **precise, read-only investigation**
to a **read-only child agent**. Each subagent gets one specific
technical question (for example, "Where is MCP support implemented?")
and returns a focused answer. The main agent's context stays clean while
the lookup is still thorough.

Subagents are built for **highly specific questions**, not wide
exploration. Avoid broad instructions like "check all documentation" —
instead ask precise questions that can be answered with a few file
reads and searches.

When the main agent calls the `task` tool, one subagent is spawned per
prompt. If multiple prompts are given, they run in **parallel**. Each
subagent has access only to read tools and returns a summary of
findings, which the main agent then folds into its response.

## Availability

Subagents are included in this build as an optional subsystem. Configure
the subagent model and provider through the options in CONFIG.md.

## The `task` tool

The main agent has a tool called `task`. It accepts:

```json
{
  "prompts": ["explore the auth module", "find all API route definitions"]
}
```

- **Single prompt**: one subagent explores, returns findings.
- **Multiple prompts**: subagents run concurrently. Each
  result appears under a `## Task N:` heading.

## What a subagent can use

### Read tools (always available)

| Tool       | Purpose                       |
|------------|-------------------------------|
| `read`     | Read file contents            |
| `grep`     | Regex search in files         |
| `find_files` | Find files by regex on filename |
| `list_dir` | List directory contents       |
| `todo`     | Track exploration steps       |

### Memory tools (when memory is enabled)

| Tool            | Purpose                                |
|-----------------|----------------------------------------|
| `memory_read`   | Read memory files (long-term, notes…)  |
| `memory_search` | Keyword search across all memory       |

### Deliberately left out

| Tool           | Reason                                  |
|----------------|-----------------------------------------|
| `write`        | Subagent is read-only by design         |
| `edit`         | Subagent is read-only by design         |
| `bash`         | Not needed — read tools cover exploration |
| `memory_write` | Subagent should not persist memory      |
| `mcp_tool`     | External, unpredictable — out of scope  |

## Why no permission system is safe here

The subagent is built with **no permission system** (`permission: None`
on all its tools). This is safe because it only has read tools:

- **Read tools with `None` permission** will read any path without
  checks, but they cannot write, edit, or execute commands.
- The worst a subagent can do is read files, which is exactly what it
  is designed for.

The main agent's `task` tool itself goes through the normal permission
check (`check_perm("task", …)`), so users can allow/ask/deny it via
their permission rules.

## Configuration

| Config field           | Type      | Default             | Description                           |
|------------------------|-----------|---------------------|---------------------------------------|
| `task_max_turns`       | `usize`   | `15`                | Max agent turns per subagent          |
| `task_enabled`         | `bool`    | `true`              | Whether the `task` tool is registered |
| `subagent_model`       | `string`  | `none (uses main model)` | Model name or quick-model alias       |
| `subagent_provider`    | `string`  | (same as main)      | Provider for the subagent (optional)  |

### How the subagent model is picked (in order)

1. `subagent_model` is set and matches a **quick model name** (e.g. `"deepseek-v4-flash"`) → uses that quick model's provider + model.
2. `subagent_model` is set but does **not** match a quick model → uses the raw model string with `subagent_provider` (or the main provider as fallback).
3. `subagent_model` is **not** set but `subagent_provider` is → uses the main model with the specified provider.
4. Neither is set → falls back to the main agent's model (same provider + model).

When the subagent uses a different provider than the main agent, a
separate API client is created at startup. The subagent client is
independent from the main agent's client and can be switched at runtime.

Example (in your config file):

```json
{
  "task_max_turns": 20,
  "task_enabled": true,
  "subagent_model": "deepseek-v4-flash",
  "subagent_provider": "openrouter"
}
```

## Slash commands for subagents

| Command                            | Description                                |
|------------------------------------|--------------------------------------------|
| `/model-subagent [name]`           | Show or switch the subagent's model        |
| `/models-subagent [name]`          | List quick models or switch subagent to one|

- **`/model-subagent`** with no arguments shows the current subagent
  provider and model. With a model name, it switches the subagent to
  that model (using the same provider).
- **`/models-subagent`** with no arguments lists quick models. With a
  quick model name, it switches the subagent to that quick model's
  provider + model. If the quick model uses a different provider, a new
  API client is created.

These commands update the global `SubagentConfig` at runtime. The next
call to the `task` tool picks up the new settings automatically.

## Internals

```
Main Agent                               Subagent(s)
┌──────────────┐                         ┌─────────────────────┐
│ read/write   │                         │ read                │
│ edit/bash    │  calls "task" tool      │ grep                │
│ grep/find_files│ ──────────────────────→│ find_files          │
│ list_dir     │   with prompt(s)        │ list_dir            │
│ todo         │                         │ todo                │
│ task  ───────┤   spawns parallel       │ memory_read         │
│              │   subagents via         │ memory_search       │
│              │   concurrent tasks          │                     │
│              │   ──────────────        │ runs ≤ max_turns    │
│              │   returns findings ────→│ returns summary     │
└──────────────┘                         └─────────────────────┘
```

Key files:

| File                                         | Role                                  |
|----------------------------------------------|---------------------------------------|
| `src/extras/subagents/mod.ts`                | Module root, static config            |
| `src/extras/subagents/task_tool.ts`          | `TaskTool` implementation             |
| `src/extras/subagents/builder.ts`            | Subagent construction (`build_explore_agent`) |
| `src/extras/subagents/prompt.ts`             | Subagent system prompt                |
| `src/agent/runner.ts` (`run_subagent`)       | Silent agent execution; reports each subagent tool call as an event |
| `src/agent/builder.ts`                       | Wires `TaskTool` into main agent      |
| `src/provider.ts` (`runSubagent`) | Provider dispatch                  |
| `src/main.ts`                                | Initializes `SubagentConfig`          |

## The subagent's own prompt

The subagent receives its own system prompt focused on answering
specific technical questions (`src/extras/subagents/prompt.ts`). It
instructs the subagent to focus on the question given, use the available
tools, and report findings concisely without preamble or wandering.

## Running in parallel

When multiple prompts are supplied, each runs as its own concurrent
task. Results are gathered together once all tasks finish. A failed
subagent (panic or error) does not cancel the others — its output shows
the error while the rest complete normally. Results are ordered by the
original prompt index.
