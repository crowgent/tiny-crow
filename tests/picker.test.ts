import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FilePicker, walkFiles, walkFilesStreaming } from "../src/ui/pickers/file.ts";
import { ListPicker } from "../src/ui/pickers/list.ts";
import { ModelsPicker } from "../src/ui/pickers/models.ts";

test("models_picker_starts_on_quick_group", () => {
  const picker = new ModelsPicker();
  picker.setGroups(["fast"], ["claude-opus-4-7"]);
  picker.activate();
  assert.deepEqual(picker.matches, ["fast"]);
});

test("models_picker_tab_toggles_to_provider_group", () => {
  const picker = new ModelsPicker();
  picker.setGroups(["fast"], ["claude-opus-4-7"]);
  picker.activate();
  picker.toggleGroup();
  assert.deepEqual(picker.matches, ["claude-opus-4-7"]);
});

test("models_picker_starts_on_provider_when_quick_empty", () => {
  const picker = new ModelsPicker();
  picker.setGroups([], ["claude-opus-4-7"]);
  picker.activate();
  assert.deepEqual(picker.matches, ["claude-opus-4-7"]);
});

test("models_picker_fuzzy_subsequence_match", () => {
  const picker = new ModelsPicker();
  picker.setGroups([], ["claude-opus-4-7", "gpt-4o-mini"]);
  picker.activate();
  for (const c of "o47") picker.charInput(c);
  assert.equal(picker.selectedName(), "claude-opus-4-7");
  assert.ok(!picker.matches.includes("gpt-4o-mini"));
});

test("backspace_empty_query", () => {
  const picker = new FilePicker();
  picker.testSetCache(["test.rs"]);
  picker.backspace();
  assert.equal(picker.query, "");
  assert.equal(picker.cursor, 0);
});

test("char_input_and_backspace_ascii", () => {
  const picker = new FilePicker();
  picker.testSetCache(["test.rs"]);
  picker.charInput("a");
  picker.charInput("b");
  picker.charInput("c");
  assert.equal(picker.query, "abc");
  assert.equal(picker.cursor, 3);
  picker.backspace();
  assert.equal(picker.query, "ab");
  assert.equal(picker.cursor, 2);
  picker.backspace();
  assert.equal(picker.query, "a");
  assert.equal(picker.cursor, 1);
  picker.backspace();
  assert.equal(picker.query, "");
  assert.equal(picker.cursor, 0);
  picker.backspace();
  assert.equal(picker.query, "");
  assert.equal(picker.cursor, 0);
});

test("char_input_and_backspace_unicode", () => {
  const picker = new FilePicker();
  picker.testSetCache(["test.rs"]);
  picker.charInput("é");
  assert.equal(picker.query, "é");
  assert.equal(picker.cursor, 1);
  picker.charInput("ñ");
  assert.equal(picker.query, "éñ");
  assert.equal(picker.cursor, 2);
  picker.backspace();
  assert.equal(picker.query, "é");
  assert.equal(picker.cursor, 1);
  picker.backspace();
  assert.equal(picker.query, "");
  assert.equal(picker.cursor, 0);
  picker.charInput("a");
  picker.charInput("é");
  picker.charInput("b");
  assert.equal(picker.query, "aéb");
  assert.equal(picker.cursor, 3);
  picker.backspace();
  assert.equal(picker.query, "aé");
  assert.equal(picker.cursor, 2);
  picker.backspace();
  assert.equal(picker.query, "a");
  assert.equal(picker.cursor, 1);
  picker.backspace();
  assert.equal(picker.query, "");
  assert.equal(picker.cursor, 0);
});

test("mid_query_insertion_unicode", () => {
  const picker = new FilePicker();
  picker.testSetCache(["test.rs"]);
  picker.charInput("a");
  picker.charInput("b");
  assert.equal(picker.query, "ab");
  assert.equal(picker.cursor, 2);
  picker.backspace();
  assert.equal(picker.query, "a");
  assert.equal(picker.cursor, 1);
  picker.charInput("é");
  assert.equal(picker.query, "aé");
  assert.equal(picker.cursor, 2);
  picker.charInput("c");
  assert.equal(picker.query, "aéc");
  assert.equal(picker.cursor, 3);
  picker.backspace();
  assert.equal(picker.query, "aé");
  assert.equal(picker.cursor, 2);
  picker.backspace();
  assert.equal(picker.query, "a");
  assert.equal(picker.cursor, 1);
});

test("deactivate_and_reactivate", () => {
  const picker = new FilePicker();
  picker.testSetCache(["test.rs"]);
  picker.charInput("h");
  picker.charInput("i");
  assert.equal(picker.query, "hi");
  picker.deactivate();
  assert.ok(!picker.active);
  picker.activate();
  assert.ok(picker.active);
  assert.equal(picker.query, "");
  assert.equal(picker.cursor, 0);
});

test("backspace_cursor_never_negative", () => {
  const picker = new FilePicker();
  picker.testSetCache(["test.rs"]);
  for (let i = 0; i < 10; i++) picker.backspace();
  assert.equal(picker.cursor, 0);
  assert.equal(picker.query, "");
});

test("emoji_handling", () => {
  const picker = new FilePicker();
  picker.testSetCache(["test.rs"]);
  picker.charInput("🔥");
  assert.equal(picker.query, "🔥");
  assert.equal(picker.cursor, 1);
  picker.charInput("x");
  assert.equal(picker.query, "🔥x");
  assert.equal(picker.cursor, 2);
  picker.backspace();
  assert.equal(picker.query, "🔥");
  assert.equal(picker.cursor, 1);
  picker.backspace();
  assert.equal(picker.query, "");
  assert.equal(picker.cursor, 0);
});

test("list_picker_filter", () => {
  const picker = new ListPicker();
  picker.setItems(["alpha", "beta", "gamma"]);
  picker.activate();
  assert.equal(picker.matches.length, 3);
  picker.charInput("a");
  assert.deepEqual(picker.matches, ["alpha", "beta", "gamma"]);
  picker.charInput("l");
  assert.deepEqual(picker.matches, ["alpha"]);
});

test("list_picker_navigation", () => {
  const picker = new ListPicker();
  picker.setItems(["a", "b", "c"]);
  picker.activate();
  assert.equal(picker.selected, 0);
  picker.selectNext();
  assert.equal(picker.selected, 1);
  picker.selectPrev();
  assert.equal(picker.selected, 0);
  picker.selectPrev();
  assert.equal(picker.selected, 2);
});

test("list_picker_backspace_and_char_unicode", () => {
  const picker = new ListPicker();
  picker.setItems(["test"]);
  picker.charInput("é");
  assert.equal(picker.query, "é");
  assert.equal(picker.cursor, 1);
  picker.charInput("ñ");
  assert.equal(picker.query, "éñ");
  assert.equal(picker.cursor, 2);
  picker.backspace();
  assert.equal(picker.query, "é");
  assert.equal(picker.cursor, 1);
  picker.backspace();
  assert.equal(picker.query, "");
  assert.equal(picker.cursor, 0);
  picker.backspace();
  assert.equal(picker.query, "");
  assert.equal(picker.cursor, 0);
});

test("list_picker_reactivate_resets_state", () => {
  const picker = new ListPicker();
  picker.setItems(["a", "b"]);
  picker.charInput("a");
  picker.charInput("b");
  assert.equal(picker.query, "ab");
  picker.deactivate();
  assert.ok(!picker.active);
  picker.activate();
  assert.ok(picker.active);
  assert.equal(picker.query, "");
  assert.equal(picker.cursor, 0);
  assert.equal(picker.selected, 0);
});

test("static_commands_prepopulated", () => {
  const picker = ListPicker.withStaticCommands();
  picker.activate();
  assert.ok(picker.matches.length > 5);
  picker.charInput("m");
  picker.charInput("o");
  picker.charInput("d");
  assert.ok(picker.matches.includes("/model"));
});

let tempCounter = 0;

function withTempDir(f: (root: string) => void): void {
  const dir = path.join(os.tmpdir(), `zerostack_test_${process.pid}_${tempCounter++}`);
  fs.mkdirSync(dir, { recursive: true });
  const canonical = fs.realpathSync(dir);
  try {
    f(canonical);
  } finally {
    fs.rmSync(canonical, { recursive: true, force: true });
  }
}

test("walk_files_includes_directories", () => {
  withTempDir((root) => {
    fs.mkdirSync(path.join(root, "subdir"));
    fs.writeFileSync(path.join(root, "file.txt"), "hello");
    const names = walkFiles(root);
    assert.ok(names.includes("file.txt"), "walk_files should include files");
    assert.ok(names.includes("subdir"), `walk_files should include directories, got: ${names}`);
  });
});

test("walk_files_includes_nested_dirs", () => {
  withTempDir((root) => {
    fs.mkdirSync(path.join(root, "a", "b"), { recursive: true });
    fs.writeFileSync(path.join(root, "a", "b", "deep.txt"), "deep");
    const names = walkFiles(root);
    assert.ok(names.includes("a"));
    assert.ok(names.includes("a/b"));
    assert.ok(names.includes("a/b/deep.txt"));
  });
});

test("walk_files_skips_dotfiles", () => {
  withTempDir((root) => {
    fs.writeFileSync(path.join(root, ".hidden"), "secret");
    fs.writeFileSync(path.join(root, "visible.txt"), "hello");
    const names = walkFiles(root);
    assert.ok(!names.includes(".hidden"));
    assert.ok(names.includes("visible.txt"));
  });
});

test("walk_files_skips_files_in_dot_dirs", () => {
  withTempDir((root) => {
    fs.mkdirSync(path.join(root, ".secret", "nested"), { recursive: true });
    fs.writeFileSync(path.join(root, ".secret", "nested", "file.txt"), "hidden");
    fs.writeFileSync(path.join(root, ".secret", "secret_file.txt"), "hidden");
    fs.writeFileSync(path.join(root, "public.txt"), "visible");
    const names = walkFiles(root);
    assert.ok(!names.includes(".secret"));
    assert.ok(!names.includes(".secret/nested"));
    assert.ok(!names.includes(".secret/nested/file.txt"));
    assert.ok(!names.includes(".secret/secret_file.txt"));
    assert.ok(names.includes("public.txt"));
  });
});

test("walk_files_root_is_sorted_and_stripped", () => {
  withTempDir((root) => {
    fs.writeFileSync(path.join(root, "z.txt"), "z");
    fs.writeFileSync(path.join(root, "c.txt"), "c");
    fs.writeFileSync(path.join(root, "a.txt"), "a");
    const names = walkFiles(root);
    const rootIdx = names.indexOf("");
    assert.ok(rootIdx !== -1, "root entry (empty string) should be present");
    const fileIndices = names
      .map((n, i) => (n.endsWith(".txt") ? i : -1))
      .filter((i) => i !== -1);
    assert.ok(
      fileIndices.every((v, i) => i === 0 || fileIndices[i - 1]! < v),
      "files should be sorted",
    );
  });
});

test("walk_files_empty_directory", () => {
  withTempDir((root) => {
    const names = walkFiles(root);
    assert.equal(names.length, 1, "only root entry expected in empty dir");
    assert.ok(names.includes(""), "root entry should be present");
  });
});

test("walk_files_streaming_batches_match_walk_files", () => {
  withTempDir((root) => {
    for (let i = 0; i < 30; i++) {
      fs.writeFileSync(path.join(root, `file${String(i).padStart(2, "0")}.txt`), "x");
    }
    const batches: string[][] = [];
    walkFilesStreaming(root, { cancelled: false }, (batch) => {
      batches.push(batch);
      return true;
    });
    assert.ok(batches.length > 1, "31 entries should arrive in multiple batches");
    assert.ok(batches.every((b) => b.length <= 25));
    const streamed = batches.flat();
    const full = walkFiles(root);
    assert.deepEqual(streamed, full, "streamed batches should equal the full walk, in order");
  });
});

test("walk_files_streaming_cancel_stops_immediately", () => {
  withTempDir((root) => {
    for (let i = 0; i < 10; i++) {
      fs.writeFileSync(path.join(root, `file${i}.txt`), "x");
    }
    const files: string[] = [];
    walkFilesStreaming(root, { cancelled: true }, (batch) => {
      files.push(...batch);
      return true;
    });
    assert.ok(files.length === 0, "a pre-set cancel flag should prevent any results");
  });
});

test("walk_files_streaming_emit_false_stops_early", () => {
  withTempDir((root) => {
    for (let i = 0; i < 60; i++) {
      fs.writeFileSync(path.join(root, `file${String(i).padStart(2, "0")}.txt`), "x");
    }
    const files: string[] = [];
    walkFilesStreaming(root, { cancelled: false }, (batch) => {
      files.push(...batch);
      return false;
    });
    assert.ok(files.length <= 25, `refusing the first batch should stop the walk, got ${files.length} files`);
  });
});
