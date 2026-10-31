import {
  createHash,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";

export const MIN_NODE_MAJOR = 24;
export const DEFAULT_INSTALL_DIR =
  typeof process.getuid === "function" && process.getuid() === 0
    ? "/usr/local/bin"
    : path.join(os.homedir(), ".local", "bin");
export const DEFAULT_COMMAND_NAME = "tiny-crow";

export interface InstallArgs {
  dir?: string;
  from?: string;
  tarball?: string;
  sha256?: string;
  name: string;
  help: boolean;
}

export function parseInstallArgs(argv: string[]): InstallArgs {
  const args: InstallArgs = { name: DEFAULT_COMMAND_NAME, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--dir" && i + 1 < argv.length) {
      args.dir = argv[++i];
    } else if (arg === "--from" && i + 1 < argv.length) {
      args.from = argv[++i];
    } else if (arg === "--tarball" && i + 1 < argv.length) {
      args.tarball = argv[++i];
    } else if (arg === "--sha256" && i + 1 < argv.length) {
      args.sha256 = argv[++i];
    } else if (arg === "--name" && i + 1 < argv.length) {
      args.name = argv[++i] as string;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return args;
}

export function printInstallHelp(): void {
  console.log(
    "Usage: node scripts/install.ts [--dir <path>] [--from <checkout-dir>]\n" +
      "       node scripts/install.ts --tarball <path-or-url> [--sha256 <hex>] [--dir <path>]\n" +
      "\n" +
      "Options:\n" +
      `  --dir <path>       Install directory (default: ${DEFAULT_INSTALL_DIR})\n` +
      "  --from <dir>       Checkout to install from (default: this repo root)\n" +
      "  --tarball <source> Tarball file path or http(s) URL to install from\n" +
      "  --sha256 <hex>     Expected SHA-256 of the tarball (verified when given)\n" +
      "  --name <name>      Command name to install (default: tiny-crow)\n" +
      "  --help, -h         Show this message",
  );
}

export function nodeMajor(versionString: string): number {
  const match = versionString.trim().match(/^v?(\d+)/);
  return match ? Number.parseInt(match[1] as string, 10) : Number.NaN;
}

export function isNodeSupported(versionString: string): boolean {
  const major = nodeMajor(versionString);
  return !Number.isNaN(major) && major >= MIN_NODE_MAJOR;
}

export function requireNode24(versionString: string): void {
  if (!isNodeSupported(versionString)) {
    throw new Error(
      `Node >= ${MIN_NODE_MAJOR} is required, found ${versionString}. ` +
        "Install a current Node release, then re-run this installer.",
    );
  }
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function launcherContent(mainPath: string, nodeCommand: string = "node"): string {
  return (
    "#!/bin/sh\n" +
    `# tiny-crow launcher: runs the TS sources directly with Node.\n` +
    `exec ${shellQuote(nodeCommand)} ${shellQuote(mainPath)} "$@"\n`
  );
}

export function findCheckout(checkoutDir: string): { mainPath: string; version: string } {
  const mainPath = path.join(checkoutDir, "src", "main.ts");
  const pkgPath = path.join(checkoutDir, "package.json");
  if (!existsSync(mainPath)) {
    throw new Error(`No src/main.ts found in checkout: ${checkoutDir}`);
  }
  if (!existsSync(pkgPath)) {
    throw new Error(`No package.json found in checkout: ${checkoutDir}`);
  }
  const version = (JSON.parse(readFileSync(pkgPath, "utf-8")) as {
    version?: unknown;
  }).version;
  if (typeof version !== "string" || !version) {
    throw new Error(`package.json in ${checkoutDir} has no version`);
  }
  return { mainPath, version };
}

export function installFromCheckout(
  checkoutDir: string,
  installDir: string,
  name: string = DEFAULT_COMMAND_NAME,
): { launcherPath: string; version: string } {
  const { mainPath, version } = findCheckout(checkoutDir);
  mkdirSync(installDir, { recursive: true });
  const launcherPath = path.join(installDir, name);
  const nodeCommand = process.env["TINY_CROW_NODE_BIN"] ?? "node";
  writeFileSync(launcherPath, launcherContent(mainPath, nodeCommand));
  chmodSync(launcherPath, 0o755);
  
  const output = execFileSync(launcherPath, ["--version"], {
    encoding: "utf-8",
  });
  if (!output.includes(version)) {
    throw new Error(
      `Installed launcher verification failed: '--version' printed ` +
        `'${output.trim()}' but package.json says ${version}`,
    );
  }
  console.log(`Installed ${name} to ${launcherPath}`);
  return { launcherPath, version };
}

export function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function downloadBytes(source: string): Promise<Buffer> {
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(
        `Downloading ${source} failed: ${response.status} ${response.statusText}`,
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }
  return readFileSync(source);
}

function findExtractedCheckout(tmpDir: string): string {
  const candidates: string[] = [tmpDir];
  for (const entry of readdirSync(tmpDir)) {
    const full = path.join(tmpDir, entry);
    try {
      if (statSync(full).isDirectory()) candidates.push(full);
    } catch {

    }
  }
  for (const candidate of candidates) {
    if (
      existsSync(path.join(candidate, "src", "main.ts")) &&
      existsSync(path.join(candidate, "package.json"))
    ) {
      return candidate;
    }
  }
  throw new Error("Could not find a tiny-crow checkout in the archive.");
}

export async function installFromTarball(
  source: string,
  expectedSha256: string | undefined,
  installDir: string,
  name: string = DEFAULT_COMMAND_NAME,
): Promise<{ launcherPath: string; version: string }> {
  console.log(`Downloading tiny-crow from ${source}...`);
  const bytes = await downloadBytes(source);
  const actual = sha256Hex(bytes);
  console.log(`  sha256: ${actual}`);
  if (expectedSha256 && actual.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(
      `SHA-256 mismatch: expected ${expectedSha256}, got ${actual}`,
    );
  }
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "tiny-crow-install-"));
  try {
    const archivePath = path.join(tmpDir, "archive.tar.gz");
    writeFileSync(archivePath, bytes);
    const extractDir = path.join(tmpDir, "extracted");
    mkdirSync(extractDir, { recursive: true });
    
    execFileSync("tar", ["xzf", archivePath, "-C", extractDir]);
    const checkout = findExtractedCheckout(extractDir);
    return installFromCheckout(checkout, installDir, name);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function askInstallDir(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(`Install directory [${DEFAULT_INSTALL_DIR}]: `, resolve);
    });
    return answer.trim() || DEFAULT_INSTALL_DIR;
  } finally {
    rl.close();
  }
}

export function printPathHint(installDir: string): void {
  const pathVar = process.env["PATH"] ?? "";
  if (!pathVar.split(path.delimiter).includes(installDir)) {
    const profiles = [
      path.join(os.homedir(), ".profile"),
      path.join(os.homedir(), ".bashrc"),
    ];
    const pathSetup =
      `case ":$PATH:" in *:${shellQuote(installDir)}:*) ;; ` +
      `*) PATH=${shellQuote(installDir)}:"$PATH" ;; esac\nexport PATH\n`;
    const updated: string[] = [];

    for (const profile of profiles) {
      const current = existsSync(profile) ? readFileSync(profile, "utf-8") : "";
      if (!current.includes(installDir)) {
        writeFileSync(profile, `${current}${current.endsWith("\n") || !current ? "" : "\n"}${pathSetup}`);
        updated.push(profile);
      }
    }

    console.log("");
    if (updated.length > 0) {
      console.log(`Added ${installDir} to PATH in ${updated.join(" and ")}.`);
      console.log("Open a new shell to use the command.");
    } else {
      console.log(`Note: ${installDir} is not currently in PATH.`);
      console.log(`Run: export PATH=${shellQuote(installDir)}:"$PATH"`);
    }
  }
}

export async function runInstall(argv: string[]): Promise<void> {
  requireNode24(process.version);
  const args = parseInstallArgs(argv);
  if (args.help) {
    printInstallHelp();
    return;
  }
  let installDir = args.dir;
  if (!installDir && process.stdin.isTTY) {
    installDir = await askInstallDir();
  }
  installDir = installDir ?? DEFAULT_INSTALL_DIR;

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");
  if (args.tarball) {
    await installFromTarball(
      args.tarball,
      args.sha256,
      installDir,
      args.name,
    );
  } else {
    installFromCheckout(args.from ?? repoRoot, installDir, args.name);
  }
  printPathHint(installDir);
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("/install.ts") ||
    process.argv[1].endsWith("\\install.ts"));
if (isMain) {
  runInstall(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
