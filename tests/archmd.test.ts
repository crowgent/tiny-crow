import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  askAndCreate,
  createArchitectureTemplate,
  hasBeenAskedWithPath,
  recordAskedDirWithPath,
  shouldAskWithPath,
} from "../src/extras/archmd/mod.ts";

let counter = 0;
function tempDir(tag: string): string {
  const dir = path.join(os.tmpdir(), `zsarchmd-${tag}-${process.pid}-${counter++}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function askedPath(temp: string): string {
  return path.join(temp, "asked.txt");
}
function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

test("should_ask_true_no_arch_not_asked", () => {
  const dir = tempDir("should_ask_true");
  try {
    assert.ok(shouldAskWithPath(dir, askedPath(dir)));
  } finally { cleanup(dir); }
});

test("should_ask_false_arch_exists", () => {
  const dir = tempDir("should_ask_false_arch");
  try {
    fs.writeFileSync(path.join(dir, "ARCHITECTURE.md"), "# test");
    assert.ok(!shouldAskWithPath(dir, askedPath(dir)));
  } finally { cleanup(dir); }
});

test("should_ask_false_already_asked", () => {
  const dir = tempDir("should_ask_false_asked");
  try {
    const ap = askedPath(dir);
    recordAskedDirWithPath(dir, ap);
    assert.ok(!shouldAskWithPath(dir, ap));
  } finally { cleanup(dir); }
});

test("should_ask_false_both_arch_and_asked", () => {
  const dir = tempDir("should_ask_false_both");
  try {
    const ap = askedPath(dir);
    fs.writeFileSync(path.join(dir, "ARCHITECTURE.md"), "# test");
    recordAskedDirWithPath(dir, ap);
    assert.ok(!shouldAskWithPath(dir, ap));
  } finally { cleanup(dir); }
});

test("has_been_asked_false_before_recording", () => {
  const dir = tempDir("has_been_asked_false");
  try {
    assert.ok(!hasBeenAskedWithPath(dir, askedPath(dir)));
  } finally { cleanup(dir); }
});

test("has_been_asked_true_after_recording", () => {
  const dir = tempDir("has_been_asked_true");
  try {
    const ap = askedPath(dir);
    recordAskedDirWithPath(dir, ap);
    assert.ok(hasBeenAskedWithPath(dir, ap));
  } finally { cleanup(dir); }
});

test("has_been_asked_matches_canonical_path", () => {
  const dir = tempDir("canonical");
  try {
    const ap = askedPath(dir);
    recordAskedDirWithPath(dir, ap);
    const canonical = fs.realpathSync(dir);
    assert.ok(hasBeenAskedWithPath(canonical, ap));
  } finally { cleanup(dir); }
});

test("has_been_asked_false_for_different_dir", () => {
  const dirA = tempDir("dir_a");
  const dirB = tempDir("dir_b");
  try {
    const ap = askedPath(dirA);
    recordAskedDirWithPath(dirA, ap);
    assert.ok(!hasBeenAskedWithPath(dirB, ap));
  } finally { cleanup(dirA); cleanup(dirB); }
});

test("has_been_asked_false_empty_asked_file", () => {
  const dir = tempDir("emptyfile");
  try {
    const ap = askedPath(dir);
    fs.writeFileSync(ap, "");
    assert.ok(!hasBeenAskedWithPath(dir, ap));
  } finally { cleanup(dir); }
});

test("has_been_asked_false_garbled_asked_file", () => {
  const dir = tempDir("garbled");
  try {
    const ap = askedPath(dir);
    fs.writeFileSync(ap, "/definitely/not/a/real/path\n");
    assert.ok(!hasBeenAskedWithPath(dir, ap));
  } finally { cleanup(dir); }
});

test("has_been_asked_false_nonexistent_asked_file", () => {
  const dir = tempDir("nonexistent");
  try {
    assert.ok(!hasBeenAskedWithPath(dir, askedPath(dir)));
  } finally { cleanup(dir); }
});

test("record_asked_dir_creates_file", () => {
  const dir = tempDir("record_creates");
  try {
    const ap = askedPath(dir);
    recordAskedDirWithPath(dir, ap);
    const content = fs.readFileSync(ap, "utf8");
    assert.ok(content.includes(dir));
  } finally { cleanup(dir); }
});

test("record_asked_dir_appends", () => {
  const dirA = tempDir("append_a");
  const dirB = tempDir("append_b");
  try {
    const ap = askedPath(dirA);
    recordAskedDirWithPath(dirA, ap);
    recordAskedDirWithPath(dirB, ap);
    const content = fs.readFileSync(ap, "utf8");
    const lines = content.split("\n").filter((l) => l !== "");
    assert.equal(lines.length, 2);
    assert.ok(lines.includes(dirA));
    assert.ok(lines.includes(dirB));
  } finally { cleanup(dirA); cleanup(dirB); }
});

test("record_asked_dir_idempotent", () => {
  // The Rust test's name notwithstanding, it asserts the file gains a
  // second line when the same directory is recorded twice.
  const dir = tempDir("idempotent");
  try {
    const ap = askedPath(dir);
    recordAskedDirWithPath(dir, ap);
    recordAskedDirWithPath(dir, ap);
    const content = fs.readFileSync(ap, "utf8");
    const lines = content.split("\n").filter((l) => l !== "");
    assert.equal(lines.length, 2);
  } finally { cleanup(dir); }
});

test("record_asked_dir_preserves_existing_entries", () => {
  const dirA = tempDir("preserve_a");
  const dirB = tempDir("preserve_b");
  try {
    const ap = askedPath(dirA);
    recordAskedDirWithPath(dirA, ap);
    recordAskedDirWithPath(dirB, ap);
    const content = fs.readFileSync(ap, "utf8");
    assert.ok(content.includes(dirA));
    assert.ok(content.includes(dirB));
  } finally { cleanup(dirA); cleanup(dirB); }
});

test("record_asked_dir_creates_parent_dirs", () => {
  const dir = tempDir("parent_dirs");
  try {
    const subDir = path.join(dir, "a", "b", "c");
    fs.mkdirSync(subDir, { recursive: true });
    const ap = path.join(dir, "deep", "nested", "asked.txt");
    recordAskedDirWithPath(subDir, ap);
    assert.ok(fs.existsSync(ap));
  } finally { cleanup(dir); }
});

test("create_template_writes_file", () => {
  const dir = tempDir("create_tpl");
  try {
    createArchitectureTemplate(dir);
    const archPath = path.join(dir, "ARCHITECTURE.md");
    assert.ok(fs.existsSync(archPath));
    const content = fs.readFileSync(archPath, "utf8");
    assert.ok(content.includes("# Architecture"));
    assert.ok(content.includes("## Contents to include"));
  } finally { cleanup(dir); }
});

test("create_template_idempotent_does_not_overwrite", () => {
  const dir = tempDir("idem_tpl");
  try {
    const archPath = path.join(dir, "ARCHITECTURE.md");
    fs.writeFileSync(archPath, "# custom architecture");
    createArchitectureTemplate(dir);
    assert.equal(fs.readFileSync(archPath, "utf8"), "# custom architecture");
  } finally { cleanup(dir); }
});

test("ask_and_create_false_when_arch_exists", () => {
  const dir = tempDir("ask_arch_exists");
  try {
    fs.writeFileSync(path.join(dir, "ARCHITECTURE.md"), "# test");
    assert.ok(!askAndCreate(dir));
  } finally { cleanup(dir); }
});
