import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { crc32Hex } from "../src/agent/tools/crc.ts";
import { EditTool } from "../src/agent/tools/edit.ts";

let counter = 0;
async function tempFile(name: string, content: string): Promise<string> {
  const p = path.join(os.tmpdir(), `tiny-crow_test_${name}_${process.pid}_${counter++}`);
  await fs.writeFile(p, content);
  return p;
}
async function cleanup(p: string): Promise<void> {
  await fs.rm(p, { force: true });
}
function tagged(lineNum: number, content: string): string {
  const tag = crc32Hex(new TextEncoder().encode(content));
  return `   ${lineNum}|${tag} ${content}`;
}
async function expectErr(promise: Promise<unknown>, needle: string): Promise<void> {
  await assert.rejects(promise, (e: unknown) => {
    assert.ok(String((e as Error).message).includes(needle), `error ${String((e as Error).message)} should contain ${needle}`);
    return true;
  });
}

test("test_sim_rejects_no_blocks", async () => {
  const p = await tempFile("noblocks.txt", "hello world\n");
  try {
    const tool = new EditTool();
    await expectErr(tool.call({ path: p, block: "no blocks here" }), "No SEARCH/REPLACE blocks found");
  } finally { await cleanup(p); }
});

test("test_sim_rejects_empty_search", async () => {
  const p = await tempFile("emptysearch.txt", "hello world\n");
  try {
    const tool = new EditTool();
    await expectErr(tool.call({ path: p, block: "<<<<<<< SEARCH\n=======\nreplacement\n>>>>>>> REPLACE" }), "has empty search text");
  } finally { await cleanup(p); }
});

test("test_sim_search_not_found", async () => {
  const p = await tempFile("notfound2.txt", "hello world\n");
  try {
    const tool = new EditTool();
    await expectErr(tool.call({ path: p, block: "<<<<<<< SEARCH\nthis does not exist in file\n=======\nreplacement\n>>>>>>> REPLACE" }), "not found");
  } finally { await cleanup(p); }
});

test("test_sim_single_block_replacement", async () => {
  const p = await tempFile("single2.txt", "before after done\n");
  try {
    const tool = new EditTool();
    const result = await tool.call({ path: p, block: "<<<<<<< SEARCH\nafter\n=======\nmiddle\n>>>>>>> REPLACE" });
    assert.equal(await fs.readFile(p, "utf8"), "before middle done\n");
    assert.ok(result.includes("Applied 1 edit(s)"));
  } finally { await cleanup(p); }
});

test("test_sim_multi_block_atomic", async () => {
  const p = await tempFile("multiblock.txt", "aaa\nbbb\nccc\n");
  try {
    const tool = new EditTool();
    const result = await tool.call({ path: p, block: "<<<<<<< SEARCH\naaa\n=======\nAAA\n>>>>>>> REPLACE\n\n<<<<<<< SEARCH\nccc\n=======\nCCC\n>>>>>>> REPLACE" });
    assert.equal(await fs.readFile(p, "utf8"), "AAA\nbbb\nCCC\n");
    assert.ok(result.includes("Applied 2 edit(s)"));
  } finally { await cleanup(p); }
});

test("test_sim_multi_match_returns_error", async () => {
  const p = await tempFile("multi2.txt", "hello world, hello there\n");
  try {
    const tool = new EditTool();
    await expectErr(tool.call({ path: p, block: "<<<<<<< SEARCH\nhello\n=======\nbye\n>>>>>>> REPLACE" }), "matched 2 times");
  } finally { await cleanup(p); }
});

test("test_sim_preserves_crlf_line_endings", async () => {
  const p = await tempFile("crlf2.txt", "line1\r\nline2\r\nline3\r\n");
  try {
    const tool = new EditTool();
    await tool.call({ path: p, block: "<<<<<<< SEARCH\nline2\n=======\nmodified\n>>>>>>> REPLACE" });
    const raw = await fs.readFile(p);
    assert.ok(raw.includes(Buffer.from("\r\n")), "CRLF should be preserved");
  } finally { await cleanup(p); }
});

test("test_hash_single_line_edit", async () => {
  const original = 'use std::io;\nuse std::fs;\n\nfn main() {\n    println!("hi");\n}\n';
  const p = await tempFile("hash_single.txt", original);
  try {
    const fileCrc = crc32Hex(new TextEncoder().encode(original));
    const tool = new EditTool();
    const result = await tool.call({ path: p, file_crc: fileCrc, edits: [{ line: tagged(4, "fn main() {"), text: "fn run() {" }] });
    const content = await fs.readFile(p, "utf8");
    assert.ok(content.includes("fn run() {"), `expected 'fn run() {', got: ${content}`);
    assert.ok(!content.includes("fn main() {"));
    assert.ok(result.includes("Applied 1 edit(s)"));
  } finally { await cleanup(p); }
});

test("test_hash_range_edit", async () => {
  const original = "line1\nline2\nline3\nline4\nline5\n";
  const p = await tempFile("hash_range.txt", original);
  try {
    const fileCrc = crc32Hex(new TextEncoder().encode(original));
    const tool = new EditTool();
    const result = await tool.call({ path: p, file_crc: fileCrc, edits: [{ lines: [tagged(2, "line2"), tagged(3, "line3"), tagged(4, "line4")].join("\n"), text: "CHANGED_A\nCHANGED_B" }] });
    assert.equal(await fs.readFile(p, "utf8"), "line1\nCHANGED_A\nCHANGED_B\nline5\n");
    assert.ok(result.includes("Applied 1 edit(s)"));
  } finally { await cleanup(p); }
});

test("test_hash_delete_via_empty_text", async () => {
  const original = "keep me\nremove me\nkeep me too\n";
  const p = await tempFile("hash_delete.txt", original);
  try {
    const fileCrc = crc32Hex(new TextEncoder().encode(original));
    const tool = new EditTool();
    await tool.call({ path: p, file_crc: fileCrc, edits: [{ line: tagged(2, "remove me"), text: "" }] });
    assert.equal(await fs.readFile(p, "utf8"), "keep me\n\nkeep me too\n");
  } finally { await cleanup(p); }
});

test("test_hash_file_crc_mismatch", async () => {
  const p = await tempFile("hash_badcrc.txt", "hello world\n");
  try {
    const tool = new EditTool();
    await expectErr(tool.call({ path: p, file_crc: "deadbeef", edits: [{ line: tagged(1, "hello world"), text: "bye" }] }), "CRC mismatch");
  } finally { await cleanup(p); }
});

test("test_hash_tag_mismatch", async () => {
  const original = "hello world\n";
  const p = await tempFile("hash_badtag.txt", original);
  try {
    const fileCrc = crc32Hex(new TextEncoder().encode(original));
    const badTag = crc32Hex(new TextEncoder().encode("different content"));
    const tool = new EditTool();
    await expectErr(tool.call({ path: p, file_crc: fileCrc, edits: [{ line: `   1|${badTag} hello world`, text: "bye" }] }), "Tag mismatch");
  } finally { await cleanup(p); }
});

test("test_hash_invalid_tag_format", async () => {
  const original = "hello world\n";
  const p = await tempFile("hash_badfmt.txt", original);
  try {
    const fileCrc = crc32Hex(new TextEncoder().encode(original));
    const tool = new EditTool();
    await expectErr(tool.call({ path: p, file_crc: fileCrc, edits: [{ line: "not a valid tagged line", text: "bye" }] }), "invalid tagged line");
  } finally { await cleanup(p); }
});

test("test_hash_crlf_preserved", async () => {
  const original = "line1\r\nline2\r\nline3\r\n";
  const p = await tempFile("hash_crlf.txt", original);
  try {
    const normalized = original.replace(/\r\n/g, "\n");
    const fileCrc = crc32Hex(new TextEncoder().encode(normalized));
    const tool = new EditTool();
    await tool.call({ path: p, file_crc: fileCrc, edits: [{ line: tagged(2, "line2"), text: "modified" }] });
    const raw = await fs.readFile(p);
    assert.ok(raw.includes(Buffer.from("\r\n")), "CRLF should be preserved");
  } finally { await cleanup(p); }
});

test("test_hash_multi_edit_atomic", async () => {
  const original = "aaa\nbbb\nccc\nddd\n";
  const p = await tempFile("hash_multi.txt", original);
  try {
    const fileCrc = crc32Hex(new TextEncoder().encode(original));
    const tool = new EditTool();
    const result = await tool.call({ path: p, file_crc: fileCrc, edits: [{ line: tagged(1, "aaa"), text: "AAA" }, { line: tagged(4, "ddd"), text: "DDD" }] });
    assert.equal(await fs.readFile(p, "utf8"), "AAA\nbbb\nccc\nDDD\n");
    assert.ok(result.includes("Applied 2 edit(s)"));
  } finally { await cleanup(p); }
});
