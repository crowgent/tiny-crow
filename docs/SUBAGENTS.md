---
description: "Tiny-crow's parallel read-only subagents: configuration, the task tool, the tools they may use, and the code behind them."
---

# Read-only subagents

A subagent is a child agent that takes one narrow investigation and
answers it, without touching anything. The main agent stays focused
on the user's request while a subagent digs through the codebase
for a specific fact, then hands back a short summary that the main
agent folds into its reply.

Subagents ship in this build as an optional subsystem. The model
and provider they use are configured through the options in
CONFIG.md.

## Configuration and model selection

The settings, with their types and defaults:

- `task_max_turns`, a `usize` defaulting to `15`: agent turns
  allowed per subagent.
- `task_enabled`, a `bool` defaulting to `true`: whether the
  `task` tool is offered at all.
- `subagent_model`, a `string` defaulting to none, in which case
  the main model is used: model name, or a quick-model alias.
- `subagent_provider`, a `string` defaulting to the same provider
  as the main agent: provider for the subagent, optional.

The choice follows this order, first match wins:

1. `subagent_model` is set and names a quick model — the subagent
   uses that quick model's provider and model together.
2. `subagent_model` is set but names no quick model — the raw
   model string is used, with `subagent_provider` if given, or the
   main provider otherwise.
3. `subagent_model` is empty but `subagent_provider` is set — the
   main model runs under the specified provider.
4. Neither is set — the subagent simply inherits the main agent's
   model and provider.

If the subagent ends up on a different provider from the main
agent, a separate API client is built at startup. That client is
independent of the main agent's client and can be swapped while
the agent is running. A configuration example:

```json
{"task_max_turns":12,"task_enabled":true,"subagent_model":"gpt-5.4-mini","subagent_provider":"cheaper-inference"}
```

## Invoke subagents with the `task` tool

The main agent reaches subagents through a tool called `task`. It
takes a list of prompts:

```json
{"prompts":["survey the billing module","locate every webhook handler"]}
```

Give it one prompt and one subagent goes off and reports back.
Give it several and they run side by side, each result arriving
under a `## Task N:` heading in prompt order.

## Tool access and restrictions

Reading tools, always present:

- `read` — read a file's contents.
- `grep` — search files with a regex.
- `find_files` — find files by filename regex.
- `list_dir` — list what a directory holds.
- `todo` — keep track of exploration steps.

Memory tools, only when memory is on:

- `memory_read` — read memory files (long-term, notes, and more).
- `memory_search` — keyword search across all memory.

Tools kept out on purpose:

- `write` and `edit` — a subagent reads only, by design.
- `bash` — reading tools already cover exploration.
- `memory_write` — a subagent must not persist memory.
- `mcp_tool` — external and unpredictable, out of scope.

## Permission model

Every subagent tool carries `permission: None`, which means no
permission prompt ever appears. That sounds loose until you notice
what the tools can do: they can only read. A read tool with no
permission check will open any path without asking, but it cannot
write a file, change a file, or run a command. The worst outcome is
a file being read, which is precisely the job.

The `task` tool on the main agent's side is different. It goes
through the ordinary permission check (`check_perm("task", …)`),
so your permission rules can allow, ask about, or deny spawning
subagents.

## Change the model during a session

- `/model-subagent` with nothing after it reports the subagent's
  current provider and model; give it a model name and the subagent
  moves to that model, keeping the same provider.
- `/model-subagent [name]` — show or change the subagent's model.
- `/models-subagent` with nothing after it lists quick models;
  give it a quick model name and the subagent moves to that quick
  model's provider and model; when that provider differs, a fresh
  API client is created.
- `/models-subagent [name]` — list quick models, or move subagents
  to one.

Both commands rewrite the global `SubagentConfig` while the agent
runs, so the next `task` call automatically picks up the new
settings.

## Runtime architecture

The main agent holds the full toolset — read, write, edit, bash,
grep, find_files, list_dir, todo, and the `task` tool itself. When
it calls `task` with prompts, subagents are spawned as concurrent
tasks. Each subagent works with the reading tools plus, when
memory is on, the memory reading tools, and runs for at most
`max_turns` turns. When it finishes, it returns a summary to the
main agent, which continues from there. Each subagent's tool calls
surface as events during its silent run.

The code behind this, file by file:

- `src/extras/subagents/mod.ts` — module root, static config.
- `src/extras/subagents/task_tool.ts` — the `TaskTool`
  implementation.
- `src/extras/subagents/builder.ts` — building a subagent
  (`build_explore_agent`).
- `src/extras/subagents/prompt.ts` — the subagent's system prompt.
- `src/agent/runner.ts` (`run_subagent`) — silent execution; each
  subagent tool call becomes an event.
- `src/agent/builder.ts` — wiring `TaskTool` into the main agent.
- `src/provider.ts` (`runSubagent`) — provider dispatch.
- `src/main.ts` — setting up `SubagentConfig` at startup.

## Subagent system prompt

A subagent gets its own system prompt
(`src/extras/subagents/prompt.ts`), written around answering one
specific technical question. It tells the subagent to stay on the
question it was given, use the tools it has, and report findings
tightly, with no preamble and no wandering.

## Parallel execution and failures

When several prompts arrive together, each becomes its own
concurrent task, and the results are gathered once every task has
finished. If one subagent fails — through a panic or an error —
the others keep going: the failed one's output shows the error
while the rest complete normally. Results come back in the order
of the original prompts.

## Write focused prompts

Subagents shine on questions with a tight scope — something like
"Which module handles invoice export?" A vague brief such as
"survey the whole repository" wastes the mechanism: the answer
sprawls, the context it returns sprawls with it, and the main
agent gains little. A question that can be settled with a few file
reads and searches is the right shape.
