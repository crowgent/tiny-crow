---
description: "Every setting tiny-crow understands: where the settings file lives, how values override each other, a worked example, and a per-option reference with exact keys, types, and defaults."
---

# Steering tiny-crow with a settings file

Tiny-crow's behaviour is steered by one optional settings file, written in TOML, YAML, or
JSON, and this page explains where that file is found, how a project-level file layers over
a global one, how flags and environment values win over the file, and what every key does.
Every key in the reference below is optional, and where a command-line flag, or a value fed
by an environment variable such as `TC_PROVIDER` or `TC_MODEL`, and a config entry both
speak to the same behaviour, the flag or environment value wins.

## A small working setup, in both syntaxes

The same setup, first in YAML, using fresh example values throughout so nothing here should
be copied as a default:

```yaml
provider: anthropic
model: anthropic/claude-haiku-4-5
max_tokens: 4096
temperature: 0.2
context_window: 120000
reserve_tokens: 2048
keep_recent_tokens: 6000
compact_enabled: true
deny_repeated_reads: false
default_prompt: review
default_permission_mode: standard
permission-modes:
  - guarded
  - standard
show_tool_details: 1
sandbox: false
quick_models:
  fast:
    provider: openai
    model: gpt-5-mini
custom_providers:
  work-gateway:
    provider_type: openai
    base_url: https://proxy.example.net/v1
    api_key_env: WORK_GATEWAY_API_KEY
    api_style: completions
    timeout_secs: 30
permission:
  "*": ask
  read: allow
  write:
    "**/*.txt": allow
    "**": ask
  bash:
    "npm run lint": allow
    "rm **": deny
```

And the same setup in TOML, with the same values, only the syntax differing:

```toml
provider = "anthropic"
model = "anthropic/claude-haiku-4-5"
max_tokens = 4096
temperature = 0.2
context_window = 120000
reserve_tokens = 2048
keep_recent_tokens = 6000
compact_enabled = true
deny_repeated_reads = false
edit_system = "similarity"
default_prompt = "review"
default_permission_mode = "standard"
permission-modes = ["guarded", "standard"]
show_tool_details = 1
[quick_models.fast]
provider = "openai"
model = "gpt-5-mini"
[custom_providers.work-gateway]
provider_type = "openai"
base_url = "https://proxy.example.net/v1"
api_key_env = "WORK_GATEWAY_API_KEY"
api_style = "completions"
[permission]
"*" = "ask"
read = "allow"
[permission.write]
"**/*.txt" = "allow"
"**" = "ask"
[permission.bash]
"npm run lint" = "allow"
"rm **" = "deny"
permission.doom_loop = "ask"
```

## Where the file is looked for, and what an unknown key does

Tiny-crow searches in a fixed order, and the first location that holds a file wins outright:
a file higher up the list replaces anything below it, it does not merge with it. When
`TC_CONFIG_DIR` is set, the search tries `$TC_CONFIG_DIR/config.toml` first, then
`config.yaml` and `config.yml`, then `config.json`. Otherwise it tries
`~/.config/tiny-crow/config.toml` first, then the YAML names, then `config.json`, and
otherwise it tries `~/.local/share/tiny-crow/config.toml` first, then the YAML names, then
`config.json`. If none of those paths holds a file, tiny-crow writes a fresh default
`config.toml` into the lowest-priority directory, `~/.local/share/tiny-crow/`, and on macOS
the XDG-style config path above resolves to `~/Library/Application Support/tiny-crow/`
instead. Within any single search directory the format preference is fixed in the order just
given, and JSON is kept for older setups because YAML is a superset of JSON, so a legacy
JSON file parses cleanly through the YAML reader.

A top-level key the program does not recognise, whether a typo or a key belonging to an
optional subsystem that is not compiled in, triggers a warning when the program starts and
is otherwise disregarded, so a misspelling fails loudly enough to notice but does not stop
the program.

## Settings that apply to one project only

A `.tiny-crow/config.toml` sitting in the current working directory is blended on top of the
global file at startup, and you do not need to repeat the whole file, since any subset of
keys may appear. Tables such as `mcp_servers`, `quick_models`, and `api_keys` merge key by
key, while plain values and arrays replace the global value wholesale, and keys missing from
the local file simply keep their global values, with startup printing a note whenever such
an override takes effect. Treat that local file with the same caution as the global one,
because it is trusted identically: it can switch on permissive modes, add permission rules,
or launch MCP server processes, so when you open a checkout you do not fully trust, read its
`.tiny-crow/config.toml` before running anything. As a small illustration with a different
model and prompt from the worked example above:

```toml
model = "openai/gpt-5-mini"
show_reasoning = false
[mcp_servers.docs-fs]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "./docs"]
```

## Where prompts and themes are picked up

Prompts and themes each come from a stack of sources, and for files that share a name, the
later source in the stack wins. For prompts, from weakest to strongest, the stack is the
ones shipped inside the program; `~/.local/share/tiny-crow/prompts/` for the global per-user
tier; `prompts/` in the project, relative to the working directory; `.tiny-crow/prompts/` as
the project-level config directory; and finally `--prompts-dir <path>` or `TC_PROMPTS_DIR`
from the command line, strongest of all, repeatable, with the last one given winning. Extra
command-line prompt directories load `.md` files just like the other tiers, so a file with a
name already seen lower down overrides it and a new name is simply added, while a directory
that does not exist is skipped with a warning. The environment variable's entries, separated
by colons, for example a shared directory followed by a team directory, are appended after
the `--prompts-dir` flags, so the environment variable's final entry ends up strongest of
all. For themes, from weakest to strongest, the stack is the ones shipped inside the
program; `~/.local/share/tiny-crow/themes/` for the global per-user tier; and `themes/` in
the project, relative to the working directory. Setting `TC_CONFIG_DIR` moves only the
config file's home, while prompts and themes keep using `TC_DATA_DIR` or the default data
directory, so reach for `TC_CONFIG_DIR` when you want the settings file to sit somewhere
apart from the data files.

## Reference, part one: display, interaction, and editing

Each option below is given as its own subsection, with its key, its type, and its default
stated exactly as the program understands them, followed by an explanation in fresh words.
Nothing has been left out; the grouping here is by what the key controls, in a different
order from any earlier grouping, starting with the screen rather than the model.

### `show_cost_always`: whether the price stays visible

- Type: boolean. Default: `false`. When true, the session cost stays visible in the status
  bar even when it reads `$0.0000`, as happens when the model carries no per-token pricing,
  and when false the cost stays hidden until it rises above zero.

### `always_show_welcome`: whether the greeting repeats

- Type: boolean. Default: `false`. When true, the welcome banner appears on every startup,
  skipping the one-shot marker file that would otherwise suppress it after the first run.

### `show_tool_details`: how much tool output is previewed

- Type: boolean or integer. Default: `3`. It controls tool-result previews in the terminal
  interface: false hides output, true shows every line, and an integer caps the preview at
  that many lines, for example three lines when the value is three.

### `show_reasoning`: whether streamed thinking is shown

- Type: boolean. Default: `false`. When true, streamed reasoning text appears in the
  terminal interface, and it can still be flipped while running with `Ctrl+R` or
  `/reasoning`.

### `statusline`: a status bar you design yourself

- Type: table. No default value as such: without it, a built-in default layout is used, and
  with it you get a configurable status bar of up to three lines of coloured segments,
  described in the status-bar section later in this page.

### `chat_left_margin`: padding for the chat area alone

- Type: integer. Default: `0`. It sets left padding, in columns, applied to the chat area
  alone, leaving the input and status rows untouched.

### `mouse_capture`: who owns the mouse

- Type: boolean. Default: `true`. When true, the terminal interface takes over mouse events
  so tiny-crow can provide scrolling, click-to-place-cursor, and drag-to-select and copy,
  and when false, selection, copy, and paste fall back to the terminal emulator, but in-app
  mouse features, mouse-wheel scrolling included, stop working, leaving scrolling to `PgUp`
  and `PgDn`, `Ctrl+Up` and `Ctrl+Down`, or `Home` and `End` instead.

### `default_prompt`: the prompt active at startup

- Type: string. Default: `code`. This is the prompt activated at startup, and when the
  prompt file's first line carries a mode directive, the security mode is set automatically,
  as described in the prompt-directives section later in this page.

### `editor`: the editor opened by a shortcut

- Type: string. Default: the `$EDITOR` environment variable, then `editor`, then `nano`.
  This is the editor command opened by `Ctrl+G`.

### `colors`: background and role colours

- Type: object. No single default: it holds background colour overrides for the terminal
  interface, described in the colours section later in this page.

### `auto-update-prompts`: whether changed prompts refresh silently

- Type: boolean. No default value: when true, prompt files that changed in a new version are
  updated without asking; when false, they are never updated; when unset, the program asks
  interactively; and nothing happens when the installed prompts already match the embedded
  defaults.

### `auto-update-themes`: whether changed themes refresh silently

- Type: boolean. No default value: when true, theme files that changed in a new version are
  updated without asking; when false, they are never updated; when unset, the program asks
  interactively; and nothing happens when the installed themes already match the embedded
  defaults.

### `edit_system`: which edit format the agent uses

- Type: string. Default: `"similarity"`. The two values are similarity, meaning SEARCH and
  REPLACE with fuzzy matching, and hashedit, meaning CRC-32 tag-based check-and-set edits,
  described in the edit-modes section later in this page and in HASHEDIT.md.

## Reference, part two: permissions and modes

### `permission`: glob-pattern permission rules

- Type: object. No default stated: permission rules written with glob patterns, described in
  the permission-rules section later in this page.

### `permission-regex`: regex-pattern permission rules

- Type: object. No default stated: built exactly like `permission`, except its patterns are
  read as regular expressions rather than globs.

### `permission-allow`: a flat allow list per tool

- Type: object. No default stated: tool names mapped to lists of glob patterns that are
  allowed, working next to the `permission` field, as described in the permission-rules
  section.

### `permission-ask`: a flat ask list per tool

- Type: object. No default stated: tool names mapped to lists of glob patterns that prompt,
  working next to the `permission` field.

### `permission-deny`: a flat deny list per tool

- Type: object. No default stated: tool names mapped to lists of glob patterns that are
  denied, working next to the `permission` field.

### `restrictive`: picking the ask-first mode

- Type: boolean. No default stated: picks the restrictive permission mode, asking before
  every operation, and it is overridden by `accept_all` or `yolo` when those are also true.

### `accept_all`: picking the standard mode with auto-allow inside the project

- Type: boolean. No default stated: picks the standard permission mode with automatic allow
  inside the working directory, the same as setting the default mode to standard, and it is
  overridden by `yolo` when true.

### `yolo`: picking the allow-almost-everything mode

- Type: boolean. No default stated: picks yolo mode, allowing everything and asking only
  about destructive shell commands.

### `permission-modes`: which modes config rules apply to

- Type: array. Default: `["guarded", "standard", "yolo"]`. Mode names to which config-based
  rules apply, and modes left out of this list bypass config rule matching entirely.

### `default_permission_mode`: the mode when nothing else picks one

- Type: string. Default: `standard`. Accepted values are standard, restrictive, readonly,
  guarded, and yolo, and this is the permission mode used when no mode boolean or flag is
  given.

## Reference, part three: sandboxing

### `sandbox`: whether shell commands run sandboxed

- Type: boolean. Default: `false`. When true, shell commands run inside the sandbox, on a
  best-effort basis: when the chosen backend program is missing, commands still run
  unsandboxed and a warning is logged, and SECURITY.md in the repository describes what the
  sandbox does and does not guard against.

### `sandbox-backend`: which sandbox program is used

- Type: string. Default: `bwrap`. The backends are `bwrap`, Linux only, and `zerobox`, for
  macOS and Linux.

### `sandbox-required`: refusing to run bare when the backend is missing

- Type: boolean. Default: `false`. When true, shell commands are refused entirely when the
  sandbox backend is unavailable, rather than dropping back to unsandboxed execution, and it
  implies `sandbox`.

### `sandbox-expose`: handing back read-only access to a masked path

- Type: array. Default: `[]`, meaning nothing exposed. Bwrap backend only: it gives back
  read-only access to a masked credential directory or a subpath of one, with tilde and home
  expansion supported, and the repeatable CLI flag `--sandbox-expose <path>` replaces this
  list entirely when given. Entries that are not a masked entry or a subpath of one, and
  entries containing parent-directory components, are warned about once at startup and
  disregarded. See the credential-masking section later in this page.

### `sandbox-network`: whether sandboxed commands keep network access

- Type: boolean. Default: `true`, meaning network open. Bwrap backend only: when false, each
  sandboxed shell command runs in a fresh network namespace holding only its own private
  loopback, so a server the command itself starts and uses on its own loopback still works,
  while the internet, the LAN, and anything listening on the host's loopback are out of
  reach. The CLI flag `--sandbox-network[=true|false]` beats this key in both directions. It
  does not imply `sandbox`: with the sandbox off, the setting does nothing and a warning is
  logged once at startup. See the network-isolation section later in this page.

## Reference, part four: model, generation, context, and files

### `provider`: which vendor answers by default

- Type: string. Default: `openrouter`. The shipped names are `openrouter`, `openai`,
  `anthropic`, `gemini` and `google`, `ollama`, `opencode-zen`, and `opencode-go`, and an
  alias defined under `custom_providers` works here too.

### `model`: which model answers by default

- Type: string. Default: `deepseek/deepseek-v4-flash`. This is the model that answers by
  default, before any quick-model switch.

### `max_tokens`: ceiling on response tokens

- Type: integer. Default: `16384`. This is the ceiling on response tokens for a single
  reply.

### `max_agent_turns`: ceiling on turns inside one response

- Type: integer. Default: `200`. This is the ceiling on agent turns inside a single
  response.

### `temperature`: sampling temperature, with a flag-only caveat

- Type: number. No default stated: sampling temperature, only honoured when given through
  the `--temperature` flag, in the range `0.0` to `2.0`, while a value in the config file is
  read but currently has no effect.

### `extra_body`: provider-specific JSON folded into every request body

- Type: object. No default stated: provider-specific JSON folded shallowly into the body of
  every completion request as a global default, where OpenRouter routing presets are one
  example, and a quick-model entry's own `extra_body` replaces it for that model, as
  described in the request-body section later in this page.

### `no_tools`: switching every tool off

- Type: boolean. Default: `false`. When true, every tool is switched off.

### `api_keys`: keys consulted only when the environment has none

- Type: object. No default stated: provider names mapped to API keys, consulted only when
  the matching environment variable is absent.

### `context_window`: session context size for display and compaction

- Type: integer. No default stated as a fixed number: the session context size used for the
  status display and for automatic compaction, and left unset it is detected from the chosen
  model's catalog entry, or, for custom providers, read live from the models endpoint at the
  base URL when that endpoint reports a context length, otherwise falling back to `128000`.
  A value of `0` turns automatic compaction off.

### `reserve_tokens`: tokens held back before compaction kicks in

- Type: integer. No fixed default stated: tokens held back before compaction kicks in, and
  when not set globally, the active quick model's reserve value is used next, and after that
  a built-in default of `8192`.

### `keep_recent_tokens`: recent tokens preserved verbatim while compacting

- Type: integer. Default: `10000`. A rough budget of recent tokens preserved word-for-word
  while compacting.

### `compact_enabled`: master control for automatic compaction

- Type: boolean. Default: `false`. The master control for every automatic compaction, both
  between turns and mid-turn, and while false, no automatic compaction ever happens.

### `mid_turn_compact_threshold`: opting into compaction inside a turn

- Type: number. No default stated: the fraction of the context window, from `0.0` to `1.0`,
  of genuine provider prompt pressure at which compaction runs during a turn rather than
  only between turns, left unset meaning mid-turn compaction never happens, only honoured
  while `compact_enabled` is true, with `0.80` as a sensible first value, as described in
  the mid-turn section later in this page.

### `max_text_file_size`: largest file the read and write tools will handle

- Type: integer. Default: `1048576`, which is 1 MB, in bytes.

### `deny_repeated_reads`: refusing a second read of the same section

- Type: boolean. Default: `true`. When true, a second read of the same file section within a
  session is refused until that file has been edited or written, and setting it to false
  permits re-reading.

### `no_context_files`: stopping context files from loading

- Type: boolean. Default: `false`. When true, global and project `AGENTS.md`, `CLAUDE.md`,
  and `ARCHITECTURE.md`, when architecture-note support is switched on, are stopped from
  being loaded as context.

## Reference, part five: providers, shortcuts, prompt wiring, MCP, and ACP

### `custom_providers`: aliases for OpenAI-compatible gateways and vendors

- Type: object. No default stated: aliases mapped to a shape holding a provider type, a base
  URL, an API key environment variable, an API style, headers, a TLS-verification switch,
  and a timeout in seconds. The provider type must resolve to a built-in provider type, the
  API key environment variable is optional, and for OpenAI providers the API style picks
  responses or completions, headers set custom HTTP headers with environment-variable
  expansion in values, and the timeout sets a whole-request deadline, leaving it unset to
  let long streamed replies run, while the TLS switch turns verification off. See the
  OpenAI-styles section later in this page.

### `quick_models`: shortcut names for provider and model pairs

- Type: object. No default stated: shortcut names mapped to a shape holding a provider, a
  model, and optionally a reserve value, input and output token costs, a temperature, and an
  extra body, switched with `/models <name>` or `--quick-model=<name>`, with the extra body
  described in the request-body section.

### `prompt_to_model`: switching model automatically with a prompt

- Type: object. No default stated: prompt names mapped to quick-model names, so switching to
  a prompt automatically switches to the matching quick model, with empty-string values
  meaning no change, as described in the prompt-to-model section later in this page.

### `mcp_servers`: the MCP server map

- Type: object. No default stated: the MCP server map, used when MCP support is switched on,
  and when left out, recommended MCPs are configured automatically, as described in the MCP
  section later in this page.

### `enable-exa-mcp`: auto-configuring the web-search MCP server

- Type: boolean. Default: `true`. When true, the Exa Web Search MCP server is configured
  automatically.

### `enable-context7-mcp`: auto-configuring the documentation MCP server

- Type: boolean. Default: `false`. When true, the Context7 MCP server is configured
  automatically.

### `enable-grepapp-mcp`: auto-configuring the code-search MCP server

- Type: boolean. Default: `false`. When true, the Grep.app MCP server is configured
  automatically.

### `allow_all_mcp_calls`: skipping permission checks for MCP tools

- Type: boolean. Default: `false`. When true, permission checks are skipped for every MCP
  tool call.

### `acp_servers`: the ACP server map

- Type: object. No default stated: the ACP server config map, used when ACP support is
  switched on, as described in the ACP section later in this page.

### `acp_host`: TCP bind host for ACP server mode

- Type: string. No default stated: the TCP bind host for ACP server mode, the same as
  `--acp-host`.

### `acp_port`: TCP bind port for ACP server mode

- Type: integer. Default: `7243`. The TCP bind port for ACP server mode, the same as
  `--acp-port`.

## Credential directories hidden by the sandbox

Under the `bwrap` backend, nine well-known credential directories are hidden behind a
temporary filesystem by default, so a sandboxed shell command finds each one empty instead
of being able to read keys and tokens, and only directories that actually exist on the host
are masked. In prose, they are: the SSH directory, holding private keys and known hosts; the
AWS directory, holding credentials and config; the GPG directory, holding keyrings and the
agent socket; the Kubernetes directory, holding cluster credentials; the Docker directory,
holding registry auth tokens; the GitHub CLI config directory, holding its OAuth token; the
Google Cloud config directory, holding its credentials; the 1Password CLI config directory,
holding session state; and the sops age config directory, holding decryption keys. The final
four are relative to the XDG config base, so when that base holds an absolute path, they
become that base plus the tool name, or the sops age path, instead, because those tools read
their credentials from there.

That temporary filesystem is an ordinary writable filesystem, not a read-only view, so a
command that writes into a masked directory, such as generating a key, logging into a CLI,
or configuring a cloud tool, succeeds and exits zero, and then loses whatever it wrote the
moment the sandbox exits. A read-only mask is possible through a remount option, but it is
not the default, since it would make those same tools fail loudly instead of quietly
discarding their output. The expose key, or the repeatable expose flag, hands back read-only
access to a masked entry or a subpath of one, for instance a known-hosts file without the
private keys, and passing the flag at least once on the command line replaces the config
list outright, following the usual CLI-beats-config rule, otherwise the config list stands.
A value counts as valid only when, after expansion, it equals one of the entries above or
sits beneath one, and holds no parent-directory component, since a path that climbs out of
the SSH directory names the whole home directory rather than a masked entry; anything else
is warned about once at startup, with the value quoted, and disregarded. Because the restore
is a read-only bind laid over the mask, exposing can never grant write access. Like any
other config key, the expose key can come from a project-local file, trusted exactly like
the global config, so review it in untrusted checkouts as noted above. Masking, the
ssh-agent cutoff, and exposing all belong to the `bwrap` backend only, and SECURITY.md holds
the full gap list, including what stays readable and the ssh-agent recovery paths.

## Cutting the network inside the sandbox

Under the `bwrap` backend, sandboxed shell commands share the host network by default, which
is the historical behaviour, and setting the network key to false, or passing the matching
flag with false, gives them a network namespace of their own instead, illustrated by a tiny
snippet that turns the sandbox on and the network off together. Each shell call then
receives a fresh network namespace holding nothing but its own private loopback device,
which bubblewrap brings up for it, and two consequences follow, pointing in opposite
directions. Loopback inside one command still works, so a command that starts a server and
then talks to it on its own loopback is fine, because both ends share the namespace, and
test suites and anything else that binds a local port inside a single command keep working.
The host is gone, including the host's loopback, so there is no internet, no LAN, and no
reaching a service already listening on the machine, whether a dev server, a database, or a
local package registry, all of which are invisible from inside the sandbox because they live
on the host's loopback and the sandbox has its own. The namespace lives exactly as long as
the command, so a server left running in the background by one shell call cannot be reached
from the next one, which also removes the pattern of starting a service in one step and
curling it in the next. Those last two points are why the default is open: cutting the
network breaks host dev servers, private registries, and any workflow spread across several
shell calls, and that is too much to change underneath people without warning. The CLI flag
takes an optional value, a bare flag for true or an explicit false, rather than acting as a
plain on-off switch, because the key defaults to true and a plain switch could not express
turning the network back on for one run over a config that turns it off. The network key
modifies rather than enforces: unlike the required key, it never switches the sandbox on, so
with the sandbox off there is nothing to cut the network from, the setting has no effect,
and a warning is logged once at startup, while pairing it with the required key is what
makes the no-network promise solid, since a missing backend would otherwise fall back to
running commands bare, with the network intact. Like the expose key, this key can come from
a project-local file, trusted exactly like the global config, so a checkout can set it back
to true and undo a global false, and reviewing that file in untrusted checkouts matters;
passing the flag with false on the command line settles the question for that run, since the
CLI beats both config files. When the network is off and a command fails with a resolver or
unreachable-network error, the tool result gains one extra line telling the model the
sandbox cut the network and to ask the user whether it should be enabled, so it stops
retrying the command instead, and that hint reads stderr, so a command that folds stderr
into stdout simply does not get one. On systemd-resolved hosts, the resolver file points at
a loopback address which inside the fresh namespace is the sandbox's own loopback with
nothing listening, so DNS failures there surface as connection refused rather than network
unreachable, which is one reason connection refused appears in the hint pattern list. Like
masking and exposing, this applies to the `bwrap` backend only, while the `zerobox` backend
denies network access under its own policy regardless of this key, as SECURITY.md explains.

## Text appended to every system prompt

You can append custom text to every system prompt by creating a `SUFFIX.md` file in the
config directory, the same place as `config.toml`, at the Linux path under the config home,
or the macOS path under Application Support, or the config-directory override path when that
variable is set. When the file exists and holds more than whitespace, its contents are
appended at the very end of the system prompt preamble, after the working-rules file, the
architecture note, the active prompt, the working directory, any added files, memory, and
everything else, with a separator inserted automatically. The suffix reaches all agent
contexts: the main interactive agent, subagents from parallel task delegation, the advisor
tool for second-model consultation when advisor support is enabled, the conversation
summarizer used in compaction, and side-question agents. When the file is missing, empty, or
whitespace-only, nothing is appended. Use it for things like persistent rules, style
preferences, team-wide policies, or provider-specific output formatting that should always
be present no matter which prompt or mode is active.

## Hooks: outside commands that watch or gate behaviour

Hooks are available in this build and active unless disabled with `--no-hooks`, and the
flags, files, and slash and test commands below all apply. Hooks let outside commands watch
or gate agent behaviour at defined moments, a tool call, a user prompt, the agent finishing
a turn, a session starting or ending, or a subagent starting or stopping, using the same
settings shape, stdin envelope, and exit-code and stdout-JSON contract as Claude Code, so an
existing Claude Code hooks setup is largely compatible, with one script-level change noted
below for the project-directory variable.

Hook config lives in a `settings.json` file, JSON rather than TOML or YAML, at up to three
locations, loaded and merged in this order. The global file under the config home, with
macOS and Windows equivalents, is trusted by default. The project file under `.tiny-crow/`,
relative to the working directory, is not trusted by default, as the trust section below
explains. The admin-controlled managed file, under the system config directory on Linux and
macOS and the program-data directory on Windows, is always trusted and unaffected by the
disable switch. Each file may carry a top-level hooks object keyed by event name and a
top-level boolean that disables all hooks, and that boolean, from the global or project
file, or the CLI flag, suppresses every non-managed hook, while managed hooks still run
regardless. A missing or invalid file is not an error; it simply contributes nothing.
Tiny-crow does not read Claude Code's own settings file directly, but its own
`settings.json` uses the identical hooks schema, so copying or symlinking the hooks key from
that file into the tiny-crow project settings works as-is, while scripts themselves may
still need a change, since tiny-crow sets its own project-directory variable rather than the
Claude Code one, so a script that reads the latter must be updated to read the former.

A handler group example, rewritten with a different script name and a narrower matcher,
looks like a hooks object holding a pre-tool event, holding a matcher for shell and write
tools, holding a command handler with a timeout in seconds. Each handler field, in prose:
the type field, a string, where only the command value is supported; the command field, a
string, a shell command run through the shell on Unix and through PowerShell on Windows,
receiving the stdin envelope as JSON, with the tiny-crow project directory set in its
environment; the args field, an array of strings, where, when present, the shell is bypassed
entirely and the command is executed directly as the program with those arguments, with no
shell metacharacter expansion; the timeout field, an integer in seconds, a per-hook timeout
where the whole process group is killed on expiry, defaulting to 60; the async field, a
boolean, where true means the hook runs in the background and its decision is ignored,
defaulting to false; the condition field, a string, a shell command evaluated with the same
stdin envelope before the handler runs, where the handler only runs if it exits zero,
failing closed in the sense that a broken, unparseable, or timed-out condition still runs
the handler, with a warning; and the once field, a boolean, running the handler at most once
per event per session, with later matches skipped. The matcher, on the handler group rather
than the handler, follows Claude Code semantics: omitted, empty, or a star matches every
tool; a bare name or a list separated by pipes or commas is an exact case-insensitive match
after tool-name normalisation, for example shell matching shell, file search matching the
find tool, and shell-or-write matching the write tool; and anything else is treated as a
regular expression, with invalid expressions reported at load time.

The events are pre-tool use, post-tool use, post-tool use failure, user prompt submission,
stop, session start, session end, subagent start, and subagent stop, while pre-compact and
notification are not currently implemented. Only pre-tool use is permission-blockable by
default. A handler's stdout JSON may set a permission decision to deny, ask, allow, or omit
it, deferring to the normal permission system, where deny always blocks, holding even under
yolo, ask forces an interactive confirmation regardless of permission mode and escalates to
deny in non-interactive contexts such as print or loop mode where no confirmation is
possible, and allow suppresses the interactive prompt for that one call only, never
overriding a deny from a rule, a security mode, a managed policy, or another hook. Pre-tool
use may also set an updated input to rewrite the tool's arguments before it runs, and
post-tool use may set a result to rewrite the model-visible output. User prompt submission
and subagent start can set additional context to prepend text to the prompt. Stop and
subagent stop can set a decision to block with a reason to force the agent, or subagent, to
continue instead of finishing, using the reason as the next instruction, and stop gives up
after eight consecutive blocks without progress. Any handler can also signal via exit code
instead of JSON: zero means no objection, two blocks for blockable events with stderr as the
reason, and any other exit code is a non-blocking error, while exit two combined with stdout
JSON is a mixed-channel warning and the JSON is ignored.

Project-level hook handlers require interactive confirmation the first time they would run,
keyed by a hash of the handler's definition, covering event, matcher, command or arguments,
timeout, and the rest, so changing the definition changes the hash and requires
re-confirmation, while global and managed hooks are trusted automatically. Confirmations
persist to a trusted-hooks file under the data home, a user-level file, so child processes
and orchestrated subagents sharing it inherit trust automatically. In headless contexts such
as print or loop mode, an unconfirmed project hook is skipped with a warning rather than
prompting.

The global switches, in prose, are: the no-hooks flag, disabling all non-managed hooks for
this run; the disable flag in the global or project settings file, with the same effect via
config; and the hooks-test flag with an optional input JSON, dry-running pre-tool use for a
tool against the loaded and trust-filtered dispatcher and printing the merged verdict,
reason, and updated input, then exiting, with no session, agent, or API key required. See
COMMANDS.md for the slash command that manages hooks.

## Compaction that can happen in the middle of a turn

Out of the box tiny-crow only compacts the conversation between turns, once a response has
finished, when the accumulated session history passes the context window minus the reserve.
A single long turn, with many tool calls and large tool results, can still overshoot the
model's real context limit before that check ever runs, because the in-flight tool traffic
never enters the session's token estimate. The mid-turn threshold opts into a second check
that runs within a turn: on every provider call tiny-crow compares the real
provider-reported prompt size against the context window, and when the ratio crosses the
threshold it halts the run at a clean boundary, compacts, and resumes the same task on the
compacted history. Unset by default, with no value set behaviour is unchanged and no
mid-turn compaction happens, so setting a value is the opt-in. Gated by the master switch,
since when compaction is disabled the threshold is disregarded and nothing compacts. Ranged
as a fraction above zero up to and including one, where an out-of-range value is
disregarded, mid-turn compaction stays off, and tiny-crow prints a warning at startup
explaining the correct form, rather than failing silently, and a value of 0.80 is a
reasonable starting value, leaving headroom below the context window while still keeping the
live prompt small enough to avoid the attention degradation that large, full context windows
suffer. A tiny illustration, with a different window size from any other example here, turns
the master switch on, sets a window, and sets the threshold to eighty percent.

## OpenAI transports, custom headers, and body parameters

The OpenAI provider, and any custom provider whose type is OpenAI, can talk to either of the
provider client's two OpenAI transports. The responses transport talks to the responses
endpoint, is the default for the OpenAI API host when no base URL is set, and is required
for the newest model series, which reject the older token parameter on chat completions and
expect the completion-token parameter instead. The completions transport talks to the chat
completions endpoint, and is the default when a custom base URL is set, because most
OpenAI-compatible gateways, such as local inference servers, proxy layers, and self-hosted
endpoints, implement only this endpoint. Setting the API style overrides the auto-detected
default, for instance to force completions against a gateway, or responses against an
endpoint that genuinely implements the responses endpoint.

Custom providers may also send arbitrary HTTP headers, which helps with gateways sitting
behind an auth proxy, and header values support environment-variable expansion, so secrets
stay in the environment rather than in the config file. A fresh illustration uses a
different gateway host and different header names from any other example: a company gateway
entry with an OpenAI type, a proxy host URL, a gateway key variable, and two access headers
expanded from the environment. The optional timeout field is a whole-request deadline in
seconds, covering the streamed reply, so a completion still running when it elapses is cut
off, and leaving it unset is right unless a gateway needs one. By default completion
requests have no deadline beyond a five-second connect cap and fail only after three hundred
seconds without a byte, while the models requests tiny-crow issues itself, at startup and
from the provider command, are capped at eight seconds per attempt. Like headers, this
applies to the OpenAI provider type, while other provider types take the provider client's
default. TLS certificate verification can be switched off for self-signed or
internal-certificate gateways, but use it with care, since it makes the connection
vulnerable to interception.

Headers only touch HTTP headers, while some providers also accept parameters in the JSON
request body, where OpenRouter routing presets that select a routing strategy are one
example, illustrated by a model identifier and a plugins preset in a small JSON snippet with
a fresh preset name. The extra-body key injects arbitrary JSON into the completion request
body, shallow-merged so top-level keys win on collision, and it works for every provider,
OpenAI, Anthropic, Gemini, Ollama, OpenRouter, and any custom provider, not just OpenRouter,
with the same value applied to the main agent and the isolated side-question agent so they
behave identically. It can be set at two levels, resolved most-specific first: a
per-quick-model entry, applying only when that model is active, and a global top-level
value, applying to every model including the base model unless a matching quick-model entry
overrides it. A TOML illustration, with fresh preset names, sets a global default for the
base model and a quick-model entry that overrides it for one model, and a YAML illustration
does the same with nested keys. Body parameters are provider-specific, so a key one provider
understands may be ignored or rejected by another, and unlike temperature, a global extra
body does not follow model switches, so prefer setting it per quick-model entry, bundled
with the matching provider and model, when the parameter is tied to a specific provider.

## The status bar, its segments, and its items

The status bar at the bottom is configurable through the statusline table: up to three
lines, each an ordered list of segments, and when the table is absent, a built-in
single-line layout is used. An illustration, with different colours and items from the
worked examples, builds a first row from the working directory, a separator, the branch, and
a flexible spacer pushing context usage to the right, a second row from the session name, an
identifier, token counts, and cost, and a third row from the active prompt alone. Each
segment has fields, in prose: the item field, the element to show, required, from the list
below; the colour field, a foreground colour as a name or a hex code, optional; the
background field, a background colour in the same format, optional; the text field, literal
text for the separator item, optional, defaulting to a space; the left field, a powerline
cap glyph drawn before the item, as a name or any literal string, optional; the right field,
a powerline cap glyph drawn after the item, optional; the icon field, a glyph shown before
the value, where true uses the item's built-in icon and a string sets a custom one, as a
named icon or a literal glyph, optional, needing a Nerd Font; and the always field, forcing
a numeric item such as input tokens, output tokens, or cost to show even when its value is
zero, normally hidden until non-zero, optional.

Items with a built-in icon, used when the icon field is true, are the branch, changes,
status, working directory, model, cost, context used, maximum, and percentage, session name
and identifier, prompt, mode, loop, side-question, and compaction items. Named custom icons
are branch, folder, chip, dollar, database, hash, terminal, lock, pencil, and sync, and any
other value is used literally, so a raw codepoint works too. Left and right caps are drawn
in the segment's background colour, falling back to its foreground colour, over the
status-bar background, so they read as the segment's edge, they render only when the item is
shown, and they need a Nerd Font or Powerline font, with named caps for right, left, thin
right, thin left, round right, round left, flame right, and flame left, and any other value
used as-is, so a raw codepoint also works, illustrated by a model segment with a white
foreground, a dark background, and round caps on both sides.

Available items, in prose groups: session name, hidden when empty, and the first eight
characters of the session identifier; the working directory name alone, and the full working
directory path with the home shortened to a tilde; the linked git worktree name, hidden when
not in a linked worktree; the current git branch, or short commit on a detached head;
working-tree changes, shown as staged, modified, deleted, and untracked parts, non-zero
parts only, hidden when clean; upstream sync and dirty marker, with ahead, behind, and dirty
symbols, or the words clean and in sync when clean and in sync; the active model identifier,
and the model identifier without its provider prefix; the active provider name; total input
and output tokens this session; current context size in tokens, the model's context window,
and context used as a percentage of the maximum; session cost, hidden at zero unless the
always-show-cost key is set; the active prompt, shown with a prompt prefix; the security
mode when not standard, shown with a mode prefix; the active loop label; the
chain-of-prompts label; the number of compactions, shown with a compaction prefix;
side-question token and cost usage; a reasoning marker shown when reasoning is enabled and
hidden when off; the number of messages in the session; time since the session was created,
and time since the last message, both in a compact minutes-and-hours form; the current local
time in hours and minutes; the machine hostname; the current username; a separator, literal
text from the text field, defaulting to a space, trimmed around hidden items; and a flexible
separator, expanding to fill the remaining width, with several splitting the space evenly.
The changes and status items run git status on focus and after shell tool calls, only when
one of them is used, while all other items are read from the session.

Exact names to type in a segment are: item, color, bg, text, left, right, icon, always.
Exact item names are: session_name, session_id, cwd, cwd_full, worktree, git_branch,
git_changes, git_status, model, model_short, provider, tokens_input, tokens_output,
context_used, context_max, context_percentage, cost, prompt, mode, loop, chain, compaction,
btw, reasoning, message_count, session_age, session_updated, clock, host, user, separator,
flex_separator. Exact named cap names are: pl_right, pl_left, pl_right_thin, pl_left_thin,
pl_round_right, pl_round_left, pl_flame_right, pl_flame_left.

## Status signals over a socket

Status signals are included in this build. Passing the status-socket flag with a path has
tiny-crow report its run state over a Unix domain socket at that path, for external status
bars or tooling to watch, and STATUS_SIGNALS.md holds the full protocol.

## Colours: scheme and backgrounds

The colours object accepts an optional scheme-type field and three optional string fields
for background colours, each of which can be a named colour or a hex colour, and named
colours are case-insensitive. The scheme type controls the terminal colour escape sequences
emitted, with two values: full, the default, meaning 24-bit true colour via RGB escape
sequences, best for modern terminals; and ansi, meaning the 256-colour palette via ANSI
escape sequences, mapping RGB colours to the nearest 256-colour match across standard
colours, the colour cube, and grayscale, for older terminals or multiplexers that do not
support true colour. The background fields are the chat background for the main conversation
buffer, the input background for the text input area, the status background for the status
bar on the lowest line, and a roles map of semantic role to colour, overriding the default
palette for conversation blocks, where known roles are user, agent, reasoning, tool, tool
result, error, system, welcome, permission, and plain, unknown roles and unparsable colours
are ignored with a warning, roles work in theme files too with the same colours object, and
a theme without a roles map restores the default palette. Supported named colours are reset,
black, red, green, yellow, blue, magenta, cyan, white, grey, dark grey, dark red, dark
green, dark yellow, dark blue, dark magenta, and dark cyan. A JSON illustration, with
different hex values from any other example, sets a full scheme and four role colours.

## Permission rules, in detail

Permission actions are lowercase strings: allow, ask, or deny. Each tool rule can be a
single action or an object mapping patterns to actions. Supported permission tool keys are
shell, read, write, edit, grep, file search, directory listing, and todo writing, and
MCP-backed tools are checked under a key shaped as the MCP tool prefix plus server name plus
tool name. Use a star for the default action, an external-directory key for absolute-path
rules outside the working directory, and a doom-loop key for repeated identical tool calls,
defaulting to ask. When shell is omitted, tiny-crow installs its built-in safe shell allow
and deny rules.

There are two config fields for controlling permissions by pattern. The permission field
treats patterns as globs, for example a TypeScript glob or a source-directory glob. The
regex field has the same structure as the permission field, but patterns are treated as
regular expressions, for example a TypeScript suffix pattern or a source-prefix pattern, and
regex patterns are unanchored, so use start and end anchors to match the full input. Both
fields can be used together and rules from both are merged, and when both define a default
action with a star, the glob default takes precedence.

As a TOML-friendly alternative to the nested permission object, you can use the flat allow,
ask, and deny fields at the top level, each a map from tool name to a list of glob patterns,
working side by side with the permission field and especially convenient in TOML configs. A
TOML illustration, with different directories from the worked example, allows reading under
source and docs, asks for shell removal patterns, and denies writing under system
directories, and a YAML illustration does the same with nested keys. A regex example in
YAML, with different patterns from the earlier illustrations, sets a default ask, allows
Markdown reads, asks for TypeScript reads, allows a small set of safe shell commands, and
denies shell commands starting with removal.

## MCP servers: command, URL, resilience, OAuth, and recommendations

With MCP support, the MCP server map accepts command-based and URL-based servers, and
servers can also be added per project via the project-local file, where project servers
merge with, and can override, global ones by name. Ephemeral servers can be added on the
command line without touching any config file, illustrated by a stdio server line with a new
name and a filesystem command, and an HTTP server line with a new name and a search URL. CLI
servers override same-named config entries, a repeated name keeps the last flag, names must
be non-empty with no whitespace, equals signs, or double underscores, since they become
allowlist keys shaped with the MCP prefix, and invalid entries abort startup with an error.
Only command and URL servers are expressible on the CLI; environment variables, headers,
OAuth, and timeouts require the config file. A JSON illustration, with different server
names from the command-line illustration, shows a command server with a filesystem command
and arguments and an empty environment map, and a remote server with a URL and an
authorization header.

Both server kinds accept optional resilience fields, in prose: a connect timeout in seconds,
defaulting to ten, for establishing the connection and the MCP handshake; a tool timeout in
seconds, defaulting to twenty, for individual tool calls and tool listing; and a connect
retry count, defaulting to one, meaning how many times a failed connection attempt is
retried, for two attempts total. Exact key names for those three are connect_timeout_secs,
tool_timeout_secs, and connect_retries. A JSON illustration, with a different server name
and longer timeouts, sets those three fields on a slow URL server. All servers connect
concurrently at startup, so one slow server does not delay the others, and when a server's
transport drops mid-session, whether a child process exits or an HTTP session is lost, the
next tool call to that server automatically reconnects once and retries the call before
reporting an error.

URL-based servers can authenticate with OAuth 2.0, using the authorization-code flow with
PKCE. Add an OAuth field, using true for defaults, meaning dynamic client registration with
no extra scopes, or an object for explicit settings, illustrated by a JSON snippet with two
servers, one using true and one using an object with scopes, a pre-registered client
identifier, and a redirect port. The OAuth fields, all optional, in prose, are: scopes, with
no default, the scopes to request during authorization; client identifier, defaulting to
dynamic registration, a pre-registered client identifier, where omitting it means the client
registers on the fly; and redirect port, defaulting to `8970`, the loopback port for the
redirect URI on the local host with that port and a callback path. The first time you
connect, run the MCP login command for the server inside the terminal interface, where
tiny-crow prints an authorization URL and copies it to the clipboard, you open it in a
browser, approve access, and the redirect is caught on the loopback port, with the browser
wait running in the background so the interface stays responsive, letting you keep working
or select the URL with the mouse to copy it. The token is saved under the data directory in
an MCP OAuth folder, one file per server, with owner-only permissions on Unix, and the
server reconnects automatically once authorization completes, while later sessions reuse the
stored refresh token and reconnect without a browser, and the logout command removes a
stored token, so a server with OAuth enabled but no stored token fails to connect until you
log in. Exact key names for the OAuth object are scopes, client_id, and redirect_port.

When the MCP server map is not explicitly set, three recommended MCP servers are available,
each toggleable with a boolean config key, all defaulting to a listed API key environment
variable when that variable is set, in prose: the web-search toggle, defaulting to true, for
the Exa web search host, with its API key variable; the documentation toggle, defaulting to
false, for the Context7 documentation host, with its API key variable; and the code-search
toggle, defaulting to false, for the Grep.app host, with its API key variable. Setting the
web-search toggle to false disables the Exa default without touching the server map, and
setting the server map to an empty object disables all MCP auto-configuration.

## ACP server configuration, and TOML key naming

With ACP support, tiny-crow can act as an ACP agent server, with the config keys already
listed in the reference: the ACP server map, the bind host, and the bind port defaulting to
7243. ACP server configs inside the map support two transport types, illustrated by a JSON
snippet with a TCP server entry holding a loopback host, the default port, and an optional
key. When the ACP flag is passed without the host flag, tiny-crow runs in stdio mode, where
the editor spawns it as a subprocess, and with the host flag it listens on TCP.

Within each search directory, tiny-crow picks the first existing file in this priority
order: TOML, then YAML, then the YAML short extension, then JSON, and JSON is kept for
backwards compatibility, since YAML is a superset of JSON and legacy JSON configs parse
transparently through the YAML reader, with a default TOML file created automatically when
none exists. TOML is especially well suited for permission rules and structured settings,
and hyphenated keys such as the regex, allow, ask, and deny fields are idiomatic in TOML and
avoid deeply nested tables, illustrated by a short TOML snippet with flat allow, ask, and
deny maps, and for more complex configurations explicit TOML tables provide clear structure,
illustrated by a permission table with a default ask, a shell table allowing a test command
and denying removal, and a write table allowing TypeScript files and asking for everything
else. All top-level keys use kebab-case when they contain hyphens, for example the allow
field and the allow-all-MCP field, simple keys use the same name as their YAML counterpart,
and quoted keys are required when the key holds special characters like stars or slashes.

## Two edit formats, prompt mode directives, and prompt-to-model wiring

Tiny Crow supports two edit systems, selectable via the edit-system config key, the matching
CLI flag, or the editsys slash command. The similarity format, the default, is the classic
SEARCH and REPLACE format, where the model copies exact text from read output into search
blocks and provides replacements in replace blocks, falling back to whitespace normalisation
and fuzzy matching when the exact text does not match, illustrated by a one-line TOML
snippet setting the key to similarity. The hashedit format is tag-based, using CRC-32 line
hashes and file-level check-and-set tokens, where the read tool annotates each line with an
eight-character hex CRC-32 tag and a file-level CRC header, and the edit tool receives
tagged lines from the read output and provides only the replacement text, with no old-text
reproduction needed. Its key advantages, in prose, are token efficiency, since no old-text
reproduction means significant savings for deletions and large edits; check-and-set
guarding, since the file-level CRC prevents applying edits to stale content; and
reliability, since per-line tag validation catches content mismatches, illustrated by a
one-line TOML snippet setting the key to hashedit. Switching between modes is immediate and
does not require an agent restart, and the slash commands for each mode provide the same
functionality at runtime.

Custom prompt Markdown files may include a mode directive on the first line to automatically
switch the security mode when the prompt is activated, whether via the prompt command or as
the startup default prompt. Valid modes are standard, restrictive, readonly, guarded, and
yolo, and a special last-user-mode value keeps, or restores, the mode the user last set
explicitly via the mode command or startup config, useful when a prompt wants to avoid
overriding the user's chosen mode. The directive line is stripped from the prompt content
before it reaches the agent. One example prompt file, with a fresh name, sets readonly mode
on its first line, then a heading and a sentence saying only reading and exploring are
allowed, while another example prompt file, with a different name, defers to the user's mode
on its first line, then a heading and a sentence about writing well-tested code and
following project conventions. The mode change is applied when the prompt is activated and
persists until changed again by the mode command, another prompt directive, or a restart,
and the status bar shows a mode marker when the mode is not standard.

The prompt-to-model table maps prompt names to quick-model names, and when you switch to a
prompt, whether via the prompt command, a dot command, a review command, chain transitions,
or the startup default, tiny-crow looks up the mapping and automatically switches the active
model to the corresponding quick model. Values are quick-model names, the same names defined
in the quick-model map, and an empty string means no change, so the current model stays
active. A TOML illustration, with fresh quick-model names, maps a planning prompt to a scout
model, a coding prompt to a builder model, a review prompt to a reviewer model, and a
brainstorming prompt to an empty string, and with that config, switching to the planning
prompt switches to the scout model, switching to the coding prompt switches to the builder
model, running review switches to the reviewer model, and switching to brainstorming does
not change the current model. When you run the prompt command with the default argument,
clearing the active prompt, the model reverts to the session's default model, from the model
and provider config or the quick-model flag, and the model switch writes a line to chat
naming the new model and the prompt it came from.

## Chains, advisor, language servers, output filtering, and logging

When enabled, after the agent finishes responding with a brainstorming, planning, or coding
prompt, the status bar shows a question offering to continue to the next prompt, with yes,
but, and no answers, where the user's next input is interpreted as a chain decision. Yes, in
its short or long form, switches to the next prompt and auto-submits a transition message.
But, in its forms, does the same, but prepends the supplied message as an additional
instruction to the transition message. No, in its short or long form, declines the chain and
continues normally. Typing anything that does not match these patterns clears the chain and
processes the input as a normal message. The phases, in prose, are: brainstorming to
planning, defaulting to true, prompting to move to planning after brainstorming; planning to
coding, defaulting to true, prompting to start coding after planning; and coding to review,
defaulting to false, prompting to run a review after coding, illustrated in both TOML and
YAML with the same three booleans.

The advisor tool lets the agent consult a stronger reviewer model, or the user in
human-handoff mode, for strategic guidance before making important decisions, following an
advisor strategy where a cheaper executor model drives the task and escalates to a more
capable model only when needed. A TOML illustration, with a different model from the earlier
examples, enables the advisor, sets a reviewer model, and comments out a maximum-uses value,
a human-handoff flag with a note that the struct default is true but currently has no effect
from config alone, and a kilobytes limit, while a YAML illustration sets the same four
fields with concrete values. The CLI flags, in prose, are: an advisor flag to enable the
tool; an advisor-model flag for the advisor model name; an advisor-max-uses flag for the
maximum advisor calls per request; an advisor-human-handoff flag, optionally with a boolean,
routing advisor calls to the user instead of a model, where a bare flag or true enables it
and the CLI default is false unless passed; and an advisor-kilobytes-limit flag for the
maximum kilobytes of conversation context sent to the advisor, defaulting to 256. A known
quirk is that the CLI flag always supplies a value, false when not passed, so the resolver
never falls through to the config file's human-handoff key in practice, and the flag or the
runtime handoff command must be used to actually enable it, since setting human-handoff in
the config file alone currently has no effect. In human-handoff mode, the agent's advisor
calls are redirected to the user instead of a second model, the agent pauses, shows its
question, and the user types a response, which is useful for reviewing the agent's approach
before it writes code, stepping in when the agent is stuck or uncertain, and teaching the
agent preferences interactively. Runtime control comes from the advisor slash command, with
forms for showing status, enabling or disabling, toggling handoff, changing the model,
setting maximum uses with zero meaning unlimited, and setting the context limit in
kilobytes.

Tiny Crow can run language servers for the files the agent edits and feed diagnostics,
errors and warnings, back into edit and write tool results, so the agent sees type errors
immediately instead of discovering them on the next build, and a diagnostics tool also lets
the agent query one file or the whole project on demand. This integration is behind the
non-default language-server optional subsystem, enabled through its configuration. A TOML
illustration enables it, overrides a built-in TypeScript server with a command and
extensions, and defines a fully custom server with a command, arguments, and an extension,
commenting out environment, initialization, and disabled fields, while a YAML illustration
enables it with a TypeScript server command and extensions. Built-in server defaults, used
only when the server program is on the path, are the TypeScript, Go, Python, C and C++,
shell, and Lua language servers. Behaviour notes, in prose, are: servers are path programs
only and tiny-crow never auto-installs a language server, with a missing program skipped
with a debug log; servers start lazily on the first edit touching one of their extensions,
with the workspace root as the session working directory, and stop when tiny-crow exits;
everything is fail-open, so a hung or crashed server only means no diagnostics, never a
failed edit; and post-edit diagnostics are capped, errors first, around twenty lines, with
nothing appended when the file is clean.

Tiny Crow can route shell commands through an external CLI proxy that filters and compresses
command output before it reaches the model context, for example tests reporting failures
only and git status returning a compact summary, with the proxy claiming up to ninety
percent reduction of shell output tokens. This integration is behind the non-default
output-filtering optional subsystem, enabled through its configuration. When enabled, every
shell tool command is passed through the proxy's rewrite step before execution, the proxy
decides which commands have a compact equivalent while unsupported commands run unchanged,
permission checks always run against the original command so existing permission patterns
keep working, and the integration is fail-open, so if the program is missing, times out, or
errors, the original command runs unfiltered. A TOML illustration enables it with a
commented-out path field, and a YAML illustration enables it with a path value, and when
active, a short note is appended to the system prompt telling the model that shell output is
compacted and that the proxy writes full raw output to a tee log on failure.

Tiny Crow uses built-in logging for structured logging, and by default only warnings and
errors are printed to stderr at the warn level, with the provider client silenced, while
full debug and trace output is available via CLI flags. Verbose mode, with the short or long
flag, enables full trace-level logging to a timestamped log file under the data directory's
logs folder, or the data-directory override's logs folder, named with the program name, a
date and time, and a process identifier, with a new file created per instance so previous
runs are never overwritten, and with verbose mode stderr output stays at the default warn
level so the interface remains clean, while the log file captures everything at trace level
for all tiny-crow modules. A custom log file flag writes full trace-level logs to the
specified path instead of the default location, implies verbose mode for the file output,
and can be combined with verbose mode with no effect on the path, since the explicit path
takes precedence. A custom stderr log level flag sets the minimum level for stderr output,
with accepted values trace, debug, info, warn, and error, overriding the log environment
variable. The standard log environment variable is still supported, illustrated by three
shell lines setting debug or trace levels for the program, and the priority, highest wins,
is the flag, then the environment variable, then the default warn level. With verbose mode,
the subsystems producing debug and trace output, in prose, are: agent lifecycle, covering
prompt sizes, retry events, token usage, and tool call dispatch; model-exposed tools,
covering every tool invocation with start and end, arguments, and results; config loading,
covering first-startup detection, config file path, and quick-model and provider counts;
session management, covering save, delete, and find operations with message counts; the
permission checker, covering every permission check result, doom-loop detection, and mode
changes; MCP, covering connection attempts, transport details, per-server tool counts, and
reconnects; ACP, covering server start, session creation, and prompt execution with provider
and model info; memory, covering store open, write operations with target and bytes,
searches, and tool entry points; advisor, covering initialization with model, enabled state,
and maximum uses, plus tool call prompts; and filesystem, covering atomic write paths and
byte counts.
