import type { KeyEvent } from "../input/cursor.ts";
import { insertAt, isBackspaceAlias, removeAt } from "../input/cursor.ts";
import {
  clearCurrentLine,
  drawPickerList,
  fuzzyScore,
  moveTo,
  resetColor,
  setForegroundColor,
  terminalSize,
} from "./mod.ts";

export type SwitcherOutcome =
  | { kind: "confirmed"; name: string }
  | { kind: "cancelled" };

export type SwitcherResult =
  | { kind: "model"; name: string }
  | { kind: "prompt"; name: string }
  | { kind: "cancelled" };

function fuzzyFilter(items: string[], query: string): string[] {
  const scored: Array<[number, string]> = [];
  for (const name of items) {
    const score = fuzzyScore(name, query);
    if (score !== undefined) scored.push([score, name]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, 50).map(([, name]) => name);
}

function drawHeader(
  header: string,
  matchesLength: number,
  monochrome: boolean,
): { listHeight: number } {
  const { rows } = terminalSize();
  const maxItems = Math.min(Math.max(rows - 5, 0), 10);
  const listHeight = Math.min(maxItems, Math.max(matchesLength, 1));
  const topRow = Math.max(rows - 3 - listHeight, 0);
  if (rows >= 8) {
    moveTo(0, Math.max(topRow - 1, 0));
    clearCurrentLine();
    setForegroundColor("darkGrey", monochrome);
    process.stdout.write(header);
    resetColor();
  }
  return { listHeight };
}

export class ModelSwitcher {
  private activeFlag = false;
  query = "";
  cursor = 0;
  matches: string[] = [];
  selected = 0;
  private quick: string[] = [];
  private live: string[] = [];
  group = 0;
  
  private details = new Map<string, string>();
  
  private currentQuick: string | undefined;
  
  private currentModel = "";
  private outcome: SwitcherOutcome | undefined;
  private monochrome = false;

  setMonochrome(monochrome: boolean): void {
    this.monochrome = monochrome;
  }

  setGroups(quick: string[], live: string[]): void {
    this.quick = [...quick];
    this.live = [...live];
  }

  setDetails(details: Map<string, string> | Record<string, string>): void {
    this.details =
      details instanceof Map ? new Map(details) : new Map(Object.entries(details));
  }

  setCurrent(currentQuick: string | undefined, currentModel: string): void {
    this.currentQuick = currentQuick;
    this.currentModel = currentModel;
  }

  activate(): void {
    this.activeFlag = true;
    this.query = "";
    this.cursor = 0;
    this.matches = [];
    this.selected = 0;
    this.outcome = undefined;
    this.group = this.quick.length === 0 && this.live.length > 0 ? 1 : 0;
    this.filter();
  }

  active(): boolean {
    return this.activeFlag;
  }

  takeOutcome(): SwitcherOutcome | undefined {
    const out = this.outcome;
    this.outcome = undefined;
    return out;
  }

  private filter(): void {
    const src = this.group === 0 ? this.quick : this.live;
    this.matches = fuzzyFilter(src, this.query);
    this.selected = 0;
  }

  private toggleGroup(): void {
    this.group = 1 - this.group;
    this.selected = 0;
    this.filter();
  }

  private charInput(c: string): void {
    this.query = insertAt(this.query, this.cursor, c);
    this.cursor += 1;
    this.filter();
  }

  private backspace(): void {
    if (this.cursor > 0 && this.query !== "") {
      this.cursor -= 1;
      this.query = removeAt(this.query, this.cursor);
      this.filter();
    }
  }

  private isCurrent(name: string): boolean {
    return this.group === 0 ? this.currentQuick === name : name === this.currentModel;
  }

  displayRows(): string[] {
    return this.matches.map((name) => {
      let row = name;
      if (this.group === 0) {
        const d = this.details.get(name);
        if (d !== undefined) row += `  ${d}`;
      }
      if (this.isCurrent(name)) row += "  ● current";
      return row;
    });
  }

  draw(): void {
    if (!this.activeFlag) return;
    const tab = (label: string, count: number, active: boolean): string =>
      active ? `[${label} ${count}]` : ` ${label} ${count} `;
    drawHeader(
      `${tab("Quick", this.quick.length, this.group === 0)}  ${tab("Provider", this.live.length, this.group === 1)}   (Tab to switch · Enter applies immediately · Esc cancels)`,
      this.matches.length,
      this.monochrome,
    );
    drawPickerList(this.displayRows(), this.selected, this.monochrome, undefined, 5);
  }

  handle(key: KeyEvent): boolean {

    if (key.modifiers.control || key.modifiers.alt) {
      if (isBackspaceAlias(key)) this.backspace();
      return true;
    }
    switch (key.code.kind) {
      case "char":
        if (key.code.char === "\x08") this.backspace();
        else this.charInput(key.code.char);
        break;
      case "backspace":
        this.backspace();
        break;
      case "tab":
      case "backtab":
        this.toggleGroup();
        break;
      case "up":
        if (this.matches.length > 0) {
          this.selected =
            this.selected === 0 ? this.matches.length - 1 : this.selected - 1;
        }
        break;
      case "down":
        if (this.matches.length > 0) {
          this.selected = (this.selected + 1) % this.matches.length;
        }
        break;
      case "enter": {
        const name = this.matches[this.selected];
        this.outcome =
          name !== undefined ? { kind: "confirmed", name } : { kind: "cancelled" };
        this.activeFlag = false;
        break;
      }
      case "esc":
        this.outcome = { kind: "cancelled" };
        this.activeFlag = false;
        break;
      default:
        break;
    }
    return true;
  }
}

export class PromptSwitcher {
  private activeFlag = false;
  query = "";
  cursor = 0;
  matches: string[] = [];
  selected = 0;
  private items: string[] = [];
  
  private details = new Map<string, string>();
  private current: string | undefined;
  private outcome: SwitcherOutcome | undefined;
  private monochrome = false;

  setMonochrome(monochrome: boolean): void {
    this.monochrome = monochrome;
  }

  setItems(items: string[]): void {
    this.items = [...items];
  }

  setDetails(details: Map<string, string> | Record<string, string>): void {
    this.details =
      details instanceof Map ? new Map(details) : new Map(Object.entries(details));
  }

  setCurrent(current: string | undefined): void {
    this.current = current;
  }

  activate(): void {
    this.activeFlag = true;
    this.query = "";
    this.cursor = 0;
    this.selected = 0;
    this.outcome = undefined;
    this.filter();
  }

  active(): boolean {
    return this.activeFlag;
  }

  takeOutcome(): SwitcherOutcome | undefined {
    const out = this.outcome;
    this.outcome = undefined;
    return out;
  }

  private filter(): void {
    this.matches = fuzzyFilter(this.items, this.query);
    this.selected = 0;
  }

  private charInput(c: string): void {
    this.query = insertAt(this.query, this.cursor, c);
    this.cursor += 1;
    this.filter();
  }

  private backspace(): void {
    if (this.cursor > 0 && this.query !== "") {
      this.cursor -= 1;
      this.query = removeAt(this.query, this.cursor);
      this.filter();
    }
  }

  displayRows(): string[] {
    return this.matches.map((name) => {
      let row = name;
      const d = this.details.get(name);
      if (d !== undefined) row += `  ${d}`;
      if (this.current === name) row += "  ● current";
      return row;
    });
  }

  draw(): void {
    if (!this.activeFlag) return;
    drawHeader(
      `[Prompts ${this.items.length}]   (Enter applies immediately · Esc cancels)`,
      this.matches.length,
      this.monochrome,
    );
    const empty =
      this.items.length === 0 ? "no prompts — /regen-prompts to restore" : undefined;
    drawPickerList(this.displayRows(), this.selected, this.monochrome, empty, 5);
  }

  handle(key: KeyEvent): boolean {
    if (key.modifiers.control || key.modifiers.alt) {
      if (isBackspaceAlias(key)) this.backspace();
      return true;
    }
    switch (key.code.kind) {
      case "char":
        if (key.code.char === "\x08") this.backspace();
        else this.charInput(key.code.char);
        break;
      case "backspace":
        this.backspace();
        break;
      case "up":
        if (this.matches.length > 0) {
          this.selected =
            this.selected === 0 ? this.matches.length - 1 : this.selected - 1;
        }
        break;
      case "down":
        if (this.matches.length > 0) {
          this.selected = (this.selected + 1) % this.matches.length;
        }
        break;
      case "enter": {
        const name = this.matches[this.selected];
        this.outcome =
          name !== undefined ? { kind: "confirmed", name } : { kind: "cancelled" };
        this.activeFlag = false;
        break;
      }
      case "esc":
        this.outcome = { kind: "cancelled" };
        this.activeFlag = false;
        break;
      default:
        break;
    }
    return true;
  }
}
