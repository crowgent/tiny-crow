// Input editor: multi-line text editing with Emacs-style key bindings,
// a kill ring, input history, and the picker dispatch.
//
// The cursor is a code-point index into the buffer (see cursor.ts); the
// original tracks a byte offset, which has no direct JavaScript equivalent.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  charCount,
  countLines,
  cursorToLineCol,
  insertAt,
  isBackspaceAlias,
  lineColToCursor,
  lineEnd,
  lineStart,
  nextCharBoundary,
  prevCharBoundary,
  removeAt,
  sliceChars,
  type KeyEvent,
} from "./cursor.ts";
import {
  drawPicker,
  handlePickerKey,
  pickerActive,
  setPickerMonochrome,
  type Picker,
} from "./pickers.ts";
import { FilePicker } from "../pickers/file.ts";
import { ListPicker } from "../pickers/list.ts";
import { ModelsPicker } from "../pickers/models.ts";
import { RewindPicker, type RewindOutcome } from "../pickers/rewind.ts";
import {
  ModelSwitcher,
  PromptSwitcher,
  type SwitcherResult,
} from "../pickers/switcher.ts";

export const MAX_KILL_RING = 30;

export {
  countLines,
  cursorToLineCol,
  lineColToCursor,
  lineEnd,
  lineStart,
  nextCharBoundary,
  prevCharBoundary,
} from "./cursor.ts";
export type { Picker } from "./pickers.ts";
export { drawPicker, pickerActive, setPickerMonochrome } from "./pickers.ts";

/** Split an editor command string (e.g. "code --wait") into program + args, respecting shell quoting. */
export function parseEditorCommand(editor: string): [string, string[]] {
  const parts: string[] = [];
  let current = "";
  let quote: string | undefined;
  let escaped = false;
  let sawToken = false;
  for (const ch of editor) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote !== undefined) {
      if (ch === quote) quote = undefined;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      sawToken = true;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (sawToken || current !== "") {
        parts.push(current);
        current = "";
        sawToken = false;
      }
      continue;
    }
    current += ch;
    sawToken = true;
  }
  if (sawToken || current !== "") parts.push(current);
  if (parts.length === 0) return [editor, []];
  const [prog, ...args] = parts;
  return [prog, args];
}

/** Leave the alternate screen, run `fn`, then re-enter it. */
export function suspendTui<T>(_mouseCapture: boolean, fn: () => T): T {
  const stdin = process.stdin as unknown as { setRawMode?: (mode: boolean) => void; isTTY?: boolean };
  try {
    if (stdin.isTTY && typeof stdin.setRawMode === "function") stdin.setRawMode(false);
  } catch {
    // Not a TTY; nothing to suspend.
  }
  process.stdout.write("\x1b[?1049l");
  try {
    return fn();
  } finally {
    process.stdout.write("\x1b[?1049h\x1b[2J");
    try {
      if (stdin.isTTY && typeof stdin.setRawMode === "function") stdin.setRawMode(true);
    } catch {
      // Ignore restore failures.
    }
  }
}

export interface HistoryEntry {
  content: string;
}

export class InputEditor {
  buffer = "";
  cursor = 0;
  private history: string[] = [];
  private historyPos: number | undefined;
  private draft: string | undefined;
  picker: Picker | undefined;
  private monochrome = false;
  promptNames: string[] = [];
  themeNames: string[] = [];
  quickModelNames: string[] = [];
  liveModelNames: string[] = [];
  providerNames: string[] = [];
  private editor: string | undefined;
  private killRing: string[] = [];
  yankPos: number | undefined;
  private yankLen = 0;
  private mouseCapture = true;

  getHistory(): string[] {
    return [...this.history];
  }

  /** Move the cursor to `pos` (a code-point index), clamped into the buffer. */
  setCursor(pos: number): void {
    this.cursor = Math.max(0, Math.min(pos, charCount(this.buffer)));
    this.yankPos = undefined;
  }

  clearBuffer(): void {
    this.buffer = "";
    this.cursor = 0;
    this.historyPos = undefined;
    this.draft = undefined;
    this.yankPos = undefined;
  }

  /** Replace the input buffer with `text`, cursor at the end. Used by the rewind flow. */
  loadText(text: string): void {
    this.buffer = text;
    this.cursor = charCount(text);
    this.historyPos = undefined;
    this.draft = undefined;
    this.yankPos = undefined;
  }

  setQuickModelNames(names: string[]): void {
    this.quickModelNames = [...names];
  }

  setLiveModelNames(names: string[]): void {
    this.liveModelNames = [...names];
  }

  setProviderNames(names: string[]): void {
    this.providerNames = [...names];
  }

  setEditor(editor: string): void {
    this.editor = editor;
  }

  setMonochrome(monochrome: boolean): void {
    this.monochrome = monochrome;
    if (this.picker !== undefined) setPickerMonochrome(this.picker, monochrome);
  }

  setMouseCapture(mouseCapture: boolean): void {
    this.mouseCapture = mouseCapture;
  }

  setPromptNames(names: string[]): void {
    this.promptNames = [...names];
  }

  setThemeNames(names: string[]): void {
    this.themeNames = [...names];
  }

  /**
   * Load persisted input history. The session slice owns chat-history
   * storage; pass its loader here (returning entries, or plain strings).
   * With no loader the existing in-memory history is left untouched.
   */
  loadGlobalHistory(
    loader?: () => Array<HistoryEntry | string>,
  ): void {
    if (loader === undefined) return;
    try {
      const entries = loader();
      this.history = entries.map((e) => (typeof e === "string" ? e : e.content));
      this.historyPos = undefined;
    } catch {
      // A failed history load must not break the editor.
    }
  }

  startFilePicker(): void {
    const picker = new FilePicker();
    picker.setMonochrome(this.monochrome);
    picker.activate();
    this.picker = { kind: "file", picker };
  }

  startCommandPicker(): void {
    const picker = ListPicker.withStaticCommands();
    picker.setMonochrome(this.monochrome);
    picker.activate();
    this.picker = { kind: "command", picker };
  }

  startModelsPicker(): void {
    const picker = new ModelsPicker();
    picker.setMonochrome(this.monochrome);
    picker.setGroups(this.quickModelNames, this.liveModelNames);
    picker.activate();
    this.picker = { kind: "models", picker };
  }

  startProviderPicker(): void {
    const picker = new ListPicker();
    picker.setMonochrome(this.monochrome);
    if (this.providerNames.length > 0) picker.setItems(this.providerNames);
    picker.activate();
    this.picker = { kind: "prefixed", picker, prefix: "/provider " };
  }

  /** Open the double-Esc rewind picker over the given user turns. No-op when there is nothing to rewind to. */
  startRewindPicker(targets: Array<[number, string]>): void {
    if (targets.length === 0) return;
    const picker = new RewindPicker(targets);
    picker.setMonochrome(this.monochrome);
    picker.activate();
    this.picker = { kind: "rewind", picker };
  }

  /** Take the rewind picker's resolved outcome, if it has one, clearing the finished picker. */
  takeRewindOutcome(): RewindOutcome | undefined {
    let outcome: RewindOutcome | undefined;
    if (this.picker?.kind === "rewind") {
      outcome = this.picker.picker.takeOutcome();
    }
    if (outcome !== undefined) this.picker = undefined;
    return outcome;
  }

  /** Open the immediate-apply Quick-Model switcher (Alt+M). Modal: typing filters, Enter applies, Esc cancels. */
  startModelSwitcher(
    quick: string[],
    live: string[],
    details: Map<string, string> | Record<string, string>,
    currentQuick: string | undefined,
    currentModel: string,
  ): void {
    const picker = new ModelSwitcher();
    picker.setMonochrome(this.monochrome);
    picker.setGroups(quick, live);
    picker.setDetails(details);
    picker.setCurrent(currentQuick, currentModel);
    picker.activate();
    this.picker = { kind: "modelSwitcher", picker };
  }

  /** Open the immediate-apply Prompt switcher (Alt+P). */
  startPromptSwitcher(
    items: string[],
    details: Map<string, string> | Record<string, string>,
    current: string | undefined,
  ): void {
    const picker = new PromptSwitcher();
    picker.setMonochrome(this.monochrome);
    picker.setItems(items);
    picker.setDetails(details);
    picker.setCurrent(current);
    picker.activate();
    this.picker = { kind: "promptSwitcher", picker };
  }

  /** Take a resolved switcher outcome, if either switcher finished, clearing the picker. */
  takeSwitcherOutcome(): SwitcherResult | undefined {
    let result: SwitcherResult | undefined;
    if (this.picker?.kind === "modelSwitcher") {
      const outcome = this.picker.picker.takeOutcome();
      if (outcome?.kind === "confirmed") result = { kind: "model", name: outcome.name };
      else if (outcome?.kind === "cancelled") result = { kind: "cancelled" };
    } else if (this.picker?.kind === "promptSwitcher") {
      const outcome = this.picker.picker.takeOutcome();
      if (outcome?.kind === "confirmed") result = { kind: "prompt", name: outcome.name };
      else if (outcome?.kind === "cancelled") result = { kind: "cancelled" };
    }
    if (result !== undefined) this.picker = undefined;
    return result;
  }

  switcherKind(): "model" | "prompt" | undefined {
    if (this.picker?.kind === "modelSwitcher") return "model";
    if (this.picker?.kind === "promptSwitcher") return "prompt";
    return undefined;
  }

  startPromptPicker(): void {
    const picker = new ListPicker();
    picker.setMonochrome(this.monochrome);
    if (this.promptNames.length > 0) picker.setItems(this.promptNames);
    picker.activate();
    this.picker = { kind: "prefixed", picker, prefix: "/prompt " };
  }

  startDotPicker(): void {
    const picker = new ListPicker();
    picker.setMonochrome(this.monochrome);
    if (this.promptNames.length > 0) picker.setItems(this.promptNames);
    picker.activate();
    this.picker = { kind: "prefixed", picker, prefix: "." };
  }

  startThemePicker(): void {
    const picker = new ListPicker();
    picker.setMonochrome(this.monochrome);
    if (this.themeNames.length > 0) picker.setItems(this.themeNames);
    picker.activate();
    this.picker = { kind: "prefixed", picker, prefix: "/theme " };
  }

  drawPicker(): void {
    if (this.picker !== undefined) drawPicker(this.picker);
  }

  pickerIsActive(): boolean {
    return this.picker !== undefined && pickerActive(this.picker);
  }

  handlePickerKey(key: KeyEvent): boolean {
    if (this.picker === undefined) return false;
    return handlePickerKey(this, key);
  }

  openInEditor(): void {
    const editor =
      this.editor ?? process.env.EDITOR ?? "editor";
    const tmp = path.join(os.tmpdir(), `zerostack-ts-${process.pid}.md`);
    try {
      fs.writeFileSync(tmp, this.buffer);
    } catch {
      // Continue: the editor run will simply show an empty file.
    }
    suspendTui(this.mouseCapture, () => {
      const [prog, args] = parseEditorCommand(editor);
      try {
        spawnSync(prog, [...args, tmp], { stdio: "inherit" });
      } catch {
        // Editor failures leave the buffer untouched.
      }
    });
    try {
      const content = fs.readFileSync(tmp, "utf8");
      this.buffer = content.replace(/\s+$/, "");
      this.cursor = charCount(this.buffer);
    } catch {
      // Keep the previous buffer if the file cannot be read back.
    }
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Temp cleanup is best-effort.
    }
  }

  handlePaste(data: string): void {
    this.buffer = insertAt(this.buffer, this.cursor, data);
    this.cursor += charCount(data);
    this.historyPos = undefined;
    this.draft = undefined;
    this.yankPos = undefined;
  }

  /** Handle a key. Returns the submitted text on Enter, or undefined. */
  handleKey(key: KeyEvent): string | undefined {
    const ctrl = key.modifiers.control;
    const alt = key.modifiers.alt;
    const c = key.code.kind === "char" ? key.code.char : undefined;

    if (ctrl && c !== undefined) {
      switch (c) {
        case "a": {
          const current = lineStart(this.buffer, this.cursor);
          if (this.cursor === current) {
            const [line] = cursorToLineCol(this.buffer, this.cursor);
            if (line > 0) this.cursor = lineEnd(this.buffer, current - 1);
          } else {
            this.cursor = current;
          }
          this.yankPos = undefined;
          return undefined;
        }
        case "e": {
          const current = lineEnd(this.buffer, this.cursor);
          if (this.cursor === current) {
            const [line] = cursorToLineCol(this.buffer, this.cursor);
            const total = countLines(this.buffer);
            if (line + 1 < total) this.cursor = lineStart(this.buffer, this.cursor + 1);
          } else {
            this.cursor = current;
          }
          this.yankPos = undefined;
          return undefined;
        }
        case "b":
          if (this.cursor > 0) this.cursor = prevCharBoundary(this.buffer, this.cursor);
          this.yankPos = undefined;
          return undefined;
        case "f":
          if (this.cursor < charCount(this.buffer)) {
            this.cursor = nextCharBoundary(this.buffer, this.cursor);
          }
          this.yankPos = undefined;
          return undefined;
        case "p":
          return this.cursorUp();
        case "n":
          return this.cursorDown();
        case "w": {
          const deleted = this.deletePrevWord();
          if (deleted !== "") this.pushKill(deleted);
          this.yankPos = undefined;
          return undefined;
        }
        case "u": {
          if (this.cursor > 0) {
            const deleted = sliceChars(this.buffer, 0, this.cursor);
            this.buffer = sliceChars(this.buffer, this.cursor);
            this.cursor = 0;
            if (deleted !== "") this.pushKill(deleted);
          }
          this.yankPos = undefined;
          return undefined;
        }
        case "k": {
          if (this.cursor < charCount(this.buffer)) {
            const deleted = sliceChars(this.buffer, this.cursor);
            this.buffer = sliceChars(this.buffer, 0, this.cursor);
            if (deleted !== "") this.pushKill(deleted);
          }
          this.yankPos = undefined;
          return undefined;
        }
        case "d":
          if (this.cursor < charCount(this.buffer)) {
            this.buffer = removeAt(this.buffer, this.cursor);
          }
          this.yankPos = undefined;
          return undefined;
        case "y": {
          if (this.killRing.length === 0) return undefined;
          const pos = this.yankPos ?? 0;
          const text = this.killRing[pos];
          this.buffer = insertAt(this.buffer, this.cursor, text);
          this.yankLen = charCount(text);
          this.cursor += charCount(text);
          this.yankPos = pos;
          return undefined;
        }
        default:
          break;
      }
      if (key.code.kind === "char" && key.modifiers.control) {
        // Ctrl+Left / Ctrl+Right arrive as char keys in some terminals; the
        // named-key forms are handled below.
      }
    }
    if (ctrl && key.code.kind === "left") {
      this.cursor = this.prevWordStart();
      this.yankPos = undefined;
      return undefined;
    }
    if (ctrl && key.code.kind === "right") {
      this.cursor = this.nextWordEnd();
      this.yankPos = undefined;
      return undefined;
    }

    if (alt && c !== undefined) {
      switch (c) {
        case "b":
          this.cursor = this.prevWordStart();
          this.yankPos = undefined;
          return undefined;
        case "f":
          this.cursor = this.nextWordEnd();
          this.yankPos = undefined;
          return undefined;
        case "d": {
          const deleted = this.deleteNextWord();
          if (deleted !== "") this.pushKill(deleted);
          this.yankPos = undefined;
          return undefined;
        }
        case "y": {
          if (this.yankPos !== undefined && this.killRing.length > 1) {
            const start = Math.max(this.cursor - this.yankLen, 0);
            const before = sliceChars(this.buffer, 0, start);
            const after = sliceChars(this.buffer, this.cursor);
            this.buffer = `${before}${after}`;
            this.cursor = start;
            const newPos =
              this.yankPos === 0 ? this.killRing.length - 1 : this.yankPos - 1;
            this.yankPos = newPos;
            const text = this.killRing[newPos];
            this.buffer = insertAt(this.buffer, this.cursor, text);
            this.yankLen = charCount(text);
            this.cursor += charCount(text);
          }
          return undefined;
        }
        default:
          break;
      }
    }

    switch (key.code.kind) {
      case "enter": {
        if (key.modifiers.shift || key.modifiers.alt) {
          if (this.pickerIsActive()) return undefined;
          this.buffer = insertAt(this.buffer, this.cursor, "\n");
          this.cursor += 1;
          return undefined;
        }
        if (this.pickerIsActive()) return undefined;
        const text = this.buffer;
        const isBlank = text.trim() === "";
        if (!isBlank) this.history.push(text);
        this.historyPos = undefined;
        this.draft = undefined;
        this.buffer = "";
        this.cursor = 0;
        this.yankPos = undefined;
        return text === "" ? undefined : text;
      }
      case "char": {
        const ch = c as string;
        if (isBackspaceAlias(key)) {
          if (this.cursor > 0) {
            this.cursor = prevCharBoundary(this.buffer, this.cursor);
            this.buffer = removeAt(this.buffer, this.cursor);
          }
          return undefined;
        }
        if (ch === "@") {
          const atWordStart =
            this.cursor === 0 ||
            sliceChars(this.buffer, this.cursor - 1, this.cursor) === " ";
          if (atWordStart) this.startFilePicker();
        }
        if (ch === "/" && this.cursor === 0) this.startCommandPicker();
        if (ch === "." && this.cursor === 0) {
          this.buffer = insertAt(this.buffer, this.cursor, ch);
          this.cursor += 1;
          this.startDotPicker();
          this.yankPos = undefined;
          return undefined;
        }
        this.buffer = insertAt(this.buffer, this.cursor, ch);
        this.cursor += 1;
        this.historyPos = undefined;
        this.draft = undefined;
        this.yankPos = undefined;

        const pickerInactive =
          this.picker === undefined || !this.pickerIsActive();
        if (pickerInactive) {
          this.maybeStartPrefixedPicker("/prompt ", () => {
            this.startPromptPicker();
            const p = this.picker;
            if (p?.kind === "prefixed") p.picker.charInput(ch);
          }, ch);
          this.maybeStartPrefixedPicker("/models ", () => {
            this.startModelsPicker();
            const p = this.picker;
            if (p?.kind === "models") p.picker.charInput(ch);
          }, ch);
          this.maybeStartPrefixedPicker("/theme ", () => {
            this.startThemePicker();
            const p = this.picker;
            if (p?.kind === "prefixed") p.picker.charInput(ch);
          }, ch);
          this.maybeStartPrefixedPicker("/provider ", () => {
            this.startProviderPicker();
            const p = this.picker;
            if (p?.kind === "prefixed") p.picker.charInput(ch);
          }, ch);
        }
        return undefined;
      }
      case "backspace":
        if (this.cursor > 0) {
          this.cursor = prevCharBoundary(this.buffer, this.cursor);
          this.buffer = removeAt(this.buffer, this.cursor);
        }
        this.yankPos = undefined;
        return undefined;
      case "delete":
        if (this.cursor < charCount(this.buffer)) {
          this.buffer = removeAt(this.buffer, this.cursor);
        }
        this.yankPos = undefined;
        return undefined;
      case "left":
        if (this.cursor > 0) this.cursor = prevCharBoundary(this.buffer, this.cursor);
        this.yankPos = undefined;
        return undefined;
      case "right":
        if (this.cursor < charCount(this.buffer)) {
          this.cursor = nextCharBoundary(this.buffer, this.cursor);
        }
        this.yankPos = undefined;
        return undefined;
      case "up":
        this.yankPos = undefined;
        return this.cursorUp();
      case "down":
        this.yankPos = undefined;
        return this.cursorDown();
      case "home":
        this.cursor = 0;
        this.yankPos = undefined;
        return undefined;
      case "end":
        this.cursor = charCount(this.buffer);
        this.yankPos = undefined;
        return undefined;
      case "tab":
        this.buffer = insertAt(this.buffer, this.cursor, "  ");
        this.cursor += 2;
        this.yankPos = undefined;
        return undefined;
      default:
        return undefined;
    }
  }

  private maybeStartPrefixedPicker(
    prefix: string,
    start: () => void,
    c: string,
  ): void {
    if (!this.buffer.startsWith(prefix)) return;
    const afterPrefix = sliceChars(this.buffer, charCount(prefix));
    if (afterPrefix !== "" && c !== " " && charCount(afterPrefix) === 1) {
      start();
    }
  }

  private historyUp(): undefined {
    const histLen = this.history.length;
    if (histLen === 0 || this.historyPos === 0) return undefined;
    if (this.historyPos === undefined) this.draft = this.buffer;
    const pos = this.historyPos !== undefined && this.historyPos > 0
      ? this.historyPos - 1
      : histLen - 1;
    this.historyPos = pos;
    this.buffer = this.history[pos];
    this.cursor = 0;
    return undefined;
  }

  private historyDown(): undefined {
    if (this.historyPos !== undefined) {
      if (this.historyPos + 1 < this.history.length) {
        const newPos = this.historyPos + 1;
        this.historyPos = newPos;
        this.buffer = this.history[newPos];
        this.cursor = charCount(this.buffer);
      } else {
        this.historyPos = undefined;
        if (this.draft !== undefined) {
          this.buffer = this.draft;
          this.draft = undefined;
          this.cursor = charCount(this.buffer);
        } else {
          this.buffer = "";
          this.cursor = 0;
        }
      }
    }
    return undefined;
  }

  private cursorUp(): undefined {
    const [line, col] = cursorToLineCol(this.buffer, this.cursor);
    if (line > 0) {
      const lineLen = lineEnd(this.buffer, this.cursor) - lineStart(this.buffer, this.cursor);
      this.cursor = lineColToCursor(
        this.buffer,
        line - 1,
        col >= lineLen ? Number.MAX_SAFE_INTEGER : col,
      );
      return undefined;
    }
    return this.historyUp();
  }

  private cursorDown(): undefined {
    const [line, col] = cursorToLineCol(this.buffer, this.cursor);
    const total = countLines(this.buffer);
    if (line + 1 < total) {
      const lineLen = lineEnd(this.buffer, this.cursor) - lineStart(this.buffer, this.cursor);
      this.cursor = lineColToCursor(
        this.buffer,
        line + 1,
        col >= lineLen ? Number.MAX_SAFE_INTEGER : col,
      );
      return undefined;
    }
    return this.historyDown();
  }

  private pushKill(text: string): void {
    if (text === "") return;
    if (this.killRing[0] === text) return;
    this.killRing.unshift(text);
    if (this.killRing.length > MAX_KILL_RING) this.killRing.pop();
  }

  private prevWordStart(): number {
    if (this.cursor === 0) return 0;
    const pairs = [...this.buffer];
    if (pairs.length === 0) return 0;
    let charIdx = pairs.findIndex((_, i) => i >= this.cursor);
    if (charIdx === -1) charIdx = pairs.length;
    let pos = charIdx;
    while (pos > 0 && pairs[pos - 1] === " ") pos -= 1;
    while (pos > 0 && pairs[pos - 1] !== " ") pos -= 1;
    return pos;
  }

  private nextWordEnd(): number {
    const pairs = [...this.buffer];
    const len = pairs.length;
    if (len === 0) return 0;
    let charIdx = pairs.findIndex((_, i) => i >= this.cursor);
    if (charIdx === -1) charIdx = len;
    let pos = charIdx;
    while (pos < len && pairs[pos] === " ") pos += 1;
    while (pos < len && pairs[pos] !== " ") pos += 1;
    return pos;
  }

  private deletePrevWord(): string {
    if (this.cursor === 0 || this.buffer === "") return "";
    const start = this.prevWordStart();
    const deleted = sliceChars(this.buffer, start, this.cursor);
    this.buffer = sliceChars(this.buffer, 0, start) + sliceChars(this.buffer, this.cursor);
    this.cursor = start;
    return deleted;
  }

  private deleteNextWord(): string {
    if (this.cursor >= charCount(this.buffer)) return "";
    const end = this.nextWordEnd();
    const deleted = sliceChars(this.buffer, this.cursor, end);
    this.buffer = sliceChars(this.buffer, 0, this.cursor) + sliceChars(this.buffer, end);
    return deleted;
  }
}
