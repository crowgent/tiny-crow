// Session export, import, and sharing: standalone HTML and JSONL.
import { estimateTokens } from "./memory/mod.ts";

/** Message shape the export functions need from the session slice. */
export interface ExportSessionMessage {
  role: string;
  content: string;
  estimatedTokens?: number;
}

/** Session shape the export functions need from the session slice. */
export interface ExportSession {
  id: string;
  name: string;
  provider: string;
  model: string;
  createdAt: string;
  messages: ExportSessionMessage[];
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCost?: number;
}

export const SESSION_JSONL_FORMAT = "zerostack-session-jsonl";

/** Export a session as JSONL: one metadata header line, then one message per line. */
export function sessionToJsonl(session: ExportSession): string {
  let out = "";
  const header = {
    type: "session",
    format: SESSION_JSONL_FORMAT,
    version: 1,
    id: session.id,
    name: session.name,
    provider: session.provider,
    model: session.model,
    created_at: session.createdAt,
  };
  out += JSON.stringify(header);
  for (const msg of session.messages) {
    out += "\n";
    out += JSON.stringify({
      role: msg.role,
      content: msg.content,
      estimated_tokens: msg.estimatedTokens ?? estimateTokens(msg.content),
    });
  }
  out += "\n";
  return out;
}

/**
 * Parse a JSONL session export back into messages. The metadata header
 * line is skipped; malformed lines throw with their line number.
 * `estimated_tokens` is optional, so bare `{role, content}` lines import too.
 */
export function parseJsonlImport(content: string): ExportSessionMessage[] {
  const messages: ExportSessionMessage[] = [];
  const lines = content.split("\n");
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!.trim();
    if (line === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`line ${idx + 1} is not valid JSON`);
    }
    if (
      value !== null &&
      typeof value === "object" &&
      (value as Record<string, unknown>).type === "session"
    ) {
      continue;
    }
    if (value === null || typeof value !== "object") {
      throw new Error(`line ${idx + 1} is not a session message`);
    }
    const record = value as Record<string, unknown>;
    if (typeof record.role !== "string" || typeof record.content !== "string") {
      throw new Error(`line ${idx + 1} is not a session message`);
    }
    messages.push({
      role: record.role,
      content: record.content,
      estimatedTokens:
        typeof record.estimated_tokens === "number" ? record.estimated_tokens : undefined,
    });
  }
  if (messages.length === 0) throw new Error("no messages found");
  return messages;
}

function escapeHtmlInto(out: string[], text: string): void {
  for (const c of text) {
    switch (c) {
      case "&":
        out.push("&amp;");
        break;
      case "<":
        out.push("&lt;");
        break;
      case ">":
        out.push("&gt;");
        break;
      case '"':
        out.push("&quot;");
        break;
      default:
        out.push(c);
    }
  }
}

function escapeHtml(text: string): string {
  const parts: string[] = [];
  escapeHtmlInto(parts, text);
  return parts.join("");
}

/**
 * Minimal Markdown-to-HTML renderer for assistant messages (no external
 * dependency): fenced code blocks, headings, bold, italic, inline code,
 * links, and paragraphs. Other roles are shown verbatim, escaped.
 */
export function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inCode = false;
  let codeLang = "";
  let codeBuf: string[] = [];
  const flushCode = () => {
    out.push(
      `<pre><code${codeLang ? ` class="language-${escapeHtml(codeLang)}"` : ""}>${escapeHtml(codeBuf.join("\n"))}</code></pre>`,
    );
    codeBuf = [];
  };
  const inline = (text: string): string => {
    // Escape first, then restore markup on the escaped text.
    let html = escapeHtml(text);
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    return html;
  };
  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        inCode = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      out.push(`<h${heading[1]!.length}>${inline(heading[2]!)}</h${heading[1]!.length}>`);
    } else if (line.trim() === "") {
      // Paragraph break; nothing to emit.
    } else {
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  if (inCode) flushCode();
  return out.join("\n");
}

const TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{title}}</title>
<style>
body { background: #1a1b26; color: #c0caf5; font-family: ui-sans-serif, system-ui, sans-serif;
  max-width: 52rem; margin: 0 auto; padding: 2rem 1rem; line-height: 1.55; }
header h1 { font-size: 1.4rem; margin-bottom: 0.2rem; }
.meta { color: #565f89; font-size: 0.85rem; }
.msg { border-top: 1px solid #292e42; padding: 0.8rem 0; }
.role { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em;
  color: #565f89; margin: 0 0 0.4rem; }
.user .role { color: #9ece6a; }
.assistant .role { color: #7aa2f7; }
pre { white-space: pre-wrap; word-wrap: break-word; font-family: ui-monospace, monospace;
  font-size: 0.85rem; margin: 0; }
.tool pre { color: #565f89; }
.markdown pre { background: #16161e; padding: 0.6rem; border-radius: 4px; overflow-x: auto; }
.markdown code { font-family: ui-monospace, monospace; font-size: 0.85rem; }
footer { color: #565f89; font-size: 0.75rem; margin-top: 2rem; }
</style>
</head>
<body>
<header>
<h1>{{title}}</h1>
<p class="meta">{{meta}}</p>
</header>
<main>
{{messages}}
</main>
<footer>exported from zerostack-ts</footer>
</body>
</html>
`;

function sessionTitle(session: ExportSession): string {
  if (session.name === "") return `zerostack-ts session ${session.id.slice(0, 8)}`;
  return session.name;
}

function roleClassLabel(
  msg: ExportSessionMessage,
  session: ExportSession,
): [string, string] {
  switch (msg.role) {
    case "user":
      return ["user", "you"];
    case "assistant":
      return ["assistant", session.model];
    case "system":
      return ["system", "system"];
    case "tool_call":
      return ["tool", "tool call"];
    case "tool_result":
      return ["tool", "tool result"];
    case "subagent_tool_call":
      return ["tool", "subagent tool call"];
    default:
      return ["tool", msg.role];
  }
}

/** Export a session as a standalone, self-contained HTML page. */
export function sessionToHtml(session: ExportSession): string {
  let messages = "";
  for (const msg of session.messages) {
    const [cls, label] = roleClassLabel(msg, session);
    messages += `<section class="msg ${cls}">\n<p class="role">${escapeHtml(label)}</p>\n`;
    if (msg.role === "assistant") {
      messages += `<div class="markdown">${markdownToHtml(msg.content)}</div>\n`;
    } else {
      messages += `<pre>${escapeHtml(msg.content)}</pre>\n`;
    }
    messages += "</section>\n";
  }
  const title = escapeHtml(sessionTitle(session));
  const meta = escapeHtml(
    `${session.provider} / ${session.model} · ${session.createdAt} · ${session.messages.length} messages · ${session.totalInputTokens ?? 0} in / ${session.totalOutputTokens ?? 0} out tokens · $${(session.totalCost ?? 0).toFixed(4)}`,
  );
  return TEMPLATE.replace("{{title}}", title).replace("{{meta}}", meta).replace("{{messages}}", messages);
}

/**
 * Upload `content` as a secret gist and return its URL. Requires
 * `GITHUB_TOKEN` or `GH_TOKEN` in the environment.
 */
export async function shareGist(
  filename: string,
  content: string,
  description: string,
): Promise<string> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!token) {
    throw new Error("set GITHUB_TOKEN or GH_TOKEN to share sessions as gists");
  }
  const body = {
    description,
    public: false,
    files: { [filename]: { content } },
  };
  let response: Response;
  try {
    response = await fetch("https://api.github.com/gists", {
      method: "POST",
      headers: {
        "User-Agent": "zerostack-ts",
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw new Error(`failed to reach the GitHub API: ${err}`);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`GitHub API returned ${response.status}: ${text.trim()}`);
  }
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const url = json?.html_url;
  if (typeof url !== "string") {
    throw new Error("GitHub API response did not include html_url");
  }
  return url;
}
