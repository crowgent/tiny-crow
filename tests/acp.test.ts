import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAcpServerConfig,
  resolveAcpMode,
  transportType,
} from "../src/extras/acp/mod.ts";
import { defaultCli } from "../src/cli.ts";
import { defaultConfig } from "../src/config/mod.ts";
import { SecurityMode } from "../src/permission/mod.ts";

test("test_acp_config_tcp_deserialization", () => {
  const cfg = parseAcpServerConfig(JSON.parse('{"type":"tcp","host":"0.0.0.0","port":7243}'));
  assert.equal(transportType(cfg), "tcp");
});

test("test_acp_config_tcp_with_api_key", () => {
  const cfg = parseAcpServerConfig(JSON.parse('{"type":"tcp","host":"127.0.0.1","port":9999,"api_key":"secret"}'));
  assert.equal(transportType(cfg), "tcp");
});

test("test_acp_config_stdio", () => {
  const cfg = parseAcpServerConfig(JSON.parse('{"type":"stdio"}'));
  assert.equal(transportType(cfg), "stdio");
});

test("test_acp_config_unknown_type_errors", () => {
  assert.throws(() => parseAcpServerConfig(JSON.parse('{"type":"http","url":"https://example.com"}')));
});

test("test_acp_cli_defaults", () => {
  const cli = defaultCli();
  assert.ok(!cli.acpEnabled);
  assert.equal(cli.acpHost, undefined);
  assert.equal(cli.acpPort, undefined);
});

test("test_acp_cli_tcp_config", () => {
  const cli = { ...defaultCli(), acpEnabled: true, acpHost: "0.0.0.0", acpPort: 7243 };
  assert.ok(cli.acpEnabled);
  assert.equal(cli.acpHost, "0.0.0.0");
  assert.equal(cli.acpPort, 7243);
});

test("test_acp_config_default_fields", () => {
  const cfg = defaultConfig();
  assert.equal(cfg.acpServers, undefined);
  assert.equal(cfg.acpHost, undefined);
  assert.equal(cfg.acpPort, undefined);
});

test("test_security_mode_discriminants", () => {
  const modes = [
    SecurityMode.Yolo,
    SecurityMode.Standard,
    SecurityMode.Guarded,
    SecurityMode.ReadOnly,
    SecurityMode.Restrictive,
  ];
  assert.equal(modes.length, 5);
  assert.equal(SecurityMode.Yolo, "yolo");
});

test("test_resolve_acp_mode_yolo_cli", () => {
  const cli = { ...defaultCli(), yolo: true };
  assert.equal(resolveAcpMode(cli, defaultConfig()), "yolo");
});

test("test_resolve_acp_mode_accept_all", () => {
  const cli = { ...defaultCli(), acceptAll: true };
  assert.equal(resolveAcpMode(cli, defaultConfig()), "standard");
});

test("test_resolve_acp_mode_restrictive", () => {
  const cli = { ...defaultCli(), restrictive: true };
  assert.equal(resolveAcpMode(cli, defaultConfig()), "restrictive");
});

test("test_resolve_acp_mode_default_standard", () => {
  assert.equal(resolveAcpMode(defaultCli(), defaultConfig()), "standard");
});

test("test_resolve_acp_mode_yolo_config", () => {
  const cfg = { ...defaultConfig(), yolo: true };
  assert.equal(resolveAcpMode(defaultCli(), cfg), "yolo");
});

test("test_resolve_acp_mode_config_default_mode", () => {
  const cfg = { ...defaultConfig(), defaultPermissionMode: "guarded" };
  assert.equal(resolveAcpMode(defaultCli(), cfg), "guarded");
});

test("test_resolve_acp_mode_skip_permissions", () => {
  const cli = { ...defaultCli(), dangerouslySkipPermissions: true };
  assert.equal(resolveAcpMode(cli, defaultConfig()), "standard");
});

test("test_resolve_acp_mode_cli_overrides_config", () => {
  const cli = { ...defaultCli(), yolo: true };
  const cfg = { ...defaultConfig(), defaultPermissionMode: "restrictive" };
  assert.equal(resolveAcpMode(cli, cfg), "yolo");
});
