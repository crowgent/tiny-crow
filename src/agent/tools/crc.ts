const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[i] = crc >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    const idx = ((crc & 0xff) ^ byte) & 0xff;
    crc = (CRC32_TABLE[idx] ^ (crc >>> 8)) >>> 0;
  }
  return (~crc) >>> 0;
}

export function crc32Hex(data: Uint8Array): string {
  return crc32(data).toString(16).padStart(8, "0");
}

export function crc32HexOfString(text: string): string {
  return crc32Hex(new TextEncoder().encode(text));
}
