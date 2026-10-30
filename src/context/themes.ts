// Theme files (port of src/context/themes.rs).
// Precedence, lowest to highest: embedded defaults, the global themes
// dir, the project's data/themes dir. apply() parses a theme's color
// config and hands background colors to the renderer; a theme without a
// roles map restores the default palette.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { dataDir } from "../config/load.ts";
import type { ColorsConfig } from "../config/types.ts";

const EMBEDDED: Record<string, string> = {
  "ayu-mirage": "{\n  \"chat_background\": \"#1F2430\",\n  \"input_background\": \"#171B24\",\n  \"status_background\": \"#0D1017\"\n}\n",
  "default": "{}",
  "dracula": "{\n  \"chat_background\": \"#282A36\",\n  \"input_background\": \"#44475A\",\n  \"status_background\": \"#21222C\"\n}\n",
  "everforest": "{\n  \"chat_background\": \"#2D353B\",\n  \"input_background\": \"#343F44\",\n  \"status_background\": \"#232A2E\"\n}\n",
  "gruvbox": "{\n  \"chat_background\": \"#282828\",\n  \"input_background\": \"#3C3836\",\n  \"status_background\": \"#1D2021\"\n}\n",
  "just-aubergine": "{\n  \"chat_background\": \"#1D1721\",\n  \"input_background\": \"#1D1721\",\n  \"status_background\": \"#1D1721\"\n}\n",
  "just-black": "{\n  \"chat_background\": \"#0D0D0D\",\n  \"input_background\": \"#0D0D0D\",\n  \"status_background\": \"#0D0D0D\"\n}\n",
  "just-charcoal": "{\n  \"chat_background\": \"#1A1A1A\",\n  \"input_background\": \"#1A1A1A\",\n  \"status_background\": \"#1A1A1A\"\n}\n",
  "just-earthy": "{\n  \"chat_background\": \"#1F1B16\",\n  \"input_background\": \"#1F1B16\",\n  \"status_background\": \"#1F1B16\"\n}\n",
  "just-navy": "{\n  \"chat_background\": \"#1B2130\",\n  \"input_background\": \"#1B2130\",\n  \"status_background\": \"#1B2130\"\n}\n",
  "kanagawa": "{\n  \"chat_background\": \"#1F1F28\",\n  \"input_background\": \"#2A2A37\",\n  \"status_background\": \"#16161D\"\n}\n",
  "monokai": "{\n  \"chat_background\": \"#272822\",\n  \"input_background\": \"#3E3D32\",\n  \"status_background\": \"#1D1E19\"\n}\n",
  "nord": "{\n  \"chat_background\": \"#2E3440\",\n  \"input_background\": \"#3B4252\",\n  \"status_background\": \"#242933\"\n}\n",
  "one-dark": "{\n  \"chat_background\": \"#282C34\",\n  \"input_background\": \"#2C313C\",\n  \"status_background\": \"#21252B\"\n}\n",
  "rose-pine": "{\n  \"chat_background\": \"#191724\",\n  \"input_background\": \"#26233A\",\n  \"status_background\": \"#1F1D2E\"\n}\n",
  "solarized-dark": "{\n  \"chat_background\": \"#002B36\",\n  \"input_background\": \"#073642\",\n  \"status_background\": \"#00151D\"\n}\n",
  "tokyo-night": "{\n  \"chat_background\": \"#1A1B26\",\n  \"input_background\": \"#24283B\",\n  \"status_background\": \"#16161E\"\n}\n"
};

export function globalDir(): string {
  return path.join(dataDir(), "themes");
}

export function loadDirFiles(dir: string, ext: string): Array<[string, string]> {
  const results: Array<[string, string]> = [];
  if (!existsSync(dir)) return results;
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return results; }
  for (const file of entries) {
    if (path.extname(file) === `.${ext}`) {
      const name = path.basename(file, `.${ext}`);
      try { results.push([name, readFileSync(path.join(dir, file), "utf-8")]); } catch { /* skip */ }
    }
  }
  return results;
}

export function load(): Record<string, string> {
  const themesMap: Record<string, string> = {};
  for (const [name, content] of Object.entries(EMBEDDED)) {
    if (!(name in themesMap)) themesMap[name] = content;
  }
  for (const [name, content] of loadDirFiles(globalDir(), "json")) themesMap[name] = content;
  for (const [name, content] of loadDirFiles("data/themes", "json")) themesMap[name] = content;
  return themesMap;
}

export function copyEmbeddedTo(dest: string): number {
  mkdirSync(dest, { recursive: true });
  let written = 0;
  for (const [name, content] of Object.entries(EMBEDDED)) {
    const destPath = path.join(dest, `${name}.json`);
    let existing: string | undefined;
    try { existing = readFileSync(destPath, "utf-8"); } catch { /* missing */ }
    if (existing === content) continue;
    writeFileSync(destPath, content);
    written++;
  }
  return written;
}

export function ensureGlobal(): void {
  const dir = globalDir();
  if (!existsSync(dir)) copyEmbeddedTo(dir);
}

export function regen(): void {
  copyEmbeddedTo(globalDir());
}

export function changedFiles(dir: string): string[] {
  const changed: string[] = [];
  for (const [name, content] of Object.entries(EMBEDDED)) {
    const fileName = `${name}.json`;
    let existing: string | undefined;
    try { existing = readFileSync(path.join(dir, fileName), "utf-8"); } catch { /* missing */ }
    if (existing !== content) changed.push(fileName);
  }
  return changed.sort();
}

// --- Color parsing (mirrors ui/utils parse_color / to_ansi_256) -------------
// Colors are carried as strings: a named color or #rrggbb. The ui slice's
// renderer accepts the same string form; toAnsi256 converts to the
// nearest ANSI-256 palette entry, expressed as `ansi256:<index>`.

const NAMED_COLORS: Record<string, string> = {
  reset: "reset", black: "black", dark_grey: "dark-grey", darkgrey: "dark-grey",
  dark_gray: "dark-grey", darkgray: "dark-grey", red: "red", dark_red: "dark-red",
  darkred: "dark-red", green: "green", dark_green: "dark-green", darkgreen: "dark-green",
  yellow: "yellow", dark_yellow: "dark-yellow", darkyellow: "dark-yellow",
  blue: "blue", light_blue: "#5fafff", lightblue: "#5fafff",
  dark_blue: "dark-blue", darkblue: "dark-blue", magenta: "magenta",
  dark_magenta: "dark-magenta", darkmagenta: "dark-magenta", cyan: "cyan",
  dark_cyan: "dark-cyan", darkcyan: "dark-cyan", white: "white",
  grey: "grey", gray: "grey",
};

export function parseColor(s: string): string | undefined {
  const t = s.trim().toLowerCase();
  if (t in NAMED_COLORS) return NAMED_COLORS[t];
  if (/^#[0-9a-f]{6}$/.test(t)) return t;
  return undefined;
}

function rgbToAnsi256(r: number, g: number, b: number): number {
  const nearest = (v: number): number => {
    if (v < 48) return 0;
    if (v < 115) return 1;
    return Math.round((v - 55) / 40);
  };
  return 16 + 36 * nearest(r) + 6 * nearest(g) + nearest(b);
}

const ANSI_INDEX: Record<string, number> = {
  black: 0, red: 1, green: 2, yellow: 3, blue: 4, magenta: 5, cyan: 6,
  white: 7, grey: 7, "dark-grey": 8, "dark-red": 9, "dark-green": 10,
  "dark-yellow": 11, "dark-blue": 12, "dark-magenta": 13, "dark-cyan": 14,
};

export function toAnsi256(color: string): string {
  if (color === "reset") return "reset";
  if (color in ANSI_INDEX) return `ansi256:${ANSI_INDEX[color]}`;
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(color);
  if (m) {
    return `ansi256:${rgbToAnsi256(parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16))}`;
  }
  return color;
}

// --- Role overrides (mirrors ui/roles) --------------------------------------

const KNOWN_ROLES = new Set([
  "user", "agent", "reasoning", "tool", "tool_result", "error",
  "system", "welcome", "permission", "plain",
]);

let roleOverrides: Record<string, string> | undefined;

export function applyRoles(roles: Record<string, string>): void {
  const overrides: Record<string, string> = {};
  for (const [name, value] of Object.entries(roles)) {
    if (!KNOWN_ROLES.has(name.toLowerCase())) {
      console.warn(`ignoring unknown color role '${name}'`);
      continue;
    }
    const color = parseColor(value);
    if (!color) {
      console.warn(`ignoring unparsable color '${value}' for role '${name}'`);
      continue;
    }
    overrides[name] = color;
  }
  roleOverrides = overrides;
}

export function resetRoles(): void {
  roleOverrides = undefined;
}

export function getRoleOverrides(): Record<string, string> | undefined {
  return roleOverrides;
}

export interface ThemeRenderer {
  setBackgroundColors(
    chatBg: string | undefined,
    inputBg: string | undefined,
    statusBg: string | undefined,
  ): void;
}

export function apply(content: string, renderer: ThemeRenderer): void {
  let colors: ColorsConfig;
  try {
    colors = JSON.parse(content) as ColorsConfig;
  } catch {
    return;
  }
  const chatBg = colors.chatBackground !== undefined ? parseColor(colors.chatBackground) : undefined;
  const inputBg = colors.inputBackground !== undefined ? parseColor(colors.inputBackground) : undefined;
  const statusBg = colors.statusBackground !== undefined ? parseColor(colors.statusBackground) : undefined;
  if (colors.schemeType === "ansi") {
    renderer.setBackgroundColors(
      chatBg !== undefined ? toAnsi256(chatBg) : undefined,
      inputBg !== undefined ? toAnsi256(inputBg) : undefined,
      statusBg !== undefined ? toAnsi256(statusBg) : undefined,
    );
  } else {
    renderer.setBackgroundColors(chatBg, inputBg, statusBg);
  }
  if (colors.roles) applyRoles(colors.roles);
  else resetRoles();
}
