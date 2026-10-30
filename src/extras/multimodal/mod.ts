import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";

export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

export type MediaAttachment =
  | { kind: "image"; path: string; data: Buffer; mime: string }
  | { kind: "audio"; path: string; data: Buffer; mime: string }
  | { kind: "document"; path: string; data: Buffer; mime: string };

export function mediaSize(attachment: MediaAttachment): number {
  return attachment.data.length;
}

export function mediaPath(attachment: MediaAttachment): string {
  return attachment.path;
}

export function mediaMime(attachment: MediaAttachment): string {
  return attachment.mime;
}

export function detectMedia(path: string): string | null {
  const ext = extname(path).replace(/^\./, "").toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "ogg":
      return "audio/ogg";
    case "flac":
      return "audio/flac";
    case "m4a":
      return "audio/mp4";
    case "aac":
      return "audio/aac";
    case "pdf":
      return "application/pdf";
    default:
      return null;
  }
}

export function loadAttachment(path: string): MediaAttachment {
  const meta = statSync(path);
  if (meta.size > MAX_MEDIA_BYTES) {
    throw new Error(`file too large: ${path} (max ${MAX_MEDIA_BYTES} bytes)`);
  }
  const data = readFileSync(path);
  const mime = detectMedia(path);
  if (mime === null) {
    throw new Error(`unknown media type: ${path}`);
  }
  if (mime.startsWith("image/")) return { kind: "image", path, data, mime };
  if (mime.startsWith("audio/")) return { kind: "audio", path, data, mime };
  return { kind: "document", path, data, mime };
}
