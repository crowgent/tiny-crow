import type { CrowKey } from "./keys.ts";
import { Screen } from "./screen.ts";

export interface PanelKeySource {
  next(timeoutMs: number): Promise<CrowKey | null>;
}

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

export async function runPanel(
  screen: Screen,
  keys: PanelKeySource,
  status: string,
  items: PanelItem[],
): Promise<number | null> {
  let selected = 0;
  let filter = "";
  while (true) {
    const lower = filter.toLowerCase();
    const visible = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => filter === "" || item.label.toLowerCase().includes(lower));
    const shown = visible.map(({ item }) => item);
    if (selected >= shown.length) selected = 0;
    const { rows, selected: rowSelected } = windowPanelRows(shown, selected, 8);
    const statusText = filter === "" ? status : `${status} | filter: ${filter}`;
    screen.render("", 0, rows, rowSelected, statusText);
    const key = await keys.next(0);
    if (key === null) continue;
    if (key.kind === "up") {
      if (shown.length > 0) selected = (selected + shown.length - 1) % shown.length;
    } else if (key.kind === "down") {
      if (shown.length > 0) selected = (selected + 1) % shown.length;
    } else if (key.kind === "enter") {
      return shown.length === 0 ? null : (visible[selected]?.index ?? null);
    } else if (key.kind === "esc" || key.kind === "ctrlc") {
      return null;
    } else if (key.kind === "backspace") {
      filter = filter.slice(0, -1);
      selected = 0;
    } else if (key.kind === "char" && !key.ctrl && !key.alt) {
      filter += key.ch;
      selected = 0;
    }
  }
}

export async function runMaskedEntry(
  screen: Screen,
  keys: PanelKeySource,
  status: string,
): Promise<string | null> {
  const chars: string[] = [];
  while (true) {
    const masked = "•".repeat(chars.length);
    screen.render(masked, chars.length, [], 0, status);
    const key = await keys.next(0);
    if (key === null) continue;
    if (key.kind === "enter") {
      return chars.length === 0 ? null : chars.join("");
    } else if (key.kind === "esc" || key.kind === "ctrlc") {
      return null;
    } else if (key.kind === "backspace") {
      chars.pop();
    } else if (key.kind === "char" && !key.ctrl && !key.alt) {
      chars.push(key.ch);
    }
  }
}
