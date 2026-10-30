// Shared picker helpers: fuzzy scoring and list rendering.
//
// Rendering uses ANSI escapes written to stdout (the only terminal facility
// in the Node standard library), mirroring the original's cursor moves and
// colour choices. `monochrome` strips colours, matching resolve_color.

export type PickerColor =
  | "reset"
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "darkGrey"
  | "darkYellow";

export function resolveColor(color: PickerColor, monochrome: boolean): PickerColor {
  return monochrome ? "reset" : color;
}

const ANSI: Record<PickerColor, string> = {
  reset: "\x1b[0m",
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  darkGrey: "\x1b[90m",
  darkYellow: "\x1b[33m",
};

export function terminalSize(): { cols: number; rows: number } {
  return {
    cols: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  };
}

export function moveTo(col: number, row: number): void {
  process.stdout.write(`\x1b[${row + 1};${col + 1}H`);
}

export function clearCurrentLine(): void {
  process.stdout.write("\x1b[2K");
}

export function setForegroundColor(color: PickerColor, monochrome: boolean): void {
  process.stdout.write(ANSI[resolveColor(color, monochrome)]);
}

export function resetColor(): void {
  process.stdout.write(ANSI.reset);
}

export function fuzzyScore(item: string, query: string): number | undefined {
  if (query === "") return 0;
  const itemL = item.toLowerCase();
  const queryL = query.toLowerCase();
  const isBoundary = (bytes: string, pos: number): boolean =>
    pos === 0 || ["-", ".", "/", "_", " ", ":"].includes(bytes[pos - 1] ?? "");

  const pos = itemL.indexOf(queryL);
  if (pos !== -1) {
    let score = 1000;
    if (isBoundary(itemL, pos)) score += 200;
    if (pos === 0) score += 100;
    score -= pos;
    score -= Math.floor([...itemL].length / 4);
    return score;
  }

  const chars = [...itemL];
  let score = 0;
  let idx = 0;
  let last: number | undefined;
  for (const qc of queryL) {
    let found: number | undefined;
    while (idx < chars.length) {
      if (chars[idx] === qc) {
        found = idx;
        break;
      }
      idx += 1;
    }
    if (found === undefined) return undefined;
    if (last === found - 1) score += 5;
    if (found === 0 || ["-", ".", "/", "_", " ", ":"].includes(chars[found - 1] ?? "")) {
      score += 3;
    }
    last = found;
    idx = found + 1;
  }
  score -= Math.floor(chars.length / 20);
  return score;
}

export function drawPickerList(
  matches: string[],
  selected: number,
  monochrome: boolean,
  emptyMessage: string | undefined,
  bottomReserved: number,
): void {
  const { cols, rows } = terminalSize();
  const maxItems = Math.min(Math.max(rows - bottomReserved, 0), 10);

  if (matches.length === 0) {
    const r = Math.max(rows - 4, 0);
    moveTo(0, r);
    setForegroundColor("darkGrey", monochrome);
    process.stdout.write(emptyMessage ?? "no matches");
    resetColor();
    return;
  }

  const listHeight = Math.min(maxItems, matches.length);
  const startIdx = Math.min(
    Math.max(selected - Math.floor(listHeight / 2), 0),
    Math.max(matches.length - listHeight, 0),
  );
  const endIdx = Math.min(startIdx + listHeight, matches.length);
  const topRow = Math.max(rows - 3 - listHeight, 0);

  for (let i = startIdx; i < endIdx; i += 1) {
    const renderRow = topRow + (i - startIdx);
    moveTo(0, renderRow);
    clearCurrentLine();
    const truncated = [...matches[i]].slice(0, Math.max(cols - 3, 0)).join("");
    if (i === selected) {
      setForegroundColor("green", monochrome);
      process.stdout.write(`▸ ${truncated}`);
    } else {
      setForegroundColor("darkGrey", monochrome);
      process.stdout.write(`  ${truncated}`);
    }
    resetColor();
  }
}
