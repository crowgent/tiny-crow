// Configure Neovim with CodeCompanion.nvim + tiny-crow ACP.
//
// Usage:
//   node scripts/setup-neovim.ts
//
//   # Skip the tiny-crow install check:
//   node scripts/setup-neovim.ts --skip-tiny-crow
//
// Steps, mirroring the original shell setup:
//   1. Require neovim >= 0.9 and git on PATH.
//   2. Unless skipped, require a tiny-crow command whose --help lists
//      --acp (warn, don't fail, when the command exists without ACP).
//   3. Create the neovim config dirs.
//   4. Bootstrap lazy.nvim: if no lazy-lock.json exists, warn when an
//      init.lua already exists, otherwise write a fresh init.lua that
//      bootstraps lazy.nvim and binds the CodeCompanion keys.
//   5. Write lua/plugins/codecompanion.lua (interactive overwrite prompt
//      when it already exists; hard error when stdin is not a terminal).
// Requires: Node >= 24, neovim, git. No extra dependencies.
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import * as readline from "node:readline";

export const REQUIRED_NVIM = "0.9";
export const AGENT_COMMAND = "tiny-crow";

export interface SetupArgs {
  skipTinyCrow: boolean;
  help: boolean;
}

export function parseSetupArgs(argv: string[]): SetupArgs {
  let skipTinyCrow = false;
  let help = false;
  for (const arg of argv) {
    if (arg === "--skip-tiny-crow") skipTinyCrow = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return { skipTinyCrow, help };
}

export function printSetupHelp(): void {
  console.log(
    "Usage: node scripts/setup-neovim.ts [--skip-tiny-crow]\n" +
      "\n" +
      "Options:\n" +
      "  --skip-tiny-crow   Skip the tiny-crow installation check\n" +
      "  --help, -h         Show this message",
  );
}

/** Compare dotted numeric versions: negative when a < b, 0 when equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function isVersionAtLeast(found: string, required: string): boolean {
  return compareVersions(found, required) >= 0;
}

export function resolveNvimConfigDir(env: NodeJS.ProcessEnv): string {
  const base = env["XDG_CONFIG_HOME"] ?? path.join(os.homedir(), ".config");
  return path.join(base, "nvim");
}

export function commandExists(command: string): boolean {
  if (command.includes(path.sep)) {
    try {
      accessSync(command, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  const pathVar = process.env["PATH"] ?? "";
  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir) continue;
    try {
      accessSync(path.join(dir, command), constants.X_OK);
      return true;
    } catch {
      // Not in this dir; keep searching.
    }
  }
  return false;
}

export function parseNvimVersion(output: string): string {
  const firstLine = output.split("\n")[0] ?? "";
  const match = firstLine.match(/[0-9]+\.[0-9]+/);
  return match ? match[0] : "0.0";
}

export function getNvimVersion(): string {
  const output = execFileSync("nvim", ["--version"], { encoding: "utf-8" });
  return parseNvimVersion(output);
}

export const INIT_LUA_CONTENT = `-- Bootstrap lazy.nvim
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not (vim.uv or vim.loop).fs_stat(lazypath) then
    vim.fn.system({
        "git",
        "clone",
        "--filter=blob:none",
        "--branch=stable",
        "https://github.com/folke/lazy.nvim.git",
        lazypath,
    })
end
vim.opt.rtp:prepend(lazypath)

require("lazy").setup("plugins")

-- CodeCompanion keymaps
vim.api.nvim_set_keymap("n", "<leader>cc", ":CodeCompanionChat<CR>", { noremap = true, silent = true, desc = "Chat" })
vim.api.nvim_set_keymap("v", "<leader>cc", ":CodeCompanionChat<CR>", { noremap = true, silent = true, desc = "Chat" })
vim.api.nvim_set_keymap("n", "<leader>ca", ":CodeCompanionActions<CR>", { noremap = true, silent = true, desc = "Actions" })
vim.api.nvim_set_keymap("v", "<leader>ca", ":CodeCompanionActions<CR>", { noremap = true, silent = true, desc = "Actions" })
`;

export const CODECOMPANION_CONTENT = `return {
    "olimorris/codecompanion.nvim",
    dependencies = {
        "nvim-lua/plenary.nvim",
        "nvim-treesitter/nvim-treesitter",
    },
    config = function()
        require("codecompanion").setup({
            adapters = {
                acp = {
                    opts = {
                        show_presets = false,
                    },
                    tiny_crow = function()
                        return {
                            name = "tiny-crow",
                            formatted_name = "Tiny Crow",
                            type = "acp",
                            roles = {
                                llm = "assistant",
                                user = "user",
                            },
                            opts = {
                                vision = false,
                            },
                            commands = {
                                default = {
                                    "tiny-crow",
                                    "--acp",
                                },
                            },
                            defaults = {
                                mcpServers = {},
                                timeout = 60000,
                            },
                            parameters = {
                                protocolVersion = 1,
                                clientCapabilities = {
                                    fs = { readTextFile = true, writeTextFile = true },
                                },
                                clientInfo = {
                                    name = "CodeCompanion.nvim",
                                    version = "1.0.0",
                                },
                            },
                            handlers = {
                                setup = function(self)
                                    return true
                                end,
                                auth = function(self)
                                    return true
                                end,
                                form_messages = function(self, messages, capabilities)
                                    return require("codecompanion.adapters.acp.helpers")
                                        .form_messages(self, messages, capabilities)
                                end,
                                on_exit = function(self, code) end,
                            },
                        }
                    end,
                },
            },
            interactions = {
                chat = {
                    adapter = "tiny-crow",
                },
            },
            display = {
                chat = {
                    show_header_separator = false,
                },
            },
        })
    end,
}
`;

export function checkAgentCommand(): void {
  if (commandExists(AGENT_COMMAND)) {
    console.log(`Found ${AGENT_COMMAND}`);
    const help = execFileSync(AGENT_COMMAND, ["--help"], {
      encoding: "utf-8",
    });
    if (!help.includes("--acp")) {
      console.error(
        `WARNING: This ${AGENT_COMMAND} build does not include ACP support.`,
      );
      console.error(
        `  Install a build with ACP support, or run with --skip-tiny-crow.`,
      );
    }
  } else {
    console.error(`${AGENT_COMMAND} not found in PATH.`);
    console.error(
      `  Install this project first (see README: link src/main.ts into a`,
    );
    console.error(`  directory on PATH, e.g. ~/.local/bin), or run with`);
    console.error(`  --skip-tiny-crow to skip this check.`);
    throw new Error(`${AGENT_COMMAND} not found in PATH`);
  }
}

async function askOverwrite(file: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(`${file} already exists. Overwrite? [y/N] `, resolve);
    });
    return /^[Yy]$/.test(answer.trim());
  } finally {
    rl.close();
  }
}

export async function runSetupNeovim(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const args = parseSetupArgs(argv);
  if (args.help) {
    printSetupHelp();
    return;
  }

  const nvimConfigDir = resolveNvimConfigDir(env);
  const lazyPath = path.join(nvimConfigDir, "lazy-lock.json");
  const ccDir = path.join(nvimConfigDir, "lua", "plugins");
  const ccFile = path.join(ccDir, "codecompanion.lua");
  const initFile = path.join(nvimConfigDir, "init.lua");

  console.log("=== tiny-crow + Neovim ACP Setup ===");

  // 1. Check neovim.
  if (!commandExists("nvim")) {
    throw new Error(
      "neovim not found. Install it first:\n  https://github.com/neovim/neovim/blob/master/INSTALL.md",
    );
  }
  const nvimVersion = getNvimVersion();
  console.log(`Found neovim ${nvimVersion}`);
  if (!isVersionAtLeast(nvimVersion, REQUIRED_NVIM)) {
    throw new Error(
      `neovim >= ${REQUIRED_NVIM} required, found ${nvimVersion}`,
    );
  }

  // 2. Check git.
  if (!commandExists("git")) {
    throw new Error("git not found. lazy.nvim bootstrap requires git.");
  }

  // 3. Check the agent command.
  if (!args.skipTinyCrow) {
    checkAgentCommand();
  }

  // 4. Create neovim config directories.
  mkdirSync(nvimConfigDir, { recursive: true });
  mkdirSync(ccDir, { recursive: true });

  // 5. Bootstrap lazy.nvim if not present.
  if (!existsSync(lazyPath)) {
    if (existsSync(initFile)) {
      console.error(`WARNING: ${initFile} already exists, but lazy.nvim is not`);
      console.error(`  configured (no lazy-lock.json found).`);
      console.error(`  Add the following to your init.lua to bootstrap lazy.nvim:`);
      console.error("");
      console.error(`    local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"`);
      console.error(`    if not (vim.uv or vim.loop).fs_stat(lazypath) then`);
      console.error(`        vim.fn.system({`);
      console.error(`            "git", "clone", "--filter=blob:none", "--branch=stable",`);
      console.error(`            "https://github.com/folke/lazy.nvim.git", lazypath,`);
      console.error(`        })`);
      console.error(`    end`);
      console.error(`    vim.opt.rtp:prepend(lazypath)`);
      console.error(`    require("lazy").setup("plugins")`);
      console.error("");
    } else {
      console.log("Bootstrapping lazy.nvim...");
      writeFileSync(initFile, INIT_LUA_CONTENT);
    }
  } else {
    console.log("lazy.nvim already bootstrapped.");
  }

  // 6. Write the codecompanion.nvim plugin spec.
  if (existsSync(ccFile)) {
    if (process.stdin.isTTY) {
      const overwrite = await askOverwrite(ccFile);
      if (!overwrite) {
        console.log("Skipping codecompanion.nvim config.");
        return;
      }
    } else {
      throw new Error(
        `${ccFile} already exists.\n  Re-run interactively to overwrite, or remove it first.`,
      );
    }
  }
  writeFileSync(ccFile, CODECOMPANION_CONTENT);

  console.log("");
  console.log("=== Setup complete ===");
  console.log("");
  if (existsSync(initFile)) {
    console.log(`  ${initFile}`);
  }
  console.log(`  ${ccFile}`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Launch neovim and let lazy.nvim install plugins");
  console.log("  2. Open a chat with: <leader>cc (default: \\cc)");
  console.log("  3. Select the 'tiny-crow' adapter in the chat buffer");
  console.log("");
  console.log("Ensure tiny-crow is installed with ACP support.");
  console.log("");
  console.log("You also need a provider configured (API keys, model, etc.).");
  console.log("See: tiny-crow --help");
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("/setup-neovim.ts") ||
    process.argv[1].endsWith("\\setup-neovim.ts"));
if (isMain) {
  runSetupNeovim(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
