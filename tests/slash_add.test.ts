import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { resolvePath } from "../src/ui/slash/add.ts";

test("test_resolve_path_absolute", () => {
  assert.equal(resolvePath("/tmp/foo.txt"), "/tmp/foo.txt");
});

test("test_resolve_path_relative_root", () => {
  assert.equal(resolvePath("/"), "/");
});

test("test_resolve_path_relative_is_under_cwd", () => {
  assert.equal(resolvePath("bar.txt"), path.join(process.cwd(), "bar.txt"));
});

test("test_resolve_path_empty_joins_cwd", () => {
  assert.equal(resolvePath(""), process.cwd());
});
