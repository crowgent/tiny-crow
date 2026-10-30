import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { FrameReader, writeFrameToStream } from "../src/extras/lsp/rpc.ts";
import { resolveServers, serverForPath, type LspServerConfig } from "../src/extras/lsp/registry.ts";
import { LspManager } from "../src/extras/lsp/mod.ts";
import type { Diagnostic } from "../src/extras/lsp/client.ts";
import { defaultConfig, resolveLsp } from "../src/config/mod.ts";

function custom(command: string, extensions: string[]): LspServerConfig {
  return { command, args: [], extensions, env: {}, disabled: false };
}

test("frame_roundtrip", async () => {
  const stream = new PassThrough();
  await writeFrameToStream(stream, Buffer.from(`{"jsonrpc":"2.0","id":1}`));
  await writeFrameToStream(stream, Buffer.from(`{"jsonrpc":"2.0","id":2}`));
  const reader = new FrameReader(stream);
  assert.equal(new TextDecoder().decode((await reader.readFrame()) ?? new Uint8Array()), `{"jsonrpc":"2.0","id":1}`);
  assert.equal(new TextDecoder().decode((await reader.readFrame()) ?? new Uint8Array()), `{"jsonrpc":"2.0","id":2}`);
  stream.end();
  assert.equal(await reader.readFrame(), null);
});

test("frame_missing_content_length_errors", async () => {
  const stream = new PassThrough();
  stream.write("Content-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n{}");
  const reader = new FrameReader(stream);
  await assert.rejects(reader.readFrame());
});

test("frame_eof_mid_message_errors", async () => {
  const stream = new PassThrough();
  stream.write("Content-Length: 100\r\n\r\n{}");
  stream.end();
  const reader = new FrameReader(stream);
  await assert.rejects(reader.readFrame());
});

test("builtin_matches_rust_extension", () => {
  const servers = resolveServers({});
  const found = serverForPath(servers, "src/main.rs");
  assert.ok(found !== null);
  assert.equal(found![0], "rust");
  assert.equal(serverForPath(servers, "readme.txt"), null);
});

test("user_override_replaces_builtin", () => {
  const servers = resolveServers({ rust: custom("my-analyzer", [".rs"]) });
  const found = serverForPath(servers, "main.rs");
  assert.ok(found !== null);
  assert.equal(found![0], "rust");
  assert.equal(found![1].command, "my-analyzer");
});

test("disabled_removes_builtin", () => {
  const servers = resolveServers({ rust: { ...custom("", [".rs"]), disabled: true } });
  assert.equal(serverForPath(servers, "main.rs"), null);
});

test("custom_server_is_added", () => {
  const servers = resolveServers({ mine: custom("my-ls", [".my"]) });
  const found = serverForPath(servers, "x.my");
  assert.ok(found !== null);
  assert.equal(found![0], "mine");
});

test("empty_command_is_dropped", () => {
  const servers = resolveServers({ bogus: custom("", [".bogus"]) });
  assert.equal(serverForPath(servers, "x.bogus"), null);
});

test("resolve_lsp_requires_enabled", () => {
  const cfg = defaultConfig();
  assert.equal(resolveLsp(cfg), undefined);
  cfg.lsp = { enabled: false, servers: {} };
  assert.equal(resolveLsp(cfg), undefined);
  cfg.lsp = { enabled: true, servers: {} };
  assert.ok(resolveLsp(cfg) !== undefined);
});

function diag(severity: number, line: number, col: number, msg: string): Diagnostic {
  return {
    range: { start: { line, character: col }, end: { line, character: col } },
    severity: severity as never,
    message: msg,
  };
}

test("unhandled_extension_yields_nothing", async () => {
  const manager = new LspManager({ enabled: false, servers: {} }, "/tmp");
  const p = "/tmp/x.unknownext";
  assert.ok(!manager.handles(p));
  assert.equal(await manager.diagnosticsBlock(p, 10), null);
});

test("injected_diagnostics_format_errors_first", async () => {
  const manager = new LspManager({ enabled: false, servers: {} }, "/tmp");
  const p = "/tmp/x.rs";
  assert.ok(manager.handles(p));
  manager.injectDiagnostics("file:///tmp/x.rs", "rust", [
    diag(2, 4, 2, "unused variable"),
    diag(1, 11, 4, "mismatched types"),
    diag(4, 0, 0, "not shown"),
  ]);
  const block = await manager.diagnosticsBlock(p, 10);
  assert.ok(block !== null);
  const errorPos = block!.indexOf("12:5 error: mismatched types");
  const warnPos = block!.indexOf("5:3 warning: unused variable");
  assert.ok(errorPos !== -1 && warnPos !== -1);
  assert.ok(errorPos < warnPos, `errors must sort first: ${block}`);
  assert.ok(!block!.includes("not shown"), "hints are filtered out");
});

test("clean_project_reports_nothing", () => {
  const manager = new LspManager({ enabled: false, servers: {} }, "/tmp");
  assert.equal(manager.allDiagnosticsBlock(), null);
  manager.injectDiagnostics("file:///tmp/x.rs", "rust", [diag(1, 0, 0, "boom")]);
  const block = manager.allDiagnosticsBlock();
  assert.ok(block !== null);
  assert.ok(block!.includes("x.rs:1:1 error: boom"), block!);
});
