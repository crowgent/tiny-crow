export function normalizeWhitespace(s: string): string {
  let out = "";
  let blankCount = 0;
  // Mirror Rust str::lines(): no phantom empty line after a trailing
  // newline, and a trailing \r is stripped from each line.
  const lines = s.split("\n");
  if (s.endsWith("\n")) lines.pop();
  for (const rawLine of lines) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const trimmed = line.replace(/[\t ]+$/u, "").replace(/\t/g, "    ");
    if (trimmed === "") {
      blankCount += 1;
      if (blankCount <= 1) out += "\n";
    } else {
      blankCount = 0;
      out += trimmed + "\n";
    }
  }
  if (blankCount === 0 && !out.endsWith("\n") && s.endsWith("\n")) out += "\n";
  return out;
}

export function levenshteinDistance(a: string, b: string): number {
  const aChars = [...a];
  const bChars = [...b];
  const aLen = aChars.length;
  const bLen = bChars.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;
  let prev: number[] = Array.from({ length: bLen + 1 }, (_, i) => i);
  let curr: number[] = new Array<number>(bLen + 1).fill(0);
  for (let i = 1; i <= aLen; i++) {
    curr[0] = i;
    for (let j = 1; j <= bLen; j++) {
      const cost = aChars[i - 1] === bChars[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[bLen];
}

export function levenshteinSimilarity(a: string, b: string): number {
  const aLen = [...a].length;
  const bLen = [...b].length;
  const maxLen = Math.max(aLen, bLen);
  if (maxLen === 0) return 1.0;
  return 1.0 - levenshteinDistance(a, b) / maxLen;
}
