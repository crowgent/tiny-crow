import { existsSync, readFileSync, renameSync } from "node:fs";
import path from "node:path";
import { atomicWrite, dataDir } from "./storage.ts";

export interface ChatHistoryEntry {
  content: string;
  timestamp: string;
}

function chatHistoryPath(): string {
  return path.join(dataDir(), "chat_history.json");
}

export function appendEntry(entry: ChatHistoryEntry): void {
  const filePath = chatHistoryPath();
  let entries: ChatHistoryEntry[] = [];
  if (existsSync(filePath)) {
    const content = readFileSync(filePath, "utf8");
    try {
      const parsed = JSON.parse(content) as unknown;
      entries = Array.isArray(parsed) ? (parsed as ChatHistoryEntry[]) : [];
    } catch {
      // File is corrupt — back it up rather than silently discarding history.
      const bak = filePath.replace(/\.json$/, "") + ".json.bak";
      renameSync(filePath, bak);
      console.warn(`chat history was corrupt, backed up to ${bak}`);
      entries = [];
    }
  }
  entries.push({ ...entry });
  atomicWrite(filePath, JSON.stringify(entries, null, 2));
}

export function loadHistory(): ChatHistoryEntry[] {
  const filePath = chatHistoryPath();
  if (!existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as ChatHistoryEntry[]) : [];
  } catch {
    return [];
  }
}
