import { homedir } from "node:os";
import path from "node:path";

export function expandTilde(s: string): string {
  const home = homedir();
  if (s === "~" || s === "$HOME") {
    return home || s;
  }
  if (s.startsWith("~/")) {
    return home ? path.join(home, s.slice(2)) : s;
  }
  if (s.startsWith("$HOME/")) {
    return home ? path.join(home, s.slice(6)) : s;
  }
  return s;
}

function globToRegex(pattern: string): string {
  let re = "^";
  const chars = [...pattern];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    if (c === "*") {
      if (chars[i + 1] === "*") {
        i++;
        if (chars[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += ".";
    } else if (c === ".") {
      re += "\\.";
    } else if (c === "\\") {
      re += "\\\\";
    } else if ("()[]{}+^$|".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return re + "$";
}

export class Pattern {
  readonly original: string;
  readonly isRegex: boolean;
  #compiled: RegExp | null = null;

  constructor(pattern: string, isRegex = false) {
    this.original = pattern;
    this.isRegex = isRegex;
  }

  static glob(pattern: string): Pattern {
    return new Pattern(pattern, false);
  }

  static regex(pattern: string): Pattern {
    return new Pattern(pattern, true);
  }

  #compile(): RegExp {
    if (this.#compiled) return this.#compiled;
    const expanded = expandTilde(this.original);
    const source = this.isRegex ? expanded : globToRegex(expanded);
    try {
      this.#compiled = new RegExp(source);
    } catch {
      console.warn(
        `invalid regex pattern ${JSON.stringify(this.original)}, falling back to match-all`,
      );
      this.#compiled = /[\s\S]*/;
    }
    return this.#compiled;
  }

  matches(input: string): boolean {
    return this.#compile().test(input);
  }
}
