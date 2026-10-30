import {
  charCount,
  insertAt,
  isBackspaceAlias,
  prevCharBoundary,
  removeAt,
  sliceChars,
  type KeyEvent,
} from "../input/cursor.ts";
import type { Picker } from "../input/pickers.ts";
import { FilePicker } from "./file.ts";
import { ListPicker } from "./list.ts";
import { ModelsPicker } from "./models.ts";

export interface EditableBuffer {
  buffer: string;
  cursor: number;
}

function lastCharIndexOf(buffer: string, ch: string): number {
  return [...buffer].lastIndexOf(ch);
}

function removeAtBuffer(state: EditableBuffer, charIdx: number): void {
  state.buffer = removeAt(state.buffer, charIdx);
}

function insertAtBuffer(state: EditableBuffer, charIdx: number, c: string): void {
  state.buffer = insertAt(state.buffer, charIdx, c);
}

export function handleFileKey(
  state: EditableBuffer,
  picker: FilePicker,
  key: KeyEvent,
): boolean {
  const c = key.code.kind === "char" ? key.code.char : undefined;
  if (c !== undefined && isBackspaceAlias(key)) {
    return handleFileBackspace(state, picker);
  }
  switch (key.code.kind) {
    case "char": {
      picker.charInput(c as string);
      insertAtBuffer(state, state.cursor, c as string);
      state.cursor += charCount(c as string);
      return true;
    }
    case "backspace":
      return handleFileBackspace(state, picker);
    case "tab":
      if (key.modifiers.shift) picker.selectPrev();
      else picker.selectNext();
      return true;
    case "up":
      picker.selectPrev();
      return true;
    case "down":
      picker.selectNext();
      return true;
    case "enter": {
      const pathStr = picker.selectedPath();
      if (pathStr !== undefined) {
        const at = lastCharIndexOf(state.buffer, "@");
        if (at !== -1) {
          const before = sliceChars(state.buffer, 0, at);
          const after = sliceChars(state.buffer, at + 1 + charCount(picker.query));
          state.buffer = `${before}${pathStr}${after}`;
          state.cursor = charCount(before) + charCount(pathStr);
        }
      }
      picker.deactivate();
      return true;
    }
    case "esc": {
      const at = lastCharIndexOf(state.buffer, "@");
      if (at !== -1) {
        const before = sliceChars(state.buffer, 0, at);
        const after = sliceChars(state.buffer, at + 1 + charCount(picker.query));
        state.buffer = `${before}${after}`;
        state.cursor = at;
      }
      picker.deactivate();
      return true;
    }
    default:
      return false;
  }
}

function handleFileBackspace(state: EditableBuffer, picker: FilePicker): boolean {
  if (picker.cursor > 0) {
    picker.backspace();
    state.cursor = prevCharBoundary(state.buffer, state.cursor);
    removeAtBuffer(state, state.cursor);
  } else {
    const at = lastCharIndexOf(state.buffer, "@");
    if (at !== -1) {
      const before = sliceChars(state.buffer, 0, at);
      const after = sliceChars(state.buffer, at + 1);
      state.buffer = `${before}${after}`;
      state.cursor = at;
    }
    picker.deactivate();
  }
  return true;
}

export interface CommandPickerCtx {
  promptNames: string[];
  themeNames: string[];
  quickModelNames: string[];
  liveModelNames: string[];
  providerNames: string[];
}

export function handleCommandKey(
  state: EditableBuffer,
  ctx: CommandPickerCtx,
  picker: ListPicker,
  key: KeyEvent,
): { handled: boolean; replacement?: Picker } {
  const c = key.code.kind === "char" ? key.code.char : undefined;
  if (c !== undefined && isBackspaceAlias(key)) {
    return { handled: handleCommandBackspace(state, picker) };
  }
  switch (key.code.kind) {
    case "char": {
      picker.charInput(c as string);
      const pos = 1 + (picker.cursor - 1);
      insertAtBuffer(state, pos, c as string);
      state.cursor += charCount(c as string);
      return { handled: true };
    }
    case "backspace":
      return { handled: handleCommandBackspace(state, picker) };
    case "tab":
      if (key.modifiers.shift) picker.selectPrev();
      else picker.selectNext();
      return { handled: true };
    case "up":
      picker.selectPrev();
      return { handled: true };
    case "down":
      picker.selectNext();
      return { handled: true };
    case "enter": {
      const selected = picker.selectedName();
      if (selected !== undefined) {
        const slashPos = lastSlashPos(state.buffer);
        const before = sliceChars(state.buffer, 0, slashPos);
        const afterOffset = slashPos + 1 + charCount(picker.query);
        const after = sliceChars(state.buffer, afterOffset);
        const insertion =
          after === "" || after.startsWith(" ") ? `${selected} ` : `${selected}${after}`;
        state.buffer = `${before}${insertion}`;
        state.cursor = charCount(before) + charCount(selected) + 1;

        const chained = chainedPicker(selected, ctx);
        if (chained !== undefined) {
          picker.deactivate();
          return { handled: true, replacement: chained };
        }
      }
      picker.deactivate();
      return { handled: true };
    }
    case "esc": {
      const slashPos = lastSlashPos(state.buffer);
      const before = sliceChars(state.buffer, 0, slashPos);
      const after = sliceChars(
        state.buffer,
        slashPos + 1 + charCount(picker.query),
      );
      state.buffer = `${before}/${after}`;
      state.cursor = slashPos + 1;
      picker.deactivate();
      return { handled: true };
    }
    default:
      return { handled: false };
  }
}

function lastSlashPos(buffer: string): number {
  const idx = [...buffer].indexOf("/");
  return idx === -1 ? 0 : idx;
}

function chainedPicker(selected: string, ctx: CommandPickerCtx): Picker | undefined {
  if (selected === "/prompt" && ctx.promptNames.length > 0) {
    const pp = new ListPicker();
    pp.setItems(ctx.promptNames);
    pp.activate();
    return { kind: "prefixed", picker: pp, prefix: "/prompt " };
  }
  if (
    selected === "/models" &&
    !(ctx.quickModelNames.length === 0 && ctx.liveModelNames.length === 0)
  ) {
    const mp = new ModelsPicker();
    mp.setGroups(ctx.quickModelNames, ctx.liveModelNames);
    mp.activate();
    return { kind: "models", picker: mp };
  }
  if (selected === "/theme" && ctx.themeNames.length > 0) {
    const tp = new ListPicker();
    tp.setItems(ctx.themeNames);
    tp.activate();
    return { kind: "prefixed", picker: tp, prefix: "/theme " };
  }
  if (selected === "/provider" && ctx.providerNames.length > 0) {
    const pp = new ListPicker();
    pp.setItems(ctx.providerNames);
    pp.activate();
    return { kind: "prefixed", picker: pp, prefix: "/provider " };
  }
  if (selected === "/queue") {
    const qp = new ListPicker();
    qp.setItems(["ls", "clear", "pop"]);
    qp.activate();
    return { kind: "prefixed", picker: qp, prefix: "/queue " };
  }
  return undefined;
}

function handleCommandBackspace(state: EditableBuffer, picker: ListPicker): boolean {
  if (picker.cursor > 0) {
    picker.backspace();
    const removePos = 1 + picker.cursor;
    if (removePos < charCount(state.buffer)) {
      removeAtBuffer(state, removePos);
    }
    state.cursor = prevCharBoundary(state.buffer, state.cursor);
  } else {
    if (state.buffer.startsWith("/")) {
      const after = sliceChars(state.buffer, 1 + charCount(picker.query));
      state.buffer = `/${after}`;
      state.cursor = 1;
    }
    picker.deactivate();
  }
  return true;
}

export function handlePrefixedKey(
  state: EditableBuffer,
  picker: ListPicker,
  prefix: string,
  key: KeyEvent,
): boolean {
  const prefixLen = charCount(prefix);
  const c = key.code.kind === "char" ? key.code.char : undefined;
  if (c !== undefined && isBackspaceAlias(key)) {
    return handlePrefixedBackspace(state, picker, prefixLen);
  }
  switch (key.code.kind) {
    case "char": {
      picker.charInput(c as string);
      const insertPos = prefixLen + (picker.cursor - 1);
      insertAtBuffer(state, insertPos, c as string);
      state.cursor += charCount(c as string);
      return true;
    }
    case "backspace":
      return handlePrefixedBackspace(state, picker, prefixLen);
    case "tab":
      if (key.modifiers.shift) picker.selectPrev();
      else picker.selectNext();
      return true;
    case "up":
      picker.selectPrev();
      return true;
    case "down":
      picker.selectNext();
      return true;
    case "enter": {
      const name = picker.selectedName();
      if (name !== undefined) {
        const afterOffset = prefixLen + charCount(picker.query);
        const before = sliceChars(state.buffer, 0, prefixLen);
        const after = sliceChars(state.buffer, afterOffset);
        state.buffer = `${before}${name}${after}`;
        state.cursor = prefixLen + charCount(name);
      }
      picker.deactivate();
      return true;
    }
    case "esc": {
      const afterOffset = prefixLen + charCount(picker.query);
      if (charCount(state.buffer) >= afterOffset) {
        const before = sliceChars(state.buffer, 0, prefixLen);
        const after = sliceChars(state.buffer, afterOffset);
        state.buffer = `${before}${after}`;
        state.cursor = prefixLen;
      }
      picker.deactivate();
      return true;
    }
    default:
      return false;
  }
}

function handlePrefixedBackspace(
  state: EditableBuffer,
  picker: ListPicker,
  prefixLen: number,
): boolean {
  if (picker.cursor > 0) {
    picker.backspace();
    const removePos = prefixLen + picker.cursor;
    if (removePos < charCount(state.buffer)) {
      removeAtBuffer(state, removePos);
    }
    state.cursor = prevCharBoundary(state.buffer, state.cursor);
  } else {
    const afterOffset = prefixLen + charCount(picker.query);
    if (charCount(state.buffer) >= afterOffset) {
      const before = sliceChars(state.buffer, 0, prefixLen);
      const after = sliceChars(state.buffer, afterOffset);
      state.buffer = `${before}${after}`;
      state.cursor = prefixLen;
    }
    picker.deactivate();
  }
  return true;
}

export function handleModelsKey(
  state: EditableBuffer,
  picker: ModelsPicker,
  key: KeyEvent,
): boolean {
  const prefix = "/models ";
  const prefixLen = charCount(prefix);
  const c = key.code.kind === "char" ? key.code.char : undefined;
  if (c !== undefined && isBackspaceAlias(key)) {
    return handleModelsBackspace(state, picker, prefixLen);
  }
  switch (key.code.kind) {
    case "char": {
      picker.charInput(c as string);
      const insertPos = prefixLen + (picker.cursor - 1);
      insertAtBuffer(state, insertPos, c as string);
      state.cursor += charCount(c as string);
      return true;
    }
    case "backspace":
      return handleModelsBackspace(state, picker, prefixLen);
    case "tab":
    case "backtab":
      picker.toggleGroup();
      return true;
    case "up":
      picker.selectPrev();
      return true;
    case "down":
      picker.selectNext();
      return true;
    case "enter": {
      const name = picker.selectedName();
      if (name !== undefined) {
        const afterOffset = prefixLen + charCount(picker.query);
        const before = sliceChars(state.buffer, 0, prefixLen);
        const after = sliceChars(state.buffer, afterOffset);
        state.buffer = `${before}${name}${after}`;
        state.cursor = prefixLen + charCount(name);
      }
      picker.deactivate();
      return true;
    }
    case "esc": {
      const afterOffset = prefixLen + charCount(picker.query);
      if (charCount(state.buffer) >= afterOffset) {
        const before = sliceChars(state.buffer, 0, prefixLen);
        const after = sliceChars(state.buffer, afterOffset);
        state.buffer = `${before}${after}`;
        state.cursor = prefixLen;
      }
      picker.deactivate();
      return true;
    }
    default:
      return false;
  }
}

function handleModelsBackspace(
  state: EditableBuffer,
  picker: ModelsPicker,
  prefixLen: number,
): boolean {
  if (picker.cursor > 0) {
    picker.backspace();
    const removePos = prefixLen + picker.cursor;
    if (removePos < charCount(state.buffer)) {
      removeAtBuffer(state, removePos);
    }
    state.cursor = prevCharBoundary(state.buffer, state.cursor);
  } else {
    const afterOffset = prefixLen + charCount(picker.query);
    if (charCount(state.buffer) >= afterOffset) {
      const before = sliceChars(state.buffer, 0, prefixLen);
      const after = sliceChars(state.buffer, afterOffset);
      state.buffer = `${before}${after}`;
      state.cursor = prefixLen;
    }
    picker.deactivate();
  }
  return true;
}
