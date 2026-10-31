export const ANSI_RESET = "\x1b[0m";
export const ANSI_GREEN = "\x1b[38;2;166;218;149m";
export const ANSI_AGENT = "\x1b[38;2;202;211;245m";
export const ANSI_TOOL = "\x1b[38;2;238;212;159m";
export const ANSI_ERROR = "\x1b[38;2;237;135;150m";
export const ANSI_MUTED = "\x1b[38;2;110;115;141m";
export const ANSI_SYSTEM = "\x1b[38;2;147;154;183m";
export const ANSI_REASONING = "\x1b[38;2;198;160;246m";
export const ANSI_WELCOME = "\x1b[38;2;139;213;202m";
export const ANSI_PINK = "\x1b[38;2;245;189;230m";
export const ANSI_BG_STATUS = "\x1b[48;2;15;15;23m";
export const ANSI_REVERSE = "\x1b[7m";

export interface FeedLine {
  text: string;
  color: string;
}

export function wrapLine(text: string, width: number): string[] {
  if (width <= 0) return [text];
  if (text === "") return [""];
  const out: string[] = [];
  let rest = text;
  while (rest.length > width) {
    out.push(rest.slice(0, width));
    rest = rest.slice(width);
  }
  out.push(rest);
  return out;
}

export class Screen {
  cols: number;
  rows: number;
  feed: FeedLine[] = [];
  header: FeedLine[] = [];
  streaming = false;
  private entered = false;
  private raw = false;
  private resizeHandler: (() => void) | null = null;
  private onSigwinch = (): void => {
    this.refreshSize();
    if (this.resizeHandler !== null) this.resizeHandler();
  };

  constructor() {
    this.cols = process.stdout.columns ?? 80;
    this.rows = process.stdout.rows ?? 24;
    if (this.cols <= 0) this.cols = 80;
    if (this.rows <= 0) this.rows = 24;
  }

  refreshSize(): void {
    const cols = process.stdout.columns ?? 80;
    const rows = process.stdout.rows ?? 24;
    if (cols > 0) this.cols = cols;
    if (rows > 0) this.rows = rows;
  }

  setHeader(lines: FeedLine[]): void {
    this.header = lines;
  }

  setResizeHandler(fn: (() => void) | null): void {
    this.resizeHandler = fn;
  }

  enter(): void {
    if (this.entered) return;
    this.entered = true;
    try {
      process.stdout.write("\x1b[?1049h\x1b[2J\x1b[H");
    } catch {
    }
    try {
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      this.raw = true;
    } catch {
    }
    try {
      process.removeListener("SIGWINCH", this.onSigwinch);
      process.on("SIGWINCH", this.onSigwinch);
    } catch {
    }
  }

  leave(): void {
    if (!this.entered) return;
    this.entered = false;
    try {
      process.removeListener("SIGWINCH", this.onSigwinch);
    } catch {
    }
    try {
      if (this.raw && process.stdin.isTTY) process.stdin.setRawMode(false);
    } catch {
    }
    this.raw = false;
    try {
      process.stdout.write("\x1b[?25h\x1b[?1049l");
    } catch {
    }
  }

  suspend<T>(fn: () => T): T {
    this.leave();
    try {
      return fn();
    } finally {
      this.enter();
    }
  }

  writeLine(text: string, color: string): void {
    this.streaming = false;
    for (const part of text.split("\n")) {
      this.feed.push({ text: part, color });
    }
  }

  write(text: string, color: string): void {
    const parts = text.split("\n");
    for (let idx = 0; idx < parts.length; idx++) {
      const part = parts[idx]!;
      if (idx === 0) {
        if (this.feed.length === 0) {
          this.feed.push({ text: part, color });
        } else {
          const last = this.feed[this.feed.length - 1]!;
          if (last.color === color) last.text += part;
          else this.feed.push({ text: part, color });
        }
      } else {
        this.feed.push({ text: part, color });
      }
    }
  }

  startStream(color: string): void {
    if (!this.streaming) {
      this.feed.push({ text: "", color });
      this.streaming = true;
    }
  }

  appendStream(text: string): void {
    if (!this.streaming) this.startStream(ANSI_AGENT);
    const parts = text.split("\n");
    for (let idx = 0; idx < parts.length; idx++) {
      const part = parts[idx]!;
      if (idx === 0) {
        this.feed[this.feed.length - 1]!.text += part;
      } else {
        const color = this.feed[this.feed.length - 1]!.color;
        this.feed.push({ text: part, color });
      }
    }
  }

  endStream(): void {
    this.streaming = false;
  }

  clearFeed(): void {
    this.feed = [];
    this.streaming = false;
  }

  render(
    inputText: string,
    cursorPos: number,
    picker: string[],
    pickerSelected: number,
    status: string,
  ): void {
    this.refreshSize();
    const width = this.cols;
    const height = this.rows;
    const clip = (text: string): string => Array.from(text).slice(0, width).join("");
    const pickerRows = picker.map((line, idx) => {
      const clipped = clip(line);
      return idx === pickerSelected ? `${ANSI_REVERSE}${clipped}${ANSI_RESET}` : clipped;
    });
    const fixedBottom = pickerRows.length + 3;
    const maxHeader = Math.max(0, height - fixedBottom - 1);
    const headerRows = this.header.slice(0, maxHeader);
    const feedRows = Math.max(0, height - headerRows.length - fixedBottom);
    const wrapped: FeedLine[] = [];
    for (const line of this.feed) {
      for (const part of wrapLine(line.text, width)) {
        wrapped.push({ text: part, color: line.color });
      }
    }
    const visible = wrapped.slice(Math.max(0, wrapped.length - feedRows));
    const out: string[] = [];
    for (const line of headerRows) out.push(`${line.color}${clip(line.text)}${ANSI_RESET}`);
    for (let idx = 0; idx < feedRows - visible.length; idx++) out.push("");
    for (const line of visible) out.push(`${line.color}${line.text}${ANSI_RESET}`);
    for (const line of pickerRows) out.push(line);
    out.push(`${ANSI_MUTED}${"─".repeat(width)}${ANSI_RESET}`);
    const prompt = "> ";
    const maxInput = Math.max(1, width - prompt.length);
    let offset = 0;
    if (cursorPos >= maxInput) offset = cursorPos - maxInput + 1;
    const inputChars = Array.from(inputText);
    const shown = inputChars.slice(offset, offset + maxInput).join("");
    out.push(`${prompt}${shown}`);
    const statusText = clip(status);
    out.push(`${ANSI_BG_STATUS}${ANSI_SYSTEM}${statusText}${" ".repeat(Math.max(0, width - statusText.length))}${ANSI_RESET}`);
    try {
      const painted = out.map((row) => `${row}\x1b[K`).join("\r\n");
      process.stdout.write(`\x1b[?25l\x1b[H${painted}`);
      const inputRow = headerRows.length + feedRows + pickerRows.length + 1;
      const cursorCol = Math.min(width, prompt.length + (cursorPos - offset) + 1);
      process.stdout.write(`\x1b[${inputRow + 1};${cursorCol}H\x1b[?25h`);
    } catch {
    }
  }
}
