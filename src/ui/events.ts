import { BlockStyle, type Feed } from "./feed.ts";
import type { Renderer } from "./renderer.ts";
import {
  resolveModel,
  resolveShowToolDetails,
  type Cli,
  type Config,
  type ContextFiles,
  type Session,
} from "./state.ts";

/** Version string shown in the welcome banner (the TS port's own version; the package slice owns the canonical value). */
export const TINY_CROW_VERSION = "1.8.5";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Format an RFC3339 timestamp for display: today's times as `HH:MM`, this year's as `Mon DD HH:MM`, older as `YYYY-MM-DD HH:MM`. Unparsable input passes through unchanged. */
export function formatTime(rfc3339: string): string {
  const dt = new Date(rfc3339);
  if (Number.isNaN(dt.getTime())) return rfc3339;
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  const hhmm = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  const sameDay =
    dt.getFullYear() === now.getFullYear() &&
    dt.getMonth() === now.getMonth() &&
    dt.getDate() === now.getDate();
  if (sameDay) return hhmm;
  if (dt.getFullYear() === now.getFullYear()) {
    return `${MONTHS[dt.getMonth()]} ${pad(dt.getDate())} ${hhmm}`;
  }
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${hhmm}`;
}

/** Render a whole session into the renderer's feed: context-file notices, compaction notices, then every message in role order. */
export function renderSession(
  renderer: Renderer,
  session: Session,
  cli: Cli,
  cfg: Config,
  context: ContextFiles,
): void {
  renderer.clearContent();
  const feed = renderer.feedMut();
  if (context.agents !== undefined) {
    feed.pushLine(BlockStyle.System, "[system] loaded AGENTS.md");
    feed.pushLine(BlockStyle.Plain, "");
  }
  if (context.architecture !== undefined) {
    feed.pushLine(BlockStyle.System, "[system] loaded ARCHITECTURE.md");
    feed.pushLine(BlockStyle.Plain, "");
  }
  if (session.compactions.length > 0) {
    const last = session.compactions[session.compactions.length - 1];
    feed.pushLine(
      BlockStyle.System,
      `compacted ${session.compactions.length} times (saved ~${last?.tokenSavings ?? 0} tokens)`,
    );
    feed.pushLine(BlockStyle.Plain, "");
  }
  for (const msg of session.messages) {
    switch (msg.role) {
      case "user":
        for (const line of msg.content.split("\n")) {
          feed.pushLine(BlockStyle.User, `> ${line}`);
        }
        break;
      case "assistant":
        feed.pushBlock(BlockStyle.Agent, msg.content);
        break;
      case "system":
        for (const line of msg.content.split("\n")) {
          feed.pushLine(BlockStyle.System, `# ${line}`);
        }
        break;
      case "tool_call":
        for (const line of msg.content.split("\n")) {
          feed.pushLine(BlockStyle.Tool, `◈ ${line}`);
        }
        break;
      case "tool_result":
        renderToolResultToFeed(feed, msg.content, cfg);
        break;
      case "subagent_tool_call":
        for (const line of msg.content.split("\n")) {
          feed.pushLine(BlockStyle.Tool, `⌥ ${line}`);
        }
        break;
      default:
        break;
    }
    feed.pushLine(BlockStyle.Plain, "");
  }
  if (session.messages.length === 0) {
    const cwdParts = process.cwd().replace(/\/$/, "").split("/");
    const cwdStr = cwdParts[cwdParts.length - 1] ?? ".";
    feed.pushLine(
      BlockStyle.Welcome,
      `[>] tiny-crow ${TINY_CROW_VERSION} | ${resolveModel(cli, cfg)} | ${cwdStr}`,
    );
    feed.pushLine(BlockStyle.Welcome, "──────────────────────────────────────────────────");
    feed.pushLine(BlockStyle.Welcome, "Ready to code; type a request or '/' for commands");
    feed.pushLine(BlockStyle.Welcome, "Run /welcome or /tutor to get started");
    feed.pushLine(BlockStyle.Plain, "");
    feed.pushLine(BlockStyle.Plain, "");
  }
}

function renderToolResultToFeed(feed: Feed, content: string, cfg: Config): void {
  const idx = content.indexOf(":\n");
  const output = idx >= 0 ? content.slice(idx + 2) : content;
  const showDetails = resolveShowToolDetails(cfg.showToolDetails);
  switch (showDetails.kind) {
    case "off":
      feed.pushLine(BlockStyle.ToolResult, "◈ result hidden by show_tool_details=false");
      break;
    case "limited": {
      const sanitized = sanitizeOutput(output);
      const charCount = [...sanitized].length;
      const lines = sanitized.split("\n");
      if (lines.length > showDetails.maxLines) {
        const shown = lines.slice(0, showDetails.maxLines).join("\n");
        feed.pushLine(
          BlockStyle.ToolResult,
          `◈ result (${charCount} chars, ${lines.length} lines, showing ${showDetails.maxLines}):\n${shown}`,
        );
      } else {
        feed.pushLine(BlockStyle.ToolResult, `◈ result (${charCount} chars):\n${sanitized}`);
      }
      break;
    }
    case "unlimited": {
      const sanitized = sanitizeOutput(output);
      const charCount = [...sanitized].length;
      feed.pushLine(BlockStyle.ToolResult, `◈ result (${charCount} chars):\n${sanitized}`);
      break;
    }
  }
}

/** Push the quickstart help text into the feed. */
export function showWelcome(renderer: Renderer, showLazygit: boolean): void {
  const feed = renderer.feedMut();
  feed.pushLine(BlockStyle.Welcome, "──────────────────────────────────────────");
  feed.pushLine(BlockStyle.Welcome, "  tiny-crow Quickstart");
  feed.pushLine(BlockStyle.Welcome, "──────────────────────────────────────────");
  feed.pushLine(BlockStyle.Plain, "");
  feed.pushLine(BlockStyle.Tool, "  Pickers:");
  feed.pushLine(BlockStyle.Plain, "    @<path>     File picker / auto-complete paths");
  feed.pushLine(BlockStyle.Plain, "    !<command>  Run a shell command (output stored as assistant)");
  feed.pushLine(BlockStyle.Plain, "    .<prompt>   Switch prompt or one-shot .<prompt> <message>");
  feed.pushLine(BlockStyle.Plain, "");
  feed.pushLine(BlockStyle.Tool, "  Slash Commands:");
  feed.pushLine(BlockStyle.Plain, "    /model        Switch model");
  feed.pushLine(BlockStyle.Plain, "    /prompt       List / activate prompts");
  feed.pushLine(BlockStyle.Plain, "    .autoconfig        Switches to auto-configurator");
  feed.pushLine(BlockStyle.Plain, "    /mode         Change security mode");
  feed.pushLine(BlockStyle.Plain, "    /clear        Clear session");
  feed.pushLine(BlockStyle.Plain, "    /undo         Undo last exchange");
  feed.pushLine(BlockStyle.Plain, "    /compress     Free context window space");
  feed.pushLine(BlockStyle.Plain, "    /help         Show all commands");
  feed.pushLine(BlockStyle.Plain, "");
  feed.pushLine(BlockStyle.Tool, "  Keybindings:");
  feed.pushLine(BlockStyle.Plain, "    Ctrl+G     Open input in $EDITOR");
  if (showLazygit) {
    feed.pushLine(BlockStyle.Plain, "    Ctrl+H     Launch lazygit");
  }
  feed.pushLine(BlockStyle.Plain, "    Ctrl+S     Save session");
  feed.pushLine(BlockStyle.Plain, "    Alt+M      Quick-model switcher");
  feed.pushLine(BlockStyle.Plain, "    Alt+P      Prompt switcher");
  feed.pushLine(BlockStyle.Plain, "    Tab        File picker / auto-complete");
  feed.pushLine(BlockStyle.Plain, "");
  feed.pushLine(BlockStyle.Welcome, "──────────────────────────────────────────");
  feed.pushLine(BlockStyle.Plain, "");
}

/**
 * Strip ANSI escape sequences and stray control characters from model or
 * tool output before it reaches the terminal, so streamed text can never
 * inject terminal commands. Newlines, tabs and carriage returns survive.
 */
export function sanitizeOutput(text: string): string {
  let result = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\x1b") {
      const next = text[i + 1];
      if (next === "[" || next === "]") {
        i += 2;
        while (i < text.length) {
          const n = text[i];
          i += 1;
          if (/[A-Za-z~]/.test(n)) break;
        }
      } else if (next !== undefined) {
        i += 2;
      } else {
        break;
      }
    } else if (c !== undefined && c.charCodeAt(0) < 32 && c !== "\n" && c !== "\t" && c !== "\r") {
      i += 1;
    } else if (c !== undefined) {
      result += c;
      i += 1;
    } else {
      i += 1;
    }
  }
  return result;
}
