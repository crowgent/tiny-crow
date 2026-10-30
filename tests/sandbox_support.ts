import * as os from "node:os";
import * as path from "node:path";
import { Sandbox } from "../src/sandbox.ts";

export function scratchDir(group: string, name: string): string {
  return path.join(os.tmpdir(), `tiny-crow-${group}-${name}-${process.pid}`);
}

export function pairAt(
  args: string[],
  flag: string,
  value: string,
): number | undefined {
  for (let i = 0; i + 1 < args.length; i++) {
    if (args[i] === flag && args[i + 1] === value) return i;
  }
  return undefined;
}

export function tripleAt(
  args: string[],
  flag: string,
  src: string,
  dst: string,
): number | undefined {
  for (let i = 0; i + 2 < args.length; i++) {
    if (args[i] === flag && args[i + 1] === src && args[i + 2] === dst) {
      return i;
    }
  }
  return undefined;
}

export function backendSandbox(
  backend: string,
  masks: string[],
  cacheDir: string,
): Sandbox {
  return new Sandbox(true, backend)
    .withBackendAvailable(true)
    .withCacheDir(cacheDir)
    .withMaskRoots(masks);
}

export function bwrapSandbox(masks: string[], cacheDir: string): Sandbox {
  return backendSandbox("bwrap", masks, cacheDir);
}
