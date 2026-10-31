import type { Component } from "./tui.ts";
import { Text } from "./components/text.ts";
import { VStack } from "./components/v-stack.ts";

export interface PanelItem {
  label: string;
  detail?: string;
}

export function windowPanelRows(
  items: PanelItem[],
  selected: number,
  size: number,
): { rows: string[]; selected: number } {
  if (items.length === 0) return { rows: ["  (none)"], selected: 0 };
  const windowSize = Math.max(1, size);
  const sel = ((selected % items.length) + items.length) % items.length;
  let start = 0;
  if (sel >= windowSize) start = sel - windowSize + 1;
  if (start > items.length - windowSize) start = Math.max(0, items.length - windowSize);
  const rows: string[] = [];
  if (start > 0) rows.push(`  ↑ ${start} more above`);
  for (const item of items.slice(start, start + windowSize)) {
    rows.push(item.detail !== undefined && item.detail !== "" ? `  ${item.label}  —  ${item.detail}` : `  ${item.label}`);
  }
  const below = items.length - (start + windowSize);
  if (below > 0) rows.push(`  ↓ ${below} more below`);
  return { rows, selected: (start > 0 ? 1 : 0) + (sel - start) };
}

function isPrintable(data: string): boolean {
  if (data.length === 0 || data.startsWith("\x1b")) return false;
  for (const ch of data) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) return false;
  }
  return true;
}

export function splitKeys(data: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < data.length) {
    const ch = data[i]!;
    if (ch === "\x1b" && data[i + 1] === "[") {
      let j = i + 2;
      while (j < data.length && !/[a-zA-Z~]/.test(data[j]!)) j++;
      if (j < data.length) {
        tokens.push(data.slice(i, j + 1));
        i = j + 1;
        continue;
      }
      tokens.push("\x1b");
      i++;
      continue;
    }
    tokens.push(ch);
    i++;
  }
  return tokens;
}

export class PanelView implements Component {
  title: string;
  status: string;
  items: PanelItem[];
  filter = "";
  selected = 0;
  onSelect: ((index: number | null) => void) | null = null;
  private titleText = new Text("", 0, 0);
  private rowsText = new Text("", 0, 0);
  private statusText = new Text("", 0, 0);
  private stack = new VStack([this.titleText, this.rowsText, this.statusText]);

  constructor(title: string, status: string, items: PanelItem[]) {
    this.title = title;
    this.status = status;
    this.items = items;
  }

  visible(): { item: PanelItem; index: number }[] {
    const lower = this.filter.toLowerCase();
    return this.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => this.filter === "" || item.label.toLowerCase().includes(lower));
  }

  invalidate(): void {
    this.titleText.invalidate();
    this.rowsText.invalidate();
    this.statusText.invalidate();
  }

  render(width: number): string[] {
    const visible = this.visible();
    if (this.selected >= visible.length) this.selected = 0;
    const shown = visible.map(({ item }) => item);
    const { rows, selected } = windowPanelRows(shown, this.selected, 8);
    const marked = rows.map((row, i) => (i === selected && !row.includes("more above") && !row.includes("more below") ? `→ ${row.slice(2)}` : row));
    this.titleText.setText(this.title);
    this.rowsText.setText(marked.join("\n"));
    this.statusText.setText(this.filter === "" ? this.status : `${this.status} | filter: ${this.filter}`);
    return this.stack.render(width);
  }

  handleInput(data: string): void {
    for (const token of splitKeys(data)) {
      this.handleToken(token);
      if (this.onSelect === null) return;
    }
  }

  private handleToken(data: string): void {
    if (data === "\x1b[A") {
      const visible = this.visible();
      if (visible.length > 0) this.selected = (this.selected + visible.length - 1) % visible.length;
      return;
    }
    if (data === "\x1b[B") {
      const visible = this.visible();
      if (visible.length > 0) this.selected = (this.selected + 1) % visible.length;
      return;
    }
    if (data === "\r" || data === "\n") {
      const visible = this.visible();
      const select = this.onSelect;
      this.onSelect = null;
      select?.(visible.length === 0 ? null : (visible[this.selected]?.index ?? null));
      return;
    }
    if (data === "\x1b") {
      const select = this.onSelect;
      this.onSelect = null;
      select?.(null);
      return;
    }
    if (data === "\x7f" || data === "\x08") {
      this.filter = this.filter.slice(0, -1);
      this.selected = 0;
      return;
    }
    if (isPrintable(data)) {
      this.filter += data;
      this.selected = 0;
    }
  }
}

export function maskedDisplay(length: number): string {
  return "•".repeat(length);
}

export class MaskedView implements Component {
  title: string;
  status: string;
  chars: string[] = [];
  onDone: ((value: string | null) => void) | null = null;
  private titleText = new Text("", 0, 0);
  private valueText = new Text("", 0, 0);
  private statusText = new Text("", 0, 0);
  private stack = new VStack([this.titleText, this.valueText, this.statusText]);

  constructor(title: string, status: string) {
    this.title = title;
    this.status = status;
  }

  invalidate(): void {
    this.titleText.invalidate();
    this.valueText.invalidate();
    this.statusText.invalidate();
  }

  render(width: number): string[] {
    this.titleText.setText(this.title);
    this.valueText.setText(maskedDisplay(this.chars.length));
    this.statusText.setText(this.status);
    return this.stack.render(width);
  }

  handleInput(data: string): void {
    for (const token of splitKeys(data)) {
      if (token === "\r" || token === "\n") {
        const done = this.onDone;
        this.onDone = null;
        done?.(this.chars.length === 0 ? null : this.chars.join(""));
        return;
      }
      if (token === "\x1b" || token === "\x03") {
        const done = this.onDone;
        this.onDone = null;
        done?.(null);
        return;
      }
      if (token === "\x7f" || token === "\x08") {
        this.chars.pop();
        continue;
      }
      if (isPrintable(token)) {
        this.chars.push(token);
      }
    }
  }
}
