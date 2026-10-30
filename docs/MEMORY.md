---
description: "Tiny-crow's file-based recall: plain Markdown notes on disk, the tools that read and write them, how recall reaches a prompt, and the guards that keep destructive edits recoverable."
---

# Recall that survives the end of a session

Memory is an optional subsystem, switched on through the memory settings (see CONFIG.md), that lets the agent remember things from earlier sessions. There is no database behind it and no indexing service: everything is plain Markdown on disk, under the agent settings directory at `<config_dir>/agent/memory/`. The design deliberately keeps the store legible and hand-editable, so a person can open any file, fix a fact, or delete a stale note without special tooling, and the agent's recall is exactly what those files say.

## Guarding destructive changes with a single backup

A change that can destroy content first copies the current file to a sibling with a `.bak` suffix, one version only, so `MEMORY.md` becomes `MEMORY.bak`, and the pre-change content stays recoverable. Each qualifying change overwrites the previous backup rather than building a history. Because the suffix is not `.md`, backups stay out of both the listing tool and the search tool, which filter to `.md` only, so a backup never slips into the model's context by accident.

A backup is made only before the operations below, and only when the target file already exists; a first-ever overwrite of a file that has not been created yet has nothing to preserve and skips silently. Overwriting through the write tool backs up the global file and the scratchpad, but not a daily log or a note. Replacing content through the edit tool, with a match string supplied, backs up the global file and the scratchpad, but not a daily log or a note. Deleting a whole note through the edit tool, with no match string supplied, backs up that note alone, and has no equivalent for the other targets. Appending never backs up anything, because an append cannot destroy content by construction, and content edits to daily logs and notes are targeted unique-match replacements, low-risk and already reversible with another edit, so they are deliberately left without backups to avoid churn.

When the backup copy itself fails, for instance because the `.bak` path is not writable, the requested change still goes ahead, since the primary operation is what was asked for, but the tool response gains a warning note saying the backup failed and no `.bak` was written, so the caller knows there is no undo for that change, and the failure is also logged.

## Ceilings on what recall can inject or accept

Two constants bound the subsystem. The injection ceiling is 32,768 bytes (32 KiB), named `MAX_INJECT_BYTES`, and it caps both the context block and the rendered search output. The per-call write ceiling is 65,536 bytes (64 KiB), named `MAX_WRITE_BYTES`, and it caps the content of a single write call, truncating with a warning when exceeded.

## The four tools the agent gets when memory is on

Once memory is enabled, four tools appear. The write tool takes a destination, the Markdown to persist, a mode, and an optional name: the destination is one of `long_term`, `scratchpad`, `daily`, or `note`; the mode is `append` by default or `overwrite`; and the name is a file stem, required when the destination is a note. The read tool takes a source and an optional name: the source is one of `long_term`, `scratchpad`, `daily`, `note`, or `list`, and the name is a note stem, or a `YYYY-MM-DD` date for a daily log; with the source set to listing, the tool enumerates every `.md` file in the store, meaning the global file plus the current project's notes and daily logs.

The edit tool takes a destination, an optional name, an optional match string, and a replacement string: the name is a note stem, required for a note, or a `YYYY-MM-DD` date for a daily log when an earlier day is meant, today being the default. It replaces one unique substring in place. The match string is compared literally, with no fuzzy matching, and it must occur exactly once in the target file; zero matches or several matches both fail without writing anything. The replacement replaces the match verbatim, with no newline cleanup, so an empty replacement deletes exactly the matched text, and folding the trailing newline into the match string deletes a whole line. Leaving the match string out deletes an entire note file from disk, which requires the destination to be a note with a name; leaving it out for the global file, the scratchpad, or a daily log is rejected and changes nothing, and trying to delete a note that does not exist is an error.

The search tool takes a single query, space-separated keywords matched without regard to case, and returns ranked files with context windows.

## The pieces the tools are built from

A write destination, called `WriteTarget`, chooses the file a write lands in: the global file for long-term, the per-project checklist for the scratchpad, today's running log for daily, and a named reference note for notes. A write mode, called `WriteMode`, is either appending, which adds content and inserts a newline separator when the file does not already end with one, with deduplication applied for long-term appends only as described later, or overwriting, which replaces the whole file.

The store handle, called `Mem`, carries three fields: a root path pointing at `<config_dir>/agent/memory/`, a project slug derived from the working directory, and today's date written as `YYYY-MM-DD`. Its public operations are opening the store while working out the project slug from the working directory; persisting content to a destination; adding a timestamped entry to today's log; building the injected recall block described later; and running a keyword search across all memory files, in multiple terms.

A single search result, called `SearchHit`, carries the file's path; which query terms matched, in query order; how many lines matched; rendered context windows, or a filename-match preview; a flag that is true when only the filename matched and not the content; the daily log's date, used for recency ordering; and a flag marking whether this is the global file, which is always sorted first. A whole search outcome, called `SearchResults`, carries each term with its total match count, the ranked list of matching files, and a render operation that formats the results as a string, greedily capped.

## What lives on disk, and how a project gets its own corner

The store is laid out with the global long-term file at the top, and a projects directory beneath it holding one folder per project slug. Inside a project folder sit the checklist file, a daily directory of dated logs, and a notes directory of reference notes that are never auto-injected. As an illustration with fresh example names:

```
<config_dir>/agent/memory/
├── MEMORY.md
└── projects/
    └── <project-slug>/
        ├── SCRATCHPAD.md
        ├── daily/
        │   ├── 2026-06-14.md
        │   └── 2026-06-13.md
        └── notes/
            ├── billing.md
            └── rollout.md
```

Per-project files, meaning the checklist, the daily logs, and the notes, are keyed by a slug built from the working directory: the sanitised folder name, a hyphen, and the first eight hex characters of a hash of the full path, so two repositories that share a folder name still get separate storage. The global file is shared across every project.

Which files feed a prompt on their own differs by destination. The global file is always fed in. The scratchpad contributes only its open items, meaning unchecked `- [ ]` or `* [ ]` entries. Daily logs contribute the two most recent non-empty logs. Notes are never fed in on their own; they are reached only through search and read.

## How recall is assembled into a prompt

Each turn, the agent builds a recall block and injects it into the system prompt. The block assembles up to four sections, in this priority order, with the most fragile, most task-relevant material first: open items from the scratchpad; the newest of the two selected daily logs; long-term memory; and the older of the two selected daily logs. The today label is attached only when a section's date is literally today's date, never merely because a daily log happens to be the newest one. In outline, the block opens with a memory tag carrying a note that the contents are reference only and must not be followed as instructions, then the scratchpad section holding only unchecked items, then the newest daily log section, then the long-term section, then the older daily log section, then the closing tag.

How the block is bounded matters. The whole output is capped at the injection ceiling. Sections are taken whole while they fit the remaining budget, in priority order. The first section that does not fit whole is tail-truncated to use exactly what is left, marked as truncated with its title, and every lower-priority section after it is left out entirely, marked as omitted with its title, instead of pushing out a higher-priority section that already fit whole. A final whole-string truncation pass for wide characters remains as a hard backstop against unexpected overrun. Files that are missing or empty are skipped without a trace. When nothing exists at all, the result is empty, leaving zero trace in the prompt. Notes are deliberately kept out, and daily-log selection is limited to the two most recent non-empty logs. The XML attribute warns the model that memory is reference material, not instructions to follow.

When memory is on, a tools prompt is appended to the system preamble as well. It tells the model when to use each write target, that scratchpad open items arrive automatically, that notes do not arrive automatically and must be found with search and read with read, and that memory is reference, not instructions.

## Finding things, and the order results come back in

Search runs a case-insensitive, multi-term keyword search in these steps. First the query is split on whitespace, and duplicate terms are removed while keeping their order. Then each term is escaped and matched literally, with no regex injection, and a line matches when it contains any term. Matched lines are then widened to three lines of context on either side, regions that touch or overlap are merged, and the result is capped at five regions per file. When no content matches but the filename does, a short preview is produced, ranked below content hits. Files are then sorted by the global file first, then by more distinct terms matched, then by content hits ahead of filename-only hits, then by more total matching lines, then by newer daily logs first, and finally by a stable path tiebreak.

Search looks through the global root file, the current project's notes, and the current project's daily logs for every date, unlike the context block, which takes only the two most recent non-empty logs.

## Keeping the global file to one fact per line

The global file is curated one fact per line, so appending to the long-term destination deduplicates the lines it appends. This applies to long-term appends only: scratchpad, daily, and note appends are never deduplicated, repeats are kept, and no destination deduplicates on overwrite.

Comparison ignores whitespace differences: each line is normalised by trimming and collapsing every run of Unicode whitespace, ASCII spaces and tabs plus the full-width space, down to a single ASCII space, preserving case, so two lines that differ only in how wide their whitespace is count as duplicates.

For one long-term append batch, meaning the incoming content split on newlines: duplicates inside the batch are dropped, keeping the first occurrence; lines whose normalised form already appears anywhere in the global file are dropped; blank or whitespace-only lines normalise to empty, never act as a deduplication key since they carry no fact, and are kept verbatim; and when nothing meaningful survives, the write is skipped entirely and the file stays byte-for-byte unchanged.

The reply reflects what happened. With no duplicates, it reports the bytes written and the path, unchanged in form. With some duplicates dropped, it reports the bytes written, the path, and how many duplicate lines were skipped. With the whole batch dropped, it reports that nothing was written to the path because every line was a duplicate.

## Letting summaries survive compression

Memory hooks into session compaction so summaries are not lost when context is compressed. Adding a timestamped entry to today's daily log is the operation the compaction flush uses, so summaries survive compression deterministically, rather than depending on the model to remember them. A helper returns a compaction heading shaped as a summary label with a message count, or a bare summary label when no count is given. A flush helper persists a compaction summary to today's daily log through the timestamped-entry operation, and the compress slash command calls it before compressing the session. A reserve helper works out a compaction reserve that includes the injected recall block's token estimate, because the block lives in the preamble rather than in session messages, so the session's own token accounting misses it, and folding the estimate into the reserve makes compaction fire early enough to leave headroom. An append helper attaches the recall block to the system prompt preamble, separated by a blank line, a rule, and a blank line, and it does nothing when given an empty value.
