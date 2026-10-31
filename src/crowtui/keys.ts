export type CrowKey =
  | { kind: "char"; ch: string; ctrl: boolean; alt: boolean }
  | { kind: "enter" }
  | { kind: "esc" }
  | { kind: "backspace" }
  | { kind: "delete" }
  | { kind: "tab" }
  | { kind: "up" }
  | { kind: "down" }
  | { kind: "left" }
  | { kind: "right" }
  | { kind: "home" }
  | { kind: "end" }
  | { kind: "pageup" }
  | { kind: "pagedown" }
  | { kind: "ctrlc" }
  | { kind: "ctrld" }
  | { kind: "ctrlu" }
  | { kind: "ctrlw" };

export function parseKeys(data: Buffer): CrowKey[] {
  const text = data.toString("utf8");
  const keys: CrowKey[] = [];
  const chars = Array.from(text);
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i]!;
    if (ch === "\x1b") {
      if (chars[i + 1] === "[") {
        let j = i + 2;
        let seq = "";
        while (j < chars.length && !/[a-zA-Z~]/.test(chars[j]!)) {
          seq += chars[j]!;
          j++;
        }
        const final = chars[j];
        if (final === undefined) {
          keys.push({ kind: "esc" });
          break;
        }
        const code = seq + final;
        if (code === "200~" || code === "201~") {
          i = j + 1;
          continue;
        }
        switch (code) {
          case "A":
            keys.push({ kind: "up" });
            break;
          case "B":
            keys.push({ kind: "down" });
            break;
          case "C":
            keys.push({ kind: "right" });
            break;
          case "D":
            keys.push({ kind: "left" });
            break;
          case "H":
            keys.push({ kind: "home" });
            break;
          case "F":
            keys.push({ kind: "end" });
            break;
          case "3~":
            keys.push({ kind: "delete" });
            break;
          case "1~":
            keys.push({ kind: "home" });
            break;
          case "4~":
            keys.push({ kind: "end" });
            break;
          case "5~":
            keys.push({ kind: "pageup" });
            break;
          case "6~":
            keys.push({ kind: "pagedown" });
            break;
          case "Z":
            keys.push({ kind: "tab" });
            break;
          default:
            break;
        }
        i = j + 1;
        continue;
      }
      if (chars[i + 1] !== undefined) {
        keys.push({ kind: "char", ch: chars[i + 1]!, ctrl: false, alt: true });
        i += 2;
        continue;
      }
      keys.push({ kind: "esc" });
      i += 1;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      keys.push({ kind: "enter" });
    } else if (ch === "\x03") {
      keys.push({ kind: "ctrlc" });
    } else if (ch === "\x04") {
      keys.push({ kind: "ctrld" });
    } else if (ch === "\x7f" || ch === "\x08") {
      keys.push({ kind: "backspace" });
    } else if (ch === "\t") {
      keys.push({ kind: "tab" });
    } else if (ch === "\x15") {
      keys.push({ kind: "ctrlu" });
    } else if (ch === "\x17") {
      keys.push({ kind: "ctrlw" });
    } else if (ch < " ") {
      i += 1;
      continue;
    } else {
      keys.push({ kind: "char", ch, ctrl: false, alt: false });
    }
    i += 1;
  }
  return keys;
}
