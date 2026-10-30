import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Rtk, type RtkConfig } from "../src/extras/rtk.ts";
import { defaultConfig, resolveRtk } from "../src/config/mod.ts";

function fakeRtk(dir: string): string {
  const p = path.join(dir, "rtk-fake");
  fs.writeFileSync(
    p,
    "#!/bin/sh\n" +
      "if [ \"$1\" = \"--version\" ]; then echo 'rtk 0.0.0-fake'; exit 0; fi\n" +
      "if [ \"$1\" = \"rewrite\" ]; then\n" +
      "case \"$2\" in git*|cargo*) echo \"rtk $2\"; exit 3;; *) exit 1;; esac\n" +
      "fi\n" +
      "exit 1\n",
  );
  fs.chmodSync(p, 0o755);
  return p;
}

function cfg(enabled: boolean, p?: string): RtkConfig {
  return { enabled, path: p ?? undefined };
}

test("detect_disabled_returns_none", async () => {
  assert.equal(await Rtk.detect(null), null);
  assert.equal(await Rtk.detect(cfg(false)), null);
});

test("detect_bogus_binary_returns_none", async () => {
  assert.equal(await Rtk.detect(cfg(true, "/definitely/not/a/real/rtk")), null);
});

test("detect_and_rewrite_with_working_binary", async () => {
  const dir = path.join(os.tmpdir(), `tc_rtk_test_${process.pid}`);
  fs.mkdirSync(dir, { recursive: true });
  try {
    const p = fakeRtk(dir);
    const rtk = await Rtk.detect(cfg(true, p));
    assert.ok(rtk !== null);
    assert.equal(await rtk!.rewrite("git status"), "rtk git status");
    assert.equal(await rtk!.rewrite("echo hello"), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolve_rtk_filters_disabled", () => {
  const c = defaultConfig();
  assert.equal(resolveRtk(c), undefined);
  c.rtk = cfg(false) as never;
  assert.equal(resolveRtk(c), undefined);
  c.rtk = cfg(true) as never;
  assert.ok(resolveRtk(c) !== undefined);
});
