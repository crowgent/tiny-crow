// Filesystem helpers (port of src/fs.rs).
import { chmod, mkdir, readlink, rename, stat, writeFile, lstat } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmpCounter = 0;

/**
 * Atomically write contents to path: write a temp file in the same
 * directory, then rename over the target. A reader therefore always sees
 * either the complete old contents or the complete new contents.
 * Symlinks are written through (the link itself is preserved) and an
 * existing file's permission bits are copied onto the replacement.
 * Deliberately no fsync: rename atomicity, not power-loss durability,
 * is the failure mode defended against.
 */
export async function atomicWrite(
  filePath: string,
  contents: string | Uint8Array,
): Promise<void> {
  const resolved = await resolveSymlinkTarget(filePath);
  const dir = path.dirname(resolved) || ".";
  const tmpPath = uniqueTmpPath(resolved, dir);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tmpPath, contents);
  } catch (e) {
    try {
      await unlinkQuiet(tmpPath);
    } catch {
      // ignore cleanup failure
    }
    throw e;
  }
  try {
    const meta = await stat(resolved).catch(() => undefined);
    if (meta) {
      try {
        await chmod(tmpPath, meta.mode);
      } catch {
        // permission preservation is best-effort
      }
    }
  } catch {
    // ignore
  }
  try {
    await rename(tmpPath, resolved);
  } catch (e) {
    try {
      await unlinkQuiet(tmpPath);
    } catch {
      // ignore
    }
    throw e;
  }
}

async function unlinkQuiet(p: string): Promise<void> {
  const { unlink } = await import("node:fs/promises");
  await unlink(p);
}

function uniqueTmpPath(target: string, dir: string): string {
  const n = tmpCounter++;
  const stem = path.basename(target) || "tmp";
  return path.join(dir, `.${stem}.zswrite.${process.pid}.${n}.tmp`);
}

async function resolveSymlinkTarget(filePath: string): Promise<string> {
  let current = filePath;
  for (let i = 0; i < 40; i++) {
    let meta;
    try {
      meta = await lstat(current);
    } catch {
      break;
    }
    if (!meta.isSymbolicLink()) break;
    let target: string;
    try {
      target = await readlink(current);
    } catch {
      break;
    }
    current = path.isAbsolute(target)
      ? target
      : path.join(path.dirname(current), target);
  }
  return current;
}

export function expandTilde(s: string): string {
  return expandTildeWithHome(s, os.homedir() || undefined);
}

/**
 * Expand `~`, `~/...`, `$HOME`, `$HOME/...` against an explicit home.
 * When home is undefined every such form is returned unchanged.
 */
export function expandTildeWithHome(s: string, home?: string): string {
  if (s === "~" || s === "$HOME") {
    return home ?? s;
  }
  if (s.startsWith("~/")) {
    return home ? path.join(home, s.slice(2)) : s;
  }
  if (s.startsWith("$HOME/")) {
    return home ? path.join(home, s.slice(6)) : s;
  }
  return s;
}

export function pathExists(p: string): boolean {
  return existsSync(p);
}
