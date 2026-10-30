// Two-level modal picker for the double-Esc rewind: first pick an earlier
// user turn, then confirm the (destructive) rewind. Reuses ListPicker for
// rendering and selection at each level; the outcome is read back by the
// event loop, which owns the session and performs the actual rewind.

import type { KeyEvent } from "../input/cursor.ts";
import { ListPicker } from "./list.ts";

export type RewindOutcome =
  | { kind: "confirmed"; index: number }
  | { kind: "cancelled" };

type Stage = "pickMessage" | "confirm";

export const CONFIRM_REWIND = "Rewind and start from here";
export const CONFIRM_CANCEL = "Cancel";

export class RewindPicker {
  private activeFlag = false;
  private stage: Stage = "pickMessage";
  private list: ListPicker;
  private targets: Array<[number, string]>;
  private chosen: number | undefined;
  private outcome: RewindOutcome | undefined;

  constructor(targets: Array<[number, string]>) {
    this.list = new ListPicker();
    this.list.setItems(targets.map(([, preview]) => preview));
    this.targets = [...targets];
  }

  setMonochrome(monochrome: boolean): void {
    this.list.setMonochrome(monochrome);
  }

  activate(): void {
    this.activeFlag = true;
    this.stage = "pickMessage";
    this.list.activate();
  }

  active(): boolean {
    return this.activeFlag;
  }

  takeOutcome(): RewindOutcome | undefined {
    const out = this.outcome;
    this.outcome = undefined;
    return out;
  }

  draw(): void {
    this.list.draw();
  }

  /** Modal key handling: always returns true, swallowing every keystroke until it resolves. */
  handle(key: KeyEvent): boolean {
    switch (key.code.kind) {
      case "up":
        this.list.selectPrev();
        break;
      case "down":
        this.list.selectNext();
        break;
      case "tab":
        if (key.modifiers.shift) this.list.selectPrev();
        else this.list.selectNext();
        break;
      case "backtab":
        this.list.selectPrev();
        break;
      case "enter":
        this.confirm();
        break;
      case "esc":
        this.backOrCancel();
        break;
      default:
        break;
    }
    return true;
  }

  private confirm(): void {
    if (this.stage === "pickMessage") {
      const target = this.targets[this.list.selected];
      if (target !== undefined) {
        this.chosen = target[0];
        this.stage = "confirm";
        this.list.setItems([CONFIRM_REWIND, CONFIRM_CANCEL]);
        this.list.activate();
      }
    } else {
      this.outcome =
        this.list.selected === 0
          ? { kind: "confirmed", index: this.chosen ?? 0 }
          : { kind: "cancelled" };
      this.finish();
    }
  }

  private backOrCancel(): void {
    if (this.stage === "confirm") {
      // Esc at the confirm step backs up to the message list rather than
      // bailing out entirely, so a mis-step is cheap to correct.
      this.stage = "pickMessage";
      this.list.setItems(this.targets.map(([, preview]) => preview));
      this.list.activate();
      if (this.chosen !== undefined) {
        const pos = this.targets.findIndex(([idx]) => idx === this.chosen);
        if (pos !== -1) this.list.selected = pos;
      }
    } else {
      this.outcome = { kind: "cancelled" };
      this.finish();
    }
  }

  private finish(): void {
    this.activeFlag = false;
    this.list.deactivate();
  }
}
