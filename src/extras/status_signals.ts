import { createConnection } from "node:net";

export type BlockedReason = "permission";

export function blockedReasonLine(reason: BlockedReason): string {
  switch (reason) {
    case "permission":
      return "blocked:permission\n";
  }
}

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
        
        try {
          socket.destroy();
        } catch {

        }
      });
      socket.end(line);
    } catch {

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

  sendBlocked(reason: BlockedReason): void {
    this.sendLine(blockedReasonLine(reason));
  }

  sendState(state: RunState): void {
    this.sendLine(runStateLine(state));
  }

  blockedScope(reason: BlockedReason): BlockedScope {
    this.sendBlocked(reason);
    return new BlockedScope(this);
  }
}

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
