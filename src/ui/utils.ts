import { homedir } from "node:os";
import { join } from "node:path";

export type NamedColor =
  | "reset"
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "grey"
  | "dark_grey"
  | "dark_red"
  | "dark_green"
  | "dark_yellow"
  | "dark_blue"
  | "dark_magenta"
  | "dark_cyan";

export interface RgbColor {
  kind: "rgb";
  r: number;
  g: number;
  b: number;
}

export interface AnsiColor {
  kind: "ansi";
  value: number;
}

export type Color = NamedColor | RgbColor | AnsiColor;

export const COLOR_RESET: Color = "reset";
export const COLOR_BLACK: Color = "black";
export const COLOR_RED: Color = "red";
export const COLOR_GREEN: Color = "green";
export const COLOR_YELLOW: Color = "yellow";
export const COLOR_BLUE: Color = "blue";
export const COLOR_MAGENTA: Color = "magenta";
export const COLOR_CYAN: Color = "cyan";
export const COLOR_WHITE: Color = "white";
export const COLOR_GREY: Color = "grey";
export const COLOR_DARK_GREY: Color = "dark_grey";
export const COLOR_DARK_RED: Color = "dark_red";
export const COLOR_DARK_GREEN: Color = "dark_green";
export const COLOR_DARK_YELLOW: Color = "dark_yellow";
export const COLOR_DARK_BLUE: Color = "dark_blue";
export const COLOR_DARK_MAGENTA: Color = "dark_magenta";
export const COLOR_DARK_CYAN: Color = "dark_cyan";

export function rgbColor(r: number, g: number, b: number): RgbColor {
  return { kind: "rgb", r, g, b };
}

export function ansiColor(value: number): AnsiColor {
  return { kind: "ansi", value };
}

export function colorEquals(a: Color, b: Color): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "rgb" && b.kind === "rgb") {
    return a.r === b.r && a.g === b.g && a.b === b.b;
  }
  if (a.kind === "ansi" && b.kind === "ansi") return a.value === b.value;
  return false;
}

export function ansiForeground(color: Color): string {
  if (typeof color === "string") {
    const code: Record<NamedColor, string> = {
      reset: "39",
      black: "30",
      red: "31",
      green: "32",
      yellow: "33",
      blue: "34",
      magenta: "35",
      cyan: "36",
      white: "37",
      grey: "37",
      dark_grey: "90",
      dark_red: "91",
      dark_green: "92",
      dark_yellow: "93",
      dark_blue: "94",
      dark_magenta: "95",
      dark_cyan: "96",
    };
    return `\x1b[${code[color]}m`;
  }
  if (color.kind === "rgb") return `\x1b[38;2;${color.r};${color.g};${color.b}m`;
  return `\x1b[38;5;${color.value}m`;
}

export function ansiBackground(color: Color): string {
  if (typeof color === "string") {
    const code: Record<NamedColor, string> = {
      reset: "49",
      black: "40",
      red: "41",
      green: "42",
      yellow: "43",
      blue: "44",
      magenta: "45",
      cyan: "46",
      white: "47",
      grey: "47",
      dark_grey: "100",
      dark_red: "101",
      dark_green: "102",
      dark_yellow: "103",
      dark_blue: "104",
      dark_magenta: "105",
      dark_cyan: "106",
    };
    return `\x1b[${code[color]}m`;
  }
  if (color.kind === "rgb") return `\x1b[48;2;${color.r};${color.g};${color.b}m`;
  return `\x1b[48;5;${color.value}m`;
}

export const ANSI_RESET = "\x1b[0m";
export const ANSI_REVERSE = "\x1b[7m";
export const ANSI_NO_REVERSE = "\x1b[27m";
export const ANSI_HIDE_CURSOR = "\x1b[?25l";
export const ANSI_SHOW_CURSOR = "\x1b[?25h";

function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x2fffd) ||
    (cp >= 0x30000 && cp <= 0x3fffd) ||
    cp === 0x1f300 ||
    (cp >= 0x1f600 && cp <= 0x1f64f)
  );
}

function isZeroWidthCodePoint(cp: number): boolean {
  return (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    cp === 0x00ad
  );
}

export function charDisplayWidth(ch: string): number {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return 0;
  if (cp === 0) return 0;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (isZeroWidthCodePoint(cp)) return 0;
  return isWideCodePoint(cp) ? 2 : 1;
}

export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += charDisplayWidth(ch);
  return w;
}

export function resolveColor(color: Color, monochrome: boolean): Color {
  return monochrome ? COLOR_RESET : color;
}

function rgbToAnsi256(r: number, g: number, b: number): number {
  const mean = (r + g + b) / 3;
  const spread = Math.max(
    Math.abs(r - mean),
    Math.abs(g - mean),
    Math.abs(b - mean),
  );
  if (spread < 15) {
    const gs = Math.round((mean / 255) * 23);
    return 232 + Math.min(gs, 23);
  }
  const levels = [0, 95, 135, 175, 215, 255];
  const nearest = (v: number): number => {
    let best = 0;
    let bestDist = Number.MAX_VALUE;
    for (let i = 0; i < levels.length; i++) {
      const dist = Math.abs(levels[i] - v);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  };
  return 16 + 36 * nearest(r) + 6 * nearest(g) + nearest(b);
}

export function toAnsi256(color: Color): Color {
  if (typeof color === "string") {
    const map: Record<NamedColor, number> = {
      reset: -1,
      black: 0,
      red: 1,
      green: 2,
      yellow: 3,
      blue: 4,
      magenta: 5,
      cyan: 6,
      white: 7,
      grey: 7,
      dark_grey: 8,
      dark_red: 9,
      dark_green: 10,
      dark_yellow: 11,
      dark_blue: 12,
      dark_magenta: 13,
      dark_cyan: 14,
    };
    const v = map[color];
    return v < 0 ? COLOR_RESET : ansiColor(v);
  }
  if (color.kind === "rgb") return ansiColor(rgbToAnsi256(color.r, color.g, color.b));
  return color;
}

export function parseColor(s: string): Color | null {
  const t = s.trim().toLowerCase();
  switch (t) {
    case "reset":
      return COLOR_RESET;
    case "black":
      return COLOR_BLACK;
    case "dark_grey":
    case "darkgrey":
    case "dark_gray":
    case "darkgray":
      return COLOR_DARK_GREY;
    case "red":
      return COLOR_RED;
    case "dark_red":
    case "darkred":
      return COLOR_DARK_RED;
    case "green":
      return COLOR_GREEN;
    case "dark_green":
    case "darkgreen":
      return COLOR_DARK_GREEN;
    case "yellow":
      return COLOR_YELLOW;
    case "dark_yellow":
    case "darkyellow":
      return COLOR_DARK_YELLOW;
    case "blue":
      return COLOR_BLUE;
    case "light_blue":
    case "lightblue":
      return rgbColor(0x5f, 0xaf, 0xff);
    case "dark_blue":
    case "darkblue":
      return COLOR_DARK_BLUE;
    case "magenta":
      return COLOR_MAGENTA;
    case "dark_magenta":
    case "darkmagenta":
      return COLOR_DARK_MAGENTA;
    case "cyan":
      return COLOR_CYAN;
    case "dark_cyan":
    case "darkcyan":
      return COLOR_DARK_CYAN;
    case "white":
      return COLOR_WHITE;
    case "grey":
    case "gray":
      return COLOR_GREY;
    default: {
      if (t.startsWith("#") && t.length === 7) {
        const r = parseInt(t.slice(1, 3), 16);
        const g = parseInt(t.slice(3, 5), 16);
        const b = parseInt(t.slice(5, 7), 16);
        if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
          return rgbColor(r, g, b);
        }
      }
      return null;
    }
  }
}

export function truncateCjk(s: string, maxWidth: number, ellipsis: string): string {
  if (displayWidth(s) <= maxWidth) return s;
  const budget = Math.max(0, maxWidth - displayWidth(ellipsis));
  let out = "";
  let w = 0;
  for (const ch of s) {
    const cw = charDisplayWidth(ch);
    if (w + cw > budget) break;
    out += ch;
    w += cw;
  }
  return out + ellipsis;
}

const TOOL_SUMMARY_MAX = 200;

function displayValue(val: string): string {
  if (val.length <= TOOL_SUMMARY_MAX) return `"${val}"`;
  return `"${truncateCjk(val, TOOL_SUMMARY_MAX, "...")}"`;
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export function formatToolCallSummary(name: string, args: unknown): string {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return name;
  }
  const obj = args as Record<string, unknown>;
  if (name === "task") return formatTaskSummary(obj);
  let primaryKeys: string[];
  switch (name) {
    case "read":
    case "write":
    case "edit":
    case "list_dir":
      primaryKeys = ["path"];
      break;
    case "grep":
      primaryKeys = ["pattern", "path"];
      break;
    case "find_files":
      primaryKeys = ["pattern"];
      break;
    case "bash":
      primaryKeys = ["command"];
      break;
    default:
      primaryKeys = [];
  }
  const shown: string[] = [];
  for (const key of primaryKeys) {
    const val = obj[key];
    if (typeof val === "string") {
      shown.push(name === "bash" ? val : displayValue(val));
    }
  }
  if (shown.length === 0) {
    const first = Object.values(obj)[0];
    if (typeof first === "string") return `${name} ${displayValue(first)}`;
    return name;
  }
  return `${name} ${shown.join(" ")}`;
}

function formatTaskSummary(obj: Record<string, unknown>): string {
  const prompts = obj["prompts"];
  if (!Array.isArray(prompts)) return "task";
  const parts = prompts
    .filter((v): v is string => typeof v === "string")
    .map(displayValue);
  if (parts.length === 0) return "task";
  return `task ${parts.join(" ")}`;
}

export function expandTilde(input: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return join(homedir(), input.slice(2));
  return input;
}

export function suggestPattern(tool: string, input: string): string {
  switch (tool) {
    case "bash": {
      const first = input.split(/\s+/)[0] ?? "*";
      return `${first} **`;
    }
    case "read":
    case "write":
    case "edit":
    case "list_dir": {
      const expanded = expandTilde(input);
      const idx = expanded.lastIndexOf("/");
      const parent = idx >= 0 ? expanded.slice(0, idx) : "";
      if (parent === "") return "**";
      return `${parent}/**/*`;
    }
    case "grep":
    case "find_files": {
      const first = input.split(/\s+/)[0] ?? "*";
      return `${first}*`;
    }
    default:
      return "*";
  }
}

export function lineColToCursor(input: string, lineIdx: number, colChars: number): number {
  const lines = input.split("\n");
  let offset = 0;
  for (let i = 0; i < lineIdx && i < lines.length; i++) {
    offset += [...lines[i]].length + 1;
  }
  const line = lines[lineIdx] ?? "";
  const chars = [...line];
  return offset + Math.min(colChars, chars.length);
}

export function cursorToLineCol(input: string, cursorPos: number): [number, number] {
  const chars = [...input];
  const clamped = Math.max(0, Math.min(cursorPos, chars.length));
  let line = 0;
  let col = 0;
  for (let i = 0; i < clamped; i++) {
    if (chars[i] === "\n") {
      line += 1;
      col = 0;
    } else {
      col += 1;
    }
  }
  return [line, col];
}

export type { JsonValue };
