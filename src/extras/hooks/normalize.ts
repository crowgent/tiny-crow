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

export function canonicalToolName(name: string): string {
  const lower = toSnakeCase(name);
  if (lower === "glob") return "find_files";
  return lower;
}
