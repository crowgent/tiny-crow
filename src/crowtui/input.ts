import type { CrowKey } from "./keys.ts";
import { slashCandidates } from "./slash.ts";

export class LineInput {
  chars: string[] = [];
  cursor = 0;
  history: string[] = [];
  historyIndex = -1;
  draft = "";
  pickerIndex = 0;
  pickerDismissed = false;

  value(): string {
    return this.chars.join("");
  }

  setValue(text: string): void {
    this.chars = Array.from(text);
    this.cursor = this.chars.length;
    this.historyIndex = -1;
    this.pickerIndex = 0;
    this.pickerDismissed = false;
  }

  clear(): void {
    this.chars = [];
    this.cursor = 0;
    this.historyIndex = -1;
    this.pickerIndex = 0;
    this.pickerDismissed = false;
  }

  dismissPicker(): void {
    this.pickerDismissed = true;
  }

  pushHistory(text: string): void {
    if (text !== "") this.history.push(text);
    if (this.history.length > 200) this.history.splice(0, this.history.length - 200);
    this.historyIndex = -1;
    this.draft = "";
  }

  insert(text: string): void {
    const incoming = Array.from(text);
    this.chars.splice(this.cursor, 0, ...incoming);
    this.cursor += incoming.length;
    this.pickerDismissed = false;
  }

  backspace(): void {
    if (this.cursor > 0) {
      this.chars.splice(this.cursor - 1, 1);
      this.cursor -= 1;
    }
    this.pickerDismissed = false;
  }

  deleteChar(): void {
    if (this.cursor < this.chars.length) this.chars.splice(this.cursor, 1);
    this.pickerDismissed = false;
  }

  moveLeft(): void {
    if (this.cursor > 0) this.cursor -= 1;
  }

  moveRight(): void {
    if (this.cursor < this.chars.length) this.cursor += 1;
  }

  moveHome(): void {
    this.cursor = 0;
  }

  moveEnd(): void {
    this.cursor = this.chars.length;
  }

  deleteWordBefore(): void {
    let end = this.cursor;
    while (end > 0 && this.chars[end - 1] === " ") end -= 1;
    while (end > 0 && this.chars[end - 1] !== " ") end -= 1;
    this.chars.splice(end, this.cursor - end);
    this.cursor = end;
    this.pickerDismissed = false;
  }

  historyUp(): boolean {
    if (this.history.length === 0) return false;
    if (this.historyIndex === -1) {
      this.draft = this.value();
      this.historyIndex = this.history.length - 1;
    } else if (this.historyIndex > 0) {
      this.historyIndex -= 1;
    } else {
      return false;
    }
    this.chars = Array.from(this.history[this.historyIndex]!);
    this.cursor = this.chars.length;
    return true;
  }

  historyDown(): boolean {
    if (this.historyIndex === -1) return false;
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex += 1;
      this.chars = Array.from(this.history[this.historyIndex]!);
    } else {
      this.historyIndex = -1;
      this.chars = Array.from(this.draft);
    }
    this.cursor = this.chars.length;
    return true;
  }

  pickerCandidates(): string[] {
    if (this.pickerDismissed) return [];
    const text = this.value();
    if (!text.startsWith("/")) return [];
    const token = text.slice(1).split(" ")[0] ?? "";
    if (text.includes(" ")) return [];
    return slashCandidates(token);
  }

  enterSlash(): string | null {
    const candidates = this.pickerCandidates();
    if (candidates.length === 0) return null;
    const raw = this.value();
    const token = raw.startsWith("/") ? (raw.slice(1).split(" ")[0] ?? "") : "";
    if (candidates.includes(token)) return null;
    this.applyPicker();
    return this.value().trim();
  }

  applyPicker(): boolean {
    const candidates = this.pickerCandidates();
    if (candidates.length === 0) return false;
    const pick = candidates[this.pickerIndex % candidates.length]!;
    this.setValue(`/${pick} `);
    return true;
  }

  handleKey(key: CrowKey): "submit" | "none" {
    switch (key.kind) {
      case "enter":
        return "submit";
      case "backspace":
        this.backspace();
        return "none";
      case "delete":
        this.deleteChar();
        return "none";
      case "left":
        this.moveLeft();
        return "none";
      case "right":
        this.moveRight();
        return "none";
      case "home":
        this.moveHome();
        return "none";
      case "end":
        this.moveEnd();
        return "none";
      case "ctrlu":
        this.clear();
        return "none";
      case "ctrlw":
        this.deleteWordBefore();
        return "none";
      case "tab":
        this.applyPicker();
        return "none";
      case "char":
        if (!key.ctrl && !key.alt) this.insert(key.ch);
        return "none";
      default:
        return "none";
    }
  }
}
