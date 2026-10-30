import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  copyEmbeddedTo,
  embeddedChangedFiles,
} from "../src/context/mod.ts";

let counter = 0;
function tempDir(): string {
  const dir = path.join(os.tmpdir(), `tiny-crow_ctx_test_${process.pid}_${counter++}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// The embedded prompt set: the data/prompts directory shipped with the port,
// mirroring the Rust include_dir! over data/prompts.
function embeddedPrompts(): Record<string, string> {
  const dir = path.join(process.cwd(), "data", "prompts");
  const out: Record<string, string> = {};
  for (const file of fs.readdirSync(dir).sort()) {
    if (file.endsWith(".md")) {
      out[file] = fs.readFileSync(path.join(dir, file), "utf8");
    }
  }
  return out;
}
const PROMPTS = embeddedPrompts();
const embeddedFileCount = () => Object.keys(PROMPTS).length;

test("changed_files_reports_everything_when_dest_missing", () => {
  const dir = tempDir();
  try {
    const missing = path.join(dir, "nonexistent");
    const changed = embeddedChangedFiles(PROMPTS, missing);
    assert.equal(changed.length, embeddedFileCount());
    assert.ok(changed.every((v, i, a) => i === 0 || a[i - 1] <= v), "sorted output");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("copy_writes_all_then_nothing_when_up_to_date", () => {
  const dir = tempDir();
  try {
    const written = copyEmbeddedTo(PROMPTS, dir);
    assert.equal(written, embeddedFileCount());
    assert.deepEqual(embeddedChangedFiles(PROMPTS, dir), []);
    const rewritten = copyEmbeddedTo(PROMPTS, dir);
    assert.equal(rewritten, 0, "identical files must not be rewritten");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("changed_files_detects_modified_and_missing", () => {
  const dir = tempDir();
  try {
    copyEmbeddedTo(PROMPTS, dir);
    const names = Object.keys(PROMPTS).sort();
    const firstName = names[0]!;
    const secondName = names[1]!;
    fs.writeFileSync(path.join(dir, firstName), "user edit");
    fs.rmSync(path.join(dir, secondName));
    const changed = embeddedChangedFiles(PROMPTS, dir);
    assert.deepEqual(changed, [firstName, secondName].sort());
    const written = copyEmbeddedTo(PROMPTS, dir);
    assert.equal(written, 2);
    assert.deepEqual(embeddedChangedFiles(PROMPTS, dir), []);
    const restored = fs.readFileSync(path.join(dir, firstName), "utf8");
    assert.equal(restored, PROMPTS[firstName]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("copy_preserves_user_files", () => {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, "my-custom.md"), "mine");
    copyEmbeddedTo(PROMPTS, dir);
    const content = fs.readFileSync(path.join(dir, "my-custom.md"), "utf8");
    assert.equal(content, "mine", "user files must survive regeneration");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
