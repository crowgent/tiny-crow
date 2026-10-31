import test from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import {
  formatSandboxExposeDisplay,
  formatSandboxNetworkDisplay,
} from "../src/print.ts";
import { partitionExpose, Sandbox } from "../src/sandbox.ts";

function networkRow(enabled: boolean, backend: string, network: boolean, backendAvailable: boolean): string {
  return formatSandboxNetworkDisplay(
    new Sandbox(enabled, backend as never)
      .withNetwork(network)
      .withBackendAvailable(backendAvailable)
      .networkEffect(),
  );
}

test("sandbox_network_display_open_network_is_plain_true", () => {
  assert.equal(networkRow(true, "bwrap", true, true), "true");
  assert.equal(networkRow(false, "bwrap", true, true), "true");
  assert.equal(networkRow(true, "bwrap", true, false), "true");
  assert.equal(networkRow(true, "zerobox", true, true), "true");
});

test("sandbox_network_display_effective_when_sandboxed_under_bwrap", () => {
  assert.equal(networkRow(true, "bwrap", false, true), "false");
});

test("sandbox_network_display_flags_a_disabled_sandbox", () => {
  assert.equal(networkRow(false, "bwrap", false, true), "false (no effect: sandbox is off)");
});

test("sandbox_network_display_flags_the_zerobox_backend", () => {
  assert.equal(networkRow(true, "zerobox", false, true), "false (no effect: bwrap backend only)");
});

test("sandbox_network_display_flags_a_missing_backend", () => {
  assert.equal(networkRow(true, "bwrap", false, false), "false (no effect: bwrap is not installed)");
});

test("sandbox_network_display_prefers_the_disabled_sandbox_reason", () => {
  assert.equal(networkRow(false, "bwrap", false, false), "false (no effect: sandbox is off)");
});

test("sandbox_expose_display_empty", () => {
  assert.equal(formatSandboxExposeDisplay([]), "(none)");
});

test("sandbox_expose_display_multi_value", () => {
  assert.equal(
    formatSandboxExposeDisplay(["~/.ssh/known_hosts", "~/.aws"]),
    "~/.ssh/known_hosts, ~/.aws",
  );
});

test("sandbox_expose_display_omits_rejected_values", () => {
  const home = path.join(os.tmpdir(), `tiny-crow-print-config-expose-${process.pid}`);
  const ssh = path.join(home, ".ssh");
  const raw = ["~/.ssh", "/etc"];
  const [valid, rejected] = partitionExpose(raw, [ssh], home);
  const display = formatSandboxExposeDisplay(valid);
  assert.equal(display, ssh);
  assert.deepEqual(rejected, ["/etc"], "the rejected value must still be reported to whoever logs the startup warning");
});

test("sandbox_expose_display_all_rejected_renders_none", () => {
  const home = path.join(os.tmpdir(), `tiny-crow-print-config-expose-none-${process.pid}`);
  const ssh = path.join(home, ".ssh");
  const raw = ["/etc"];
  const [valid] = partitionExpose(raw, [ssh], home);
  assert.equal(formatSandboxExposeDisplay(valid), "(none)");
});
