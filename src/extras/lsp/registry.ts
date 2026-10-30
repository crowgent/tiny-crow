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
