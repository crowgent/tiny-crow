import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";

export function loadFiles(
  embedded: Record<string, string>,
  globalDir: string,
  localDir: string,
  ext: string,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [fileName, content] of Object.entries(embedded)) {
    if (fileName.endsWith(`.${ext}`)) {
      const name = fileName.slice(0, -ext.length - 1);
      if (!(name in map)) map[name] = content;
    }
  }
  for (const dir of [globalDir, localDir]) {
    if (!existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of entries) {
      if (path.extname(file) === `.${ext}`) {
        const name = path.basename(file, `.${ext}`);
        try {
          map[name] = readFileSync(path.join(dir, file), "utf-8");
        } catch {

        }
      }
    }
  }
  return map;
}

function copyEmbedded(embedded: Record<string, string>, dest: string): void {
  for (const [name, content] of Object.entries(embedded)) {
    writeFileSync(path.join(dest, name), content);
  }
}

export function ensureGlobal(embedded: Record<string, string>, dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    copyEmbedded(embedded, dir);
  }
}

export function regen(embedded: Record<string, string>, dir: string): void {
  mkdirSync(dir, { recursive: true });
  copyEmbedded(embedded, dir);
}
