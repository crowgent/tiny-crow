import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { atomicWrite } from "../src/fs.ts";

let counter = 0;
async function tempDir(tag: string): Promise<string> {
  const dir = path.join(
    os.tmpdir(),
    `tiny-crow_atomic_test_${tag}_${process.pid}_${counter++}`,
  );
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
async function tempResidue(dir: string): Promise<number> {
  const entries = await fs.readdir(dir);
  return entries.filter((e) => e.includes(".zswrite.")).length;
}
async function cleanup(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

test("creates_new_file", async () => {
  const dir = await tempDir("new");
  try {
    const f = path.join(dir, "new.txt");
    await atomicWrite(f, "hello world");
    assert.equal(await fs.readFile(f, "utf8"), "hello world");
    assert.equal(await tempResidue(dir), 0);
  } finally {
    await cleanup(dir);
  }
});

test("overwrites_existing_file", async () => {
  const dir = await tempDir("overwrite");
  try {
    const f = path.join(dir, "f.txt");
    await fs.writeFile(f, "old contents");
    await atomicWrite(f, "new contents");
    assert.equal(await fs.readFile(f, "utf8"), "new contents");
    assert.equal(await tempResidue(dir), 0);
  } finally {
    await cleanup(dir);
  }
});

test("preserves_permissions_on_overwrite", async () => {
  const dir = await tempDir("perms");
  try {
    const f = path.join(dir, "script.sh");
    await fs.writeFile(f, "#!/bin/sh\necho old\n");
    await fs.chmod(f, 0o755);
    await atomicWrite(f, "#!/bin/sh\necho new\n");
    const mode = (await fs.stat(f)).mode & 0o777;
    assert.equal(mode, 0o755, "executable bit must survive the atomic replace");
    assert.equal(await fs.readFile(f, "utf8"), "#!/bin/sh\necho new\n");
  } finally {
    await cleanup(dir);
  }
});

test("writes_through_symlink", async () => {
  const dir = await tempDir("symlink");
  try {
    const real = path.join(dir, "real.txt");
    const link = path.join(dir, "link.txt");
    await fs.writeFile(real, "old");
    await fs.symlink(real, link);
    await atomicWrite(link, "new via link");
    assert.ok((await fs.lstat(link)).isSymbolicLink());
    assert.equal(await fs.readFile(real, "utf8"), "new via link");
    assert.equal(await fs.readFile(link, "utf8"), "new via link");
    assert.equal(await tempResidue(dir), 0);
  } finally {
    await cleanup(dir);
  }
});

test("writes_through_symlink_chain", async () => {
  const dir = await tempDir("chain");
  try {
    const real = path.join(dir, "real.txt");
    const link = path.join(dir, "link.txt");
    const link2 = path.join(dir, "link2.txt");
    await fs.writeFile(real, "old");
    await fs.symlink(real, link);
    await fs.symlink(link, link2);
    await atomicWrite(link2, "via chain");
    assert.ok((await fs.lstat(link)).isSymbolicLink());
    assert.ok((await fs.lstat(link2)).isSymbolicLink());
    assert.equal(await fs.readFile(real, "utf8"), "via chain");
  } finally {
    await cleanup(dir);
  }
});

test("resolves_relative_symlink_target", async () => {
  const dir = await tempDir("relsym");
  try {
    const real = path.join(dir, "r.txt");
    const link = path.join(dir, "rlink.txt");
    await fs.writeFile(real, "x");
    await fs.symlink("r.txt", link);
    await atomicWrite(link, "relative ok");
    assert.ok((await fs.lstat(link)).isSymbolicLink());
    assert.equal(await fs.readFile(real, "utf8"), "relative ok");
  } finally {
    await cleanup(dir);
  }
});

test("concurrent_writes_to_distinct_files_leave_no_residue", async () => {
  const dir = await tempDir("concurrent");
  try {
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        atomicWrite(path.join(dir, `p${i}.txt`), `file ${i}`),
      ),
    );
    for (let i = 0; i < 50; i++) {
      assert.equal(
        await fs.readFile(path.join(dir, `p${i}.txt`), "utf8"),
        `file ${i}`,
      );
    }
    assert.equal(await tempResidue(dir), 0);
  } finally {
    await cleanup(dir);
  }
});

test("no_torn_reads_during_rewrites", async () => {
  const dir = await tempDir("torn");
  try {
    const target = path.join(dir, "hot.txt");
    const size = 64 * 1024;
    await atomicWrite(target, "A".repeat(size));
    let done = false;
    let torn = 0;
    const reader = (async () => {
      while (!done) {
        try {
          const bytes = await fs.readFile(target);
          const homogeneous =
            bytes.every((c) => c === 0x41) || bytes.every((c) => c === 0x42);
          if (!(bytes.length === size && homogeneous)) torn++;
        } catch {
          // ignore transient read errors
        }
      }
    })();
    for (let r = 0; r < 300; r++) {
      await atomicWrite(target, (r % 2 === 0 ? "B" : "A").repeat(size));
    }
    done = true;
    await reader;
    assert.equal(torn, 0, `reader observed ${torn} torn/partial states`);
    assert.equal(await tempResidue(dir), 0);
  } finally {
    await cleanup(dir);
  }
});
