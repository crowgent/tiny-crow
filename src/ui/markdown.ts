import type { LineEntry } from "./renderer.ts";
import {
  COLOR_CYAN,
  COLOR_DARK_GREY,
  COLOR_DARK_YELLOW,
  COLOR_WHITE,
  type Color,
} from "./utils.ts";
import { charDisplayWidth, displayWidth } from "./utils.ts";

/**
 * Word-wrap `text` to `maxWidth` display columns. Words are kept whole
 * when they fit; over-long words are hard-split by character. Mirrors the
 * Rust wrap: a word that fits on the current line (with its trailing
 * whitespace) stays, otherwise the line is flushed and the word starts a
 * new one, with a single separating space when that still fits.
 */
export function wordWrap(text: string, maxWidth: number): string[] {
  if (text === "" || maxWidth === 0) return [text];
  if (displayWidth(text) <= maxWidth) return [text];

  const lines: string[] = [];
  let line = "";
  let lineWidth = 0;

  // Split into words keeping each word's trailing whitespace attached.
  const words: string[] = [];
  let cur = "";
  for (const ch of text) {
    cur += ch;
    if (/\s/.test(ch)) {
      // Whitespace run ends the word only when the next char is not
      // whitespace; simpler: flush on the last whitespace of a run.
      words.push(cur);
      cur = "";
    }
  }
  if (cur !== "") words.push(cur);
  // The loop above splits after every whitespace char, which breaks the
  // Rust split_inclusive semantics (a word includes its whole trailing
  // whitespace run). Re-merge: a fragment that is only whitespace joins
  // the previous word.
  const merged: string[] = [];
  for (const w of words) {
    if (/^\s+$/.test(w) && merged.length > 0) {
      merged[merged.length - 1] += w;
    } else {
      merged.push(w);
    }
  }

  for (const word of merged) {
    const wordTrimmed = word.replace(/\s+$/, "");
    const wordW = displayWidth(word);
    const trimmedW = displayWidth(wordTrimmed);

    if (wordTrimmed === "") {
      if (lineWidth > 0 && lineWidth < maxWidth) {
        line += " ";
        lineWidth += 1;
      }
      continue;
    }

    if (lineWidth + wordW <= maxWidth) {
      line += word;
      lineWidth += wordW;
    } else if (line !== "" && lineWidth + 1 + trimmedW <= maxWidth) {
      line += " ";
      line += wordTrimmed;
      lineWidth += 1 + trimmedW;
      if (/\s$/.test(word)) {
        line += " ";
        lineWidth += 1;
      }
    } else {
      if (line !== "") lines.push(line.replace(/\s+$/, ""));
      line = "";
      lineWidth = 0;
      if (trimmedW > maxWidth) {
        for (const ch of wordTrimmed) {
          const cw = charDisplayWidth(ch);
          if (lineWidth + cw > maxWidth && line !== "") {
            lines.push(line);
            line = "";
            lineWidth = 0;
          }
          line += ch;
          lineWidth += cw;
        }
      } else {
        line += wordTrimmed;
        lineWidth += trimmedW;
      }
      if (/\s$/.test(word)) {
        line += " ";
        lineWidth += 1;
      }
    }
  }

  const trimmed = line.replace(/\s+$/, "");
  if (trimmed !== "") lines.push(trimmed);
  if (lines.length === 0) lines.push(text);
  return lines;
}

function flushAcc(acc: string, color: Color, maxWidth: number, out: LineEntry[]): void {
  if (acc === "") return;
  for (const rawLine of acc.split("\n")) {
    const trimmed = rawLine.replace(/\r$/, "");
    if (trimmed === "") {
      out.push({ text: "", color });
    } else {
      for (const chunk of wordWrap(trimmed, maxWidth)) {
        out.push({ text: chunk, color });
      }
    }
  }
}

function bulletPrefix(color: Color): string {
  return color === COLOR_DARK_GREY ? "  ┊ " : "  • ";
}

/** Strip emphasis/strikethrough markers outside code spans, keeping code spans verbatim with backticks. */
function stripInlineMarkers(text: string): string {
  const codeSpans: string[] = [];
  const protectedText = text.replace(/`[^`]*`/g, (m) => {
    codeSpans.push(m);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });
  let stripped = protectedText
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1$2")
    .replace(/(^|[^_])_([^_]+)_/g, "$1$2");
  stripped = stripped.replace(/\u0000(\d+)\u0000/g, (_, i) => codeSpans[Number(i)] ?? "");
  return stripped;
}

/** Flush a paragraph, rendering link text in dark cyan followed by a `↪ url` note line per link. */
function flushParagraph(acc: string, color: Color, maxWidth: number, out: LineEntry[]): void {
  if (acc === "") return;
  const linkRe = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  if (!linkRe.test(acc)) {
    flushAcc(stripInlineMarkers(acc), color, maxWidth, out);
    return;
  }
  linkRe.lastIndex = 0;
  let last = 0;
  let match: RegExpExecArray | null;
  // Text is flushed segment by segment so link text gets its own colour
  // and the URL note follows it, as in the Rust event-driven renderer.
  let pending = "";
  const flushPending = (c: Color): void => {
    if (pending !== "") {
      flushAcc(stripInlineMarkers(pending), c, maxWidth, out);
      pending = "";
    }
  };
  while ((match = linkRe.exec(acc)) !== null) {
    pending += acc.slice(last, match.index);
    flushPending(color);
    const linkText = match[1];
    flushAcc(stripInlineMarkers(linkText), "dark_cyan", maxWidth, out);
    const note = `  ↪ ${match[2]}`;
    for (const chunk of wordWrap(note, maxWidth)) {
      out.push({ text: chunk, color: COLOR_DARK_GREY });
    }
    last = match.index + match[0].length;
  }
  pending += acc.slice(last);
  flushPending(color);
}

type TableAlign = "none" | "left" | "center" | "right";

function parseTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  let body = trimmed;
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|")) body = body.slice(0, -1);
  return body.split("|").map((c) => c.trim());
}

function isSeparatorRow(line: string): TableAlign[] | null {
  const cells = parseTableRow(line);
  if (cells === null || cells.length === 0) return null;
  const aligns: TableAlign[] = [];
  for (const cell of cells) {
    if (/^:?-+:?$/.test(cell)) {
      if (cell.startsWith(":") && cell.endsWith(":") && cell.length > 2) aligns.push("center");
      else if (cell.endsWith(":")) aligns.push("right");
      else aligns.push("left");
    } else {
      return null;
    }
  }
  return aligns;
}

function formatTableRule(widths: number[], left: string, mid: string, right: string): string {
  let s = left;
  for (let i = 0; i < widths.length; i++) {
    s += "─".repeat(widths[i] + 2);
    if (i + 1 < widths.length) s += mid;
  }
  return s + right;
}

function formatTableRow(cells: string[], widths: number[], aligns: TableAlign[]): string[] {
  const wrapped: string[][] = [];
  let maxSubrows = 0;
  for (let i = 0; i < cells.length; i++) {
    const width = widths[i] ?? 10;
    const cell = cells[i] ?? "";
    const chunks =
      displayWidth(cell) <= width ? [cell] : wordWrap(cell, width);
    maxSubrows = Math.max(maxSubrows, chunks.length);
    wrapped.push(chunks);
  }
  const lines: string[] = [];
  for (let sub = 0; sub < maxSubrows; sub++) {
    let line = "│";
    for (let i = 0; i < wrapped.length; i++) {
      const width = widths[i] ?? 10;
      const text = wrapped[i][sub] ?? "";
      const textW = displayWidth(text);
      const padding = Math.max(0, width - textW);
      const align = aligns[i] ?? "none";
      line += " ";
      if (align === "center") {
        const leftPad = Math.floor(padding / 2);
        line += " ".repeat(leftPad) + text + " ".repeat(padding - leftPad);
      } else if (align === "right") {
        line += " ".repeat(padding) + text;
      } else {
        line += text + " ".repeat(padding);
      }
      line += " ";
      if (i + 1 < wrapped.length) line += "│";
    }
    lines.push(line + "│");
  }
  return lines;
}

function flushTable(
  rows: string[][],
  aligns: TableAlign[],
  maxWidth: number,
  out: LineEntry[],
): void {
  if (rows.length === 0) return;
  const colCount = Math.max(...rows.map((r) => r.length));
  if (colCount === 0) return;
  const colWidths: number[] = new Array(colCount).fill(0);
  for (const row of rows) {
    for (let i = 0; i < row.length && i < colCount; i++) {
      colWidths[i] = Math.max(colWidths[i], displayWidth(row[i]));
    }
  }
  const overhead = 3 * colCount + 1;
  const available = Math.max(0, maxWidth - overhead);
  if (available === 0) return;
  const minColWidth = 4;
  let totalReq = colWidths.reduce((a, b) => a + b, 0);
  while (totalReq > available) {
    let widestIdx = 0;
    let widestW = 0;
    for (let i = 0; i < colWidths.length; i++) {
      if (colWidths[i] > widestW) {
        widestW = colWidths[i];
        widestIdx = i;
      }
    }
    if (widestW <= minColWidth) break;
    colWidths[widestIdx] -= 1;
    totalReq -= 1;
  }
  out.push({ text: formatTableRule(colWidths, "┌", "┬", "┐"), color: COLOR_DARK_GREY });
  for (let i = 0; i < rows.length; i++) {
    for (const line of formatTableRow(rows[i], colWidths, aligns)) {
      out.push({ text: line, color: COLOR_WHITE });
    }
    if (i === 0 && rows.length > 1) {
      out.push({ text: formatTableRule(colWidths, "├", "┼", "┤"), color: COLOR_DARK_GREY });
    }
  }
  out.push({ text: formatTableRule(colWidths, "└", "┴", "┘"), color: COLOR_DARK_GREY });
}

/**
 * Render Markdown text to styled terminal lines. Headings render cyan,
 * code blocks dark yellow, blockquotes dark grey with a `│` prefix, lists
 * with `•` / numbered bullets, tables as bordered grids, and horizontal
 * rules as a line of `─`. Inline emphasis markers are dropped (only the
 * text survives); inline code keeps its backticks; link text renders
 * dark cyan followed by a `↪ url` note line.
 */
export function markdownToStyled(text: string, maxWidth: number): LineEntry[] {
  if (text === "") return [];
  const result: LineEntry[] = [];
  const rawLines = text.split("\n");

  let i = 0;
  let paragraph: string[] = [];
  const flushPara = (): void => {
    if (paragraph.length > 0) {
      flushParagraph(paragraph.join("\n"), COLOR_WHITE, maxWidth, result);
      paragraph = [];
    }
  };

  while (i < rawLines.length) {
    const raw = rawLines[i];
    const line = raw.replace(/\r$/, "");

    // Fenced code block.
    const fence = line.match(/^(\s*)(```|~~~)/);
    if (fence !== null) {
      flushPara();
      const marker = fence[2];
      i += 1;
      while (i < rawLines.length) {
        const codeLine = rawLines[i].replace(/\r$/, "");
        if (codeLine.trimStart().startsWith(marker)) {
          i += 1;
          break;
        }
        result.push({ text: codeLine, color: COLOR_DARK_YELLOW });
        i += 1;
      }
      result.push({ text: "", color: COLOR_WHITE });
      continue;
    }

    // Heading.
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading !== null) {
      flushPara();
      flushAcc(stripInlineMarkers(heading[2]), COLOR_CYAN, maxWidth, result);
      result.push({ text: "", color: COLOR_WHITE });
      i += 1;
      continue;
    }

    // Horizontal rule.
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara();
      result.push({
        text: "─".repeat(Math.min(maxWidth, 40)),
        color: COLOR_DARK_GREY,
      });
      result.push({ text: "", color: COLOR_WHITE });
      i += 1;
      continue;
    }

    // Blockquote: consecutive `>` lines.
    if (/^\s*>/.test(line)) {
      flushPara();
      const quoted: string[] = [];
      while (i < rawLines.length && /^\s*>/.test(rawLines[i])) {
        quoted.push(rawLines[i].replace(/^\s*>\s?/, "").replace(/\r$/, ""));
        i += 1;
      }
      for (const q of quoted) {
        if (q === "") {
          result.push({ text: "", color: COLOR_DARK_GREY });
        } else {
          for (const chunk of wordWrap(`│ ${stripInlineMarkers(q)}`, maxWidth)) {
            result.push({ text: chunk, color: COLOR_DARK_GREY });
          }
        }
      }
      result.push({ text: "", color: COLOR_WHITE });
      continue;
    }

    // Table: header row followed by a separator row.
    {
      const headerCells = parseTableRow(line);
      const nextLine = i + 1 < rawLines.length ? rawLines[i + 1] : null;
      const aligns = nextLine !== null ? isSeparatorRow(nextLine) : null;
      if (headerCells !== null && aligns !== null) {
        flushPara();
        const rows: string[][] = [headerCells.map((c) => stripInlineMarkers(c))];
        i += 2;
        while (i < rawLines.length) {
          const bodyCells = parseTableRow(rawLines[i].replace(/\r$/, ""));
          if (bodyCells === null) break;
          rows.push(bodyCells.map((c) => stripInlineMarkers(c)));
          i += 1;
        }
        // Fully blank rows are filtered out, as in the Rust renderer.
        const nonBlankRows = rows.filter((r) => r.some((c) => c !== ""));
        flushTable(nonBlankRows, aligns, maxWidth, result);
        result.push({ text: "", color: COLOR_WHITE });
        continue;
      }
    }

    // List item.
    const item = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (item !== null) {
      flushPara();
      const ordered = /^\d/.test(item[2]);
      const bullet = ordered ? ` ${item[2]} ` : bulletPrefix(COLOR_WHITE);
      let itemText = item[3];
      // Task-list marker becomes part of the item text, as in the Rust renderer.
      const task = itemText.match(/^\[([ xX])\]\s+(.*)$/);
      if (task !== null) {
        itemText = `[${task[1].toLowerCase() === "x" ? "x" : " "}] ${task[2]}`;
      }
      // Indented continuation lines belong to the same item.
      const continuation: string[] = [];
      let j = i + 1;
      while (j < rawLines.length) {
        const next = rawLines[j].replace(/\r$/, "");
        if (next === "") break;
        if (/^(\s*)([-*+]|\d+[.)])\s+/.test(next)) break;
        if (/^\s+\S/.test(next)) {
          continuation.push(next.trim());
          j += 1;
        } else {
          break;
        }
      }
      const full = [itemText, ...continuation].join("\n");
      const itemLines = full.split("\n");
      let first = true;
      for (const itemLine of itemLines) {
        if (itemLine === "") {
          result.push({ text: "", color: COLOR_WHITE });
        } else if (first) {
          for (const chunk of wordWrap(`${bullet}${stripInlineMarkers(itemLine)}`, maxWidth)) {
            result.push({ text: chunk, color: COLOR_WHITE });
          }
          first = false;
        } else {
          flushParagraph(itemLine, COLOR_WHITE, maxWidth, result);
        }
      }
      i = j;
      continue;
    }

    // Blank line ends a paragraph.
    if (line.trim() === "") {
      flushPara();
      i += 1;
      continue;
    }

    paragraph.push(line);
    i += 1;
  }
  flushPara();
  return result;
}
