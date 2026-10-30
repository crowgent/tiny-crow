import { markdownToStyled, wordWrap } from "./markdown.ts";
import type { LineEntry } from "./renderer.ts";
import { color as roleColor } from "./roles.ts";
import type { Color } from "./utils.ts";

/**
 * Semantic role of a conversation block in the feed. Roles are
 * independent of terminal colours; `blockColor` maps each role to a
 * colour, honouring `[colors.roles]` overrides (see `roles.ts`).
 */
export const BlockStyle = {
  User: "user",
  Agent: "agent",
  Reasoning: "reasoning",
  Tool: "tool",
  ToolResult: "tool_result",
  Error: "error",
  System: "system",
  Welcome: "welcome",
  Permission: "permission",
  Plain: "plain",
} as const;

export type BlockStyle = (typeof BlockStyle)[keyof typeof BlockStyle];

/** The colour a role renders in, honouring configured overrides. */
export function blockColor(style: BlockStyle): Color {
  return roleColor(style);
}

/**
 * Map a legacy terminal colour to the closest semantic block style.
 * Used while migrating callers from `Renderer.writeLine(text, colour)` to
 * the feed model; new code should prefer `BlockStyle` directly.
 */
export function styleFromColor(color: Color): BlockStyle {
  switch (color) {
    case "green":
      return BlockStyle.User;
    case "dark_magenta":
      return BlockStyle.Reasoning;
    case "yellow":
      return BlockStyle.Tool;
    case "dark_grey":
      return BlockStyle.System;
    case "cyan":
      return BlockStyle.Welcome;
    case "red":
      return BlockStyle.Error;
    case "magenta":
      return BlockStyle.Permission;
    case "white":
      return BlockStyle.Plain;
    default:
      return BlockStyle.Plain;
  }
}

/** A single structured conversation block. Blocks store raw text; layout happens in `Feed.lines(width)`. */
export class Block {
  style: BlockStyle;
  text: string;
  /** True while a producer is still appending to this block (streaming agent tokens). */
  running: boolean;
  private mdCache: {
    width: number;
    parsedLen: number;
    lines: LineEntry[];
  } | null = null;

  constructor(style: BlockStyle, text: string) {
    this.style = style;
    this.text = text;
    this.running = false;
  }

  getMdCache(): { width: number; parsedLen: number; lines: LineEntry[] } | null {
    return this.mdCache;
  }

  setMdCache(cache: { width: number; parsedLen: number; lines: LineEntry[] } | null): void {
    this.mdCache = cache;
  }
}

interface LayoutCache {
  width: number;
  generation: number;
  lines: LineEntry[];
}

/**
 * Conversation feed: a sequence of semantic blocks that can be laid out
 * at any width. Layout is memoised per (width, generation) so scroll and
 * selection queries reuse the pre-wrapped rows instead of re-laying out
 * the whole feed on every call.
 */
export class Feed {
  private blocks: Block[] = [];
  private generationValue = 0;
  private layoutCache: LayoutCache | null = null;

  constructor() {}

  static new(): Feed {
    return new Feed();
  }

  /** Monotonic counter bumped on every content mutation. */
  generation(): number {
    return this.generationValue;
  }

  clear(): void {
    this.generationValue += 1;
    this.blocks = [];
  }

  isEmpty(): boolean {
    return this.blocks.length === 0;
  }

  blockCount(): number {
    return this.blocks.length;
  }

  blocksSnapshot(): Block[] {
    return [...this.blocks];
  }

  pushBlock(style: BlockStyle, text: string): void {
    this.generationValue += 1;
    this.blocks.push(new Block(style, text));
  }

  /**
   * Push an empty block that a producer will append to incrementally
   * (streaming agent tokens). While running, agent blocks parse markdown
   * only for completed lines and render the unfinished tail line as plain
   * text. Call `finalizeLast` when the stream ends.
   */
  pushStreamingBlock(style: BlockStyle): void {
    this.generationValue += 1;
    const block = new Block(style, "");
    block.running = true;
    this.blocks.push(block);
  }

  /** Mark the last block as complete; its full text is parsed as markdown on the next layout. No-op when the last block is not running. */
  finalizeLast(): void {
    const last = this.blocks[this.blocks.length - 1];
    if (last !== undefined && last.running) {
      this.generationValue += 1;
      last.running = false;
      last.setMdCache(null);
    }
  }

  pushLine(style: BlockStyle, text: string): void {
    this.pushBlock(style, text);
  }

  /** Append text to the most recent block. Returns false when the feed is empty. */
  appendToLast(text: string): boolean {
    const last = this.blocks[this.blocks.length - 1];
    if (last === undefined) return false;
    this.generationValue += 1;
    last.text += text;
    return true;
  }

  /** Replace the last block, or push a new one if the feed is empty. */
  replaceLast(style: BlockStyle, text: string): void {
    this.generationValue += 1;
    const last = this.blocks[this.blocks.length - 1];
    if (last !== undefined) {
      last.style = style;
      last.text = text;
      last.running = false;
      last.setMdCache(null);
    } else {
      this.blocks.push(new Block(style, text));
    }
  }

  truncateBlocks(len: number): void {
    this.generationValue += 1;
    this.blocks.length = Math.min(len, this.blocks.length);
  }

  /** Return the fully laid-out chat lines for the given width. */
  lines(width: number): LineEntry[] {
    return [...this.linesShared(width)];
  }

  /** Shared version of `lines()`: the cached array is returned directly when valid. */
  linesShared(width: number): LineEntry[] {
    const cached = this.layoutCache;
    if (cached !== null && cached.width === width && cached.generation === this.generationValue) {
      return cached.lines;
    }
    const lines = this.computeLines(width);
    this.layoutCache = { width, generation: this.generationValue, lines };
    return lines;
  }

  private computeLines(width: number): LineEntry[] {
    const result: LineEntry[] = [];
    for (const block of this.blocks) {
      if (block.style === BlockStyle.Agent) {
        const styled = agentBlockLines(block, width);
        if (styled.length > 0) {
          styled[0] = { text: `< ${styled[0].text}`, color: styled[0].color };
        }
        result.push(...styled);
      } else {
        const color = blockColor(block.style);
        for (const rawLine of block.text.split("\n")) {
          const trimmed = rawLine.replace(/\r$/, "");
          if (trimmed === "") {
            result.push({ text: "", color });
          } else {
            for (const chunk of wordWrap(trimmed, width)) {
              result.push({ text: chunk, color });
            }
          }
        }
      }
    }
    return result;
  }

  /** Total number of visible rows for the given width. */
  lineCount(width: number): number {
    return this.lines(width).length;
  }

  /**
   * Index of the first and last line visible in a viewport of
   * `viewportHeight` rows with `scrollOffset`. `scrollOffset == 0` means
   * "stick to the bottom" (auto-scroll).
   */
  visibleRange(width: number, scrollOffset: number, viewportHeight: number): [number, number] {
    const total = this.lineCount(width);
    const visible = Math.min(viewportHeight, total);
    const autoScroll = scrollOffset === 0;
    const start = autoScroll
      ? Math.max(0, total - visible)
      : Math.max(0, total - Math.min(scrollOffset + visible, total));
    const end = Math.min(start + visible, total);
    return [start, end];
  }

  /** Map a screen row (relative to the top of the viewport) to a line index. Returns null for padding rows or rows past the last visible line. */
  lineAtVisualRow(
    width: number,
    scrollOffset: number,
    viewportHeight: number,
    row: number,
  ): number | null {
    const total = this.lineCount(width);
    if (total === 0) return null;
    const visible = Math.min(viewportHeight, total);
    const autoScroll = scrollOffset === 0;
    const pad = autoScroll && total < viewportHeight ? viewportHeight - total : 0;
    if (row < pad) return null;
    const start = autoScroll
      ? Math.max(0, total - visible)
      : Math.max(0, total - Math.min(scrollOffset + visible, total));
    const lines = this.lines(width);
    let visualRow = pad;
    let idx = start;
    while (idx < lines.length) {
      if (visualRow === row) return idx;
      visualRow += 1;
      idx += 1;
    }
    return null;
  }

  /** Concatenate the text of all visible lines in the given range (inclusive). */
  selectedText(width: number, start: number, end: number): string | null {
    const lines = this.lines(width);
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    let result = "";
    for (let i = lo; i <= hi; i++) {
      const entry = lines[i];
      if (entry !== undefined) {
        if (result !== "") result += "\n";
        result += entry.text;
      }
    }
    return result === "" ? null : result;
  }
}

/**
 * Lay out an agent block: markdown for completed lines, plain text for
 * the unfinished tail line of a still-streaming block. The markdown parse
 * of the completed prefix is memoised in the block's cache, keyed by
 * (width, parsed length); block text grows by appends only while running,
 * so an unchanged prefix length means an unchanged prefix.
 */
function agentBlockLines(block: Block, width: number): LineEntry[] {
  const completedLen = block.running
    ? (() => {
        const idx = block.text.lastIndexOf("\n");
        return idx >= 0 ? idx + 1 : 0;
      })()
    : block.text.length;

  const cached = block.getMdCache();
  let lines: LineEntry[];
  if (cached !== null && cached.width === width && cached.parsedLen === completedLen) {
    lines = [...cached.lines];
  } else {
    const parsed = markdownToStyled(block.text.slice(0, completedLen), width);
    block.setMdCache({ width, parsedLen: completedLen, lines: [...parsed] });
    lines = parsed;
  }

  if (block.running && completedLen < block.text.length) {
    const tail = block.text.slice(completedLen).replace(/\r$/, "");
    if (tail !== "") {
      const color = blockColor(BlockStyle.Agent);
      for (const chunk of wordWrap(tail, width)) {
        lines.push({ text: chunk, color });
      }
    }
  }
  return lines;
}
