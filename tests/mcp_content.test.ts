import test from "node:test";
import assert from "node:assert/strict";
import { renderResult, type ToolOutput, type ToolResultBlock } from "../src/extras/mcp/tool.ts";

function blocks(out: ToolOutput): ToolResultBlock[] {
  if (out.kind === "text") return [{ type: "text", text: out.text }];
  return out.blocks;
}

test("text_only_result_stays_plain_text", () => {
  const items = blocks(renderResult(["status: ok"], []));
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], { type: "text", text: "status: ok" });
});

test("image_result_becomes_multimodal_blocks", () => {
  const items = blocks(renderResult(["Screenshot saved"], [["image/png", "aGVsbG8="]]));
  assert.equal(items.length, 2);
  assert.ok(items[0]!.type === "text" && items[0].text.includes("Screenshot saved"));
  const img = items[1]!;
  assert.ok(img.type === "image");
  if (img.type === "image") {
    assert.equal(img.mimeType, "image/png");
    assert.equal(img.data, "aGVsbG8=");
  }
});

test("image_only_result_omits_response_text", () => {
  const items = blocks(renderResult([], [["image/jpeg", "aGk="]]));
  assert.equal(items.length, 1);
  const img = items[0]!;
  assert.ok(img.type === "image");
  if (img.type === "image") {
    assert.equal(img.mimeType, "image/jpeg");
    assert.equal(img.data, "aGk=");
  }
});

test("multiple_blocks_join_texts_and_keep_all_images", () => {
  const items = blocks(renderResult(
    ["before", "after"],
    [["image/png", "dg=="], ["image/webp", "dw=="]],
  ));
  assert.equal(items.length, 3);
  assert.ok(items[0]!.type === "text" && items[0].text.includes("before") && items[0].text.includes("after"));
  assert.equal(items[1]!.type, "image");
  assert.equal(items[2]!.type, "image");
});

test("coaching_text_lands_ahead_of_images", () => {
  const items = blocks(renderResult(["[note] approved", "result"], [["image/png", "dg=="]]));
  assert.ok(items[0]!.type === "text" && items[0].text.includes("[note] approved") && items[0].text.includes("result"));
  assert.equal(items[1]!.type, "image");
});
