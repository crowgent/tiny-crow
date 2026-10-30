function utf8Len(cp: number): number {
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp < 0x10000) return 3;
  return 4;
}

export function truncateCjk(s: string, max: number, marker: string): string {
  let total = 0;
  for (const ch of s) total += utf8Len(ch.codePointAt(0)!);
  if (total <= max) return s;
  let used = 0;
  let out = "";
  for (const ch of s) {
    const len = utf8Len(ch.codePointAt(0)!);
    if (used + len > max) break;
    used += len;
    out += ch;
  }
  return out + marker;
}

export function headLines(s: string, max: number): [string, number] {
  const lines = s.split("\n");
  
  const effective = s.endsWith("\n") && lines.length > 0 ? lines.slice(0, -1) : lines;
  const total = effective.length;
  if (total <= max) return [s, total];
  return [effective.slice(0, max).join("\n"), total];
}
