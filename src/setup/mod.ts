// Interactive setup wizard: manage providers and quick models, then
// launch the agent, autoconfigure from environment keys, or quit & save.
//
// The wizard is a full-screen terminal UI. Rendering is split into pure
// line builders (render*Lines, used by tests) and drawSetup, which writes
// those lines to the terminal. Key handling is the pure handleKey state
// machine; run() drives it from stdin in raw mode.

import type { KeyEvent } from "../ui/input/cursor.ts";
import { charKey, makeKeyEvent, plainKey } from "../ui/input/cursor.ts";

export type SetupOutcome =
  | { kind: "launch" }
  | { kind: "launchAutoconfigure" }
  | { kind: "quit" };

export const SETUP_OUTCOME_LAUNCH: SetupOutcome = { kind: "launch" };
export const SETUP_OUTCOME_LAUNCH_AUTOCONFIGURE: SetupOutcome = {
  kind: "launchAutoconfigure",
};
export const SETUP_OUTCOME_QUIT: SetupOutcome = { kind: "quit" };

export interface CustomProviderConfig {
  providerType: string;
  baseUrl: string;
  apiKeyEnv?: string;
  dangerAcceptInvalidCerts?: boolean;
  apiStyle?: string;
  headers?: Record<string, string>;
  timeoutSecs?: number;
  model?: string;
}

export interface QuickModelConfig {
  provider: string;
  model: string;
  inputTokenCost: number;
  outputTokenCost: number;
  reserveTokens?: number;
  temperature?: number;
  extraBody?: unknown;
  contextWindow?: number;
}

export interface SetupConfig {
  customProviders?: Record<string, CustomProviderConfig>;
  apiKeys?: Record<string, string>;
  quickModels?: Record<string, QuickModelConfig>;
  [key: string]: unknown;
}

export function cloneSetupConfig(cfg: SetupConfig): SetupConfig {
  const clone: SetupConfig = { ...cfg };
  if (cfg.customProviders !== undefined) {
    const cp: Record<string, CustomProviderConfig> = {};
    for (const [k, v] of Object.entries(cfg.customProviders)) {
      cp[k] = { ...v, headers: v.headers !== undefined ? { ...v.headers } : undefined };
    }
    clone.customProviders = cp;
  }
  if (cfg.apiKeys !== undefined) clone.apiKeys = { ...cfg.apiKeys };
  if (cfg.quickModels !== undefined) {
    const qm: Record<string, QuickModelConfig> = {};
    for (const [k, v] of Object.entries(cfg.quickModels)) qm[k] = { ...v };
    clone.quickModels = qm;
  }
  return clone;
}

export class TextInput {
  buffer: string;
  cursor: number;
  original: string;

  constructor(text: string) {
    this.buffer = text;
    this.cursor = [...text].length;
    this.original = text;
  }

  insert(c: string): void {
    const cs = [...this.buffer];
    cs.splice(this.cursor, 0, c);
    this.buffer = cs.join("");
    this.cursor += 1;
  }

  backspace(): void {
    if (this.cursor > 0) {
      this.cursor -= 1;
      const cs = [...this.buffer];
      cs.splice(this.cursor, 1);
      this.buffer = cs.join("");
    }
  }

  delete(): void {
    const cs = [...this.buffer];
    if (this.cursor < cs.length) {
      cs.splice(this.cursor, 1);
      this.buffer = cs.join("");
    }
  }

  cursorLeft(): void {
    if (this.cursor > 0) this.cursor -= 1;
  }

  cursorRight(): void {
    if (this.cursor < [...this.buffer].length) this.cursor += 1;
  }

  cursorHome(): void {
    this.cursor = 0;
  }

  cursorEnd(): void {
    this.cursor = [...this.buffer].length;
  }

  confirmed(): string {
    return this.buffer;
  }
}

export interface FieldDef {
  label: string;
  value: string;
  editable: boolean;
  masked: boolean;
}

export function cloneFields(fields: FieldDef[]): FieldDef[] {
  return fields.map((f) => ({ ...f }));
}

export type Screen =
  | { kind: "mainMenu" }
  | { kind: "manageProviders"; selected: number; confirmDelete: boolean }
  | {
      kind: "providerDetail";
      isNew: boolean;
      isBuiltin: boolean;
      name: string;
      fields: FieldDef[];
      selectedField: number;
      editing?: TextInput;
      error?: string;
    }
  | { kind: "manageModels"; selected: number; confirmDelete: boolean }
  | {
      kind: "modelDetail";
      isNew: boolean;
      name: string;
      fields: FieldDef[];
      selectedField: number;
      editing?: TextInput;
      error?: string;
    };

export interface SetupCtx {
  cfg: SetupConfig;
  screen: Screen;
  cols: number;
  rows: number;
  message?: string;
}

export function builtinProviderNames(): string[] {
  return [
    "openrouter",
    "openai",
    "anthropic",
    "gemini",
    "ollama",
    "opencode-zen",
    "opencode-go",
  ];
}

export const VALID_PROVIDER_TYPES: string[] = [
  "openrouter",
  "openai",
  "anthropic",
  "gemini",
  "ollama",
  "opencode-zen",
  "opencode-go",
  "custom",
];

export function isValidProviderType(name: string): boolean {
  return VALID_PROVIDER_TYPES.includes(name);
}

export function providerEnvVar(name: string): string {
  switch (name) {
    case "openrouter":
      return "OPENROUTER_API_KEY";
    case "openai":
      return "OPENAI_API_KEY";
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "gemini":
      return "GEMINI_API_KEY";
    case "ollama":
      return "OLLAMA_API_KEY";
    case "opencode-zen":
    case "opencode-go":
      return "OPENCODE_API_KEY";
    default:
      return "";
  }
}

export function collectProviderNames(cfg: SetupConfig): string[] {
  const names = builtinProviderNames();
  if (cfg.customProviders !== undefined) {
    for (const name of Object.keys(cfg.customProviders)) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

export function collectModels(cfg: SetupConfig): Array<[string, QuickModelConfig]> {
  const models: Array<[string, QuickModelConfig]> = cfg.quickModels !== undefined
    ? Object.entries(cfg.quickModels).map(([k, v]) => [k, v] as [string, QuickModelConfig])
    : [];
  models.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return models;
}

export function hasEnv(envName: string): boolean {
  if (envName === "") return false;
  const v = process.env[envName];
  return v !== undefined && v !== "";
}

export function maskedKey(key: string): string {
  if (key === "") return "(not set)";
  const chars = [...key];
  if (chars.length <= 4) return "****";
  return `${chars.slice(0, 4).join("")}****`;
}

export function providerTypeDisplay(name: string, cfg: SetupConfig): string {
  if (builtinProviderNames().includes(name)) return `[built-in: ${name}]`;
  const custom = cfg.customProviders?.[name];
  if (custom !== undefined) return `[custom: ${custom.providerType}]`;
  return "[unknown]";
}

function hline(width: number): string {
  return "─".repeat(Math.max(width, 0));
}

function centered(text: string, width: number): string {
  if (width <= text.length) return text;
  const pad = Math.floor((width - text.length) / 2);
  return " ".repeat(pad) + text;
}

function twoColumns(left: string, right: string, rightCol: number): string {
  const padded = left.padEnd(rightCol, " ");
  return `${padded}${right}`;
}

export function renderSetupLines(ctx: SetupCtx): string[] {
  switch (ctx.screen.kind) {
    case "mainMenu":
      return renderMainMenuLines(ctx);
    case "manageProviders":
      return renderManageProvidersLines(ctx, ctx.screen.selected, ctx.screen.confirmDelete);
    case "providerDetail":
      return renderProviderDetailLines(ctx);
    case "manageModels":
      return renderManageModelsLines(ctx, ctx.screen.selected, ctx.screen.confirmDelete);
    case "modelDetail":
      return renderModelDetailLines(ctx);
  }
}

function renderMainMenuLines(ctx: SetupCtx): string[] {
  const lines: string[] = [];
  lines.push(centered("TINY-CROW SETUP", ctx.cols));
  lines.push("");
  lines.push(hline(ctx.cols));
  lines.push("");
  lines.push("  PROVIDERS");
  const providers = collectProviderNames(ctx.cfg);
  if (providers.length === 0) {
    lines.push("    (none)");
  } else {
    for (const name of providers) {
      lines.push(`    ${name}  ${providerTypeDisplay(name, ctx.cfg)}`);
    }
  }
  lines.push("");
  lines.push("  QUICK MODELS");
  const models = collectModels(ctx.cfg);
  if (models.length === 0) {
    lines.push("    (none)");
  } else {
    for (const [name, qm] of models) {
      lines.push(`    ${name}  →  ${qm.provider} / ${qm.model}`);
    }
  }
  lines.push("");
  lines.push(hline(ctx.cols));
  lines.push("");
  lines.push(twoColumns("  P) Manage Providers", "M) Manage Models", 28));
  lines.push(twoColumns("  L) Launch agent", "A) Autoconfigure", 28));
  lines.push("  Q) Quit & Save");
  if (ctx.message !== undefined) {
    lines.push("");
    lines.push(`  ${ctx.message}`);
  }
  return lines;
}

function renderManageProvidersLines(
  ctx: SetupCtx,
  selected: number,
  confirmDelete: boolean,
): string[] {
  const lines: string[] = [];
  lines.push(centered("MANAGE PROVIDERS", ctx.cols));
  lines.push("");
  lines.push(hline(ctx.cols));
  lines.push("");
  const providers = collectProviderNames(ctx.cfg);
  if (providers.length === 0) {
    lines.push("    (no providers configured)");
    lines.push("");
  } else {
    providers.forEach((name, i) => {
      const highlight = i === selected;
      const marker = highlight ? ">" : " ";
      const isBuiltin = builtinProviderNames().includes(name);
      const typeStr = isBuiltin
        ? "[built-in]"
        : ctx.cfg.customProviders?.[name] !== undefined
          ? `[custom: ${ctx.cfg.customProviders[name].providerType}]  ${ctx.cfg.customProviders[name].baseUrl}`
          : "[unknown]";
      const env = providerEnvVar(name);
      const cfgKey = ctx.cfg.apiKeys?.[name];
      const keyStr = (cfgKey !== undefined && cfgKey !== "") || hasEnv(env)
        ? "key: set"
        : "key: not set";
      lines.push(`    ${marker} ${i + 1}. ${name}    ${typeStr}    ${keyStr}`);
    });
  }
  lines.push("");
  lines.push(hline(ctx.cols));
  lines.push("");
  if (confirmDelete) {
    const selectedName = providers[selected] ?? "";
    lines.push(`    Delete '${selectedName}'? This cannot be undone. [Y] Yes  [N] No`);
  } else {
    lines.push(twoColumns("    A) Add custom provider", "Enter) View / Edit selected", 32));
    const selectedName = providers[selected];
    const delLabel = selectedName !== undefined && builtinProviderNames().includes(selectedName)
      ? "    D) (cannot delete built-in provider)"
      : "    D) Delete selected";
    lines.push(twoColumns(delLabel, "Esc) Back", 32));
  }
  if (ctx.message !== undefined) {
    lines.push("");
    lines.push(`    ${ctx.message}`);
  }
  return lines;
}

function detailLines(
  title: string,
  ctx: SetupCtx,
  fields: FieldDef[],
  selectedField: number,
  editing: TextInput | undefined,
  error: string | undefined,
  helpEditing: string,
  maskedEditing: boolean,
): string[] {
  const lines: string[] = [];
  lines.push(centered(title, ctx.cols));
  lines.push("");
  lines.push(hline(ctx.cols));
  lines.push("");
  fields.forEach((field, i) => {
    const highlight = i === selectedField;
    const marker = highlight && editing === undefined ? ">" : " ";
    let valueDisplay: string;
    if (editing !== undefined && i === selectedField) {
      if (field.masked && maskedEditing) {
        const visible = editing.buffer === "" ? "(empty)" : editing.buffer;
        valueDisplay = `${"*".repeat(Math.min([...visible].length, 16))} (editing...)`;
      } else {
        valueDisplay = editing.buffer;
      }
    } else if (field.masked && field.value !== "") {
      valueDisplay = maskedKey(field.value);
    } else if (field.value === "") {
      valueDisplay = "(not set)";
    } else {
      valueDisplay = field.value;
    }
    const editableMarker = field.editable ? "" : " (read-only)";
    lines.push(`    ${marker} ${field.label.padEnd(20, " ")}  ${valueDisplay}${editableMarker}`);
  });
  lines.push("");
  lines.push(hline(ctx.cols));
  lines.push("");
  lines.push(
    editing !== undefined
      ? `    ${helpEditing}`
      : "    [Up/Down] Select field  [Enter] Edit  [S] Save  [Esc] Back",
  );
  if (error !== undefined) {
    lines.push("");
    lines.push(`    ${error}`);
  }
  return lines;
}

function renderProviderDetailLines(ctx: SetupCtx): string[] {
  if (ctx.screen.kind !== "providerDetail") return [];
  const s = ctx.screen;
  const title = s.isNew ? "ADD PROVIDER" : `EDIT PROVIDER: ${s.name}`;
  return detailLines(
    title,
    ctx,
    s.fields,
    s.selectedField,
    s.editing,
    s.error,
    "[Enter] Confirm  [Esc] Cancel  [Tab] Toggle mask",
    true,
  );
}

function renderManageModelsLines(
  ctx: SetupCtx,
  selected: number,
  confirmDelete: boolean,
): string[] {
  const lines: string[] = [];
  lines.push(centered("MANAGE MODELS", ctx.cols));
  lines.push("");
  lines.push(hline(ctx.cols));
  lines.push("");
  const models = collectModels(ctx.cfg);
  if (models.length === 0) {
    lines.push("    (no quick models defined)");
    lines.push("");
  } else {
    models.forEach(([name, qm], i) => {
      const highlight = i === selected;
      const marker = highlight ? ">" : " ";
      lines.push(
        `    ${marker} ${i + 1}. ${name}    ${qm.provider} / ${qm.model}    $${qm.inputTokenCost.toFixed(4)}/M in  $${qm.outputTokenCost.toFixed(4)}/M out`,
      );
    });
  }
  lines.push("");
  lines.push(hline(ctx.cols));
  lines.push("");
  if (confirmDelete) {
    const selectedName = models[selected]?.[0] ?? "";
    lines.push(`    Delete '${selectedName}'? This cannot be undone. [Y] Yes  [N] No`);
  } else {
    lines.push(twoColumns("    A) Add model", "Enter) View / Edit selected", 32));
    lines.push(twoColumns("    D) Delete selected", "Esc) Back", 32));
  }
  if (ctx.message !== undefined) {
    lines.push("");
    lines.push(`    ${ctx.message}`);
  }
  return lines;
}

function renderModelDetailLines(ctx: SetupCtx): string[] {
  if (ctx.screen.kind !== "modelDetail") return [];
  const s = ctx.screen;
  const title = s.isNew ? "ADD MODEL" : `EDIT MODEL: ${s.name}`;
  return detailLines(
    title,
    ctx,
    s.fields,
    s.selectedField,
    s.editing,
    s.error,
    "[Enter] Confirm  [Esc] Cancel",
    false,
  );
}

/** Write the current screen to the terminal (clear, then lines top-down). */
export function drawSetup(ctx: SetupCtx): void {
  process.stdout.write("\x1b[?25l\x1b[2J\x1b[1;1H");
  const lines = renderSetupLines(ctx);
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
  process.stdout.write("\x1b[?25h");
}

export function makeProviderDetailState(
  isNew: boolean,
  isBuiltin: boolean,
  name: string,
  cfg: SetupConfig,
): Screen {
  const providerType = isBuiltin
    ? name
    : (cfg.customProviders?.[name]?.providerType ?? "");
  const baseUrl = cfg.customProviders?.[name]?.baseUrl ?? "";
  const apiKeyEnv = isBuiltin
    ? providerEnvVar(name)
    : (cfg.customProviders?.[name]?.apiKeyEnv ?? "");
  const apiKeyValue = cfg.apiKeys?.[name] ?? "";
  // Intentionally show the stored config value, not the env var: previously
  // the env value shadowed the file value, so pressing Save without
  // editing would copy the env secret into config.
  const fields: FieldDef[] = [];
  if (!isBuiltin) {
    fields.push({ label: "Name", value: name, editable: isNew, masked: false });
    fields.push({ label: "Provider Type", value: providerType, editable: true, masked: false });
    fields.push({ label: "Base URL", value: baseUrl, editable: true, masked: false });
  }
  fields.push({
    label: isBuiltin ? "API Key Env" : "API Key Env Var",
    value: apiKeyEnv,
    editable: !isBuiltin,
    masked: false,
  });
  fields.push({ label: "API Key Value", value: apiKeyValue, editable: true, masked: true });
  return {
    kind: "providerDetail",
    isNew,
    isBuiltin,
    name,
    fields,
    selectedField: 0,
  };
}

export function makeModelDetailState(
  isNew: boolean,
  name: string,
  cfg: SetupConfig,
): Screen {
  const qm = isNew ? undefined : cfg.quickModels?.[name];
  const fields: FieldDef[] = [
    { label: "Name", value: name, editable: isNew, masked: false },
    { label: "Provider", value: qm?.provider ?? "", editable: true, masked: false },
    { label: "Model ID", value: qm?.model ?? "", editable: true, masked: false },
    {
      label: "Input Cost ($/M)",
      value: qm !== undefined ? String(qm.inputTokenCost) : "0.0",
      editable: true,
      masked: false,
    },
    {
      label: "Output Cost ($/M)",
      value: qm !== undefined ? String(qm.outputTokenCost) : "0.0",
      editable: true,
      masked: false,
    },
    {
      label: "Context Window",
      value: qm?.contextWindow !== undefined ? String(qm.contextWindow) : "",
      editable: true,
      masked: false,
    },
  ];
  return { kind: "modelDetail", isNew, name, fields, selectedField: 0 };
}

export type KeyResult =
  | { kind: "screen"; screen: Screen }
  | { kind: "applyConfig"; screen: Screen; cfg: SetupConfig }
  | { kind: "outcome"; outcome: SetupOutcome; cfg: SetupConfig };

function screenResult(screen: Screen): KeyResult {
  return { kind: "screen", screen };
}

export function handleKey(ctx: SetupCtx, key: KeyEvent): KeyResult {
  // Ctrl-C / Ctrl-D must exit without saving or launching.
  if (
    key.modifiers.control &&
    key.code.kind === "char" &&
    (key.code.char === "c" || key.code.char === "d")
  ) {
    return { kind: "outcome", outcome: SETUP_OUTCOME_QUIT, cfg: cloneSetupConfig(ctx.cfg) };
  }
  switch (ctx.screen.kind) {
    case "mainMenu":
      return handleMainMenuKey(ctx, key);
    case "manageProviders":
      return handleManageProvidersKey(ctx, ctx.screen.selected, ctx.screen.confirmDelete, key);
    case "providerDetail":
      return handleProviderDetailKey(ctx, key);
    case "manageModels":
      return handleManageModelsKey(ctx, ctx.screen.selected, ctx.screen.confirmDelete, key);
    case "modelDetail":
      return handleModelDetailKey(ctx, key);
  }
}

function charOf(key: KeyEvent): string | undefined {
  return key.code.kind === "char" ? key.code.char : undefined;
}

function handleMainMenuKey(ctx: SetupCtx, key: KeyEvent): KeyResult {
  const c = charOf(key)?.toLowerCase();
  switch (c) {
    case "p":
      return screenResult({ kind: "manageProviders", selected: 0, confirmDelete: false });
    case "m":
      return screenResult({ kind: "manageModels", selected: 0, confirmDelete: false });
    case "l":
      return { kind: "outcome", outcome: SETUP_OUTCOME_LAUNCH, cfg: cloneSetupConfig(ctx.cfg) };
    case "a": {
      const newCfg = cloneSetupConfig(ctx.cfg);
      applyAutoconfigure(newCfg);
      return { kind: "outcome", outcome: SETUP_OUTCOME_LAUNCH_AUTOCONFIGURE, cfg: newCfg };
    }
    case "q":
      return { kind: "outcome", outcome: SETUP_OUTCOME_QUIT, cfg: cloneSetupConfig(ctx.cfg) };
    default:
      if (key.code.kind === "esc") {
        return { kind: "outcome", outcome: SETUP_OUTCOME_QUIT, cfg: cloneSetupConfig(ctx.cfg) };
      }
      return screenResult(ctx.screen);
  }
}

function handleManageProvidersKey(
  ctx: SetupCtx,
  selected: number,
  confirmDelete: boolean,
  key: KeyEvent,
): KeyResult {
  const providers = collectProviderNames(ctx.cfg);
  const count = providers.length;
  if (confirmDelete) {
    const c = charOf(key)?.toLowerCase();
    if (c === "y") {
      const newCfg = cloneSetupConfig(ctx.cfg);
      const name = providers[selected];
      if (name !== undefined && !builtinProviderNames().includes(name)) {
        if (newCfg.customProviders !== undefined) delete newCfg.customProviders[name];
        if (newCfg.apiKeys !== undefined) delete newCfg.apiKeys[name];
      }
      const newSelected = Math.min(selected, Math.max(count - 2, 0));
      return {
        kind: "applyConfig",
        screen: { kind: "manageProviders", selected: newSelected, confirmDelete: false },
        cfg: newCfg,
      };
    }
    if (c === "n" || key.code.kind === "esc") {
      return screenResult({ kind: "manageProviders", selected, confirmDelete: false });
    }
    return screenResult(ctx.screen);
  }
  switch (key.code.kind) {
    case "up": {
      const s = selected === 0 ? Math.max(count - 1, 0) : selected - 1;
      return screenResult({ kind: "manageProviders", selected: s, confirmDelete: false });
    }
    case "down": {
      const s = count === 0 ? 0 : Math.min(selected + 1, count - 1);
      return screenResult({ kind: "manageProviders", selected: s, confirmDelete: false });
    }
    case "enter": {
      const name = providers[selected];
      if (name === undefined) return screenResult(ctx.screen);
      const isBuiltin = builtinProviderNames().includes(name);
      return screenResult(makeProviderDetailState(false, isBuiltin, name, ctx.cfg));
    }
    case "esc":
      return screenResult({ kind: "mainMenu" });
    case "char": {
      const c = (key.code.char as string).toLowerCase();
      if (c === "a") {
        return screenResult(makeProviderDetailState(true, false, "", ctx.cfg));
      }
      if (c === "d") {
        const name = providers[selected];
        if (name !== undefined && !builtinProviderNames().includes(name)) {
          return screenResult({ kind: "manageProviders", selected, confirmDelete: true });
        }
        return screenResult(ctx.screen);
      }
      return screenResult(ctx.screen);
    }
    default:
      return screenResult(ctx.screen);
  }
}

function handleProviderDetailKey(ctx: SetupCtx, key: KeyEvent): KeyResult {
  if (ctx.screen.kind !== "providerDetail") return screenResult(ctx.screen);
  const s = ctx.screen;
  const fields = cloneFields(s.fields);
  const makeScreen = (
    f: FieldDef[],
    sf: number,
    ed: TextInput | undefined,
    err: string | undefined,
  ): Screen => ({
    kind: "providerDetail",
    isNew: s.isNew,
    isBuiltin: s.isBuiltin,
    name: s.name,
    fields: f,
    selectedField: sf,
    editing: ed,
    error: err,
  });

  if (s.editing !== undefined) {
    const ed = s.editing;
    switch (key.code.kind) {
      case "enter":
        fields[s.selectedField].value = ed.confirmed();
        return screenResult(makeScreen(fields, s.selectedField, undefined, undefined));
      case "esc":
        fields[s.selectedField].value = ed.original;
        return screenResult(makeScreen(fields, s.selectedField, undefined, undefined));
      case "backspace":
        ed.backspace();
        return screenResult(makeScreen(fields, s.selectedField, ed, undefined));
      case "delete":
        ed.delete();
        return screenResult(makeScreen(fields, s.selectedField, ed, undefined));
      case "left":
        ed.cursorLeft();
        return screenResult(makeScreen(fields, s.selectedField, ed, undefined));
      case "right":
        ed.cursorRight();
        return screenResult(makeScreen(fields, s.selectedField, ed, undefined));
      case "home":
        ed.cursorHome();
        return screenResult(makeScreen(fields, s.selectedField, ed, undefined));
      case "end":
        ed.cursorEnd();
        return screenResult(makeScreen(fields, s.selectedField, ed, undefined));
      case "tab":
        fields[s.selectedField].masked = !fields[s.selectedField].masked;
        return screenResult(makeScreen(fields, s.selectedField, ed, undefined));
      case "char":
        ed.insert(key.code.char as string);
        return screenResult(makeScreen(fields, s.selectedField, ed, undefined));
      default:
        return screenResult(ctx.screen);
    }
  }

  switch (key.code.kind) {
    case "up": {
      const sf = s.selectedField === 0
        ? Math.max(fields.length - 1, 0)
        : s.selectedField - 1;
      return screenResult(makeScreen(fields, sf, undefined, undefined));
    }
    case "down": {
      const sf = fields.length === 0
        ? 0
        : Math.min(s.selectedField + 1, fields.length - 1);
      return screenResult(makeScreen(fields, sf, undefined, undefined));
    }
    case "enter": {
      const field = fields[s.selectedField];
      if (field !== undefined && field.editable) {
        return screenResult(
          makeScreen(fields, s.selectedField, new TextInput(field.value), undefined),
        );
      }
      return screenResult(ctx.screen);
    }
    case "esc":
      return screenResult({ kind: "mainMenu" });
    case "char": {
      const c = (key.code.char as string).toLowerCase();
      if (c !== "s") return screenResult(ctx.screen);
      const newCfg = cloneSetupConfig(ctx.cfg);
      const fieldValue = (label: string): string =>
        fields.find((f) => f.label === label)?.value ?? "";
      const newName = fields.find((f) => f.label === "Name")?.value ?? s.name;
      const newProviderType = fieldValue("Provider Type");
      const newBaseUrl = fieldValue("Base URL");
      const newApiKeyEnv =
        fieldValue("API Key Env Var") !== "" ? fieldValue("API Key Env Var") : fieldValue("API Key Env");
      const newApiKeyValue = fieldValue("API Key Value");

      if (s.isBuiltin) {
        if (newApiKeyValue !== "") {
          newCfg.apiKeys = { ...(newCfg.apiKeys ?? {}), [s.name]: newApiKeyValue };
        } else if (newCfg.apiKeys !== undefined) {
          delete newCfg.apiKeys[s.name];
        }
        return { kind: "applyConfig", screen: { kind: "mainMenu" }, cfg: newCfg };
      }
      if (s.isNew && newName === "") {
        return screenResult(makeScreen(fields, s.selectedField, undefined, "Name is required"));
      }
      if (
        s.isNew &&
        (builtinProviderNames().includes(newName) ||
          (newCfg.customProviders?.[newName] !== undefined))
      ) {
        return screenResult(
          makeScreen(fields, s.selectedField, undefined, `Provider '${newName}' already exists`),
        );
      }
      if (newProviderType === "") {
        return screenResult(makeScreen(fields, s.selectedField, undefined, "Provider Type is required"));
      }
      if (!isValidProviderType(newProviderType)) {
        return screenResult(
          makeScreen(
            fields,
            s.selectedField,
            undefined,
            `Unknown provider type '${newProviderType}' (valid: openrouter, openai, anthropic, gemini, ollama, opencode-zen, opencode-go, custom)`,
          ),
        );
      }
      if (newBaseUrl === "") {
        return screenResult(
          makeScreen(fields, s.selectedField, undefined, "Base URL is required for custom providers"),
        );
      }
      if (!newBaseUrl.startsWith("http://") && !newBaseUrl.startsWith("https://")) {
        return screenResult(
          makeScreen(fields, s.selectedField, undefined, "Base URL must start with http:// or https://"),
        );
      }
      const finalName = s.isNew ? newName : s.name;
      const existing = newCfg.customProviders?.[finalName];
      newCfg.customProviders = {
        ...(newCfg.customProviders ?? {}),
        [finalName]: {
          providerType: newProviderType,
          baseUrl: newBaseUrl,
          apiKeyEnv: newApiKeyEnv === "" ? undefined : newApiKeyEnv,
          dangerAcceptInvalidCerts: existing?.dangerAcceptInvalidCerts,
          apiStyle: existing?.apiStyle,
          headers: existing?.headers ?? {},
          timeoutSecs: existing?.timeoutSecs,
          model: existing?.model,
        },
      };
      if (newApiKeyValue !== "") {
        newCfg.apiKeys = { ...(newCfg.apiKeys ?? {}), [finalName]: newApiKeyValue };
      } else if (newCfg.apiKeys !== undefined) {
        delete newCfg.apiKeys[finalName];
      }
      return { kind: "applyConfig", screen: { kind: "mainMenu" }, cfg: newCfg };
    }
    default:
      return screenResult(ctx.screen);
  }
}

function handleManageModelsKey(
  ctx: SetupCtx,
  selected: number,
  confirmDelete: boolean,
  key: KeyEvent,
): KeyResult {
  const models = collectModels(ctx.cfg);
  const count = models.length;
  if (confirmDelete) {
    const c = charOf(key)?.toLowerCase();
    if (c === "y") {
      const newCfg = cloneSetupConfig(ctx.cfg);
      const name = models[selected]?.[0];
      if (name !== undefined && newCfg.quickModels !== undefined) {
        delete newCfg.quickModels[name];
      }
      const newSelected = Math.min(selected, Math.max(count - 2, 0));
      return {
        kind: "applyConfig",
        screen: { kind: "manageModels", selected: newSelected, confirmDelete: false },
        cfg: newCfg,
      };
    }
    if (c === "n" || key.code.kind === "esc") {
      return screenResult({ kind: "manageModels", selected, confirmDelete: false });
    }
    return screenResult(ctx.screen);
  }
  switch (key.code.kind) {
    case "up": {
      const s = selected === 0 ? Math.max(count - 1, 0) : selected - 1;
      return screenResult({ kind: "manageModels", selected: s, confirmDelete: false });
    }
    case "down": {
      const s = count === 0 ? 0 : Math.min(selected + 1, count - 1);
      return screenResult({ kind: "manageModels", selected: s, confirmDelete: false });
    }
    case "enter": {
      const name = models[selected]?.[0];
      if (name === undefined) return screenResult(ctx.screen);
      return screenResult(makeModelDetailState(false, name, ctx.cfg));
    }
    case "esc":
      return screenResult({ kind: "mainMenu" });
    case "char": {
      const c = (key.code.char as string).toLowerCase();
      if (c === "a") {
        return screenResult(makeModelDetailState(true, "", ctx.cfg));
      }
      if (c === "d" && models[selected] !== undefined) {
        return screenResult({ kind: "manageModels", selected, confirmDelete: true });
      }
      return screenResult(ctx.screen);
    }
    default:
      return screenResult(ctx.screen);
  }
}

function handleModelDetailKey(ctx: SetupCtx, key: KeyEvent): KeyResult {
  if (ctx.screen.kind !== "modelDetail") return screenResult(ctx.screen);
  const s = ctx.screen;
  const fields = cloneFields(s.fields);
  const makeScreen = (
    f: FieldDef[],
    sf: number,
    ed: TextInput | undefined,
    err: string | undefined,
  ): Screen => ({
    kind: "modelDetail",
    isNew: s.isNew,
    name: s.name,
    fields: f,
    selectedField: sf,
    editing: ed,
    error: err,
  });

  if (s.editing !== undefined) {
    const ed = s.editing;
    switch (key.code.kind) {
      case "enter":
        fields[s.selectedField].value = ed.confirmed();
        return screenResult(makeScreen(fields, s.selectedField, undefined, undefined));
      case "esc":
        fields[s.selectedField].value = ed.original;
        return screenResult(makeScreen(fields, s.selectedField, undefined, undefined));
      case "backspace":
        ed.backspace();
        return screenResult(makeScreen(fields, s.selectedField, ed, undefined));
      case "delete":
        ed.delete();
        return screenResult(makeScreen(fields, s.selectedField, ed, undefined));
      case "left":
        ed.cursorLeft();
        return screenResult(makeScreen(fields, s.selectedField, ed, undefined));
      case "right":
        ed.cursorRight();
        return screenResult(makeScreen(fields, s.selectedField, ed, undefined));
      case "home":
        ed.cursorHome();
        return screenResult(makeScreen(fields, s.selectedField, ed, undefined));
      case "end":
        ed.cursorEnd();
        return screenResult(makeScreen(fields, s.selectedField, ed, undefined));
      case "char":
        ed.insert(key.code.char as string);
        return screenResult(makeScreen(fields, s.selectedField, ed, undefined));
      default:
        return screenResult(ctx.screen);
    }
  }

  switch (key.code.kind) {
    case "up": {
      const sf = s.selectedField === 0
        ? Math.max(fields.length - 1, 0)
        : s.selectedField - 1;
      return screenResult(makeScreen(fields, sf, undefined, undefined));
    }
    case "down": {
      const sf = fields.length === 0
        ? 0
        : Math.min(s.selectedField + 1, fields.length - 1);
      return screenResult(makeScreen(fields, sf, undefined, undefined));
    }
    case "enter": {
      const field = fields[s.selectedField];
      if (field !== undefined && field.editable) {
        return screenResult(
          makeScreen(fields, s.selectedField, new TextInput(field.value), undefined),
        );
      }
      return screenResult(ctx.screen);
    }
    case "esc":
      return screenResult({ kind: "mainMenu" });
    case "char": {
      const c = (key.code.char as string).toLowerCase();
      if (c !== "s") return screenResult(ctx.screen);
      const fieldValue = (label: string): string =>
        fields.find((f) => f.label === label)?.value.trim() ?? "";
      const newName = fields.find((f) => f.label === "Name")?.value ?? "";
      const newProvider = fieldValue("Provider");
      const newModelId = fieldValue("Model ID");
      const newInputCostRaw = fieldValue("Input Cost ($/M)");
      const newOutputCostRaw = fieldValue("Output Cost ($/M)");
      const newContextWindowRaw = fieldValue("Context Window");
      const parseCost = (label: string, raw: string): number => {
        if (raw === "") return 0;
        const v = Number(raw);
        if (!Number.isFinite(v) || v < 0) {
          throw new Error(`${label} must be a non-negative number`);
        }
        return v;
      };
      let newInputCost: number;
      let newOutputCost: number;
      try {
        newInputCost = parseCost("Input Cost ($/M)", newInputCostRaw);
        newOutputCost = parseCost("Output Cost ($/M)", newOutputCostRaw);
      } catch (e) {
        return screenResult(
          makeScreen(fields, s.selectedField, undefined, e instanceof Error ? e.message : String(e)),
        );
      }
      let newContextWindow: number | undefined;
      if (newContextWindowRaw !== "") {
        const v = Number(newContextWindowRaw);
        if (!Number.isInteger(v) || v < 0) {
          return screenResult(
            makeScreen(fields, s.selectedField, undefined, "Context Window must be a positive integer"),
          );
        }
        newContextWindow = v;
      }
      if (newName === "") {
        return screenResult(makeScreen(fields, s.selectedField, undefined, "Name is required"));
      }
      if (newProvider === "") {
        return screenResult(makeScreen(fields, s.selectedField, undefined, "Provider is required"));
      }
      if (newModelId === "") {
        return screenResult(makeScreen(fields, s.selectedField, undefined, "Model ID is required"));
      }
      if (!collectProviderNames(ctx.cfg).includes(newProvider)) {
        return screenResult(
          makeScreen(fields, s.selectedField, undefined, `Unknown provider '${newProvider}'`),
        );
      }
      if (newName !== s.name && ctx.cfg.quickModels?.[newName] !== undefined) {
        return screenResult(
          makeScreen(fields, s.selectedField, undefined, `Model '${newName}' already exists`),
        );
      }
      const newCfg = cloneSetupConfig(ctx.cfg);
      if (newName !== s.name && newCfg.quickModels !== undefined) {
        delete newCfg.quickModels[s.name];
      }
      const existing = newCfg.quickModels?.[s.name];
      newCfg.quickModels = {
        ...(newCfg.quickModels ?? {}),
        [newName]: {
          provider: newProvider,
          model: newModelId,
          inputTokenCost: newInputCost,
          outputTokenCost: newOutputCost,
          reserveTokens: existing?.reserveTokens,
          temperature: existing?.temperature,
          extraBody: existing?.extraBody,
          contextWindow: newContextWindow,
        },
      };
      if (s.isNew && s.name !== newName) {
        return {
          kind: "applyConfig",
          screen: { kind: "manageModels", selected: 0, confirmDelete: false },
          cfg: newCfg,
        };
      }
      return { kind: "applyConfig", screen: { kind: "mainMenu" }, cfg: newCfg };
    }
    default:
      return screenResult(ctx.screen);
  }
}

export function applyAutoconfigure(cfg: SetupConfig): void {
  const providersToCheck: Array<[string, string]> = [
    ["openai", "OPENAI_API_KEY"],
    ["anthropic", "ANTHROPIC_API_KEY"],
    ["gemini", "GEMINI_API_KEY"],
    ["openrouter", "OPENROUTER_API_KEY"],
    ["opencode-zen", "OPENCODE_API_KEY"],
    ["opencode-go", "OPENCODE_API_KEY"],
  ];
  for (const [provider, envVar] of providersToCheck) {
    const val = process.env[envVar];
    if (val !== undefined && val !== "") {
      cfg.apiKeys = cfg.apiKeys ?? {};
      if (cfg.apiKeys[provider] === undefined) cfg.apiKeys[provider] = val;
    }
  }
}

/**
 * Parse raw stdin bytes into key events. Incomplete escape sequences at
 * the end of a chunk are returned as leftover bytes for the next chunk.
 */
export function parseSetupKeys(data: Buffer): { keys: KeyEvent[]; leftover: Buffer<ArrayBufferLike> } {
  const keys: KeyEvent[] = [];
  let i = 0;
  while (i < data.length) {
    const b = data[i];
    if (b === 0x1b) {
      if (i + 1 >= data.length) break; // lone ESC, wait for more bytes
      if (data[i + 1] === 0x5b) {
        // CSI sequence
        if (i + 2 >= data.length) break;
        const third = data[i + 2];
        if (third === 0x41) { keys.push(plainKey("up")); i += 3; continue; }
        if (third === 0x42) { keys.push(plainKey("down")); i += 3; continue; }
        if (third === 0x43) { keys.push(plainKey("right")); i += 3; continue; }
        if (third === 0x44) { keys.push(plainKey("left")); i += 3; continue; }
        if (third === 0x48) { keys.push(plainKey("home")); i += 3; continue; }
        if (third === 0x46) { keys.push(plainKey("end")); i += 3; continue; }
        if (third === 0x5a) { keys.push(plainKey("backtab", { shift: true })); i += 3; continue; }
        if (third === 0x33) {
          if (i + 3 >= data.length) break;
          if (data[i + 3] === 0x7e) { keys.push(plainKey("delete")); i += 4; continue; }
        }
        // Unknown CSI: consume through the final byte.
        let j = i + 2;
        while (j < data.length && !(data[j] >= 0x40 && data[j] <= 0x7e)) j += 1;
        i = Math.min(j + 1, data.length);
        continue;
      }
      keys.push(plainKey("esc"));
      i += 1;
      continue;
    }
    if (b === 0x0d || b === 0x0a) { keys.push(plainKey("enter")); i += 1; continue; }
    if (b === 0x7f) { keys.push(plainKey("backspace")); i += 1; continue; }
    if (b === 0x09) { keys.push(plainKey("tab")); i += 1; continue; }
    if (b === 0x03) { keys.push(charKey("c", { control: true })); i += 1; continue; }
    if (b === 0x04) { keys.push(charKey("d", { control: true })); i += 1; continue; }
    if (b < 0x20) {
      // Other control characters: Ctrl+letter.
      const letter = String.fromCharCode(b + 0x60);
      keys.push(charKey(letter, { control: true }));
      i += 1;
      continue;
    }
    // Decode one UTF-8 character.
    const slice = data.subarray(i);
    const text = slice.toString("utf8");
    const ch = [...text][0] ?? "";
    const len = Buffer.byteLength(ch);
    keys.push(charKey(ch));
    i += len;
  }
  return { keys, leftover: data.subarray(i) };
}

/**
 * Run the wizard. `cfg` is mutated in place with the final configuration
 * (as in the original, which takes &mut Config); `saveConfig`, when
 * supplied, is called whenever a change is applied and once on exit, and
 * is the config slice's persistence hook. Without it, edits live only in
 * memory for this process.
 */
export async function run(
  cfg: SetupConfig,
  saveConfig?: (cfg: SetupConfig) => void,
): Promise<SetupOutcome> {
  const stdin = process.stdin as unknown as {
    setRawMode?: (mode: boolean) => void;
    isTTY?: boolean;
    on?: (event: string, fn: (data: Buffer) => void) => void;
    removeAllListeners?: (event: string) => void;
    pause?: () => void;
  };
  const ctx: SetupCtx = {
    cfg: cloneSetupConfig(cfg),
    screen: { kind: "mainMenu" },
    cols: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  };
  const applyCfg = (next: SetupConfig): void => {
    const keys = Object.keys(ctx.cfg);
    for (const k of keys) delete (ctx.cfg as Record<string, unknown>)[k];
    Object.assign(ctx.cfg, next);
    const outKeys = Object.keys(cfg);
    for (const k of outKeys) delete (cfg as Record<string, unknown>)[k];
    Object.assign(cfg, cloneSetupConfig(next));
    saveConfig?.(cloneSetupConfig(next));
  };

  if (stdin.isTTY && typeof stdin.setRawMode === "function") {
    try {
      stdin.setRawMode(true);
    } catch {
      // Not a TTY after all; proceed without raw mode.
    }
  }
  let leftover: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let resolveOutcome: ((outcome: SetupOutcome) => void) | undefined;
  const onData = (chunk: Buffer): void => {
    const data = Buffer.concat([leftover, chunk]);
    const parsed = parseSetupKeys(data);
    leftover = parsed.leftover;
    for (const key of parsed.keys) {
      const result = handleKey(ctx, key);
      if (result.kind === "screen") {
        ctx.screen = result.screen;
        ctx.message = undefined;
      } else if (result.kind === "applyConfig") {
        applyCfg(result.cfg);
        ctx.screen = result.screen;
        ctx.message = "Saved";
      } else {
        applyCfg(result.cfg);
        resolveOutcome?.(result.outcome);
        return;
      }
    }
    drawSetup(ctx);
  };
  const onResize = (): void => {
    ctx.cols = process.stdout.columns ?? 80;
    ctx.rows = process.stdout.rows ?? 24;
    drawSetup(ctx);
  };
  try {
    drawSetup(ctx);
    process.stdin.on("data", onData);
    process.stdout.on("resize", onResize);
    const outcome = await new Promise<SetupOutcome>((resolve) => {
      resolveOutcome = resolve;
    });
    return outcome;
  } finally {
    process.stdin.off("data", onData);
    process.stdout.off("resize", onResize);
    try {
      if (stdin.isTTY && typeof stdin.setRawMode === "function") stdin.setRawMode(false);
    } catch {
      // Ignore restore failures.
    }
    process.stdout.write("\x1b[2J\x1b[1;1H\x1b[?25h");
    stdin.pause?.();
  }
}

export { makeKeyEvent };
