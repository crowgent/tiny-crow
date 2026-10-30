import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { countDirEntries, formatSize } from "../src/agent/tools/list_dir.ts";

const sizeCases: [string, number, string][] = [
  ["format_0_bytes", 0, "0 B"],
  ["format_1_byte", 1, "1 B"],
  ["format_1023_bytes", 1023, "1023 B"],
  ["format_1024_bytes_1_kb", 1024, "1.0 KB"],
  ["format_1536_bytes", 1536, "1.5 KB"],
  ["format_1048576_bytes_1_mb", 1048576, "1.0 MB"],
  ["format_1073741824_bytes_1_gb", 1073741824, "1.0 GB"],
  ["format_above_gb_remains_gb", 2199023255552, "2048.0 GB"],
  ["format_512_bytes", 512, "512 B"],
  ["format_2048_bytes", 2048, "2.0 KB"],
  ["format_2560_bytes", 2560, "2.5 KB"],
  ["format_large_kb", 1047552, "1023.0 KB"],
];
for (const [name, bytes, expected] of sizeCases) {
  test(name, () => {
    assert.equal(formatSize(bytes), expected);
  });
}

let counter = 0;
async function tempDir(tag: string): Promise<string> {
  const dir = path.join(os.tmpdir(), `tc_${tag}_${process.pid}_${counter++}`);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

test("count_empty_dir", async () => {
  const dir = await tempDir("empty");
  try {
    assert.equal(await countDirEntries(dir), 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("count_dir_with_files", async () => {
  const dir = await tempDir("files");
  try {
    await fs.writeFile(path.join(dir, "a.txt"), "a");
    await fs.writeFile(path.join(dir, "b.txt"), "b");
    assert.equal(await countDirEntries(dir), 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("count_nonexistent_dir", async () => {
  assert.equal(await countDirEntries("/nonexistent_xyz_test"), 0);
});
