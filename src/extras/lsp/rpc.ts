export const MAX_HEADER_BYTES = 8 * 1024;
export const MAX_BODY_BYTES = 32 * 1024 * 1024;

export interface FrameSink {
  write(data: Uint8Array): Promise<void>;
}

export interface NodeWritableLike {
  write(chunk: Uint8Array, callback?: (error?: Error | null) => void): boolean;
}

export async function writeFrame(sink: FrameSink, body: Uint8Array): Promise<void> {
  const header = new TextEncoder().encode(`Content-Length: ${body.length}\r\n\r\n`);
  const combined = new Uint8Array(header.length + body.length);
  combined.set(header, 0);
  combined.set(body, header.length);
  await sink.write(combined);
}

export async function writeFrameToStream(stream: NodeWritableLike, body: Uint8Array): Promise<void> {
  const header = new TextEncoder().encode(`Content-Length: ${body.length}\r\n\r\n`);
  await new Promise<void>((resolve, reject) => {
    stream.write(header, (err) => (err ? reject(err) : resolve()));
  });
  await new Promise<void>((resolve, reject) => {
    stream.write(body, (err) => (err ? reject(err) : resolve()));
  });
}

export class FrameReader {
  private iterator: AsyncIterator<Uint8Array>;
  private buffered = new Uint8Array(0);
  private done = false;

  constructor(source: AsyncIterable<Uint8Array>) {
    this.iterator = source[Symbol.asyncIterator]();
  }

  private async fill(minBytes: number): Promise<boolean> {
    while (this.buffered.length < minBytes && !this.done) {
      const next = await this.iterator.next();
      if (next.done) {
        this.done = true;
        break;
      }
      const merged = new Uint8Array(this.buffered.length + next.value.length);
      merged.set(this.buffered, 0);
      merged.set(next.value, this.buffered.length);
      this.buffered = merged;
    }
    return this.buffered.length >= minBytes;
  }

  private async readExact(n: number): Promise<Uint8Array | null> {
    if (!(await this.fill(n))) return null;
    const out = this.buffered.subarray(0, n);
    this.buffered = this.buffered.subarray(n);
    return new Uint8Array(out);
  }

  private async readByte(): Promise<number | null> {
    const b = await this.readExact(1);
    return b ? b[0] : null;
  }

  async readFrame(): Promise<Uint8Array | null> {
    const headerBytes: number[] = [];
    for (;;) {
      const byte = await this.readByte();
      if (byte === null) {
        if (headerBytes.length === 0) return null;
        throw new Error("eof inside LSP headers");
      }
      headerBytes.push(byte);
      const len = headerBytes.length;
      if (
        len >= 4 &&
        headerBytes[len - 4] === 0x0d &&
        headerBytes[len - 3] === 0x0a &&
        headerBytes[len - 2] === 0x0d &&
        headerBytes[len - 1] === 0x0a
      ) {
        break;
      }
      if (headerBytes.length > MAX_HEADER_BYTES) {
        throw new Error("LSP header block too large");
      }
    }
    const headerText = new TextDecoder().decode(new Uint8Array(headerBytes));
    let contentLength: number | null = null;
    for (const line of headerText.split("\r\n")) {
      const colon = line.indexOf(":");
      if (colon === -1) continue;
      const name = line.slice(0, colon).trim();
      if (name.toLowerCase() === "content-length") {
        const parsed = Number.parseInt(line.slice(colon + 1).trim(), 10);
        if (!Number.isNaN(parsed)) contentLength = parsed;
      }
    }
    if (contentLength === null) throw new Error("missing Content-Length in LSP frame");
    if (contentLength > MAX_BODY_BYTES) throw new Error("LSP message body too large");
    const body = await this.readExact(contentLength);
    if (body === null) throw new Error("eof inside LSP body");
    return body;
  }
}

export async function readFrame(source: AsyncIterable<Uint8Array>): Promise<Uint8Array | null> {
  return new FrameReader(source).readFrame();
}
