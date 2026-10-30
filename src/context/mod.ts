import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { configDirPath, dataDir } from "../config/load.ts";
import * as prompts from "./prompts.ts";
import * as themes from "./themes.ts";

export * as prompts from "./prompts.ts";
export * as themes from "./themes.ts";
export * as resources from "./resources.ts";

export interface ContextFiles {
  agents?: string;
  prompts: Record<string, string>;
  currentPrompt?: string;
  currentPromptName?: string;
  extraPromptsDirs: string[];
  themes: Record<string, string>;
  currentThemeName?: string;
  extraFiles: string[];
  oneShotRestore?: string;
  chainDeclined: string[];
  memory?: string;
  architecture?: string;
}

export function loadEmbeddedFiles(
  embedded: Record<string, string>,
  ext: string,
): Array<[string, string]> {
  const results: Array<[string, string]> = [];
  for (const [fileName, content] of Object.entries(embedded)) {
    if (fileName.endsWith(`.${ext}`)) {
      results.push([fileName.slice(0, -ext.length - 1), content]);
    }
  }
  return results;
}

export function loadDirFiles(dir: string, ext: string): Array<[string, string]> {
  const results: Array<[string, string]> = [];
  if (!existsSync(dir)) return results;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const file of entries) {
    if (path.extname(file) === `.${ext}`) {
      const name = path.basename(file, `.${ext}`);
      try {
        results.push([name, readFileSync(path.join(dir, file), "utf-8")]);
      } catch {

      }
    }
  }
  return results;
}

export function embeddedChangedFiles(
  embedded: Record<string, string>,
  dest: string,
): string[] {
  const changed: string[] = [];
  for (const name of Object.keys(embedded)) {
    let existing: string | undefined;
    try {
      existing = readFileSync(path.join(dest, name), "utf-8");
    } catch {
      existing = undefined;
    }
    if (existing !== embedded[name]) changed.push(name);
  }
  return changed.sort();
}

export function copyEmbeddedTo(embedded: Record<string, string>, dest: string): number {
  mkdirSync(dest, { recursive: true });
  let written = 0;
  for (const [name, content] of Object.entries(embedded)) {
    const destPath = path.join(dest, name);
    let existing: string | undefined;
    try {
      existing = readFileSync(destPath, "utf-8");
    } catch {
      existing = undefined;
    }
    if (existing === content) continue;
    writeFileSync(destPath, content);
    written++;
  }
  return written;
}

export function agentsPath(): string {
  return path.join(configDirPath(), "agent", "AGENTS.md");
}

export function architecturePath(): string {
  return path.join(configDirPath(), "agent", "ARCHITECTURE.md");
}

export function loadThemeName(): string | undefined {
  try {
    const raw = JSON.parse(
      readFileSync(path.join(dataDir(), "theme.json"), "utf-8"),
    ) as Record<string, unknown>;
    return typeof raw["theme"] === "string" ? raw["theme"] : undefined;
  } catch {
    return undefined;
  }
}

function loadFile(filePath: string): string | undefined {
  try {
    return existsSync(filePath) ? readFileSync(filePath, "utf-8") : undefined;
  } catch {
    return undefined;
  }
}

export const MAX_ANCESTOR_CONTEXT_BYTES = 524_288;

export function walkContextFiles(): [string | undefined, string | undefined] {
  const agentParts: string[] = [];
  const archParts: string[] = [];
  let totalBytes = 0;

  const globalAgents = loadFile(agentsPath());
  if (globalAgents && globalAgents.trim().length > 0) {
    totalBytes += globalAgents.length;
    agentParts.push(`# Global AGENTS.md\n${globalAgents}`);
  }
  const globalArch = loadFile(architecturePath());
  if (globalArch && globalArch.trim().length > 0) {
    totalBytes += globalArch.length;
    archParts.push(`# Global ARCHITECTURE.md\n${globalArch}`);
  }

  let current: string | undefined;
  try {
    current = process.cwd();
  } catch {
    current = undefined;
  }
  while (current) {
    if (totalBytes >= MAX_ANCESTOR_CONTEXT_BYTES) {
      console.warn(
        `ancestor context files exceed ${MAX_ANCESTOR_CONTEXT_BYTES} bytes, stopping traversal`,
      );
      break;
    }
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      const content = loadFile(path.join(current, name));
      if (content && content.trim().length > 0) {
        totalBytes += content.length;
        agentParts.push(`# ${name} (${current})\n${content}`);
      }
    }
    const arch = loadFile(path.join(current, "ARCHITECTURE.md"));
    if (arch && arch.trim().length > 0) {
      totalBytes += arch.length;
      archParts.push(`# ARCHITECTURE.md (${current})\n${arch}`);
    }
    const parent = path.dirname(current);
    current = parent === current ? undefined : parent;
  }

  return [
    agentParts.length > 0 ? agentParts.join("\n\n") : undefined,
    archParts.length > 0 ? archParts.join("\n\n") : undefined,
  ];
}

export function loadArchitecture(): string | undefined {
  return walkContextFiles()[1];
}

export function load(noContextFiles: boolean): ContextFiles {
  return loadWithPromptsDirs(noContextFiles, []);
}

export function loadWithPromptsDirs(
  noContextFiles: boolean,
  extraPromptsDirs: string[],
): ContextFiles {
  try {
    prompts.ensureGlobal();
  } catch (e) {
    console.warn(`failed to install default prompts: ${e}`);
  }
  try {
    themes.ensureGlobal();
  } catch (e) {
    console.warn(`failed to install default themes: ${e}`);
  }
  const [agents, archCandidate] = noContextFiles
    ? [undefined, undefined]
    : walkContextFiles();
  const promptMap = prompts.loadWithExtra(extraPromptsDirs);
  const themeMap = themes.load();
  return {
    agents,
    prompts: promptMap,
    currentPrompt: undefined,
    currentPromptName: undefined,
    extraPromptsDirs: [...extraPromptsDirs],
    themes: themeMap,
    currentThemeName: loadThemeName(),
    extraFiles: [],
    oneShotRestore: undefined,
    chainDeclined: [],
    architecture: archCandidate,
  };
}

export function reloadContextFiles(ctx: ContextFiles): void {
  ctx.agents = walkContextFiles()[0];
  ctx.architecture = walkContextFiles()[1];
  ctx.prompts = prompts.loadWithExtra(ctx.extraPromptsDirs);
  if (ctx.currentPromptName) {
    ctx.currentPrompt = ctx.prompts[ctx.currentPromptName];
  }
  ctx.themes = themes.load();
  ctx.currentThemeName = loadThemeName();
}
