// Status signals over a Unix socket: start/stop, blocked/state lines.
import { createConnection } from "node:net";

/** Reasons tiny-crow can be blocked waiting on something external. */
export type BlockedReason = "permission";

export function blockedReasonLine(reason: BlockedReason): string {
  switch (reason) {
    case "permission":
      return "blocked:permission\n";
  }
}

/** Run states reported once a block has ended. */
export type RunState = "working";

export function runStateLine(state: RunState): string {
  switch (state) {
    case "working":
      return "state:working\n";
  }
}

export class StatusSignals {
  private path: string;

  constructor(path: string) {
    this.path = path;
  }

  get socketPath(): string {
    return this.path;
  }

  private sendLine(line: string): void {
    try {
      const socket = createConnection(this.path);
      socket.on("error", () => {
        // Best effort: a missing listener must never break the agent.
        try {
          socket.destroy();
        } catch {
          // ignore
        }
      });
      socket.end(line);
    } catch {
      // Best effort.
    }
  }

  sendStart(): void {
    this.sendLine("start\n");
  }

  sendStop(): void {
    this.sendLine("stop\n");
  }

  sendGitConflict(): void {
    this.sendLine("git-conflict\n");
  }

  /**
   * Raw sender for `blocked:<reason>`. Prefer `blockedScope` so the
   * `blocked:`/`state:` pair stays balanced; this exists because some
   * waits span several event-loop turns and cannot hold a guard.
   */
  sendBlocked(reason: BlockedReason): void {
    this.sendLine(blockedReasonLine(reason));
  }

  /** Raw sender for `state:<state>`; see `sendBlocked`. */
  sendState(state: RunState): void {
    this.sendLine(runStateLine(state));
  }

  /**
   * Permission waits always resume the same run, which is why the guard
   * releases with `working` while `sendState` stays parameterised.
   * Call `dispose()` to release.
   */
  blockedScope(reason: BlockedReason): BlockedScope {
    this.sendBlocked(reason);
    return new BlockedScope(this);
  }
}

/**
 * Guard that reports `blocked:<reason>` on construction and
 * `state:working` on dispose, keeping the pair balanced across every
 * exit path.
 */
export class BlockedScope {
  private signals: StatusSignals;
  private released = false;

  constructor(signals: StatusSignals) {
    this.signals = signals;
  }

  dispose(): void {
    if (this.released) return;
    this.released = true;
    this.signals.sendState("working");
  }
}
