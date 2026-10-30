// The input editor's active picker: one of the picker kinds, plus the
// dispatch that routes keys to the active picker.
//
// This file deliberately does not import the editor itself: it works
// through the PickerHost interface, which the editor satisfies
// structurally, so there is no import cycle between editor and pickers.

import type { KeyEvent } from "./cursor.ts";
import { FilePicker } from "../pickers/file.ts";
import {
  handleCommandKey,
  handleFileKey,
  handleModelsKey,
  handlePrefixedKey,
  type EditableBuffer,
} from "../pickers/handlers.ts";
import { ListPicker } from "../pickers/list.ts";
import { ModelsPicker } from "../pickers/models.ts";
import { RewindPicker } from "../pickers/rewind.ts";
import { ModelSwitcher, PromptSwitcher } from "../pickers/switcher.ts";

export type Picker =
  | { kind: "file"; picker: FilePicker }
  | { kind: "command"; picker: ListPicker }
  | { kind: "prefixed"; picker: ListPicker; prefix: string }
  | { kind: "models"; picker: ModelsPicker }
  | { kind: "rewind"; picker: RewindPicker }
  | { kind: "modelSwitcher"; picker: ModelSwitcher }
  | { kind: "promptSwitcher"; picker: PromptSwitcher };

/** The editor surface the picker dispatch needs. */
export interface PickerHost extends EditableBuffer {
  picker: Picker | undefined;
  promptNames: string[];
  themeNames: string[];
  quickModelNames: string[];
  liveModelNames: string[];
  providerNames: string[];
  yankPos: number | undefined;
}

export function pickerActive(picker: Picker): boolean {
  switch (picker.kind) {
    case "file":
    case "command":
    case "prefixed":
    case "models":
      return picker.picker.active;
    case "rewind":
    case "modelSwitcher":
    case "promptSwitcher":
      return picker.picker.active();
  }
}

export function setPickerMonochrome(picker: Picker, monochrome: boolean): void {
  picker.picker.setMonochrome(monochrome);
}

export function drawPicker(picker: Picker): void {
  switch (picker.kind) {
    case "file":
      picker.picker.draw();
      break;
    case "command":
      picker.picker.draw();
      break;
    case "prefixed":
      picker.picker.draw(
        picker.prefix === "/provider "
          ? "no matches  (type a registered custom gateway name)"
          : undefined,
      );
      break;
    case "models":
    case "rewind":
    case "modelSwitcher":
    case "promptSwitcher":
      picker.picker.draw();
      break;
  }
}

export function handlePickerKey(host: PickerHost, key: KeyEvent): boolean {
  if (host.picker === undefined) return false;
  const picker = host.picker;
  let handled: boolean;
  switch (picker.kind) {
    case "file":
      handled = handleFileKey(host, picker.picker, key);
      break;
    case "command": {
      const ctx = {
        promptNames: host.promptNames,
        themeNames: host.themeNames,
        quickModelNames: host.quickModelNames,
        liveModelNames: host.liveModelNames,
        providerNames: host.providerNames,
      };
      const result = handleCommandKey(host, ctx, picker.picker, key);
      if (result.replacement !== undefined) {
        host.picker = result.replacement;
      }
      handled = result.handled;
      break;
    }
    case "prefixed":
      handled = handlePrefixedKey(host, picker.picker, picker.prefix, key);
      break;
    case "models":
      handled = handleModelsKey(host, picker.picker, key);
      break;
    case "rewind":
      handled = picker.picker.handle(key);
      break;
    case "modelSwitcher":
      handled = picker.picker.handle(key);
      break;
    case "promptSwitcher":
      handled = picker.picker.handle(key);
      break;
  }
  if (handled) host.yankPos = undefined;
  return handled;
}
