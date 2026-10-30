import { spawnSync } from "node:child_process";
import { BlockStyle, Feed, styleFromColor } from "./feed.ts";
import { wordWrap } from "./markdown.ts";
import { color as roleColor } from "./roles.ts";
import type { StatusSpan } from "./statusline.ts";
import { terminalSize } from "./terminal.ts";
import {
  ANSI_HIDE_CURSOR,
  ANSI_NO_REVERSE,
  ANSI_RESET,
  ANSI_REVERSE,
  ANSI_SHOW_CURSOR,
  ansiBackground,
  ansiForeground,
  charDisplayWidth,
  displayWidth,
  resolveColor,
  type Color,
} from "./utils.ts";
import { cursorToLineCol, lineColToCursor } from "./utils.ts";

export interface RenderBackend {
  write(s: string): void;
  size(): [number, number];
  
  captured(): string | null;
  
  readonly headless: boolean;
}

export class StdoutBackend implements RenderBackend {
  readonly headless = false;

  write(s: string): void {
    try {
      process.stdout.write(s);
    } catch {

    }
  }

  size(): [number, number] {
    return terminalSize();
  }

  captured(): string | null {
    return null;
  }
}

export class StringBackend implements RenderBackend {
  readonly headless = true;
  private buf = "";
  private cols: number;
  private rows: number;

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
  }

  write(s: string): void {
    this.buf += s;
  }

  size(): [number, number] {
    return [this.cols, this.rows];
  }

  captured(): string | null {
    return this.buf;
  }
}

const URL_RE = /https?:\/\/[^\x00-\x1f\x7f\s<>]+/g;

function wrapUrlsOsc8(text: string): string {
  let result = "";
  let last = 0;
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    result += text.slice(last, m.index);
    result += `\x1b]8;;${m[0]}\x1b\\${m[0]}\x1b]8;;\x1b\\`;
    last = m.index + m[0].length;
  }
  result += text.slice(last);
  return result;
}

function wrapUrlsOsc8Fast(text: string): string {
  if (!text.includes("http://") && !text.includes("https://")) return text;
  URL_RE.lastIndex = 0;
  if (!URL_RE.test(text)) return text;
  return wrapUrlsOsc8(text);
}

function moveTo(col: number, row: number): string {
  return `\x1b[${row + 1};${col + 1}H`;
}

export interface LineEntry {
  text: string;
  color: Color;
}

export interface PermissionPrompt {
  tool: string;
  options: string;
}

export interface ChainPrompt {
  question: string;
}

interface ChatSnapshot {
  feedGeneration: number;
  width: number;
  visibleRows: number;
  scrollOffset: number;
  selectionActive: boolean;
  selectionStart: number | null;
  selectionEnd: number | null;
  partial: string;
  partialStyle: BlockStyle;
  chatBg: Color | null;
  monochrome: boolean;
}

export type PromptSnapshot =
  | { kind: "input" }
  | { kind: "permission"; tool: string; options: string }
  | { kind: "chain"; question: string; butMode: boolean };

export interface BottomSnapshot {
  cols: number;
  rows: number;
  statuslineHeight: number;
  input: string;
  cursorPos: number;
  isRunning: boolean;
  spinnerFrame: number;
  inputVscrollOffset: number;
  prompt: PromptSnapshot;
  statusline: StatusSpan[][];
  scrollIndicator: boolean;
  monochrome: boolean;
  inputBg: Color | null;
  statusBg: Color | null;
}

export const BottomRedrawPlan = {
  Skip: "skip",
  StatuslineOnly: "statusline_only",
  Full: "full",
} as const;

export type BottomRedrawPlan = (typeof BottomRedrawPlan)[keyof typeof BottomRedrawPlan];

function bottomSnapshotsEqual(a: BottomSnapshot, b: BottomSnapshot): boolean {
  return (
    a.cols === b.cols &&
    a.rows === b.rows &&
    a.statuslineHeight === b.statuslineHeight &&
    a.input === b.input &&
    a.cursorPos === b.cursorPos &&
    a.isRunning === b.isRunning &&
    a.spinnerFrame === b.spinnerFrame &&
    a.inputVscrollOffset === b.inputVscrollOffset &&
    promptSnapshotsEqual(a.prompt, b.prompt) &&
    JSON.stringify(a.statusline) === JSON.stringify(b.statusline) &&
    a.scrollIndicator === b.scrollIndicator &&
    a.monochrome === b.monochrome &&
    colorOptEqual(a.inputBg, b.inputBg) &&
    colorOptEqual(a.statusBg, b.statusBg)
  );
}

function promptSnapshotsEqual(a: PromptSnapshot, b: PromptSnapshot): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "permission" && b.kind === "permission") {
    return a.tool === b.tool && a.options === b.options;
  }
  if (a.kind === "chain" && b.kind === "chain") {
    return a.question === b.question && a.butMode === b.butMode;
  }
  return true;
}

function colorOptEqual(a: Color | null, b: Color | null): boolean {
  if (a === null || b === null) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

export class Renderer {
  private backend: RenderBackend;
  private spinnerFrame = 0;
  private feedValue: Feed = new Feed();
  private partial = "";
  private partialStyle: BlockStyle = BlockStyle.Plain;
  private scrollOffset = 0;
  private inputScrollOffset = 0;
  private inputVscrollOffset = 0;
  private inputMaxVscroll = 0;
  private lastInputCursor = 0;
  private inputBaseRow = 0;
  private inputPromptWidth = 0;
  private inputFirstVisible = 0;
  private inputVisibleLineCount = 0;
  private inputHScroll = 0;
  private inputCursorLine = 0;
  private monochrome = false;
  private chatBg: Color | null = null;
  private inputBg: Color | null = null;
  private statusBg: Color | null = null;
  selectionActive = false;
  selectionStart: number | null = null;
  selectionEnd: number | null = null;
  private prevInputHeight = 0;
  private statuslineHeight = 1;
  private chatMargin = 0;
  permissionPrompt: PermissionPrompt | null = null;
  chainPrompt: ChainPrompt | null = null;
  chainButMode = false;
  private chatDirty = true;
  private lastChatSnapshot: ChatSnapshot | null = null;
  private bottomDirty = true;
  private lastBottomSnapshotValue: BottomSnapshot | null = null;
  private bottomCursor: [number, number] | null = null;

  constructor(backend?: RenderBackend) {
    this.backend = backend ?? new StdoutBackend();
  }

  static new(): Renderer {
    return new Renderer(new StdoutBackend());
  }

  static withBackend(backend: RenderBackend): Renderer {
    return new Renderer(backend);
  }

  private out(s: string): void {
    this.backend.write(s);
  }

  setStatuslineHeight(h: number): void {
    this.statuslineHeight = Math.min(Math.max(h, 1), 3);
  }

  private statuslineReserve(): number {
    return this.statuslineHeight + 2;
  }

  setMonochrome(monochrome: boolean): void {
    this.monochrome = monochrome;
  }

  setChatMargin(margin: number): void {
    const [cols] = this.terminalSize();
    this.chatMargin = Math.min(margin, Math.max(0, cols - 8));
  }

  private writeChatMargin(margin: number): void {
    if (margin > 0) this.out(" ".repeat(margin));
  }

  setBackgroundColors(
    chatBg: Color | null,
    inputBg: Color | null,
    statusBg: Color | null,
  ): void {
    this.chatBg = chatBg;
    this.inputBg = inputBg;
    this.statusBg = statusBg;
  }

  private color(colorValue: Color): Color {
    return resolveColor(colorValue, this.monochrome);
  }

  private terminalSize(): [number, number] {
    try {
      return this.backend.size();
    } catch {
      return [80, 24];
    }
  }

  private maxLineWidth(): number {
    const [cols] = this.terminalSize();
    return Math.max(0, cols - 1 - this.chatMargin);
  }

  lineWidth(): number {
    return this.maxLineWidth();
  }

  private chatLines(width: number): LineEntry[] {
    const lines = [...this.feedValue.linesShared(width)];
    if (this.partial !== "") {
      const color = this.partialStyleColor();
      for (const chunk of wordWrap(this.partial, width)) {
        lines.push({ text: chunk, color });
      }
    }
    return lines;
  }

  private partialStyleColor(): Color {
    
    return roleColor(this.partialStyle);
  }

  bufferLen(): number {
    const w = this.maxLineWidth();
    const baseLen = this.feedValue.linesShared(w).length;
    if (this.partial === "") return baseLen;
    return baseLen + wordWrap(this.partial, w).length;
  }

  feed(): Feed {
    return this.feedValue;
  }

  feedMut(): Feed {
    return this.feedValue;
  }

  private chatSnapshot(): ChatSnapshot {
    return {
      feedGeneration: this.feedValue.generation(),
      width: this.maxLineWidth(),
      visibleRows: this.visibleLines(),
      scrollOffset: this.scrollOffset,
      selectionActive: this.selectionActive,
      selectionStart: this.selectionStart,
      selectionEnd: this.selectionEnd,
      partial: this.partial,
      partialStyle: this.partialStyle,
      chatBg: this.chatBg,
      monochrome: this.monochrome,
    };
  }

  chatNeedsRedraw(): boolean {
    if (this.chatDirty) return true;
    if (this.lastChatSnapshot === null) return true;
    return JSON.stringify(this.lastChatSnapshot) !== JSON.stringify(this.chatSnapshot());
  }

  private recordChatDrawn(): void {
    this.lastChatSnapshot = this.chatSnapshot();
    this.chatDirty = false;
  }

  markChatClean(): void {
    this.recordChatDrawn();
  }

  capturedOutput(): string {
    return this.backend.captured() ?? "";
  }

  lastBottomSnapshot(): BottomSnapshot | null {
    return this.lastBottomSnapshotValue;
  }

  isHeadless(): boolean {
    return this.backend.headless;
  }

  invalidate(): void {
    this.chatDirty = true;
    this.bottomDirty = true;
  }

  visibleLines(): number {
    const [, rows] = this.terminalSize();
    const inputHeight = Math.max(this.prevInputHeight, 1);
    return Math.max(0, rows - inputHeight - this.statuslineReserve());
  }

  private inputVisibleHeight(inputLine: string, rows: number): number {
    if (this.permissionPrompt !== null || this.chainPrompt !== null) return 2;
    const availableRows = Math.max(0, rows - this.statuslineReserve());
    const maxInputRows = Math.min(availableRows, Math.max(Math.floor((availableRows * 3) / 10), 5));
    return Math.min(Math.max(inputLine.split("\n").length, 1), maxInputRows);
  }

  syncInputHeight(inputLine: string): void {
    const [, rows] = this.terminalSize();
    const newHeight = this.inputVisibleHeight(inputLine, rows);
    this.clearShrunkRows(this.prevInputHeight, newHeight);
    this.prevInputHeight = newHeight;
  }

  bufferLineAtRow(row: number): number | null {
    const width = this.maxLineWidth();
    const total = this.chatLines(width).length;
    if (total === 0) return null;
    const visible = this.visibleLines();
    const autoScroll = this.scrollOffset === 0;
    const pad = autoScroll && total < visible ? visible - total : 0;
    if (row < pad) return null;
    let start = autoScroll
      ? Math.max(0, total - visible)
      : Math.max(0, total - (this.scrollOffset + visible));
    start = Math.min(start, Math.max(0, total - visible));
    return start + row - pad;
  }

  clearSelection(): void {
    this.chatDirty = true;
    this.selectionActive = false;
    this.selectionStart = null;
    this.selectionEnd = null;
  }

  linkUrlAt(bufIdx: number, col: number): string | null {
    const lines = this.chatLines(this.maxLineWidth());
    const entry = lines[bufIdx];
    if (entry === undefined) return null;
    const clickCol = Math.max(0, col - this.chatMargin);
    URL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = URL_RE.exec(entry.text)) !== null) {
      const prefix = entry.text.slice(0, m.index);
      const urlStart = displayWidth(prefix);
      const urlEnd = urlStart + displayWidth(m[0]);
      if (clickCol >= urlStart && clickCol < urlEnd) return m[0];
    }
    return null;
  }

  selectedText(): string | null {
    if (this.selectionStart === null || this.selectionEnd === null) return null;
    const start = Math.min(this.selectionStart, this.selectionEnd);
    const end = Math.max(this.selectionStart, this.selectionEnd);
    const lines = this.chatLines(this.maxLineWidth());
    let result = "";
    for (let i = start; i <= end; i++) {
      const entry = lines[i];
      if (entry !== undefined) {
        if (result !== "") result += "\n";
        result += entry.text;
      }
    }
    return result === "" ? null : result;
  }

  private commitPartial(): void {
    if (this.partial !== "") {
      this.feedValue.pushBlock(this.partialStyle, this.partial);
      this.partial = "";
      this.chatDirty = true;
    }
  }

  isScrolling(): boolean {
    return this.scrollOffset > 0;
  }

  inputCursorForClick(row: number, col: number, inputLine: string): number | null {
    const vlc = this.inputVisibleLineCount;
    if (vlc === 0) return null;
    if (row < this.inputBaseRow || row >= this.inputBaseRow + vlc) return null;
    const visibleIdx = row - this.inputBaseRow;
    const lineIdx = this.inputFirstVisible + visibleIdx;
    const lines = inputLine.split("\n");
    const lineText = lines[lineIdx];
    if (lineText === undefined) return null;
    let targetDisplay = Math.max(0, col - this.inputPromptWidth);
    if (lineIdx === this.inputCursorLine) targetDisplay += this.inputHScroll;
    let width = 0;
    let colChars = 0;
    for (const ch of lineText) {
      const cw = charDisplayWidth(ch);
      if (width + cw > targetDisplay) break;
      width += cw;
      colChars += 1;
    }
    return lineColToCursor(inputLine, lineIdx, colChars);
  }

  inputScrollUp(): boolean {
    if (this.inputVscrollOffset > 0) {
      this.inputVscrollOffset -= 1;
      return true;
    }
    return false;
  }

  inputScrollDown(): boolean {
    if (this.inputVscrollOffset < this.inputMaxVscroll) {
      this.inputVscrollOffset += 1;
      return true;
    }
    return false;
  }

  scrollLineUp(): void {
    const visible = this.visibleLines();
    const maxOffset = Math.max(0, this.bufferLen() - visible);
    if (this.scrollOffset < maxOffset) {
      this.scrollOffset += 1;
      this.chatDirty = true;
    }
  }

  scrollLineDown(): void {
    if (this.scrollOffset > 0) {
      this.scrollOffset -= 1;
      this.chatDirty = true;
    }
  }

  scrollPageUp(): void {
    const visible = this.visibleLines();
    const page = Math.max(visible - 2, 1);
    const maxOffset = Math.max(0, this.bufferLen() - visible);
    const newOffset = Math.min(this.scrollOffset + page, maxOffset);
    if (newOffset !== this.scrollOffset) {
      this.scrollOffset = newOffset;
      this.chatDirty = true;
    }
  }

  scrollPageDown(): void {
    const visible = this.visibleLines();
    const page = Math.max(visible - 2, 1);
    const newOffset = this.scrollOffset <= page ? 0 : this.scrollOffset - page;
    if (newOffset !== this.scrollOffset) {
      this.scrollOffset = newOffset;
      this.chatDirty = true;
    }
  }

  scrollToTop(): void {
    const visible = this.visibleLines();
    const newOffset = Math.max(0, this.bufferLen() - visible);
    if (newOffset !== this.scrollOffset) {
      this.scrollOffset = newOffset;
      this.chatDirty = true;
    }
  }

  scrollToBottom(): void {
    if (this.scrollOffset !== 0) {
      this.scrollOffset = 0;
      this.chatDirty = true;
    }
    this.syncToBuffer();
  }

  private syncToBuffer(): void {
    this.commitPartial();
    this.renderViewport();
  }

  renderViewport(): void {
    if (!this.chatNeedsRedraw()) return;
    const [cols] = this.terminalSize();
    const maxWidth = Math.max(0, cols - 1 - this.chatMargin);
    const visible = this.visibleLines();
    const base = this.feedValue.linesShared(maxWidth);
    const partialEntries: LineEntry[] = [];
    if (this.partial !== "") {
      const color = this.partialStyleColor();
      for (const chunk of wordWrap(this.partial, maxWidth)) {
        partialEntries.push({ text: chunk, color });
      }
    }
    const total = base.length + partialEntries.length;
    this.out(ANSI_HIDE_CURSOR);

    const autoScroll = this.scrollOffset === 0;
    let start = autoScroll
      ? Math.max(0, total - visible)
      : Math.max(0, total - (this.scrollOffset + visible));
    start = Math.min(start, Math.max(0, total - visible));

    let visualRow = 0;
    let bufIdx = start;

    if (autoScroll && total < visible) {
      const pad = visible - total;
      for (let p = 0; p < pad; p++) {
        this.out(moveTo(0, visualRow));
        if (this.chatBg !== null) this.out(ansiBackground(this.color(this.chatBg)));
        this.out("\x1b[K");
        this.out(ANSI_RESET);
        visualRow += 1;
      }
    }

    while (visualRow < visible && bufIdx < total) {
      const entry = bufIdx < base.length ? base[bufIdx] : partialEntries[bufIdx - base.length];
      this.out(moveTo(0, visualRow));
      const isSelected =
        this.selectionActive &&
        this.selectionStart !== null &&
        this.selectionEnd !== null &&
        bufIdx >= Math.min(this.selectionStart, this.selectionEnd) &&
        bufIdx <= Math.max(this.selectionStart, this.selectionEnd);
      if (this.chatBg !== null) this.out(ansiBackground(this.color(this.chatBg)));
      this.writeChatMargin(this.chatMargin);
      if (isSelected) this.out(ANSI_REVERSE);
      this.out(ansiForeground(this.color(entry.color)));
      this.out(wrapUrlsOsc8Fast(entry.text));
      if (isSelected) this.out(ANSI_NO_REVERSE);
      this.out("\x1b[K");
      this.out(ANSI_RESET);
      visualRow += 1;
      bufIdx += 1;
    }

    while (visualRow < visible) {
      this.out(moveTo(0, visualRow));
      if (this.chatBg !== null) this.out(ansiBackground(this.color(this.chatBg)));
      this.out("\x1b[K");
      this.out(ANSI_RESET);
      visualRow += 1;
    }

    if (this.scrollOffset > 0) {
      const pct =
        total > visible
          ? Math.min(Math.floor(((total - this.scrollOffset - visible) * 100) / (total - visible)), 100)
          : 0;
      const indicator = ` SCROLL ${pct}% `;
      const x = Math.max(0, cols - indicator.length);
      this.out(moveTo(x, 0));
      if (this.chatBg !== null) this.out(ansiBackground(this.color(this.chatBg)));
      this.out(ansiForeground(this.color("dark_yellow")));
      this.out(indicator);
      this.out(ANSI_RESET);
    }

    this.recordChatDrawn();
  }

  writeLine(text: string, color: Color): void {
    this.commitPartial();
    const style = styleFromColor(color);
    this.feedValue.pushBlock(style, text);
    this.chatDirty = true;
    if (this.scrollOffset === 0) this.renderViewport();
  }

  write(text: string, color: Color): void {
    if (text === "") return;
    const style = styleFromColor(color);
    const parts = text.split("\n");
    const last = parts.length - 1;
    for (let i = 0; i < parts.length; i++) {
      const segment = parts[i];
      if (i < last) {
        if (this.partial !== "") this.commitPartial();
        this.feedValue.pushBlock(style, segment);
      } else {
        this.partialStyle = style;
        this.partial += segment;
      }
    }
    this.chatDirty = true;
    if (this.scrollOffset === 0) this.renderViewport();
  }

  clearContent(): void {
    this.chatDirty = true;
    this.feedValue.clear();
    this.partial = "";
    this.scrollOffset = 0;
    this.clearSelection();
    if (this.chatBg !== null) this.out(ansiBackground(this.color(this.chatBg)));
    this.out("\x1b[2J");
    this.out(ANSI_RESET);
    this.out(moveTo(0, 0));
  }

  resize(): void {
    this.chatDirty = true;
    const visible = this.visibleLines();
    const maxOffset = Math.max(0, this.bufferLen() - visible);
    if (this.scrollOffset > maxOffset) this.scrollOffset = maxOffset;
  }

  private clearShrunkRows(oldHeight: number, newHeight: number): void {
    if (newHeight >= oldHeight) return;
    const [, rows] = this.terminalSize();
    const reserve = this.statuslineReserve();
    const avail = Math.max(0, rows - reserve);
    const oldStart = Math.max(0, avail - oldHeight) + 1;
    const newStart = Math.max(0, avail - newHeight) + 1;
    for (let row = oldStart; row < newStart; row++) {
      this.out(moveTo(0, row));
      if (this.inputBg !== null) this.out(ansiBackground(this.color(this.inputBg)));
      this.out("\x1b[K");
      this.out(ANSI_RESET);
    }
  }

  private drawSeparator(row: number, cols: number): void {
    this.out(moveTo(0, row));
    if (this.inputBg !== null) this.out(ansiBackground(this.color(this.inputBg)));
    this.out(ansiForeground(this.color("dark_grey")));
    this.out("─".repeat(cols));
    this.out(ANSI_RESET);
  }

  private drawStatusline(statusline: StatusSpan[][], cols: number, isScrolling: boolean): void {
    const [, rows] = this.terminalSize();
    const h = this.statuslineHeight;
    for (let rowIdx = 0; rowIdx < h; rowIdx++) {
      const screenRow = Math.max(0, rows - (h - rowIdx));
      const spans = statusline[rowIdx] ?? [];
      const prefix = isScrolling && rowIdx === 0 ? "-- SCROLL -- " : "";
      this.drawStatuslineRow(screenRow, spans, prefix, cols);
    }
  }

  private drawStatuslineRow(
    screenRow: number,
    spans: StatusSpan[],
    prefix: string,
    cols: number,
  ): void {
    this.out(moveTo(0, screenRow));
    if (this.statusBg !== null) this.out(ansiBackground(this.color(this.statusBg)));
    this.out("\x1b[2K");
    this.out(moveTo(0, screenRow));
    if (this.statusBg !== null) this.out(ansiBackground(this.color(this.statusBg)));

    const total = cols;
    let budget = total;

    if (prefix !== "") {
      this.out(ansiForeground(this.color("dark_yellow")));
      const take = [...prefix].slice(0, budget).join("");
      budget -= displayWidth(take);
      this.out(take);
    }

    const fixed = spans.reduce((sum, s) => {
      return s.kind === "text" ? sum + displayWidth(s.text) : sum;
    }, 0);
    const flexCount = spans.filter((s) => s.kind === "flex").length;
    let flexLeft = Math.max(0, budget - fixed);
    let flexSeen = 0;

    for (const span of spans) {
      if (budget === 0) break;
      if (span.kind === "text") {
        const bgc = span.bg ?? this.statusBg;
        if (bgc !== null) this.out(ansiBackground(this.color(bgc)));
        const fgc = span.fg ?? "dark_grey";
        this.out(ansiForeground(this.color(fgc)));
        const piece = [...span.text].slice(0, budget).join("");
        budget = Math.max(0, budget - displayWidth(piece));
        this.out(piece);
        this.out(ANSI_RESET);
        if (this.statusBg !== null) this.out(ansiBackground(this.color(this.statusBg)));
      } else {
        flexSeen += 1;
        if (flexCount === 0) continue;
        const base = Math.floor(flexLeft / flexCount);
        const extra = flexSeen <= flexLeft % flexCount ? 1 : 0;
        const width = Math.min(base + extra, budget);
        flexLeft = Math.max(0, flexLeft - width);
        budget = Math.max(0, budget - width);
        this.out(" ".repeat(width));
      }
    }

    this.out("\x1b[K");
    this.out(ANSI_RESET);
  }

  private bottomSnapshot(
    inputLine: string,
    cursorPos: number,
    statusline: StatusSpan[][],
    isRunning: boolean,
    cols: number,
    rows: number,
  ): BottomSnapshot {
    let prompt: PromptSnapshot;
    if (this.permissionPrompt !== null) {
      prompt = {
        kind: "permission",
        tool: this.permissionPrompt.tool,
        options: this.permissionPrompt.options,
      };
    } else if (this.chainPrompt !== null) {
      prompt = {
        kind: "chain",
        question: this.chainPrompt.question,
        butMode: this.chainButMode,
      };
    } else {
      prompt = { kind: "input" };
    }
    return {
      cols,
      rows,
      statuslineHeight: this.statuslineHeight,
      input: inputLine,
      cursorPos,
      isRunning,
      spinnerFrame: this.spinnerFrame,
      inputVscrollOffset: this.inputVscrollOffset,
      prompt,
      statusline: statusline.map((line) => [...line]),
      scrollIndicator: prompt.kind === "input" && this.scrollOffset > 0,
      monochrome: this.monochrome,
      inputBg: this.inputBg,
      statusBg: this.statusBg,
    };
  }

  static bottomRedrawPlan(
    prev: BottomSnapshot | null,
    next: BottomSnapshot,
    forceFull: boolean,
  ): BottomRedrawPlan {
    if (forceFull) return BottomRedrawPlan.Full;
    if (prev === null) return BottomRedrawPlan.Full;
    if (bottomSnapshotsEqual(prev, next)) return BottomRedrawPlan.Skip;
    if (
      prev.cols === next.cols &&
      prev.rows === next.rows &&
      prev.statuslineHeight === next.statuslineHeight &&
      prev.input === next.input &&
      prev.cursorPos === next.cursorPos &&
      prev.isRunning === next.isRunning &&
      prev.spinnerFrame === next.spinnerFrame &&
      prev.inputVscrollOffset === next.inputVscrollOffset &&
      promptSnapshotsEqual(prev.prompt, next.prompt) &&
      prev.monochrome === next.monochrome &&
      colorOptEqual(prev.inputBg, next.inputBg) &&
      colorOptEqual(prev.statusBg, next.statusBg)
    ) {
      if (
        JSON.stringify(prev.statusline) !== JSON.stringify(next.statusline) ||
        prev.scrollIndicator !== next.scrollIndicator
      ) {
        return BottomRedrawPlan.StatuslineOnly;
      }
    }
    return BottomRedrawPlan.Full;
  }

  private recordBottomDrawn(snapshot: BottomSnapshot): void {
    this.lastBottomSnapshotValue = snapshot;
    this.bottomDirty = false;
  }

  private restoreBottomCursor(): void {
    if (this.bottomCursor !== null) {
      this.out(moveTo(this.bottomCursor[0], this.bottomCursor[1]));
      this.out(ANSI_SHOW_CURSOR);
    } else {
      this.out(ANSI_HIDE_CURSOR);
    }
  }

  drawBottom(
    inputLine: string,
    cursorPos: number,
    statusline: StatusSpan[][],
    isRunning: boolean,
  ): void {
    const [cols, rows] = this.terminalSize();
    const snapshot = this.bottomSnapshot(inputLine, cursorPos, statusline, isRunning, cols, rows);
    const plan = Renderer.bottomRedrawPlan(
      this.lastBottomSnapshotValue,
      snapshot,
      this.bottomDirty,
    );
    if (plan === BottomRedrawPlan.Skip) return;
    if (plan === BottomRedrawPlan.StatuslineOnly) {
      this.drawStatusline(statusline, cols, snapshot.scrollIndicator);
      this.restoreBottomCursor();
      this.recordBottomDrawn(snapshot);
      return;
    }
    const reserve = this.statuslineReserve();

    if (this.permissionPrompt !== null) {
      const permLines = [this.permissionPrompt.tool, this.permissionPrompt.options];
      const lineCount = 2;
      const inputTop = Math.max(0, rows - reserve - lineCount) + 1;
      const sepAbove = inputTop - 1;
      this.clearShrunkRows(this.prevInputHeight, lineCount);
      this.prevInputHeight = lineCount;
      if (sepAbove < inputTop) this.drawSeparator(sepAbove, cols);
      const permColor = this.color("dark_yellow");
      for (let i = 0; i < permLines.length; i++) {
        const renderRow = inputTop + i;
        this.out(moveTo(0, renderRow));
        if (this.inputBg !== null) this.out(ansiBackground(this.color(this.inputBg)));
        this.out(ansiForeground(permColor));
        this.out(permLines[i]);
        this.out("\x1b[K");
        this.out(ANSI_RESET);
      }
      const sepBelow = rows - (reserve - 1);
      if (sepBelow < rows - 1) this.drawSeparator(sepBelow, cols);
      this.drawStatusline(statusline, cols, false);
      this.out(ANSI_HIDE_CURSOR);
      this.bottomCursor = null;
      this.recordBottomDrawn(snapshot);
      return;
    }

    if (this.chainPrompt !== null) {
      const options = this.chainButMode
        ? "[Enter] send  [Esc] cancel"
        : "[Y] Yes  [N] No  [B] yes, But (add instruction)";
      const renderLines = [this.chainPrompt.question, options];
      const lineCount = 2;
      const inputTop = Math.max(0, rows - reserve - lineCount) + 1;
      const sepAbove = inputTop - 1;
      this.clearShrunkRows(this.prevInputHeight, lineCount);
      this.prevInputHeight = lineCount;
      if (sepAbove < inputTop) this.drawSeparator(sepAbove, cols);
      const chainColor = this.color("dark_yellow");
      for (let i = 0; i < renderLines.length; i++) {
        const renderRow = inputTop + i;
        this.out(moveTo(0, renderRow));
        if (this.inputBg !== null) this.out(ansiBackground(this.color(this.inputBg)));
        this.out(ansiForeground(chainColor));
        this.out(renderLines[i]);
        this.out("\x1b[K");
        this.out(ANSI_RESET);
      }
      const sepBelow = rows - (reserve - 1);
      if (sepBelow < rows - 1) this.drawSeparator(sepBelow, cols);
      this.drawStatusline(statusline, cols, false);
      this.out(ANSI_HIDE_CURSOR);
      this.bottomCursor = null;
      this.recordBottomDrawn(snapshot);
      return;
    }

    const lines = inputLine.split("\n");
    const lineCount = lines.length;
    const availableRows = Math.max(1, rows - reserve);
    const maxInputRows = Math.min(availableRows, Math.max(Math.floor((availableRows * 3) / 10), 5));
    const needScroll = lineCount > maxInputRows;

    const SPINNER = ["⠋ ", "⠙ ", "⠹ ", "⠸ ", "⠼ ", "⠴ ", "⠦ ", "⠧ ", "⠇ ", "⠏ "];
    let prompt: string;
    if (isRunning) {
      prompt = SPINNER[this.spinnerFrame];
      this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER.length;
    } else {
      prompt = "> ";
    }
    const promptWidth = displayWidth(prompt);

    const [cursorLine, cursorCol] = cursorToLineCol(inputLine, cursorPos);

    const cursorMoved = this.lastInputCursor !== cursorPos;
    this.lastInputCursor = cursorPos;
    let firstVisible: number;
    if (needScroll) {
      this.inputMaxVscroll = lineCount - maxInputRows;
      if (cursorMoved) {
        if (cursorLine < this.inputVscrollOffset) {
          this.inputVscrollOffset = cursorLine;
        } else if (cursorLine >= this.inputVscrollOffset + maxInputRows) {
          this.inputVscrollOffset = cursorLine - maxInputRows + 1;
        }
      }
      this.inputVscrollOffset = Math.min(this.inputVscrollOffset, this.inputMaxVscroll);
      firstVisible = this.inputVscrollOffset;
    } else {
      this.inputVscrollOffset = 0;
      this.inputMaxVscroll = 0;
      firstVisible = 0;
    }

    const visibleWidth = Math.max(0, cols - promptWidth);
    const cursorLineText = lines[cursorLine] ?? "";
    const cursorChars = [...cursorLineText];
    const cursorByte = cursorChars
      .slice(0, cursorCol)
      .reduce((sum, ch) => sum + ch.length, 0);
    const cursorDisplayCol = displayWidth(cursorLineText.slice(0, cursorByte));
    const cursorLineLen = displayWidth(cursorLineText);
    let hScroll = 0;
    if (cursorLineLen >= visibleWidth) {
      if (cursorDisplayCol < this.inputScrollOffset) {
        this.inputScrollOffset = cursorDisplayCol;
      } else if (cursorDisplayCol >= this.inputScrollOffset + visibleWidth) {
        this.inputScrollOffset = cursorDisplayCol - visibleWidth + 1;
      }
      const maxHScroll = Math.max(0, cursorLineLen - visibleWidth + 1);
      hScroll = Math.min(this.inputScrollOffset, maxHScroll);
    } else {
      this.inputScrollOffset = 0;
    }

    const visibleLineCount = needScroll ? maxInputRows : lineCount;
    this.clearShrunkRows(this.prevInputHeight, visibleLineCount);
    this.prevInputHeight = visibleLineCount;

    const inputTop = Math.max(0, rows - reserve - visibleLineCount) + 1;
    const sepAbove = inputTop - 1;
    if (sepAbove < inputTop) this.drawSeparator(sepAbove, cols);

    this.inputBaseRow = inputTop;
    this.inputPromptWidth = promptWidth;
    this.inputFirstVisible = firstVisible;
    this.inputVisibleLineCount = visibleLineCount;
    this.inputHScroll = hScroll;
    this.inputCursorLine = cursorLine;

    for (let idx = firstVisible; idx < Math.min(lines.length, firstVisible + visibleLineCount); idx++) {
      const line = lines[idx];
      const renderRow = Math.max(0, rows - reserve - visibleLineCount + 1) + (idx - firstVisible);
      this.out(moveTo(0, renderRow));
      if (this.inputBg !== null) this.out(ansiBackground(this.color(this.inputBg)));
      if (idx === firstVisible) {
        this.out(ansiForeground(this.color("dark_yellow")));
        this.out(prompt);
        this.out(ansiForeground("reset"));
      } else {
        this.out(" ".repeat(promptWidth));
      }
      const lineChars = [...line];
      let skipChars = 0;
      if (idx === cursorLine) {
        let w = 0;
        for (const ch of lineChars) {
          const cw = charDisplayWidth(ch);
          if (w + cw > hScroll) break;
          w += cw;
          skipChars += 1;
        }
      }
      const display = lineChars.slice(skipChars, skipChars + visibleWidth).join("");
      this.out(display);
      this.out("\x1b[K");
      this.out(ANSI_RESET);
    }

    const sepBelow = rows - (reserve - 1);
    if (sepBelow < rows - 1) this.drawSeparator(sepBelow, cols);
    this.drawStatusline(statusline, cols, this.scrollOffset > 0);

    const cursorRenderIdx = Math.min(
      Math.max(0, cursorLine - firstVisible),
      Math.max(0, visibleLineCount - 1),
    );
    const cursorRow = Math.max(0, rows - reserve - visibleLineCount + 1) + cursorRenderIdx;
    const cursorX = promptWidth + Math.max(0, cursorDisplayCol - hScroll);
    this.out(moveTo(cursorX, cursorRow));
    this.out(ANSI_SHOW_CURSOR);
    this.bottomCursor = [cursorX, cursorRow];

    const drawn: BottomSnapshot = { ...snapshot, inputVscrollOffset: this.inputVscrollOffset };
    this.recordBottomDrawn(drawn);
  }
}

export function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed === "" || trimmed.length > 2048) return false;
  if ([...trimmed].some((c) => c.charCodeAt(0) < 32 || /\s/.test(c))) return false;
  const rest = trimmed.startsWith("https://")
    ? trimmed.slice("https://".length)
    : trimmed.startsWith("http://")
      ? trimmed.slice("http://".length)
      : null;
  if (rest === null) return false;
  const host = rest.split(/[/ ?#]/)[0] ?? "";
  return host !== "";
}

export function openUrl(url: string): void {
  if (!isSafeUrl(url)) {
    const preview = [...url].slice(0, 80).join("");
    throw new Error(`refusing to open invalid or non-http(s) URL: ${preview}`);
  }
  const openers: [string, string[]][] = [
    ["xdg-open", [url]],
    ["open", [url]],
    ["cmd", ["/c", "start", url]],
  ];
  for (const [cmd, args] of openers) {
    try {
      const res = spawnSync(cmd, args, { stdio: "ignore" });
      if (res.status === 0) return;
      if (res.error !== undefined) continue;
    } catch {
      continue;
    }
  }
  throw new Error("no working opener found (tried xdg-open, open, cmd)");
}

export function copyToClipboard(text: string): void {
  const cmds: [string, string[]][] = [
    ["wl-copy", []],
    ["xclip", ["-selection", "clipboard"]],
    ["pbcopy", []],
    ["clip.exe", []],
  ];
  for (const [cmd, args] of cmds) {
    try {
      const res = spawnSync(cmd, args, { input: text, stdio: ["pipe", "ignore", "ignore"] });
      if (res.status === 0) return;
    } catch {
      continue;
    }
  }
  const encoded = base64Encode(new TextEncoder().encode(text));
  try {
    process.stdout.write(`\x1b]52;c;${encoded}\x07`);
  } catch {
    throw new Error("failed to write OSC 52 clipboard escape");
  }
}

export function base64Encode(input: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < input.length; i += 3) {
    const b0 = input[i];
    const b1 = i + 1 < input.length ? input[i + 1] : 0;
    const b2 = i + 2 < input.length ? input[i + 2] : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += alphabet[(triple >> 18) & 63];
    out += alphabet[(triple >> 12) & 63];
    out += i + 1 < input.length ? alphabet[(triple >> 6) & 63] : "=";
    out += i + 2 < input.length ? alphabet[triple & 63] : "=";
  }
  return out;
}
