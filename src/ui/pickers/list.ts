// Generic list picker used for slash-command completion and for
// prefixed pickers (prompt / theme / provider / queue names).

import { charCount, insertAt, removeAt } from "../input/cursor.ts";
import { drawPickerList } from "./mod.ts";

// Commands that are always available, in alphabetical order. The original
// appends feature-gated commands only when their feature is compiled in;
// this port has no cargo features, so every command whose handler exists in
// this port is listed.
export const BASE_COMMANDS: string[] = [
  "/add",
  "/btw",
  "/clear",
  "/compact",
  "/compress",
  "/drop",
  "/drop-all",
  "/editsys",
  "/exit",
  "/help",
  "/history",
  "/init",
  "/mode",
  "/model",
  "/models",
  "/models-add",
  "/new",
  "/prompt",
  "/provider",
  "/queue",
  "/quit",
  "/reasoning",
  "/redo",
  "/rename",
  "/regen-prompts",
  "/regen-themes",
  "/retry",
  "/review",
  "/rewind",
  "/sessions",
  "/theme",
  "/thinking",
  "/toggle",
  "/tutor",
  "/tutorial",
  "/undo",
  "/welcome",
];

export function availableCommands(): string[] {
  return [
    ...BASE_COMMANDS,
    "/advisor",
    "/export",
    "/import",
    "/share",
    "/worktree",
    "/wt-exit",
    "/wt-merge",
    "/hooks",
    "/loop",
    "/mcp",
    "/memory",
    "/model-subagent",
    "/models-subagent",
  ];
}

export class ListPicker {
  active = false;
  query = "";
  cursor = 0;
  matches: string[] = [];
  selected = 0;
  private items: string[] = [];
  private monochrome = false;

  static withStaticCommands(): ListPicker {
    const picker = new ListPicker();
    picker.items = availableCommands();
    return picker;
  }

  setMonochrome(monochrome: boolean): void {
    this.monochrome = monochrome;
  }

  setItems(items: string[]): void {
    this.items = [...items];
  }

  getItems(): string[] {
    return [...this.items];
  }

  activate(): void {
    this.active = true;
    this.query = "";
    this.cursor = 0;
    this.matches = [];
    this.selected = 0;
    this.filter();
  }

  deactivate(): void {
    this.active = false;
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
    const queryLower = this.query.toLowerCase();
    this.matches = this.items
      .filter((name) => name.toLowerCase().includes(queryLower))
      .slice(0, 50);
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

  draw(emptyMessage?: string): void {
    if (!this.active) return;
    drawPickerList(this.matches, this.selected, this.monochrome, emptyMessage, 4);
  }
}

export function queryCharCount(picker: ListPicker): number {
  return charCount(picker.query);
}
