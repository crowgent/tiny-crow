// One running language server process: spawn, initialize handshake,
// full-document sync, and publishDiagnostics collection into the shared
// DiagStore. Everything is fail-open — callers get null / no-op on any
// error so a broken server never breaks an edit.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";
import { FrameReader, writeFrameToStream } from "./rpc.ts";
import type { LspServerConfig } from "./registry.ts";

export const INIT_TIMEOUT_MS = 15_000;

/** file:// URI for a path, with minimal percent-encoding (anything outside
 *  RFC 3986 unreserved + `/` is hex-escaped). Relative paths resolve
 *  against the process cwd. */
export function fileUri(path: string): string | null {
  const abs = isAbsolute(path) ? path : join(process.cwd(), path);
  let out = "file://";
  for (const byte of Buffer.from(abs, "utf8")) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9\/\-._~]/.test(ch)) out += ch;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

export const DiagnosticSeverity = {
  Error: 1,
  Warning: 2,
  Information: 3,
  Hint: 4,
} as const;

export type DiagnosticSeverityValue = (typeof DiagnosticSeverity)[keyof typeof DiagnosticSeverity];

export interface DiagnosticPosition {
  line: number;
  character: number;
}

export interface DiagnosticRange {
  start: DiagnosticPosition;
  end: DiagnosticPosition;
}

export interface Diagnostic {
  range: DiagnosticRange;
  severity?: DiagnosticSeverityValue | null;
  message: string;
  source?: string | null;
  code?: string | number | null;
}

/** Diagnostics for one file, as last published by one server. */
export interface FileDiags {
  server: string;
  /** Bumped on every publishDiagnostics for this file. */
  version: number;
  diagnostics: Diagnostic[];
}

/** uri -> latest diagnostics. Shared between the manager and every client. */
export type DiagStore = Map<string, FileDiags>;

/** Waiter set notified whenever any server publishes diagnostics. */
export class DiagNotify {
  private waiters = new Set<() => void>();

  notifyWaiters(): void {
    for (const w of [...this.waiters]) w();
    this.waiters.clear();
  }

  notified(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waiters.add(resolve);
    });
  }

  wait(timeoutMs: number): Promise<boolean> {
    return Promise.race([
      this.notified().then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]);
  }
}

export function storeDiagnostics(diags: DiagStore, server: string, params: Record<string, unknown>): void {
  const uri = params["uri"];
  if (typeof uri !== "string") return;
  const raw = Array.isArray(params["diagnostics"]) ? (params["diagnostics"] as unknown[]) : [];
  const diagnostics: Diagnostic[] = raw.map((d) => {
    const obj = (d ?? {}) as Record<string, unknown>;
    const range = (obj["range"] as Record<string, Record<string, number>> | undefined) ?? {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    };
    return {
      range: {
        start: { line: range.start?.line ?? 0, character: range.start?.character ?? 0 },
        end: { line: range.end?.line ?? 0, character: range.end?.character ?? 0 },
      },
      severity: typeof obj["severity"] === "number" ? (obj["severity"] as DiagnosticSeverityValue) : null,
      message: typeof obj["message"] === "string" ? obj["message"] : "",
      source: typeof obj["source"] === "string" ? obj["source"] : null,
      code: typeof obj["code"] === "string" || typeof obj["code"] === "number" ? obj["code"] : null,
    };
  });
  const existing = diags.get(uri);
  if (existing) {
    existing.version += 1;
    existing.diagnostics = diagnostics;
  } else {
    diags.set(uri, { server, version: 1, diagnostics });
  }
}

/** LSP languageId for didOpen. */
export function languageId(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  const dot = base.lastIndexOf(".");
  const ext = dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
  switch (ext) {
    case "rs":
      return "rust";
    case "go":
      return "go";
    case "ts":
    case "mts":
    case "cts":
      return "typescript";
    case "tsx":
      return "typescriptreact";
    case "js":
    case "mjs":
    case "cjs":
      return "javascript";
    case "jsx":
      return "javascriptreact";
    case "py":
    case "pyi":
      return "python";
    case "c":
    case "h":
      return "c";
    case "cpp":
    case "cc":
    case "cxx":
    case "hpp":
    case "hh":
    case "hxx":
      return "cpp";
    case "sh":
    case "bash":
    case "zsh":
      return "shellscript";
    case "lua":
      return "lua";
    case "java":
      return "java";
    case "rb":
      return "ruby";
    case "php":
      return "php";
    case "cs":
      return "csharp";
    case "swift":
      return "swift";
    case "kt":
    case "kts":
      return "kotlin";
    case "nix":
      return "nix";
    case "yaml":
    case "yml":
      return "yaml";
    case "json":
      return "json";
    case "toml":
      return "toml";
    case "md":
      return "markdown";
    default:
      return "plaintext";
  }
}

export class LspClient {
  readonly name: string;
  private child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, (msg: Record<string, unknown>) => void>();
  private open = new Map<string, number>();
  private closed = false;

  private constructor(name: string, child: ChildProcessWithoutNullStreams) {
    this.name = name;
    this.child = child;
  }

  /** Spawns the server and runs the initialize handshake. Returns null
   *  on any failure: missing binary, spawn error, init timeout. */
  static async spawn(
    name: string,
    cfg: LspServerConfig,
    root: string,
    diags: DiagStore,
    diagNotify: DiagNotify,
  ): Promise<LspClient | null> {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(cfg.command, cfg.args, {
        env: { ...process.env, ...cfg.env },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      console.debug(`lsp[${name}]: cannot spawn '${cfg.command}': ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
    const client = new LspClient(name, child);

    // Reader task: routes responses to pending requests, stores
    // diagnostics, and answers server->client requests with null.
    const stdout = child.stdout as unknown as AsyncIterable<Uint8Array>;
    const reader = new FrameReader(stdout);
    void (async () => {
      for (;;) {
        let frame: Uint8Array | null;
        try {
          frame = await reader.readFrame();
        } catch (e) {
          console.debug(`lsp[${name}]: read error: ${e instanceof Error ? e.message : String(e)}`);
          break;
        }
        if (frame === null) break;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(new TextDecoder().decode(frame)) as Record<string, unknown>;
        } catch {
          continue;
        }
        const method = typeof msg["method"] === "string" ? msg["method"] : null;
        const id = typeof msg["id"] === "number" ? msg["id"] : null;
        if (method !== null && id !== null) {
          const reply = { jsonrpc: "2.0", id, result: null };
          try {
            await writeFrameToStream(child.stdin, new TextEncoder().encode(JSON.stringify(reply)));
          } catch {
            // server gone
          }
        } else if (method !== null && method === "textDocument/publishDiagnostics") {
          const params = (msg["params"] as Record<string, unknown> | undefined) ?? {};
          storeDiagnostics(diags, name, params);
          diagNotify.notifyWaiters();
        } else if (method === null && id !== null) {
          const tx = client.pending.get(id);
          if (tx) {
            client.pending.delete(id);
            tx(msg);
          }
        }
      }
      client.pending.clear();
    })();

    // Drain stderr into the debug log so noisy servers don't fill pipes.
    const errLines = createInterface({ input: child.stderr, crlfDelay: Infinity });
    errLines.on("line", (line) => {
      console.debug(`lsp[${name}] stderr: ${line}`);
    });
    child.on("exit", () => {
      client.closed = true;
      client.pending.clear();
    });

    const rootUri = fileUri(root);
    if (rootUri === null) {
      console.debug(`lsp[${name}]: root '${root}' is not a valid uri`);
      client.close();
      return null;
    }
    const initParams = {
      processId: process.pid,
      rootUri,
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false, willSave: false, willSaveWaitUntil: false, didSave: false },
          publishDiagnostics: {},
        },
      },
      initializationOptions: cfg.initialization ?? null,
      clientInfo: { name: "tiny-crow", version: "1.0.5" },
    };
    const init = await client.request("initialize", initParams, INIT_TIMEOUT_MS);
    if (init === null) {
      client.close();
      return null;
    }
    await client.notify("initialized", {});
    return client;
  }

  async request(method: string, params: unknown, timeoutMs: number): Promise<Record<string, unknown> | null> {
    if (this.closed) return null;
    const id = this.nextId++;
    const msg = { jsonrpc: "2.0", id, method, params };
    const body = new TextEncoder().encode(JSON.stringify(msg));
    const response = new Promise<Record<string, unknown> | null>((resolve) => {
      this.pending.set(id, (m) => resolve(m));
      setTimeout(() => {
        if (this.pending.delete(id)) resolve(null);
      }, timeoutMs);
    });
    try {
      await writeFrameToStream(this.child.stdin, body);
    } catch {
      this.pending.delete(id);
      return null;
    }
    const resp = await response;
    if (resp === null) console.debug(`lsp[${this.name}]: '${method}' timed out`);
    return resp;
  }

  async notify(method: string, params: unknown): Promise<void> {
    const msg = { jsonrpc: "2.0", method, params };
    try {
      await writeFrameToStream(this.child.stdin, new TextEncoder().encode(JSON.stringify(msg)));
    } catch {
      // best-effort
    }
  }

  /** Syncs a file's current disk content: didOpen on first touch,
   *  full-content didChange afterwards. */
  async syncFile(path: string): Promise<void> {
    const uri = fileUri(path);
    if (uri === null) return;
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      return; // unreadable/binary file — skip silently
    }
    const existing = this.open.get(uri);
    if (existing === undefined) {
      this.open.set(uri, 1);
      await this.notify("textDocument/didOpen", {
        textDocument: { uri, languageId: languageId(path), version: 1, text },
      });
    } else {
      const version = existing + 1;
      this.open.set(uri, version);
      await this.notify("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    }
  }

  close(): void {
    this.closed = true;
    try {
      this.child.kill();
    } catch {
      // already dead
    }
  }
}
