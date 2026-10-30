---
description: "How tiny-crow reports its run state to an outside observer over a Unix socket, and how a listener should read it."
---

# Status socket protocol

Tiny Crow can narrate what it is doing to a supervisor — a status
bar, a manager for parallel agents, or any other piece of tooling —
through a Unix domain socket. This page is the one place the
protocol is defined. `docs/CONFIG.md` and `README.md` point here
rather than repeating the message list, so a protocol change only
ever needs an edit in this file.

## Enable signal emission

Signals are present in this build, so no extra subsystem needs
enabling. Pass `--status-socket <path>` on the command line and
emission starts; leave the flag off and tiny-crow sends nothing at
all.

The listener has to bind the Unix domain socket at `<path>` and
start accepting before tiny-crow begins sending. Every message
opens a fresh connection, so if nobody is listening at the moment
tiny-crow connects, that write is dropped without a sound and the
run carries on exactly as it would have without
`--status-socket`.

## Transport and delivery guarantees

Traffic flows in one direction only. Tiny Crow sends; the listener
watches. Nothing comes back the other way, and delivery is
best-effort in the plainest sense: for each message tiny-crow
connects, writes, and disconnects. It never waits for a listener
that is not there, never retries a missed message, and never
queues one for later.

Each message is a single ASCII line, closed by one `\n`, sent on
its own connect-write-close round trip.

## Message types

- `start`, since v1.0: a turn has started.
- `stop`, since v1.0: a turn has finished.
- `git-conflict`, since v1.0: a worktree merge ran into a conflict
  and is asking the user. It is emitted at two worktree-merge
  prompts; there is currently no matching signal for leaving that
  wait.
- `blocked:permission`, since v1.1: the interactive permission
  prompt is visible and tiny-crow is waiting on a human decision.
- `state:working`, since v1.1: a wait announced by a
  `blocked:<reason>` message has finished and tiny-crow is working
  again.

The `blocked:<reason>` and `state:<state>` families use lowercase
ASCII tokens with no whitespace and no `\n`. This version of the
protocol defines exactly one reason, `permission`, and exactly one
state, `working`. Other reasons and states — a `/chain` wait, a
headless plan-reuse wait, or an `idle` state, for instance — are
held back for later protocol versions and are not sent today.

## Ordering and invariants

A permission wait is wrapped in an exact sequence, in this order:
first `start`, then `blocked:permission`, then `state:working`,
then whatever else the turn produces, and finally `stop`.

The `blocked:permission` line goes out only once the prompt is
actually on screen, and `state:working` goes out only once the
user's decision has been made, before that decision is passed back
to the tool that was waiting. That holds for every outcome the
prompt accepts: allow once, allow always, deny, and Esc. Even if
the prompt path errors out after reporting `blocked:permission`,
the listener still gets `state:working` before the prompt path
returns, so the pair is never left unbalanced.

Treat `state:<state>` as a level report — a statement of the state
tiny-crow is in after a wait ends — not as an event with pairing
or nesting rules. Waits are serialised at present, one prompt at a
time, so a consumer must not stack `blocked:` / `state:` pairs.
`git-conflict` remains a v1.0 attention event with no release
signal in this version.

A `blocked:<reason>` or `state:<state>` line never inserts an
extra `start` or `stop`, and never removes one either. Take a whole
turn, throw away every line that is not `start`, `stop`, or
`git-conflict`, and what is left is byte-for-byte identical, in
the same relative order, to the stream protocol v1.0 produced for
that turn. That is the run-boundary invariant.

## Listener implementation guidance

- Cut incoming bytes at `\n`; a message is everything up to and
  including each `\n`.
- Skip any line you do not recognise. That is what keeps the
  protocol backward compatible: a v1.0 listener that skips
  `blocked:*` and `state:*` notices no change when talking to a
  v1.1 sender.
- Each message arrives on its own connection carrying exactly one
  line, so one read on an accepted stream yields at most one line;
  batching is not part of v1.1.
- Remove a stale socket file before binding. A listener that
  crashed leaves its inode behind, and every later signal is then
  dropped silently with `ECONNREFUSED`.
- The sender connects per message and blocks synchronously on
  `connect` and `write_all`, ignoring the outcome. Accept and read
  promptly: a listener that stalls in its accept loop stalls
  tiny-crow's own run, because the sender is stuck on that same
  connect/write finishing.
- If you keep a single "current state" for display, let the most
  recent recognised `state:<state>` win. A `state:working` that
  shows up after a `stop` (possible on some error paths) is
  harmless: `stop` still arrives and wins as the run boundary, and
  showing `working` for a little longer than the run actually
  lasted beats showing nothing at all.

## Signals by run mode

- Interactive TUI: sends the v1.0 lines (`start`, `stop`,
  `git-conflict`) and also `blocked:permission` / `state:working`.
- Headless `-p`: sends the v1.0 lines only, never the permission
  pair.
- Headless `--loop`: sends the v1.0 lines only, never the
  permission pair.

The non-interactive modes (`-p` and `--loop`) hand no ask channel
to the permission checker, so an Ask verdict is refused before any
prompt is ever drawn. With no permission wait to announce, those
modes never send `blocked:permission` or its paired
`state:working`. A consumer driving tiny-crow headlessly should
not sit waiting for either line.

## Security and operational considerations

Tiny Crow connects to whatever path `--status-socket` names. It
never creates that path and never checks who is on the other end.
Whoever binds the path first sees the agent's activity timeline,
and, because the sender blocks on `connect` and `write` with no
timeout, can also stall the agent. That trade-off is accepted by
the flag and documented here rather than bounded in this protocol
version. Keep the socket in `$XDG_RUNTIME_DIR` or a 0700
directory, never in a shared `/tmp`. Messages deliberately carry
no session content, no tool names, no commands, and no prompt text,
and future reasons must preserve that property.

## Protocol versions

- Protocol v1.0, first shipped in tiny-crow v1.5.0, added
  `start`, `stop`, and `git-conflict`.
- Protocol v1.1, still unreleased, added `blocked:permission` and
  `state:working`.
