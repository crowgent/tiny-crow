// Logging and crash reports.
import { mkdirSync, writeFileSync, createWriteStream } from "node:fs";
import * as path from "node:path";
import { dataDir } from "./config/load.ts";
import type { Cli } from "./cli.ts";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

export const VERSION = "1.8.5";

let currentLevel: LogLevel = "warn";
let fileStream: ReturnType<typeof createWriteStream> | undefined;

export function crashLogDir(): string {
  return path.join(dataDir(), "logs", "crashes");
}

export function resolveCrashLogPath(): string {
  const dir = crashLogDir();
  const ts = formatTimestamp(new Date());
  return path.join(dir, `tiny-crow-crash-${ts}_${process.pid}.log`);
}

function formatTimestamp(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_` +
    `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}

export function writeCrashReport(error: unknown, location?: string): string | undefined {
  const filePath = resolveCrashLogPath();
  const parent = path.dirname(filePath);
  try {
    mkdirSync(parent, { recursive: true });
  } catch {
    return undefined;
  }
  let content = "tiny-crow crash report\n";
  content += `time: ${new Date().toISOString()}\n`;
  content += `version: ${VERSION}\n\n`;
  content += `panic: ${error instanceof Error ? error.message : String(error)}\n`;
  if (location) content += `location: ${location}\n`;
  content += "\n";
  if (error instanceof Error && error.stack) content += error.stack + "\n";
  try {
    writeFileSync(filePath, content);
    return filePath;
  } catch {
    return undefined;
  }
}

export function installPanicHook(): void {
  process.on("uncaughtException", (err) => {
    const written = writeCrashReport(err);
    if (written) console.error(`crash report written to ${written}`);
    console.error(err);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    const written = writeCrashReport(reason);
    if (written) console.error(`crash report written to ${written}`);
    console.error(reason);
    process.exit(1);
  });
}

export function resolveLogPath(cli: Cli): string | undefined {
  if (cli.logFile) return cli.logFile;
  if (cli.verbose) {
    const logsDir = path.join(dataDir(), "logs");
    try {
      mkdirSync(logsDir, { recursive: true });
    } catch {
      // best effort
    }
    const ts = formatTimestamp(new Date());
    return path.join(logsDir, `tiny-crow-${ts}_${process.pid}.log`);
  }
  return undefined;
}

export function buildStderrFilter(cli: Cli): LogLevel {
  const lvl = cli.logLevel?.toLowerCase();
  if (lvl && lvl in LEVEL_ORDER) return lvl as LogLevel;
  const env = process.env["RUST_LOG"] ?? process.env["TC_LOG"];
  if (env) {
    const first = env.split(",")[0]!.split("=")[0]!.trim().toLowerCase();
    if (first in LEVEL_ORDER) return first as LogLevel;
  }
  return "warn";
}

/** Install stderr/file logging. No-op level filtering mirrors the original:
 * without a subscriber, tracing lines are dropped; here the level gate
 * decides what reaches stderr. */
export function init(cli: Cli): void {
  currentLevel = buildStderrFilter(cli);
  const logPath = resolveLogPath(cli);
  if (logPath) {
    try {
      fileStream = createWriteStream(logPath, { flags: "w" });
      return;
    } catch (e) {
      console.error(`warning: could not create log file ${logPath}: ${e}`);
    }
  }
}

export function logAt(level: LogLevel, message: string): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}\n`;
  process.stderr.write(line);
  if (fileStream) fileStream.write(line);
}

export const logTrace = (m: string): void => logAt("trace", m);
export const logDebug = (m: string): void => logAt("debug", m);
export const logInfo = (m: string): void => logAt("info", m);
export const logWarn = (m: string): void => logAt("warn", m);
export const logError = (m: string): void => logAt("error", m);
