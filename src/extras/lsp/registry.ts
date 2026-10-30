// Built-in language-server defaults and resolution against user
// [lsp.servers] config. Servers are PATH binaries only — nothing is
// auto-installed; a missing binary is skipped at spawn time.

/** Local mirror of the config slice's LspServerConfig. */
export interface LspServerConfig {
  command: string;
  args: string[];
  extensions: string[];
  env: Record<string, string>;
  initialization?: unknown | null;
  disabled: boolean;
}

function server(command: string, args: string[], extensions: string[]): LspServerConfig {
  return { command, args, extensions, env: {}, initialization: null, disabled: false };
}

/** Defaults applied when [lsp] is enabled. Each is used only if its binary
 *  is found on PATH at spawn time. */
export function builtinServers(): Array<[string, LspServerConfig]> {
  return [
    ["rust", server("rust-analyzer", [], [".rs"])],
    ["go", server("gopls", [], [".go"])],
    [
      "typescript",
      server("typescript-language-server", ["--stdio"], [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]),
    ],
    ["python", server("pyright-langserver", ["--stdio"], [".py", ".pyi"])],
    [
      "clangd",
      server("clangd", [], [".c", ".h", ".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"]),
    ],
    ["bash", server("bash-language-server", ["start"], [".sh", ".bash", ".zsh"])],
    ["lua", server("lua-language-server", [], [".lua"])],
  ];
}

/** Merges user config over the built-ins: a same-named entry replaces the
 *  built-in, disabled = true removes it, new names add custom servers.
 *  Entries without a command are dropped (they can only ever disable). */
export function resolveServers(
  user: Map<string, LspServerConfig> | Record<string, LspServerConfig>,
): Array<[string, LspServerConfig]> {
  const servers = new Map<string, LspServerConfig>(builtinServers());
  const entries: Array<[string, LspServerConfig]> =
    user instanceof Map ? [...user.entries()] : Object.entries(user);
  for (const [name, cfg] of entries) {
    if (cfg.disabled || cfg.command.length === 0) {
      servers.delete(name);
    } else {
      servers.set(name, cfg);
    }
  }
  return [...servers.entries()];
}

/** First server claiming this path's extension (case-insensitive, dot
 *  included in configured extensions). */
export function serverForPath(
  servers: Array<[string, LspServerConfig]>,
  path: string,
): [string, LspServerConfig] | null {
  const base = path.split(/[\\/]/).pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = `.${base.slice(dot + 1).toLowerCase()}`;
  for (const entry of servers) {
    if (entry[1].extensions.some((e) => e === ext)) return entry;
  }
  return null;
}
