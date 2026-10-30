import {
  DiagNotify,
  LspClient,
  fileUri,
  type DiagStore,
  type Diagnostic,
  type FileDiags,
} from "./client.ts";
import { resolveServers, serverForPath, type LspServerConfig } from "./registry.ts";

export const DIAG_WAIT_MS = 1000;
export const MAX_DIAG_LINES = 20;

export interface LspConfig {
  enabled: boolean;
  servers: Map<string, LspServerConfig> | Record<string, LspServerConfig>;
}

export class LspManager {
  readonly root: string;
  readonly servers: Array<[string, LspServerConfig]>;
  private clients = new Map<string, LspClient | null>();
  private diags: DiagStore = new Map();
  private diagNotify = new DiagNotify();

  constructor(cfg: LspConfig, root: string) {
    this.servers = resolveServers(cfg.servers);
    this.root = root;
  }

  handles(path: string): boolean {
    return serverForPath(this.servers, path) !== null;
  }

  async clientFor(path: string): Promise<LspClient | null> {
    const found = serverForPath(this.servers, path);
    if (!found) return null;
    const [name, cfg] = found;
    if (this.clients.has(name)) return this.clients.get(name) ?? null;
    const spawned = await LspClient.spawn(name, cfg, this.root, this.diags, this.diagNotify);
    this.clients.set(name, spawned);
    return spawned;
  }

  async notifyChanged(path: string): Promise<void> {
    const client = await this.clientFor(path);
    if (client) await client.syncFile(path);
  }

  async diagnosticsBlock(path: string, waitMs: number): Promise<string | null> {
    if (!this.handles(path)) return null;
    const uri = fileUri(path);
    if (uri === null) return null;
    const v0 = this.diags.get(uri)?.version ?? 0;
    const deadline = Date.now() + waitMs;
    for (;;) {
      const current = this.diags.get(uri)?.version ?? 0;
      if (current > v0) break;
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const notified = await this.diagNotify.wait(remaining);
      if (!notified) break;
    }
    const file = this.diags.get(uri);
    if (!file) return null;
    return formatFileDiags(file.server, file.diagnostics);
  }

  async diagnosticsBlockForEdit(path: string): Promise<string | null> {
    return this.diagnosticsBlock(path, DIAG_WAIT_MS);
  }

  allDiagnosticsBlock(): string | null {
    const entries = [...this.diags.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    let out = "";
    let lines = 0;
    for (const [uri, file] of entries) {
      const interesting = file.diagnostics.filter((d) => (d.severity ?? 4) <= 2);
      if (interesting.length === 0) continue;
      let display = uri;
      if (uri.startsWith("file://")) {
        const rest = uri.slice("file://".length);
        if (rest.startsWith(this.root)) {
          display = rest.slice(this.root.length).replace(/^\/+/, "");
        }
      }
      for (const d of interesting) {
        if (lines >= MAX_DIAG_LINES) {
          out += "  … (truncated)\n";
          return out;
        }
        out += formatDiagLine(display, d);
        lines++;
      }
    }
    return out.length === 0 ? null : out;
  }

  injectDiagnostics(uri: string, server: string, diagnostics: Diagnostic[]): void {
    this.diags.set(uri, { server, version: 1, diagnostics });
  }

  close(): void {
    for (const client of this.clients.values()) client?.close();
    this.clients.clear();
  }
}

export function formatFileDiags(server: string, diags: Diagnostic[]): string | null {
  const sorted = diags
    .filter((d) => (d.severity ?? 4) <= 2)
    .sort((a, b) => (a.severity ?? 4) - (b.severity ?? 4));
  if (sorted.length === 0) return null;
  let out = `\n\nLSP diagnostics (${server}):`;
  for (let i = 0; i < sorted.length; i++) {
    if (i >= MAX_DIAG_LINES) {
      out += "\n  … (truncated)";
      break;
    }
    out += formatDiagLine("", sorted[i]);
  }
  return out;
}

export function formatDiagLine(locationPrefix: string, d: Diagnostic): string {
  const severity =
    d.severity === 1 ? "error" : d.severity === 2 ? "warning" : d.severity === 3 ? "info" : "hint";
  const line = d.range.start.line + 1;
  const col = d.range.start.character + 1;
  const message = (d.message.split("\n")[0] ?? "").slice(0, 200);
  const where = locationPrefix.length === 0 ? `${line}:${col}` : `${locationPrefix}:${line}:${col}`;
  return `\n  ${where} ${severity}: ${message}`;
}

export { LspClient, DiagNotify, fileUri, languageId, storeDiagnostics } from "./client.ts";
export type { DiagStore, FileDiags, Diagnostic, DiagnosticRange, DiagnosticPosition } from "./client.ts";
export { builtinServers, resolveServers, serverForPath } from "./registry.ts";
export type { LspServerConfig } from "./registry.ts";
export { FrameReader, writeFrame, writeFrameToStream, MAX_HEADER_BYTES, MAX_BODY_BYTES } from "./rpc.ts";
export type { FrameSink } from "./rpc.ts";
