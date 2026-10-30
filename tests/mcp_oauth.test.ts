import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_REDIRECT_PORT,
  oauthRedirectPort,
  oauthRedirectUri,
  oauthSettings,
  parseMcpServerConfig,
  mcpServerConfigToJson,
  type McpServerConfig,
} from "../src/extras/mcp/config.ts";
import {
  parseCallback,
  percentDecode,
  tokenFilename,
} from "../src/extras/mcp/oauth.ts";

test("url_server_without_oauth_parses", () => {
  const cfg = parseMcpServerConfig(JSON.parse(`{ "url": "https://example.com/mcp" }`));
  assert.equal(cfg.kind, "url");
  if (cfg.kind === "url") {
    assert.equal(cfg.url, "https://example.com/mcp");
    assert.ok(cfg.oauth === null || cfg.oauth === undefined);
  }
});

test("oauth_true_enables_with_defaults", () => {
  const cfg = parseMcpServerConfig(JSON.parse(`{ "url": "https://example.com/mcp", "oauth": true }`));
  assert.equal(cfg.kind, "url");
  if (cfg.kind === "url") {
    const settings = oauthSettings(cfg.oauth);
    assert.ok(settings !== null, "oauth enabled");
    assert.deepEqual(settings!.scopes, []);
    assert.ok(settings!.clientId === null || settings!.clientId === undefined);
    assert.equal(oauthRedirectPort(settings!), DEFAULT_REDIRECT_PORT);
  }
});

test("oauth_false_disables", () => {
  const cfg = parseMcpServerConfig(JSON.parse(`{ "url": "https://example.com/mcp", "oauth": false }`));
  assert.equal(cfg.kind, "url");
  if (cfg.kind === "url") {
    assert.equal(oauthSettings(cfg.oauth), null);
  }
});

test("oauth_object_parses_fields", () => {
  const cfg = parseMcpServerConfig(JSON.parse(`{
    "url": "https://example.com/mcp",
    "oauth": { "scopes": ["read", "write"], "client_id": "abc", "redirect_port": 9123 }
  }`));
  assert.equal(cfg.kind, "url");
  if (cfg.kind === "url") {
    const settings = oauthSettings(cfg.oauth)!;
    assert.deepEqual(settings.scopes, ["read", "write"]);
    assert.equal(settings.clientId, "abc");
    assert.equal(oauthRedirectPort(settings), 9123);
    assert.equal(oauthRedirectUri(settings), "http://127.0.0.1:9123/callback");
  }
});

test("default_redirect_uri_uses_loopback", () => {
  assert.equal(
    oauthRedirectUri({ scopes: [] }),
    `http://127.0.0.1:${DEFAULT_REDIRECT_PORT}/callback`,
  );
});

test("token_filename_sanitizes_server_name", () => {
  assert.equal(tokenFilename("Exa Web Search"), "Exa_Web_Search.json");
  assert.equal(tokenFilename("../etc/passwd"), "___etc_passwd.json");
  assert.equal(tokenFilename("plain-name_1"), "plain-name_1.json");
});

test("parse_callback_extracts_code_and_state", () => {
  const { code, state } = parseCallback("GET /callback?code=abc123&state=xyz789 HTTP/1.1");
  assert.equal(code, "abc123");
  assert.equal(state, "xyz789");
});

test("parse_callback_decodes_percent_escapes", () => {
  const { code, state } = parseCallback("GET /callback?code=a%2Fb%2Bc&state=s%20t HTTP/1.1");
  assert.equal(code, "a/b+c");
  assert.equal(state, "s t");
});

test("parse_callback_reports_server_error", () => {
  assert.throws(() => parseCallback("GET /callback?error=access_denied HTTP/1.1"));
});

test("parse_callback_missing_params_errors", () => {
  assert.throws(() => parseCallback("GET /callback?code=only HTTP/1.1"));
});

test("percent_decode_handles_plus_and_hex", () => {
  assert.equal(percentDecode("a+b"), "a b");
  assert.equal(percentDecode("%41%42"), "AB");
  assert.equal(percentDecode("nochange"), "nochange");
  assert.equal(percentDecode("%zz"), "%zz");
});

test("oauth_config_round_trips_through_serde", () => {
  const cfg: McpServerConfig = {
    kind: "url",
    url: "https://example.com/mcp",
    headers: {},
    oauth: true,
  };
  const json = mcpServerConfigToJson(cfg);
  const back = parseMcpServerConfig(json);
  assert.equal(back.kind, "url");
  if (back.kind === "url") {
    assert.ok(oauthSettings(back.oauth) !== null);
  }
});
