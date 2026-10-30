---
description: "How a project design note gives tiny-crow and its exploration subagents a shared picture of a codebase before work starts."
---

# Handing the agent a picture of the codebase

Tiny Crow can read an optional design note, `ARCHITECTURE.md`, that explains a project to
the main agent and to every exploration subagent it sends out. Think of it as the companion
to `AGENTS.md`: where the latter tells the agent how to behave inside a codebase, the former
tells it what that codebase actually is, so the agent does not have to reconstruct the shape
of the system from scratch on every fresh conversation.

## Switching the note off, and how it sits beside the working-rules file

Passing `--no-context-files` (short form `-n`) stops both `AGENTS.md` and `ARCHITECTURE.md`
from loading at all, and the same effect can be had by setting `no_context_files = true` in
the settings file. The two files play different roles, and keeping them apart makes each one
easier to maintain: the working-rules file carries coding conventions, instructions, and
project-specific procedures, and it changes rarely because conventions move slowly, staying
short to medium in length; the design note carries the high-level shape, the relationships
between parts, and the reasoning behind that shape, and it is refreshed whenever a
significant refactor lands or a new module appears, typically running medium in length,
somewhere in the low hundreds to a couple of thousand words. Both are concatenated into the
system prompt preamble, so the agent always has the behaviour rules and the structural
picture side by side: one says how to operate, the other says what is being operated on.

## What the agent gains, and what the people around it gain

Without a note, an agent dropped into a big codebase starts with no structural knowledge at
all. It reads the working-rules file for conventions, then pokes at files one after another,
assembling a mental model as it goes. That approach works, but it spends tokens and turns on
detective work before the real task even begins, and its first answers are necessarily
tentative. With a note in place, the agent arrives already knowing how the project is laid
out and what each module is for, which types and interfaces matter most, where control and
data travel, which design decisions and constraints shaped the result, which outside
dependencies matter and what they do, and where the program starts and how it boots. That
head start cuts down exploratory reads and sharpens the first response.

For the humans, the payoff is steadier: the agent keeps working toward the same design
intent from one session to the next instead of drifting; subagents sent out through the
`task` tool already grasp the architecture and do not need to interrogate the main agent; a
newcomer, human or artificial, gets a structured overview instead of a pile of files to wade
through; and the note stays alive because the agent is prompted to refresh it when a
significant change lands, rather than going stale in a corner.

## Finding the note, and what happens when there is none

Tiny Crow looks upward the same way it looks for `AGENTS.md`, gathering a note from two
tiers. The global tier lives at `~/.local/share/tiny-crow/agent/ARCHITECTURE.md`, in the XDG
data directory. The project tier is an `ARCHITECTURE.md` in the current working directory,
plus one in every parent directory up to the filesystem root. Content from every tier that
is found is joined together, each block headed by the path it came from, so
organisation-wide conventions can live in the global file while each repository keeps its
own project-specific note. The combined content is appended to the agent's system prompt
preamble, after the `AGENTS.md` context and before the custom prompt, which means every
model call carries awareness of the project's architecture, and every subagent receives that
same architecture context in its own preamble, letting it explore with the overall design
already in mind.

When no note turns up anywhere in the directory tree at startup, tiny-crow offers to make
one, printing a prompt that names the project directory and asks whether to create a file,
with a no-by-default choice. Answering yes drops a template into the project root. Accepting
it also injects a system message telling the agent to explore the codebase and fill the file
in with a thorough architectural overview. The template covers, in its own words, the folder
layout, the key types and interfaces, the control path, the data path, the design decisions,
the dependencies, and the ways in.

## Where the note surfaces while you work

The note shows up in several places at once. In the system prompt, its content is appended
after the working-rules context and before the custom prompt. Every subagent gets the
architecture context in its preamble. The `task` tool tells exploration subagents to read
the design note first, before probing. The terminal interface displays a short loaded
message when architecture content exists. And the built-in prompts refer to workflows that
assume the agent is architecture-aware, so the note shapes how the agent plans, not just
what it knows.

## Drafting a note that earns its keep

Keep the note concise and actionable, somewhere around a couple of hundred to five hundred
words for a small project and five hundred to two thousand for a larger one, and treat it as
a cheat sheet the agent consults while deciding, not as a second copy of the code. Describe
structure, relationships, and reasons, and do not reproduce code. The parts worth covering
are a one-line summary for each top-level directory; the five to ten data structures that
matter most; the request lifecycle, the main loops, and the async boundaries; how data comes
in, changes shape, and leaves; why one option was chosen over another for the critical
choices; the key libraries and what each one is for; and the program entry, the API
handlers, and the CLI parsing.

A filled-in sketch for a project shaped like tiny-crow itself might run like this, in prose
rather than as a copy-paste template. For folders: the agent directory covers building,
prompt construction, and tool execution; the interface directory covers the terminal event
loop, the renderer, input handling, and slash commands; the provider directory covers the
model-vendor abstraction; the settings directory covers parsing, validation, and resolution;
and the extras directory covers optional subsystems. For central types: a provider
abstraction for the agent and the model client; a session record holding conversation state,
messages, tokens, and compactions; and a context record holding the loaded working-rules
file, the design note, prompts, and themes. For the control path: flags are parsed, settings
are loaded, and context files are discovered; the agent is built with a system prompt
assembled from working rules, architecture, and the active prompt; the terminal loop turns
user input into agent runs, streaming events, and rendered output; and slash commands
intercept input that starts with a slash. For the data path: user input moves from the input
editor through the event loop into the agent runner; the runner streams agent events for
tokens, reasoning, tool calls, tool results, and completion, with tool calls and results
carrying a correlation identifier so a parallel batch pairs each result with its own call;
and events are rendered incrementally as the renderer writes lines. For decisions: a single
provider abstraction keeps vendor choice flexible, Node.js async I/O handles the terminal,
and async queues carry agent events, user events, and permission requests. For dependencies:
a model-client abstraction, terminal handling for cross-platform manipulation, the Node.js
async runtime, and settings parsing across TOML, YAML, and JSON. For ways in: the main file
handles program entry, CLI parsing, and session setup, and the interactive terminal loop
provides the full-screen session.
