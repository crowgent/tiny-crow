// Truncation helpers: byte-accurate, UTF-8 boundary safe.

/** Byte length of a single code point in UTF-8. */
function utf8Len(cp: number): number {
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp < 0x10000) return 3;
  return 4;
}

/**
 * Truncate `s` to at most `max` bytes on a UTF-8 character boundary,
 * appending `marker` so callers know content was capped. Returns `s`
 * unchanged when it already fits.
 */
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

/**
 * Keep the first `max` lines of `s`. Returns `[head, totalLines]` where
 * `totalLines` is the original line count; when no truncation was needed
 * `head` equals `s`.
 */
export function headLines(s: string, max: number): [string, number] {
  const lines = s.split("\n");
  // Rust's str::lines() drops a trailing empty line after a final newline.
  const effective = s.endsWith("\n") && lines.length > 0 ? lines.slice(0, -1) : lines;
  const total = effective.length;
  if (total <= max) return [s, total];
  return [effective.slice(0, max).join("\n"), total];
}
