import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { BashTool, networkHintForExit } from "../src/agent/tools/bash.ts";
import {
  defaultCli,
  parseCliArgs,
  resolveSandbox,
  resolveSandboxNetwork,
} from "../src/cli.ts";
import { defaultConfig } from "../src/config/mod.ts";
import { buildSandbox, networkHint, Sandbox } from "../src/sandbox.ts";
import { backendSandbox, scratchDir, tripleAt } from "./sandbox_support.ts";

const HINT =
  "note: network is disabled by the sandbox (sandbox-network = false); ask the user whether it should be enabled";

function dir(name: string): string {
  return scratchDir("network", name);
}

function runningSandbox(backend: string, network: boolean, name: string): Sandbox {
  return backendSandbox(backend, [], dir(name)).withNetwork(network);
}

function wrapArgs(sandbox: Sandbox, name: string): string[] {
  const args = sandbox.wrapCommand("echo hello").args;
  fs.rmSync(dir(name), { recursive: true, force: true });
  return args;
}

function indexOf(args: string[], flag: string): number | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? i : undefined;
}

function warningsFor(enabled: boolean, network: boolean): string[] {
  return buildSandbox({ enabled, required: false, backend: "bwrap", shell: "bash", expose: [], network }).warnings;
}

function warnsAboutNetwork(enabled: boolean, network: boolean): boolean {
  return warningsFor(enabled, network).some((w) => w.includes("sandbox-network is set to false"));
}

test("test_bare_flag_parses_as_some_true", () => {
  // TS parseCliArgs takes the argument list without the program name.
  const cli = parseCliArgs(["--sandbox-network"]);
  assert.equal(cli.sandboxNetwork, true);
});

test("test_resolve_sandbox_network_defaults_to_true", () => {
  assert.ok(resolveSandboxNetwork(defaultCli(), defaultConfig()), "the network stays open unless it is turned off explicitly");
});

test("test_resolve_sandbox_network_from_config", () => {
  const cfg = { ...defaultConfig(), sandbox: true, sandboxNetwork: false };
  assert.ok(!resolveSandboxNetwork(defaultCli(), cfg));
});

test("test_resolve_sandbox_network_cli_disables_over_config", () => {
  const cli = { ...defaultCli(), sandboxNetwork: false };
  const cfg = { ...defaultConfig(), sandbox: true, sandboxNetwork: true };
  assert.ok(!resolveSandboxNetwork(cli, cfg));
});

test("test_resolve_sandbox_network_cli_enables_over_config", () => {
  const cli = { ...defaultCli(), sandboxNetwork: true };
  const cfg = { ...defaultConfig(), sandbox: true, sandboxNetwork: false };
  assert.ok(resolveSandboxNetwork(cli, cfg));
});

test("test_sandbox_network_never_enables_the_sandbox", () => {
  const cfg = { ...defaultConfig(), sandboxNetwork: false };
  assert.ok(!resolveSandbox(defaultCli(), cfg), "turning the network off must not imply sandbox = true");
});

test("test_network_off_with_the_sandbox_off_warns_once", () => {
  const warnings = warningsFor(false, false);
  const matched = warnings.filter((w) => w.includes("sandbox-network is set to false"));
  assert.equal(matched.length, 1, `exactly one warning, naming the key: ${JSON.stringify(warnings)}`);
});

test("test_no_warning_when_the_sandbox_is_on", () => {
  assert.ok(!warnsAboutNetwork(true, false));
});

test("test_no_warning_when_the_network_stays_open", () => {
  assert.ok(!warnsAboutNetwork(false, true));
  assert.ok(!warnsAboutNetwork(true, true));
});

test("test_default_emits_no_unshare_net", () => {
  const args = wrapArgs(runningSandbox("bwrap", true, "default"), "default");
  assert.equal(indexOf(args, "--unshare-net"), undefined, `the default keeps the network, so the flag must be absent: ${JSON.stringify(args)}`);
});

test("test_network_off_emits_unshare_net_in_the_unshare_block", () => {
  const args = wrapArgs(runningSandbox("bwrap", false, "off"), "off");
  const cgroup = indexOf(args, "--unshare-cgroup");
  assert.ok(cgroup !== undefined, `the existing unshare block should still be there: ${JSON.stringify(args)}`);
  const net = indexOf(args, "--unshare-net");
  assert.ok(net !== undefined, `expected --unshare-net when the network is off: ${JSON.stringify(args)}`);
  const die = indexOf(args, "--die-with-parent");
  assert.ok(die !== undefined, "--die-with-parent should still be emitted");
  assert.ok(cgroup < net && net < die, "--unshare-net belongs in the unshare block, before --die-with-parent");
});

test("test_resolver_file_stays_bound_when_the_network_is_off", () => {
  const root = dir("resolv");
  fs.mkdirSync(root, { recursive: true });
  const resolver = path.join(root, "resolv.conf");
  fs.writeFileSync(resolver, "nameserver 127.0.0.53\n");
  const expected = fs.realpathSync(resolver);
  try {
    const sandbox = runningSandbox("bwrap", false, "resolv").withResolvConf(resolver);
    const args = wrapArgs(sandbox, "resolv");
    assert.ok(
      tripleAt(args, "--ro-bind-try", expected, "/etc/resolv.conf") !== undefined,
      `the resolver bind must still be emitted with the network off: ${JSON.stringify(args)}`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("test_network_off_changes_nothing_else_in_the_argv", () => {
  const withNetwork = wrapArgs(runningSandbox("bwrap", true, "diff"), "diff");
  const withoutNetwork = wrapArgs(runningSandbox("bwrap", false, "diff"), "diff");
  const stripped = withoutNetwork.filter((a) => a !== "--unshare-net");
  assert.deepEqual(stripped, withNetwork, "turning the network off must add exactly one flag and change nothing else");
});

test("test_zerobox_backend_ignores_the_network_setting", () => {
  const args = wrapArgs(runningSandbox("zerobox", false, "zerobox"), "zerobox");
  assert.equal(indexOf(args, "--unshare-net"), undefined, `--unshare-net is a bwrap flag and must never reach zerobox: ${JSON.stringify(args)}`);
});

test("test_build_sandbox_wires_the_setting_through", () => {
  const setup = buildSandbox({ enabled: true, required: false, backend: "bwrap", shell: "bash", expose: [], network: false });
  const sandbox = setup.sandbox
    .withBackendAvailable(true)
    .withCacheDir(dir("build"))
    .withMaskRoots([]);
  const args = wrapArgs(sandbox, "build");
  assert.ok(indexOf(args, "--unshare-net") !== undefined, `build_sandbox must forward sandbox-network to the sandbox it returns: ${JSON.stringify(args)}`);
});

const DNS_FAILURE = "curl: (6) Could not resolve host: example.com";

test("test_hint_matches_the_no_network_failure_spellings", () => {
  for (const stderr of [
    DNS_FAILURE,
    "fatal: unable to access 'https://example.com/': Could not resolve host: example.com",
    "socket.gaierror: [Errno -3] Temporary failure in name resolution",
    "ping: connect: Network is unreachable",
    "curl: (7) Failed to connect to 127.0.0.1 port 5432: Connection refused",
    "bind: Cannot assign requested address",
  ]) {
    assert.equal(networkHint(stderr), HINT, `expected a hint for: ${stderr}`);
  }
});

test("test_hint_matching_is_case_insensitive", () => {
  assert.equal(networkHint("COULD NOT RESOLVE HOST: EXAMPLE.COM"), HINT);
});

test("test_module_resolution_failures_never_hint", () => {
  for (const stderr of [
    'X [ERROR] Could not resolve "./missing-module"',
    "npm ERR! code ERESOLVE\nnpm ERR! Could not resolve dependency:",
  ]) {
    assert.equal(networkHint(stderr), undefined, `a module resolution failure is not a network failure: ${stderr}`);
  }
});

test("test_unrelated_failure_never_hints", () => {
  assert.equal(networkHint("cat: missing.txt: No such file or directory"), undefined, "the narrow pattern list is what keeps the sandbox from being blamed for every failure");
});

test("test_unlisted_wording_is_a_harmless_miss", () => {
  assert.equal(networkHint("wget: unable to resolve host address"), undefined);
});

test("test_exit_zero_never_hints", () => {
  const sandbox = runningSandbox("bwrap", false, "exit-zero");
  assert.equal(networkHintForExit(0, DNS_FAILURE, sandbox as never), undefined);
  assert.equal(networkHintForExit(6, DNS_FAILURE, sandbox as never), HINT);
});

test("test_open_network_never_hints", () => {
  const sandbox = runningSandbox("bwrap", true, "open");
  assert.equal(networkHintForExit(6, DNS_FAILURE, sandbox as never), undefined);
});

test("test_unsandboxed_command_never_hints", () => {
  const sandbox = new Sandbox(true, "bwrap")
    .withBackendAvailable(false)
    .withNetwork(false);
  assert.equal(networkHintForExit(6, DNS_FAILURE, sandbox as never), undefined);
});

test("test_zerobox_command_never_hints", () => {
  const sandbox = runningSandbox("zerobox", false, "zerobox-hint");
  assert.equal(networkHintForExit(6, DNS_FAILURE, sandbox as never), undefined);
});

const BASE_DESCRIPTION =
  "Execute a bash command in the current working directory. Returns stdout and stderr.";
const NOTICE =
  " This session's sandbox runs commands without network access, so the internet, the local network, and services listening on the host are unreachable; a server started and used within a single command still works on 127.0.0.1.";

function bashDescription(sandbox: Sandbox): string {
  return new BashTool(null, null, sandbox as never, null, null).description();
}

test("test_description_announces_an_unshared_network", () => {
  const described = bashDescription(runningSandbox("bwrap", false, "describe-off"));
  assert.equal(described, `${BASE_DESCRIPTION}${NOTICE}`, "the notice is appended to the description, not substituted for it");
});

test("test_description_is_unchanged_when_the_network_is_open", () => {
  assert.equal(bashDescription(runningSandbox("bwrap", true, "describe-on")), BASE_DESCRIPTION);
});

test("test_description_stays_silent_when_nothing_unshares_the_network", () => {
  const noBackend = new Sandbox(true, "bwrap")
    .withBackendAvailable(false)
    .withNetwork(false);
  assert.equal(bashDescription(noBackend), BASE_DESCRIPTION);
  const zerobox = runningSandbox("zerobox", false, "describe-zerobox");
  assert.equal(bashDescription(zerobox), BASE_DESCRIPTION);
  const sandboxOff = new Sandbox(false, "bwrap")
    .withBackendAvailable(true)
    .withNetwork(false);
  assert.equal(bashDescription(sandboxOff), BASE_DESCRIPTION);
});
