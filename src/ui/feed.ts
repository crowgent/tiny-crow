import { markdownToStyled, wordWrap } from "./markdown.ts";
import type { LineEntry } from "./renderer.ts";
import { color as roleColor } from "./roles.ts";
import { colorEquals, type Color } from "./utils.ts";

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

export function blockColor(style: BlockStyle): Color {
  return roleColor(style);
}

export function styleFromColor(color: Color): BlockStyle {
  if (typeof color === "object" && color.kind === "rgb") {
    const rgb = (r: number, g: number, b: number) =>
      colorEquals(color, { kind: "rgb", r, g, b });
    if (rgb(166, 218, 149)) return BlockStyle.User;
    if (rgb(202, 211, 245)) return BlockStyle.Agent;
    if (rgb(198, 160, 246)) return BlockStyle.Reasoning;
    if (rgb(238, 212, 159)) return BlockStyle.Tool;
    if (rgb(110, 115, 141)) return BlockStyle.ToolResult;
    if (rgb(237, 135, 150)) return BlockStyle.Error;
    if (rgb(147, 154, 183)) return BlockStyle.System;
    if (rgb(139, 213, 202)) return BlockStyle.Welcome;
    if (rgb(245, 189, 230)) return BlockStyle.Permission;
    return BlockStyle.Plain;
  }
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

export class Block {
  style: BlockStyle;
  text: string;
  
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

export class Feed {
  private blocks: Block[] = [];
  private generationValue = 0;
  private layoutCache: LayoutCache | null = null;

  constructor() {}

  static new(): Feed {
    return new Feed();
  }

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

  pushStreamingBlock(style: BlockStyle): void {
    this.generationValue += 1;
    const block = new Block(style, "");
    block.running = true;
    this.blocks.push(block);
  }

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

  appendToLast(text: string): boolean {
    const last = this.blocks[this.blocks.length - 1];
    if (last === undefined) return false;
    this.generationValue += 1;
    last.text += text;
    return true;
  }

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

  lines(width: number): LineEntry[] {
    return [...this.linesShared(width)];
  }

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

  lineCount(width: number): number {
    return this.lines(width).length;
  }

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
