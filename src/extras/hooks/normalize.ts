// Canonical tool-name mapping used for hook matcher matching.

function toSnakeCase(name: string): string {
  let out = "";
  for (let i = 0; i < name.length; i++) {
    const ch = name[i]!;
    if (ch >= "A" && ch <= "Z") {
      if (i > 0) out += "_";
      out += ch.toLowerCase();
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Canonicalize a tool name into tiny-crow's own name, accepting either
 * tiny-crow's own name or the equivalent external name. Case handling
 * is via snake-casing and the mapping is idempotent: already-canonical
 * names pass through unchanged.
 */
export function canonicalToolName(name: string): string {
  const lower = toSnakeCase(name);
  if (lower === "glob") return "find_files";
  return lower;
}
