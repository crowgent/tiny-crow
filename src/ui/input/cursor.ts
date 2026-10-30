// Cursor and character-index helpers for the input editor.
//
// Rust tracks the cursor as a byte offset into a UTF-8 buffer. JavaScript
// strings are UTF-16, so this port tracks the cursor as a code-point index
// (an index into [...buffer]). That keeps multi-byte text (for example CJK)
// correct in both representations: moving by one character always lands on a
// character boundary, and end-of-buffer is the character count, not a byte
// length. All functions in this file use that convention.

export type KeyCode =
  | { kind: "char"; char: string }
  | { kind: "enter" }
  | { kind: "esc" }
  | { kind: "backspace" }
  | { kind: "delete" }
  | { kind: "tab" }
  | { kind: "backtab" }
  | { kind: "up" }
  | { kind: "down" }
  | { kind: "left" }
  | { kind: "right" }
  | { kind: "home" }
  | { kind: "end" }
  | { kind: "pageup" }
  | { kind: "pagedown" };

export interface KeyModifiers {
  control: boolean;
  alt: boolean;
  shift: boolean;
}

export interface KeyEvent {
  code: KeyCode;
  modifiers: KeyModifiers;
}

export function noModifiers(): KeyModifiers {
  return { control: false, alt: false, shift: false };
}

export function makeKeyEvent(
  code: KeyCode,
  modifiers: Partial<KeyModifiers> = {},
): KeyEvent {
  return {
    code,
    modifiers: { ...noModifiers(), ...modifiers },
  };
}

export function charKey(char: string, modifiers: Partial<KeyModifiers> = {}): KeyEvent {
  return makeKeyEvent({ kind: "char", char }, modifiers);
}

export function plainKey(
  kind: Exclude<KeyCode, { kind: "char" }>["kind"],
  modifiers: Partial<KeyModifiers> = {},
): KeyEvent {
  return makeKeyEvent({ kind } as KeyCode, modifiers);
}

/** The character of a character key, or undefined for any other key. */
export function keyChar(key: KeyEvent): string | undefined {
  return key.code.kind === "char" ? key.code.char : undefined;
}

/** True when the key is a character key for `char` (default: any character). */
export function isCharKey(key: KeyEvent, char?: string): boolean {
  return key.code.kind === "char" && (char === undefined || key.code.char === char);
}

/** True for Ctrl+H and for the raw backspace control character, both of which mean backspace. */
export function isBackspaceAlias(key: KeyEvent): boolean {
  const c = keyChar(key);
  return c === "\x08" || (c === "h" && key.modifiers.control && !key.modifiers.alt);
}

export function charsOf(s: string): string[] {
  return [...s];
}

export function charCount(s: string): number {
  return [...s].length;
}

export function sliceChars(s: string, start: number, end?: number): string {
  return charsOf(s).slice(start, end).join("");
}

export function insertAt(s: string, idx: number, text: string): string {
  const cs = charsOf(s);
  const at = Math.max(0, Math.min(idx, cs.length));
  return [...cs.slice(0, at), ...charsOf(text), ...cs.slice(at)].join("");
}

export function insertCharAt(s: string, idx: number, c: string): string {
  return insertAt(s, idx, c);
}

export function removeAt(s: string, idx: number): string {
  const cs = charsOf(s);
  if (idx < 0 || idx >= cs.length) return s;
  return [...cs.slice(0, idx), ...cs.slice(idx + 1)].join("");
}

export function removeRange(s: string, start: number, end: number): string {
  const cs = charsOf(s);
  return [...cs.slice(0, start), ...cs.slice(end)].join("");
}

export function prevCharBoundary(_s: string, idx: number): number {
  return Math.max(0, idx - 1);
}

export function nextCharBoundary(s: string, idx: number): number {
  return Math.min(charCount(s), idx + 1);
}

export function cursorToLineCol(buffer: string, cursor: number): [number, number] {
  let line = 0;
  let col = 0;
  const cs = charsOf(buffer);
  for (let i = 0; i < cs.length && i < cursor; i += 1) {
    if (cs[i] === "\n") {
      line += 1;
      col = 0;
    } else {
      col += 1;
    }
  }
  return [line, col];
}

export function lineColToCursor(
  buffer: string,
  targetLine: number,
  targetCol: number,
): number {
  let line = 0;
  let col = 0;
  const cs = charsOf(buffer);
  for (let i = 0; i < cs.length; i += 1) {
    if (line === targetLine && col === targetCol) return i;
    if (cs[i] === "\n") {
      if (line === targetLine) return i;
      line += 1;
      col = 0;
    } else {
      col += 1;
    }
  }
  return cs.length;
}

export function countLines(buffer: string): number {
  return charsOf(buffer).filter((c) => c === "\n").length + 1;
}

export function lineStart(buffer: string, cursor: number): number {
  const [line] = cursorToLineCol(buffer, cursor);
  return lineColToCursor(buffer, line, 0);
}

export function lineEnd(buffer: string, cursor: number): number {
  const start = lineStart(buffer, cursor);
  const rest = sliceChars(buffer, start);
  const nl = charsOf(rest).indexOf("\n");
  return nl === -1 ? charCount(buffer) : start + nl;
}
