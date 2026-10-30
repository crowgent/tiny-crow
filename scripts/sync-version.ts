// Sync the version from package.json into every other place the TS code
// reads a version from.
//
// How the version is actually read in this port (verified by searching
// src/ for version constants):
//   * package.json "version" (currently 1.8.5) is the CANONICAL source.
//     Nothing at runtime reads package.json: the entry point runs directly
//     under Node type stripping with no loader that resolves the package
//     manifest, so the running program never sees that field.
//   * src/cli.ts exports CLI_VERSION, printed by --version / -V and by
//     --help. src/logging.ts exports VERSION, written into crash reports
//     and compared by src/docs.ts against the stored current_version file
//     to decide whether to refresh the global guides.
//     src/ui/events.ts exports ZEROSTACK_TS_VERSION, shown in the welcome
//     banner. These three literals are the ONLY version values the code
//     reads, and they are what this script rewrites.
//   * There are no packaging manifests in this port (no platform
//     installer definitions to carry a version), so there is nothing else
//     to sync. If a new version constant is added to src/, add a row to
//     TARGETS below; if a target file disappears, this script fails loudly
//     instead of silently skipping it.
//
// Usage:
//   node scripts/sync-version.ts            # rewrite differing literals
//   node scripts/sync-version.ts --check    # exit 1 if any literal differs
//   node scripts/sync-version.ts --help
import { readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export interface VersionTarget {
  /** Path relative to the repo root. */
  file: string;
  /** Exported constant name whose string literal holds the version. */
  constant: string;
}

export const TARGETS: readonly VersionTarget[] = [
  { file: "src/cli.ts", constant: "CLI_VERSION" },
  { file: "src/logging.ts", constant: "VERSION" },
  { file: "src/ui/events.ts", constant: "ZEROSTACK_TS_VERSION" },
];

export interface SyncResult {
  file: string;
  constant: string;
  before: string;
  after: string;
  /** True when before differed from the package version. */
  needsSync: boolean;
  /** True when this run actually rewrote the file. */
  updated: boolean;
}

export const SEMVER_RE = /^\d+\.\d+\.\d+$/;

export function readPackageVersion(repoRoot: string): string {
  const pkgPath = path.join(repoRoot, "package.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch (e) {
    throw new Error(`Could not read ${pkgPath}: ${e}`);
  }
  const version = (parsed as { version?: unknown })?.version;
  if (typeof version !== "string" || !SEMVER_RE.test(version)) {
    throw new Error(`Could not read a valid version from ${pkgPath}`);
  }
  return version;
}

function literalPattern(constant: string): RegExp {
  return new RegExp(`(export const ${constant} = ")([^"]*)(")`);
}

export function syncVersion(
  repoRoot: string,
  options: { check?: boolean } = {},
): { version: string; results: SyncResult[] } {
  const version = readPackageVersion(repoRoot);
  const results: SyncResult[] = [];
  for (const target of TARGETS) {
    const filePath = path.join(repoRoot, target.file);
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch (e) {
      throw new Error(`Could not read ${filePath}: ${e}`);
    }
    const match = content.match(literalPattern(target.constant));
    if (!match) {
      throw new Error(
        `${target.file} does not contain 'export const ${target.constant} = "..."'`,
      );
    }
    const before = match[2] as string;
    const needsSync = before !== version;
    let updated = false;
    if (needsSync && !options.check) {
      const next = content.replace(
        literalPattern(target.constant),
        `$1${version}$3`,
      );
      writeFileSync(filePath, next);
      updated = true;
    }
    results.push({
      file: target.file,
      constant: target.constant,
      before,
      after: version,
      needsSync,
      updated,
    });
  }
  return { version, results };
}

export interface SyncArgs {
  check: boolean;
  help: boolean;
}

export function parseSyncArgs(argv: string[]): SyncArgs {
  let check = false;
  let help = false;
  for (const arg of argv) {
    if (arg === "--check") check = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return { check, help };
}

export function printSyncHelp(): void {
  console.log(
    "Usage: node scripts/sync-version.ts [--check]\n" +
      "  (no flags)  Rewrite version literals in src/ from package.json\n" +
      "  --check     Report drift and exit 1 without writing",
  );
}

export function runSyncVersion(argv: string[], repoRoot?: string): number {
  const args = parseSyncArgs(argv);
  if (args.help) {
    printSyncHelp();
    return 0;
  }
  const root =
    repoRoot ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { version, results } = syncVersion(root, { check: args.check });
  console.log(`Syncing version ${version} across version literals...`);
  for (const r of results) {
    if (!r.needsSync) {
      console.log(`  ${r.file} (${r.constant}): already ${r.before}`);
    } else if (args.check) {
      console.log(`  ${r.file} (${r.constant}): ${r.before} -> ${version} (drift)`);
    } else {
      console.log(`  ${r.file} (${r.constant}): ${r.before} -> ${version}`);
    }
  }
  if (args.check && results.some((r) => r.needsSync)) {
    console.error("Version drift detected; run without --check to sync.");
    return 1;
  }
  return 0;
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("/sync-version.ts") ||
    process.argv[1].endsWith("\\sync-version.ts"));
if (isMain) {
  try {
    process.exitCode = runSyncVersion(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
