import { insertAt, removeAt } from "../input/cursor.ts";
import {
  clearCurrentLine,
  drawPickerList,
  fuzzyScore,
  moveTo,
  resetColor,
  setForegroundColor,
  terminalSize,
  type PickerColor,
} from "./mod.ts";

export class ModelsPicker {
  active = false;
  query = "";
  cursor = 0;
  matches: string[] = [];
  selected = 0;
  group = 0;
  private quick: string[] = [];
  private provider: string[] = [];
  private monochrome = false;

  setMonochrome(monochrome: boolean): void {
    this.monochrome = monochrome;
  }

  setGroups(quick: string[], provider: string[]): void {
    this.quick = [...quick];
    this.provider = [...provider];
  }

  private color(color: PickerColor): PickerColor {
    return this.monochrome ? "reset" : color;
  }

  activate(): void {
    this.active = true;
    this.query = "";
    this.cursor = 0;
    this.matches = [];
    this.selected = 0;
    this.group = this.quick.length === 0 && this.provider.length > 0 ? 1 : 0;
    this.filter();
  }

  deactivate(): void {
    this.active = false;
  }

  toggleGroup(): void {
    this.group = 1 - this.group;
    this.selected = 0;
    this.filter();
  }

  charInput(c: string): void {
    this.query = insertAt(this.query, this.cursor, c);
    this.cursor += 1;
    this.filter();
  }

  backspace(): void {
    if (this.cursor > 0 && this.query !== "") {
      this.cursor -= 1;
      this.query = removeAt(this.query, this.cursor);
      this.filter();
    }
  }

  private filter(): void {
    const src = this.group === 0 ? this.quick : this.provider;
    const scored: Array<[number, string]> = [];
    for (const name of src) {
      const score = fuzzyScore(name, this.query);
      if (score !== undefined) scored.push([score, name]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    this.matches = scored.slice(0, 50).map(([, name]) => name);
    this.selected = 0;
  }

  selectNext(): void {
    if (this.matches.length > 0) {
      this.selected = (this.selected + 1) % this.matches.length;
    }
  }

  selectPrev(): void {
    if (this.matches.length > 0) {
      this.selected =
        this.selected === 0 ? this.matches.length - 1 : this.selected - 1;
    }
  }

  selectedName(): string | undefined {
    return this.matches[this.selected];
  }

  draw(): void {
    if (!this.active) return;
    const { rows } = terminalSize();
    const maxItems = Math.min(Math.max(rows - 5, 0), 10);
    const listHeight = Math.min(maxItems, Math.max(this.matches.length, 1));
    const topRow = Math.max(rows - 3 - listHeight, 0);

    if (rows >= 8) {
      const headerRow = Math.max(topRow - 1, 0);
      moveTo(0, headerRow);
      clearCurrentLine();
      const tab = (label: string, count: number, active: boolean): string =>
        active ? `[${label} ${count}]` : ` ${label} ${count} `;
      setForegroundColor(this.color("darkGrey"), false);
      process.stdout.write(
        `${tab("Quick", this.quick.length, this.group === 0)}  ${tab("Provider", this.provider.length, this.group === 1)}   (Tab to switch · /models refresh for the latest)`,
      );
      resetColor();
    }
    drawPickerList(this.matches, this.selected, this.monochrome, undefined, 5);
  }
}
