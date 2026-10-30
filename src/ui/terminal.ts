export const ANSI_ENTER_ALTERNATE = "\x1b[?1049h";
export const ANSI_LEAVE_ALTERNATE = "\x1b[?1049l";
export const ANSI_CLEAR_ALL = "\x1b[2J";
export const ANSI_ENABLE_MOUSE = "\x1b[?1000h\x1b[?1002h\x1b[?1006h";
export const ANSI_DISABLE_MOUSE = "\x1b[?1006l\x1b[?1002l\x1b[?1000l";
export const ANSI_ENABLE_BRACKETED_PASTE = "\x1b[?2004h";
export const ANSI_DISABLE_BRACKETED_PASTE = "\x1b[?2004l";
export const ANSI_ENABLE_FOCUS = "\x1b[?1004h";
export const ANSI_DISABLE_FOCUS = "\x1b[?1004l";
export const ANSI_PUSH_KEYBOARD_FLAGS = "\x1b[>1u";
export const ANSI_POP_KEYBOARD_FLAGS = "\x1b[<u";
export const ANSI_SHOW_CURSOR = "\x1b[?25h";

function writeStdout(s: string): void {
  try {
    process.stdout.write(s);
  } catch {

  }
}

function enableRawMode(): void {
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
  } catch {

  }
}

function disableRawMode(): void {
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  } catch {

  }
}

export class SuspendGuard {
  private mouseCapture: boolean;
  private disposed = false;

  private constructor(mouseCapture: boolean) {
    this.mouseCapture = mouseCapture;
  }

  static suspend(mouseCapture: boolean): SuspendGuard {
    disableRawMode();
    if (mouseCapture) writeStdout(ANSI_DISABLE_MOUSE);
    writeStdout(ANSI_LEAVE_ALTERNATE);
    return new SuspendGuard(mouseCapture);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    writeStdout(ANSI_ENTER_ALTERNATE);
    writeStdout(ANSI_CLEAR_ALL);
    if (this.mouseCapture) writeStdout(ANSI_ENABLE_MOUSE);
    enableRawMode();
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

export function suspendTui<T>(mouseCapture: boolean, fn: () => T): T {
  const guard = SuspendGuard.suspend(mouseCapture);
  try {
    return fn();
  } finally {
    guard.dispose();
  }
}

export function parseEditorCommand(editor: string): [string, string[]] {
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  let escaped = false;
  let hasToken = false;
  for (const ch of editor) {
    if (escaped) {
      current += ch;
      escaped = false;
      hasToken = true;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      hasToken = true;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      hasToken = true;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (hasToken || current !== "") {
        parts.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }
    current += ch;
    hasToken = true;
  }
  if (hasToken || current !== "") parts.push(current);
  if (parts.length === 0) return [editor, []];
  const [prog, ...args] = parts;
  return [prog, args];
}

export class TerminalGuard {
  private mouseCapture: boolean;
  private disposed = false;

  constructor(mouseCapture: boolean) {
    this.mouseCapture = mouseCapture;
    writeStdout(ANSI_ENTER_ALTERNATE);
    writeStdout(ANSI_CLEAR_ALL);
    if (mouseCapture) writeStdout(ANSI_ENABLE_MOUSE);
    writeStdout(ANSI_ENABLE_BRACKETED_PASTE);
    writeStdout(ANSI_ENABLE_FOCUS);
    writeStdout(ANSI_PUSH_KEYBOARD_FLAGS);
    enableRawMode();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    disableRawMode();
    writeStdout(ANSI_POP_KEYBOARD_FLAGS);
    writeStdout(ANSI_DISABLE_BRACKETED_PASTE);
    writeStdout(ANSI_DISABLE_FOCUS);
    if (this.mouseCapture) writeStdout(ANSI_DISABLE_MOUSE);
    writeStdout(ANSI_SHOW_CURSOR);
    writeStdout(ANSI_LEAVE_ALTERNATE);
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

export function terminalSize(): [number, number] {
  const cols = process.stdout.columns ?? 80;
  const rows = process.stdout.rows ?? 24;
  return [cols > 0 ? cols : 80, rows > 0 ? rows : 24];
}
