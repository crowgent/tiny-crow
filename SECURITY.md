# Security and sandboxing

Tiny Crow can place commands issued by the `bash` tool inside an
isolated environment. It is opt-in: `--sandbox` on the command line, or
`sandbox = true` in the config file. Pick the backend with
`--sandbox-backend` / `sandbox-backend`: `bwrap`
([bubblewrap](https://github.com/containers/bubblewrap), the default,
Linux only) or `zerobox` ([zerobox](https://github.com/afshinm/zerobox),
macOS and Linux, installed separately).

The sandbox is there to limit accidental damage from commands the
model proposes. It is not a full security boundary against an
adversary who controls the command being run.

## Sandbox guarantees and best-effort behaviour

Two different contracts sit behind the same flags:

- `sandbox = true` (or `--sandbox`) is **best effort**. Should the
  backend program be missing, tiny-crow logs a warning at startup and
  each command runs unsandboxed rather than failing. Sessions carry on
  working on machines without the backend, just without isolation.
- `sandbox-required = true` (or `--sandbox-required`) is the
  **guarantee**. When the backend program is unavailable, bash commands
  are refused with an error explaining why, instead of running bare.
  `sandbox-required` implies `sandbox`.

`sandbox-required` does not stop the process at startup. Everything
else in the session (reading files, editing, planning) keeps working;
only bash execution is refused. This is the setting for unattended or
automated runs, where nobody is watching the log for the "running
unsandboxed" warning.

Neither `sandbox-expose` nor `sandbox-network` forms a contract of
its own: both only tune what the sandbox does once it is running,
and neither one switches the sandbox on. `sandbox-network = false` alongside
`sandbox = false` is a no-op, warned about once at startup;
`sandbox-network = false` alongside `sandbox = true` alone is best
effort in the same way as everything else, since a missing backend
still runs the command bare and online. Pairing it with
`sandbox-required` is what turns "the bash tool cannot reach the host
network" into a guarantee, and that sentence is deliberately about the
bash tool rather than about the session.

Neither setting alters the gaps listed below. `sandbox-required`
guarantees the isolation is present, not that the isolation is
complete.

## What the sandbox does not cover

- **Sandboxing covers the `bash` tool and nothing else.** File reads
  and writes done by tiny-crow's own tools, MCP servers, hooks, and
  shell commands you run yourself with the `!` prefix all execute
  outside the sandbox. The permission system governs them, not this
  isolation.
- **Whether a backend exists depends on the platform.** `bwrap` runs
  on Linux only, so on macOS the default backend is absent and
  `sandbox = true` on its own buys no isolation: commands run bare,
  with a warning in the logs. Install zerobox and set
  `sandbox-backend = "zerobox"` for genuine isolation on macOS, or set
  `sandbox-required` so those commands are turned away with an error
  rather than running unprotected.
- **Tiny Crow takes the backend's enforcement on trust.** It starts
  the backend with the arguments described here and accepts the
  outcome. What this document states about zerobox is its documented
  default behaviour, not something established by auditing its
  implementation.

## Backend behaviour

- `bwrap` (default): Linux only. The bubblewrap mounts and namespaces
  described below, with the host network left open unless
  `sandbox-network = false` unshares it, in which case each command
  gets a fresh namespace with only its own private loopback. The nine
  built-in credential directories are masked by default and the
  advertised ssh-agent socket is cut off; see below.
- `zerobox`: macOS and Linux. Denies writes, network access, and
  environment variables by default, with per-domain network
  allowances. `sandbox-network` is a bwrap-only key and does not apply
  here: zerobox refuses network access on its own terms no matter
  what that key says. Tiny Crow invokes
  `zerobox --allow-write <cwd> -- <shell> -c <command>`, so the working
  directory is writable and the rest of the policy is whatever zerobox
  enforces. Credential masking does not apply here: zerobox exposes no
  mount-policy surface to inject it, and whether its own defaults limit
  reads under `$HOME` has not been verified.
- none: with the sandbox off (the default), bash commands run
  directly as your user with no isolation at all. The permission
  system is the only gate.

## Default `bwrap` environment

A command running under the default backend finds:

- The root filesystem bound in read-only, so writes outside the
  permitted paths are refused.
- The working directory bound in read-write, so the project being
  worked on stays editable.
- A new `/tmp` on tmpfs, a private `/proc`, and a stripped-down `/dev`.
- Its own IPC, PID, UTS, and cgroup namespaces, hiding outside
  processes from view and from signals — plus its own network
  namespace only when `sandbox-network = false` is set (the default
  leaves the host network in place).
- An emptied environment, filled back in from an allowlist of everyday
  variables (`PATH`, `HOME`, toolchain and locale variables, and so on).
- `--die-with-parent`, so the sandboxed tree dies with tiny-crow.

That combination catches everyday accidents: a stray `rm -rf` aimed
outside the project, an installer writing into system directories, a
build script touching files elsewhere on the machine.

The `zerobox` backend takes a different shape. It is built on the
OpenAI Codex sandbox runtime, and its starting position is to refuse
writes, network access, and environment variables, with network access
openable per domain. Tiny Crow calls it as
`zerobox --allow-write <cwd> -- <shell> -c <command>`, so write access
to the working directory is the single opening tiny-crow makes in that
policy; the rest follows zerobox's own defaults.

## Sandbox limitations

Most of these follow from how tiny-crow configures the default `bwrap`
backend; the final group holds whichever backend you pick.

Under `bwrap`:

- **The network stays open unless you close it.** By default tiny-crow
  leaves the network namespace shared, so a sandboxed command can talk
  to the internet and to the local network — and can therefore send
  out anything it can read. Closing it takes `sandbox-network = false`
  (or `--sandbox-network=false`). Each bash call then gets a brand-new
  network namespace containing nothing but its own private loopback
  device, which bubblewrap raises for it: a server the command starts
  and then reaches on `127.0.0.1` keeps working, because both ends sit
  inside that namespace, while the internet, the LAN, and anything
  listening on the *host's* loopback (a dev server on `localhost:3000`,
  a database, a local registry) all become unreachable. Note this is
  routing only: `/sys` is a host bind, so interface names and MAC
  addresses can still be read from inside the offline namespace
  (`/proc` is remounted fresh and mirrors the new namespace, not the
  host's). The namespace lives exactly as long as the command, so a
  server left running in the background by one bash call is gone by
  the next. Closing the network also swaps in a new abstract Unix
  socket namespace, cutting off abstract-address sockets on the host,
  which some D-Bus and X11 setups rely on. Sockets that live at a
  filesystem path are unaffected; the next gap covers those. Switching
  the network off is what gives credential masking real weight:
  masking alone limits what a sandboxed command can read but leaves it
  a route out, and an offline namespace alone removes the route out
  but leaves everything outside the masked directories readable.
  Together they shrink the path from "reads your secrets" to "sends
  them somewhere" **for the `bash` tool only** — that is the full
  extent of every claim in this section, since the file reads, MCP
  servers, hooks, and `!` commands described under "What the sandbox
  never covers" above never enter the sandbox at all. Two limits
  bind that shrinkage, and neither is minor. Where a machine runs
  Docker, a session bus, or another daemon listening on a socket file,
  the next gap applies and the route out remains open, so the shrinkage
  is not claimed there at all. And the tool result is itself a route
  out: a sandboxed command's stdout and stderr are exactly what the
  `bash` tool hands back, and that text goes to whichever model
  provider the session is configured with, so anything a command prints
  has already left your machine whatever the network setting says.
  Switching the network off removes the command's own network access;
  it cannot seal the channel the agent itself runs over. Without
  `sandbox-required`, a missing backend still drops back to running
  commands bare, network intact and nothing masked. The `zerobox`
  backend is untouched by this key and refuses network access
  anyway, by its own default.
- **Sockets on disk can still be connected to, network off or not.**
  A read-only bind mount blocks writes to a socket *file*, but a
  `connect(2)` to it is a different operation: the kernel's read-only
  protection applies to regular files, directories, and symlinks, not
  to connecting to a socket inode. Socket paths under `/run`,
  `/var/run`, and `/run/user/$UID` are thus visible and usable from
  inside the sandbox no matter what `sandbox-network` is set to,
  because they are filesystem objects rather than network ones and
  sit entirely outside the network namespace. The sharpest instance is
  `/run/docker.sock` on a Docker host: a sandboxed command able to
  talk to the Docker daemon can request a container with the host
  filesystem mounted and the host network attached — a complete escape
  from mounts and network namespace alike, credential masks included.
  A session bus at `/run/user/$UID/bus` has the same shape on a
  smaller scale, as does any other daemon socket your distribution
  leaves lying around. Tiny Crow currently masks no host socket paths.
  Masking them is plausible future hardening, not present behaviour,
  so "the sandbox is offline" should be read as a statement about the
  network stack, not about every possible way out of the machine.
- **Your home directory is mostly still open to reads.** Since `/` is
  mounted read-only rather than hidden, everything under `$HOME`
  shows up inside the sandbox apart from the nine credential
  directories masked by default: `~/.ssh`, `~/.aws`, `~/.gnupg`,
  `~/.kube`, `~/.docker`, `~/.config/gh`, `~/.config/gcloud`,
  `~/.config/op`, `~/.config/sops/age` (the last four track
  `$XDG_CONFIG_HOME` instead of `~/.config` when that variable holds
  an absolute path, since that is where those tools look). Each of
  these, where it exists on the host, is overlaid with a tmpfs, so a
  sandboxed command finds an empty directory instead of your keys and
  tokens. That tmpfs is an ordinary writable filesystem belonging to
  the sandboxed user, not a read-only view, so a command writing into
  a masked directory succeeds and then loses what it wrote when the
  sandbox exits: `ssh-keygen -f ~/.ssh/id_x`, `gh auth login`, and
  `aws configure` all return `0` after silently throwing away
  whatever they wrote, and because the exit status is zero, the hint
  that names a masked path on a failed command never triggers for
  these. A read-only mask is achievable (bwrap offers `--remount-ro`),
  but it would turn any tool that writes into its own credential
  directory into a hard failure rather than a silent loss, which is
  why the mask remains writable by default today. When a command has a
  legitimate need for one, `sandbox-expose` (config key or repeatable
  `--sandbox-expose <path>` flag) restores read-only access to a
  masked entry or a subpath of one; see `docs/CONFIG.md`. Three holes
  remain after all that: single-file credentials such as `~/.netrc`
  and `~/.npmrc` have no clean bwrap file-hiding primitive and go
  unmasked; everything else under `$HOME` beyond the nine directories
  above (`.env` files, browser profiles, shell history) stays fully
  readable; and live IPC credential endpoints are untouched by
  directory masking altogether. The sandbox environment allowlist
  still passes through `DBUS_SESSION_BUS_ADDRESS` and
  `XDG_RUNTIME_DIR`, and `/run` stays readable via the read-only root
  bind, so the freedesktop secret service (gnome-keyring, KWallet)
  stays reachable from inside the sandbox, and tools built on it —
  `secret-tool`, `git-credential-libsecret`,
  `docker-credential-secretservice`, and the Python `keyring` package
  — can still pull stored tokens out. Directory masking does not fix
  this, and this change does not address it.
- **The user cache directory is writable throughout.** `~/.cache` (or
  `$XDG_CACHE_HOME`) is bound in read-write so build tooling works.
  Anything cached there, including tool caches other programs trust,
  is open to modification.
- **Only the advertised agent socket is cut off, not every agent that
  might exist.** `SSH_AUTH_SOCK` and `SSH_AGENT_PID` are struck from
  the sandbox environment allowlist, and the socket path the host's
  `SSH_AUTH_SOCK` names is bound over with `/dev/null`, so a
  sandboxed command cannot reach the agent even by rebuilding the
  variable by hand. That targets the socket the host advertises: a
  second agent socket running somewhere else (for example a systemd
  `ssh-agent.socket` next to gnome-keyring) can stay reachable under
  `/run/user`. The gpg-agent SSH socket gets the same treatment as any
  other advertised agent: whichever socket `SSH_AUTH_SOCK` names
  receives the `/dev/null` bind, wherever it lives. The `~/.gnupg`
  directory mask additionally conceals a gpg-agent socket when the
  socket file itself sits inside `~/.gnupg`, which is not how things
  are on mainstream systemd distributions, where GnuPG's socket
  directory is `/run/user/$UID/gnupg` instead (check with
  `gpgconf --list-dirs socketdir`). There is no switch inside the
  sandbox to turn the agent back on; the ways back are
  `sandbox-expose ~/.ssh` for direct key-file auth (passphrase-less
  keys) and the `!` prefix, which runs the command outside the
  sandbox with the agent intact.
- **Escapes at the kernel level sit outside this design.** Bubblewrap
  relies on user namespaces; a kernel vulnerability, or a host set up
  to grant more than the usual namespace privileges, can break the
  isolation.

Treat the sandbox as a seatbelt against mistakes, not as a container
for untrusted code. If a genuine boundary is what you need, run
tiny-crow itself inside a VM or a container, with only the network and
credentials you are prepared to expose.

## Reporting a vulnerability privately

Security issues go through private channels only: use the repository's
Security tab ("Report a vulnerability"). A vulnerability must never be
filed as a public issue or pull request.

A report is most useful when it carries: the tiny-crow version
(`tiny-crow --version`), the platform, the configuration involved (with
API keys removed), and the smallest reproduction you have.

Fixes land in the next release from `main`. There are no long-term
support branches, so upgrade to the latest release before reporting.
