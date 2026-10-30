export const Action = {
  Allow: "allow",
  Ask: "ask",
  Deny: "deny",
} as const;
export type Action = (typeof Action)[keyof typeof Action];

export function actionFromString(s: string): Action | null {
  switch (s) {
    case "allow":
      return Action.Allow;
    case "ask":
      return Action.Ask;
    case "deny":
      return Action.Deny;
    default:
      return null;
  }
}

export type ToolPerm =
  | { kind: "simple"; action: Action }
  | { kind: "granular"; rules: Map<string, Action> };

function parseToolPerm(raw: unknown): ToolPerm | null {
  if (typeof raw === "string") {
    const action = actionFromString(raw);
    return action === null ? null : { kind: "simple", action };
  }
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const rules = new Map<string, Action>();
    for (const [pattern, actionRaw] of Object.entries(raw as Record<string, unknown>)) {
      const action = typeof actionRaw === "string" ? actionFromString(actionRaw) : null;
      if (action !== null) rules.set(pattern, action);
    }
    return { kind: "granular", rules };
  }
  return null;
}

function parseActionMap(raw: unknown): Map<string, Action> | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const map = new Map<string, Action>();
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const action = typeof value === "string" ? actionFromString(value) : null;
    if (action !== null) map.set(key, action);
  }
  return map;
}

function parseStringListMap(raw: unknown): Map<string, string[]> | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const map = new Map<string, string[]>();
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      map.set(key, [...value]);
    }
  }
  return map;
}

export interface PermissionConfig {
  default?: Action;
  bash?: ToolPerm;
  read?: ToolPerm;
  write?: ToolPerm;
  edit?: ToolPerm;
  grep?: ToolPerm;
  findFiles?: ToolPerm;
  listDir?: ToolPerm;
  todoWrite?: ToolPerm;
  mcpTool?: ToolPerm;
  externalDirectory?: Map<string, Action>;
  doomLoop?: Action;
  allowEntries?: Map<string, string[]>;
  askEntries?: Map<string, string[]>;
  denyEntries?: Map<string, string[]>;
}

const TOOL_FIELDS: Array<[string, keyof PermissionConfig]> = [
  ["bash", "bash"],
  ["read", "read"],
  ["write", "write"],
  ["edit", "edit"],
  ["grep", "grep"],
  ["find_files", "findFiles"],
  ["list_dir", "listDir"],
  ["write_todo_list", "todoWrite"],
  ["todo_write", "todoWrite"],
  ["mcp_tool", "mcpTool"],
];

/** Parses a permission config object (as read from settings JSON). Unknown or malformed entries are skipped. */
export function parsePermissionConfig(raw: unknown): PermissionConfig {
  const config: PermissionConfig = {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return config;
  const obj = raw as Record<string, unknown>;
  const def = typeof obj["*"] === "string" ? actionFromString(obj["*"]) : null;
  if (def !== null) config.default = def;
  for (const [jsonKey, field] of TOOL_FIELDS) {
    const perm = parseToolPerm(obj[jsonKey]);
    if (perm !== null) (config as Record<string, unknown>)[field] = perm;
  }
  const ext = parseActionMap(obj["external_directory"]);
  if (ext !== null) config.externalDirectory = ext;
  const doom = typeof obj["doom_loop"] === "string" ? actionFromString(obj["doom_loop"]) : null;
  if (doom !== null) config.doomLoop = doom;
  for (const [jsonKey, field] of [
    ["allow_entries", "allowEntries"],
    ["ask_entries", "askEntries"],
    ["deny_entries", "denyEntries"],
  ] as const) {
    const entries = parseStringListMap(obj[jsonKey]);
    if (entries !== null) (config as Record<string, unknown>)[field] = entries;
  }
  return config;
}

export interface PermissionConfigs {
  glob: PermissionConfig;
  regex: PermissionConfig;
}

export function permissionConfigsFromGlob(glob: PermissionConfig): PermissionConfigs {
  return { glob, regex: {} };
}

export const SecurityMode = {
  Standard: "standard",
  Restrictive: "restrictive",
  ReadOnly: "readonly",
  PlanWrite: "planwrite",
  Guarded: "guarded",
  Yolo: "yolo",
} as const;
export type SecurityMode = (typeof SecurityMode)[keyof typeof SecurityMode];

export function securityModeFromString(s: string): SecurityMode | null {
  switch (s) {
    case "standard":
      return SecurityMode.Standard;
    case "restrictive":
      return SecurityMode.Restrictive;
    case "readonly":
      return SecurityMode.ReadOnly;
    case "planwrite":
      return SecurityMode.PlanWrite;
    case "guarded":
      return SecurityMode.Guarded;
    case "yolo":
      return SecurityMode.Yolo;
    default:
      return null;
  }
}

export function securityModeToString(mode: SecurityMode): string {
  return mode;
}

/**
 * Parses a `%%mode=X` directive from the first line of a prompt file.
 * Returns the mode string if found, plus the content with the directive line stripped.
 */
export function parsePromptMode(content: string): [string | null, string] {
  const firstLineEnd = content.indexOf("\n");
  const first = firstLineEnd === -1 ? content : content.slice(0, firstLineEnd);
  const trimmed = first.trim();
  if (!trimmed.startsWith("%%mode=")) return [null, content];
  const modeStr = trimmed.slice("%%mode=".length).trim();
  if (modeStr === "") return [null, content];
  const rest = firstLineEnd === -1 ? "" : content.slice(firstLineEnd + 1);
  return [modeStr, rest];
}

/**
 * Resolves the security mode requested by a prompt's `%%mode=` directive.
 * Returns null when the prompt is unknown, has no directive, names an
 * unknown mode, or uses `last_user_mode` (meaningless at startup).
 */
export function resolveStartupPromptMode(
  prompts: Map<string, string>,
  name: string,
): SecurityMode | null {
  const content = prompts.get(name);
  if (content === undefined) return null;
  const [directive] = parsePromptMode(content);
  if (directive === null || directive === "last_user_mode") return null;
  return securityModeFromString(directive);
}

/** Auto-deny regex patterns always active regardless of config, appended last so they take precedence. */
export function defaultDenyRegexRules(): Array<[string, string]> {
  return [["bash", String.raw`^rm\s+.*\*`]];
}

export function defaultBashRules(): Array<[string, Action]> {
  const allow = (p: string): [string, Action] => [p, Action.Allow];
  const deny = (p: string): [string, Action] => [p, Action.Deny];
  const ask = (p: string): [string, Action] => [p, Action.Ask];
  const gitRead = (sub: string): Array<[string, Action]> => [allow(`git ${sub}`), allow(`git ${sub} **`)];
  return [
    allow("ls **"),
    allow("cd **"),
    allow("pwd"),
    allow("echo **"),
    allow("which **"),
    allow("type **"),
    allow("cat **"),
    allow("head **"),
    allow("tail **"),
    allow("wc **"),
    allow("sort **"),
    allow("uniq **"),
    allow("cut **"),
    allow("diff **"),
    allow("grep **"),
    allow("rg **"),
    allow("find **"),
    allow("fd **"),
    allow("fdfind **"),
    ...gitRead("status"),
    ...gitRead("log"),
    ...gitRead("diff"),
    ...gitRead("show"),
    ...gitRead("branch"),
    allow("git ls-files"),
    allow("git ls-files **"),
    ...gitRead("remote"),
    ...gitRead("rev-parse"),
    ...gitRead("ls-tree"),
    ...gitRead("ls-remote"),
    ...gitRead("cat-file"),
    ...gitRead("blame"),
    ...gitRead("reflog"),
    ...gitRead("tag"),
    allow("git stash list"),
    allow("git stash list **"),
    allow("git config --get"),
    allow("git config --get **"),
    allow("cargo check"),
    allow("cargo build"),
    allow("cargo test"),
    allow("cargo fmt"),
    allow("cargo clippy"),
    allow("cargo install **"),
    allow("mkdir **"),
    allow("touch **"),
    allow("cp **"),
    allow("npm run **"),
    allow("pixi run **"),
    allow("pip list"),
    allow("pip show **"),
    deny("darcs **--diff-command**"),
    deny("darcs **--prehook**"),
    deny("darcs **--posthook**"),
    allow("darcs annotate **"),
    allow("darcs diff"),
    allow("darcs diff **"),
    allow("darcs log"),
    allow("darcs log **"),
    allow("darcs test"),
    allow("darcs test **"),
    allow("darcs show **"),
    allow("darcs whatsnew"),
    allow("darcs whatsnew **"),
    allow("pijul diff**"),
    allow("pijul log**"),
    allow("pijul change**"),
    allow("pijul credit**"),
    allow("pijul list**"),
    allow("pijul ls**"),
    allow("pijul channel"),
    allow("pijul remote"),
    allow("pijul channel -**"),
    allow("pijul remote -**"),
    deny("pijul record**"),
    deny("pijul hooks**"),
    deny("pijul channel switch**"),
    deny("pijul channel new**"),
    deny("pijul channel rename**"),
    deny("pijul channel delete**"),
    deny("pijul remote delete**"),
    ask("sudo"),
    ask("sudo **"),
    deny("rm -rf /**"),
    deny("sudo rm -rf /**"),
    deny("dd **"),
    deny("mkfs **"),
    deny("fdisk **"),
    deny("mkswap **"),
    deny("editor **"),
    deny("vim **"),
    deny("vi **"),
    deny("nano **"),
  ];
}
