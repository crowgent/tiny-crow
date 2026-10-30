import { readFile } from "node:fs/promises";
import type {
  AskSenderLike,
  EditArgs,
  EditBlock,
  EditOp,
  PermCheckLike,
  Tool,
} from "./mod.ts";
import {
  ToolError,
  atomicWrite,
  checkPermPath,
  editSystem,
  expandTilde,
  untrackReadPath,
} from "./mod.ts";
import { crc32HexOfString } from "./crc.ts";
import { levenshteinSimilarity, normalizeWhitespace } from "./normalize.ts";
import type { LspManagerLike } from "./lsp.ts";

export function parseBlocks(raw: string): EditBlock[] {
  const blocks: EditBlock[] = [];
  let inBlock = false;
  let searchLines: string[] = [];
  let replaceLines: string[] = [];
  let phase = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "<<<<<<< SEARCH") {
      if (inBlock) {
        throw new ToolError(
          "Nested SEARCH/REPLACE block detected. Close each block with >>>>>>> REPLACE before starting a new one.",
        );
      }
      inBlock = true;
      searchLines = [];
      replaceLines = [];
      phase = 1;
    } else if (trimmed === "=======" && phase === 1) {
      phase = 2;
    } else if (trimmed === ">>>>>>> REPLACE" && phase === 2) {
      const search = searchLines.join("\n");
      if (search === "") {
        throw new ToolError(
          `Block ${blocks.length + 1} has empty search text. Each block must have a non-empty SEARCH section.`,
        );
      }
      blocks.push({ search, replace: replaceLines.join("\n") });
      inBlock = false;
      phase = 0;
    } else if (phase === 1) {
      searchLines.push(line);
    } else if (phase === 2) {
      replaceLines.push(line);
    }
  }
  if (inBlock) {
    throw new ToolError(
      "Unclosed SEARCH/REPLACE block. Each block must end with >>>>>>> REPLACE.",
    );
  }
  if (blocks.length === 0) {
    throw new ToolError(
      "No SEARCH/REPLACE blocks found. Use format:\n<<<<<<< SEARCH\nexisting code to find\n=======\nreplacement code\n>>>>>>> REPLACE\n\nMultiple blocks can be included for editing different parts of the same file.",
    );
  }
  return blocks;
}

export type MatchResult =
  | { kind: "exact"; pos: number }
  | { kind: "normalized"; start: number; end: number }
  | { kind: "fuzzyApply"; start: number; end: number; similarity: number }
  | { kind: "fuzzySuggest"; line: number; similarity: number; preview: string }
  | { kind: "notFound" };

export function computeByteRange(content: string, normPos: number, normLen: number): [number, number] {
  const contentNorm = normalizeWhitespace(content);
  const normEnd = Math.min(normPos + normLen, contentNorm.length);
  let origPos = 0;
  let normRem = 0;
  let byteStart: number | undefined;
  while (origPos < content.length && normRem < normEnd) {
    if (normRem >= contentNorm.length) break;
    const ch = content[origPos];
    if (ch === "\t") {
      const tabSpaces = 4;
      if (normRem < normPos) {
        origPos += 1;
        normRem = Math.min(normRem + tabSpaces, contentNorm.length);
        continue;
      }
      if (byteStart === undefined) byteStart = origPos;
      origPos += 1;
      normRem = Math.min(normRem + tabSpaces, contentNorm.length);
      continue;
    }
    if (normRem < normPos) {
      origPos += 1;
      normRem += 1;
      continue;
    }
    if (byteStart === undefined) byteStart = origPos;
    if (ch === "\r" && normRem < contentNorm.length && contentNorm[normRem] === "\n") {
      origPos += 1;
      continue;
    }
    origPos += 1;
    normRem += 1;
  }
  const start = byteStart ?? content.length;
  return [start, origPos];
}

export function findBestMatch(content: string, search: string): MatchResult {
  const exactPos = content.indexOf(search);
  if (exactPos !== -1) return { kind: "exact", pos: exactPos };
  const contentNorm = normalizeWhitespace(content);
  const searchNorm = normalizeWhitespace(search);
  const normPos = contentNorm.indexOf(searchNorm);
  if (normPos !== -1) {
    const [start, end] = computeByteRange(content, normPos, searchNorm.length);
    return { kind: "normalized", start, end };
  }
  const searchLines = search.split("\n");
  const contentLines = content.split("\n");
  if (searchLines.length === 0 || contentLines.length < searchLines.length) {
    return { kind: "notFound" };
  }
  const searchNormLines = searchLines.map((l) => normalizeWhitespace(l));
  const searchNormJoined = searchNormLines.join("\n");
  let bestSim = 0;
  let bestStart = 0;
  for (let start = 0; start <= contentLines.length - searchLines.length; start++) {
    const windowNorm = contentLines
      .slice(start, start + searchLines.length)
      .map((l) => normalizeWhitespace(l))
      .join("\n");
    const sim = levenshteinSimilarity(searchNormJoined, windowNorm);
    if (sim > bestSim) {
      bestSim = sim;
      bestStart = start;
    }
    if (sim >= 0.999) break;
  }
  if (bestSim >= 0.85) {
    const byteStart = contentLines.slice(0, bestStart).reduce((acc, l) => acc + l.length + 1, 0);
    const byteEnd =
      byteStart +
      Math.max(
        contentLines.slice(bestStart, bestStart + searchLines.length).reduce((acc, l) => acc + l.length + 1, 0) - 1,
        0,
      );
    return { kind: "fuzzyApply", start: byteStart, end: byteEnd, similarity: bestSim };
  }
  if (bestSim >= 0.6) {
    const preview = searchLines.slice(0, 3).join("\n");
    return { kind: "fuzzySuggest", line: bestStart + 1, similarity: bestSim, preview };
  }
  return { kind: "notFound" };
}

export function countExactMatches(content: string, search: string): number {
  if (search === "") return 0;
  let count = 0;
  let idx = 0;
  while (true) {
    const found = content.indexOf(search, idx);
    if (found === -1) break;
    count += 1;
    idx = found + search.length;
  }
  return count;
}

type Range = [number, number, string];

async function handleSimilarity(
  path: string,
  block: string,
  content: string,
): Promise<{ notes: string[]; ranges: Range[] }> {
  const blocks = parseBlocks(block);
  interface Resolved {
    byteStart: number;
    byteEnd: number;
    replace: string;
    note: string;
  }
  const resolved: Resolved[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const blk = blocks[i];
    const label = blocks.length > 1 ? `Block ${i + 1}: ` : "";
    const match = findBestMatch(content, blk.search);
    if (match.kind === "exact") {
      const count = countExactMatches(content, blk.search);
      if (count > 1) {
        const lineStarts: number[] = [0];
        for (let j = 0; j < content.length; j++) {
          if (content[j] === "\n") lineStarts.push(j + 1);
        }
        const matchInfo: string[] = [];
        let idx = 0;
        while (true) {
          const found = content.indexOf(blk.search, idx);
          if (found === -1) break;
          idx = found + blk.search.length;
          let lineNum: number;
          let lo = 0;
          let hi = lineStarts.length - 1;
          let exact = -1;
          while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            if (lineStarts[mid] === found) {
              exact = mid;
              break;
            } else if (lineStarts[mid] < found) lo = mid + 1;
            else hi = mid - 1;
          }
          lineNum = exact !== -1 ? exact + 1 : lo;
          const ls = lineStarts[lineNum - 1] ?? 0;
          const nl = content.indexOf("\n", ls);
          const le = nl === -1 ? content.length : nl;
          const text = content.slice(ls, le).slice(0, 100);
          matchInfo.push(`  Line ${lineNum}: ${text}`);
        }
        throw new ToolError(
          `${label}search text matched ${count} times in ${path}:\n${matchInfo.join("\n")}\n\nAdd more surrounding context to the SEARCH block to make it unique.`,
        );
      }
      resolved.push({ byteStart: match.pos, byteEnd: match.pos + blk.search.length, replace: blk.replace, note: "" });
    } else if (match.kind === "normalized") {
      resolved.push({ byteStart: match.start, byteEnd: match.end, replace: blk.replace, note: "matched after whitespace normalization" });
    } else if (match.kind === "fuzzyApply") {
      resolved.push({
        byteStart: match.start,
        byteEnd: match.end,
        replace: blk.replace,
        note: `fuzzy match, ${Math.round(match.similarity * 100)}% similarity`,
      });
    } else if (match.kind === "fuzzySuggest") {
      throw new ToolError(
        `${label}search text not found in '${path}'. Closest match at line ${match.line}, ${Math.round(match.similarity * 100)}% similar:\n  ${match.preview}\n\nRead the file around that area, copy the exact text, and retry the edit.`,
      );
    } else {
      throw new ToolError(
        `${label}search text not found in '${path}'.\nRead the file and copy the exact text for the SEARCH block, ensuring whitespace and indentation match.`,
      );
    }
  }
  const notes: string[] = [];
  const ranges: Range[] = [];
  for (const rb of resolved) {
    if (rb.note !== "") notes.push(rb.note);
    ranges.push([rb.byteStart, rb.byteEnd, rb.replace]);
  }
  return { notes, ranges };
}

export function parseTaggedLine(raw: string): [number, string] | undefined {
  const stripped = raw.replace(/^[ \t]+/, "");
  const spaceIdx = stripped.indexOf(" ");
  if (spaceIdx === -1) return undefined;
  const numTag = stripped.slice(0, spaceIdx);
  const pipeIdx = numTag.indexOf("|");
  if (pipeIdx === -1) return undefined;
  const numStr = numTag.slice(0, pipeIdx);
  const tag = numTag.slice(pipeIdx + 1);
  const lineNum = Number(numStr);
  if (!Number.isInteger(lineNum) || tag.length !== 8 || !/^[0-9a-fA-F]{8}$/.test(tag)) return undefined;
  return [lineNum, tag];
}

export function extractLineInfo(linesRaw: string): Array<[number, string]> {
  const result: Array<[number, string]> = [];
  for (const line of linesRaw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const parsed = parseTaggedLine(line);
    if (!parsed) {
      throw new ToolError(
        `Invalid tagged line format. Expected 'N|TAG content', got: '${trimmed}'`,
      );
    }
    result.push(parsed);
  }
  if (result.length === 0) {
    throw new ToolError("No valid tagged lines found. Copy lines from the read output exactly.");
  }
  return result;
}

export function validateTag(contentLines: string[], lineNum: number, tag: string): void {
  const idx = lineNum - 1;
  const actual = contentLines[idx];
  if (actual === undefined) {
    throw new ToolError(`Line ${lineNum} is out of range (file has ${contentLines.length} lines)`);
  }
  const expected = crc32HexOfString(actual);
  if (expected !== tag) {
    throw new ToolError(
      `Tag mismatch at line ${lineNum}: expected ${tag} but line content has tag ${expected}. The file may have changed. Re-read and retry.`,
    );
  }
}

export function lineRangeToByteRange(
  contentLines: string[],
  startLine: number,
  endLine: number,
): [number, number] {
  if (contentLines.length === 0 || startLine === 0 || startLine > contentLines.length) return [0, 0];
  const end = Math.min(endLine, contentLines.length);
  const byteStart = contentLines.slice(0, startLine - 1).reduce((acc, l) => acc + l.length + 1, 0);
  const byteEnd =
    byteStart +
    Math.max(contentLines.slice(startLine - 1, end).reduce((acc, l) => acc + l.length + 1, 0) - 1, 0);
  return [byteStart, byteEnd];
}

async function handleHashedit(
  path: string,
  fileCrc: string,
  edits: EditOp[],
  content: string,
): Promise<{ notes: string[]; ranges: Range[] }> {
  const actualCrc = crc32HexOfString(content);
  if (actualCrc !== fileCrc) {
    throw new ToolError(
      `File CRC mismatch for '${path}': expected ${fileCrc} but file now has ${actualCrc}. The file has changed since the read. Re-read and retry.`,
    );
  }
  const contentLines = content.split("\n");
  const notes: string[] = [];
  const ranges: Range[] = [];
  for (let i = 0; i < edits.length; i++) {
    const op = edits[i];
    const label = edits.length > 1 ? `Edit ${i + 1}: ` : "";
    if (op.line !== undefined && op.lines === undefined) {
      const parsed = parseTaggedLine(op.line);
      if (!parsed) {
        throw new ToolError(`${label}invalid tagged line format. Expected 'N|TAG content', got: '${op.line}'`);
      }
      const [lineNum, tag] = parsed;
      try {
        validateTag(contentLines, lineNum, tag);
      } catch (e) {
        throw new ToolError(`${label}${e instanceof Error ? e.message : String(e)}`);
      }
      const [bs, be] = lineRangeToByteRange(contentLines, lineNum, lineNum);
      ranges.push([bs, be, op.text]);
    } else if (op.lines !== undefined && op.line === undefined) {
      const entries = extractLineInfo(op.lines);
      for (const [lineNum, tag] of entries) {
        try {
          validateTag(contentLines, lineNum, tag);
        } catch (e) {
          throw new ToolError(`${label}${e instanceof Error ? e.message : String(e)}`);
        }
      }
      const startLine = entries[0][0];
      const endLine = entries[entries.length - 1][0];
      const [bs, be] = lineRangeToByteRange(contentLines, startLine, endLine);
      ranges.push([bs, be, op.text]);
    } else if (op.line !== undefined && op.lines !== undefined) {
      throw new ToolError(`${label}both 'line' and 'lines' specified — use only one`);
    } else {
      throw new ToolError(`${label}neither 'line' nor 'lines' specified — provide one`);
    }
  }
  return { notes, ranges };
}

export class EditTool implements Tool<EditArgs, string> {
  static readonly NAME = "edit";
  readonly name = "edit";
  permission: PermCheckLike | undefined | null;
  askTx: AskSenderLike | undefined | null;
  lsp: LspManagerLike | undefined | null;

  constructor(permission?: PermCheckLike | null, askTx?: AskSenderLike | null) {
    this.permission = permission ?? null;
    this.askTx = askTx ?? null;
    this.lsp = null;
  }

  withLsp(lsp: LspManagerLike | undefined | null): this {
    this.lsp = lsp ?? null;
    return this;
  }

  description(): string {
    if (editSystem() === "hashedit") {
      return "Edit a file using tag-based line references. Copy tagged lines from read output. Edit is CAS-guarded via file-level CRC-32 hash. All edits in one call are applied atomically.";
    }
    return "Edit a file using aider-style SEARCH/REPLACE blocks. Each block finds exact text and replaces it. Multiple blocks in one call are applied atomically. If the search text is not an exact match, whitespace normalization and fuzzy matching are attempted as fallbacks.";
  }

  parameters(): Record<string, unknown> {
    if (editSystem() === "hashedit") {
      return {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file (relative or absolute)" },
          file_crc: { type: "string", description: "8-char hex CRC-32 from the read output header [CRC: ...]" },
          edits: {
            type: "array",
            items: {
              type: "object",
              properties: {
                line: { type: "string", description: "For single-line edits: copy-paste the tagged line from read output. Format: 'N|TAG content'" },
                lines: { type: "string", description: "For range edits: copy-paste multiple tagged lines from read output. Newline-separated." },
                text: { type: "string", description: "Replacement text. Use empty string to delete." },
              },
              required: ["text"],
            },
            description: "Array of edit operations",
          },
        },
        required: ["path", "file_crc", "edits"],
      };
    }
    return {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file (relative or absolute)" },
        block: {
          type: "string",
          description: "One or more SEARCH/REPLACE blocks:\n<<<<<<< SEARCH\nexisting code to find\n=======\nreplacement code\n>>>>>>> REPLACE\n\nInclude multiple blocks for separate edits to the same file.",
        },
      },
      required: ["path", "block"],
    };
  }

  async call(args: EditArgs): Promise<string> {
    const path = expandTilde(args.path);
    const coaching = await checkPermPath(this.permission, this.askTx, "edit", path);
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch (e) {
      throw new ToolError(e instanceof Error ? e.message : String(e));
    }
    const hasCrlf = bytes.includes(Buffer.from("\r\n"));
    const content = bytes.toString("utf8").replace(/\r\n/g, "\n");
    let resolved: { notes: string[]; ranges: Range[] };
    if (args.block !== undefined) {
      resolved = await handleSimilarity(path, args.block, content);
    } else if (args.file_crc !== undefined && args.edits !== undefined) {
      resolved = await handleHashedit(path, args.file_crc, args.edits, content);
    } else {
      throw new ToolError(
        "Provide either 'block' (SEARCH/REPLACE) or 'file_crc'+'edits' (hashedit). Use /editsys to check the current mode.",
      );
    }
    const editCount = resolved.ranges.length;
    const ranges = [...resolved.ranges].sort((a, b) => b[0] - a[0]);
    let modified = content;
    for (const [byteStart, byteEnd, replace] of ranges) {
      if (byteEnd > modified.length || byteStart > modified.length) {
        throw new ToolError("Internal error: edit range exceeds file bounds. The file may have changed. Re-read and retry.");
      }
      modified = modified.slice(0, byteStart) + replace + modified.slice(byteEnd);
    }
    const output = hasCrlf ? modified.replace(/\n/g, "\r\n") : modified;
    try {
      await atomicWrite(path, output);
    } catch (e) {
      throw new ToolError(e instanceof Error ? e.message : String(e));
    }
    untrackReadPath(path);
    let result = `Applied ${editCount} edit(s) to ${path}`;
    for (const note of resolved.notes) result += `\n  Note: ${note}`;
    if (coaching) result = `${coaching}\n\n${result}`;
    if (this.lsp) {
      await this.lsp.notifyChanged(path);
      const block = await this.lsp.diagnosticsBlockForEdit(path);
      if (block) result += block;
    }
    return result;
  }
}
