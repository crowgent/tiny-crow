import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  detectMedia,
  loadAttachment,
  mediaPath,
  mediaSize,
  type MediaAttachment,
} from "../src/extras/multimodal/mod.ts";
import { mediaToMessages } from "../src/agent/runner.ts";

test("detect_media_image_extensions", () => {
  assert.equal(detectMedia("photo.png"), "image/png");
  assert.equal(detectMedia("photo.jpg"), "image/jpeg");
  assert.equal(detectMedia("photo.jpeg"), "image/jpeg");
  assert.equal(detectMedia("photo.GIF"), "image/gif");
  assert.equal(detectMedia("photo.webp"), "image/webp");
});

test("detect_media_audio_extensions", () => {
  assert.equal(detectMedia("song.mp3"), "audio/mpeg");
  assert.equal(detectMedia("song.wav"), "audio/wav");
  assert.equal(detectMedia("song.ogg"), "audio/ogg");
  assert.equal(detectMedia("song.flac"), "audio/flac");
  assert.equal(detectMedia("song.m4a"), "audio/mp4");
  assert.equal(detectMedia("song.aac"), "audio/aac");
});

test("detect_media_document_extension", () => {
  assert.equal(detectMedia("doc.pdf"), "application/pdf");
});

test("detect_media_unknown_returns_none", () => {
  assert.equal(detectMedia("code.rs"), null);
  assert.equal(detectMedia("README.md"), null);
  assert.equal(detectMedia("script.sh"), null);
  assert.equal(detectMedia("Dockerfile"), null);
  assert.equal(detectMedia("data.txt"), null);
});

test("detect_media_no_extension_returns_none", () => {
  assert.equal(detectMedia("Makefile"), null);
  assert.equal(detectMedia("/usr/bin/binary"), null);
});

test("load_attachment_file_not_found", () => {
  assert.throws(
    () => loadAttachment("/nonexistent/file.png"),
    (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT",
  );
});

test("load_attachment_unknown_media_type", () => {
  // The Rust test reads the repo's own Cargo.toml; the TS port has none,
  // so use a temp file with an unknown extension instead.
  const p = path.join(os.tmpdir(), `zerostack_test_unknown_${process.pid}.toml`);
  try {
    fs.writeFileSync(p, "[package]\n");
    assert.throws(() => loadAttachment(p), /unknown media type/);
  } finally {
    fs.rmSync(p, { force: true });
  }
});

test("load_attachment_success_for_small_media", () => {
  const p = path.join(os.tmpdir(), "zerostack_test_media.png");
  try {
    fs.writeFileSync(p, "fake png data");
    const att = loadAttachment(p);
    assert.equal(mediaSize(att), 13);
    assert.equal(mediaPath(att), p);
  } finally {
    fs.rmSync(p, { force: true });
  }
});

test("media_attachment_size_matches_data_len", () => {
  const att: MediaAttachment = { kind: "image", path: "test.png", data: Buffer.alloc(42), mime: "image/png" };
  assert.equal(mediaSize(att), 42);
});

test("media_attachment_path_returns_stored_path", () => {
  const att: MediaAttachment = { kind: "audio", path: "/tmp/sound.wav", data: Buffer.alloc(10), mime: "audio/wav" };
  assert.equal(mediaPath(att), "/tmp/sound.wav");
});

test("media_to_messages_produces_user_messages", () => {
  const media: MediaAttachment[] = [
    { kind: "image", path: "photo.png", data: Buffer.from([1, 2, 3]), mime: "image/png" },
    { kind: "document", path: "doc.pdf", data: Buffer.from([4, 5, 6]), mime: "application/pdf" },
  ];
  const messages = mediaToMessages(media as never);
  assert.equal(messages.length, 2);
  for (const msg of messages) {
    assert.equal(msg.role, "user");
  }
});

test("media_to_messages_empty_vec_returns_empty", () => {
  assert.deepEqual(mediaToMessages([]), []);
});
