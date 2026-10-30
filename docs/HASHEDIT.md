---
description: "Word-anchored editing in tiny-crow: durable labels that follow lines when they move, the reconciliation procedure, the safety checks on every edit, and the edge cases."
---

# Edits that stay on target when lines shift

A line number names a position, and positions move. Insert a handful of lines near the top
of a file and every line below them gets a new number, so an edit aimed at one number can
quietly land on the wrong text. The system described here answers that fragility by giving
each line a durable word label that travels with the line itself: while a line's text stays
byte-for-byte identical, its label stays the same no matter how many lines appear or
disappear around it.

The system works in two movements. Reading loads the file from disk, gives every line a
durable label, and shows the labelled text to the model. Editing takes in an edit that names
labels, checks it twice over, and only then writes to disk, confirming both that the label
is still present and that the line it points at still holds the text the edit expected.

## One complete round trip, before the details

A round trip runs like this. The model asks to read a file, the system reads it from disk,
reconciles labels by hashing each line and diffing against the last known state, and hands
back labelled lines plus a file-level hash header. The model then asks to edit by naming
labels, the system re-reads the file, reconciles again, resolves each label to a line index
while verifying the supplied content, applies the edits from the bottom up, writes the
result, reconciles once more over the finished content, runs diagnostics, and returns a diff
plus diagnostics plus fresh labels where needed. The rest of this page unpacks each step of
that trip.

## Labels made of ordinary words

Each line's label is a readable token built by joining words from a fixed vocabulary of
roughly 1,720 everyday English words, in pairs such as `HarborMaple`, `StoneRaven`, or
`FieldBrook`. Two words drawn from a vocabulary that size give around 3 million distinct
pairings, which comfortably covers any file a person would realistically edit this way.
Labels always take the shape of one word joined directly to a second, for instance
`HarborMaple`.

When a line is shown to the model, its label goes in front, separated by a delimiter
character, the section sign, chosen because it is hard to overlook and almost never occurs
in source code. A short illustration, with a different snippet from any other example on
this page:

```
HarborMaple§def shipping_cost(order):
StoneRaven§    total = 0
FieldBrook§    for item in order:
```

## Reading: what the model is handed, and why the file hash travels along

The read procedure loads the file, splits it into lines, computes a hash of the entire
content, and compares that hash with the last known hash for the file. If the two match, the
system answers with a short staleness message instead of re-sending every line, which is a
pure token saving for the common case where the model re-reads a file nobody has touched.
Otherwise it reconciles labels for the current lines and formats the output as a header line
carrying the file hash in hex, followed by one labelled line per line of the file.

The header matters because the next read can be answered from it: the hash in the header is
the value the staleness check compares against, so an unchanged file costs the model almost
nothing to re-check.

## The vocabulary file, and minting fresh labels

The vocabulary lives in a plain text file, about 1,720 English words with one word per line.
The words come from ordinary vocabulary and are case-sensitive: each begins with a capital
letter and continues in lowercase, examples being `Harbor`, `Stone`, `Maple`, and `Raven`.
One-letter words are left out, as are words carrying punctuation or symbols. That file is
read a single time when the program starts and then held in memory.

A new label is minted by picking two words from the vocabulary at random and joining them.
In short pseudocode, with variable names shortened so each line stays brief:

```
w1 = pick(dict)
w2 = pick(dict)
tag = w1 + w2
```

Inside a single file, no label may be used twice. Before a freshly drawn pairing is handed
out, it is checked against the set of labels already in use; a collision means the pairing
is discarded and another is drawn.

Drawing unique pairings one at a time would cost a scan per line on very large reads, so the
system keeps a reservoir of labels minted ahead of time. At start-up, roughly 10,000
distinct two-word pairings are generated, the reservoir is shuffled, and when a label is
needed one is popped off the reservoir in constant time; when the reservoir runs thin,
another batch of roughly 10,000 pairings is generated to refill it.

For extraordinarily large files, even the two-word space can run dry, and the fallback then
is a three-word label, joining three drawn words instead of two. That stretches the space to
roughly 5 billion pairings, which is enough for any file.

Past 50,000 lines, word labels are abandoned altogether and plain line numbers take over,
shaped as the letter L followed by the one-based line number, for example `L1`, `L2`, and so
on up to the last line. Number labels are not durable: they drift with insertions and
deletions. That is a deliberate trade, since on files that big speed matters more than label
stability.

## The per-line hash, and why it is not a security hash

Every line is hashed with FNV-1a, a 32-bit non-cryptographic hash named for Fowler, Noll,
and Vo. The recipe, written with each step on its own short line, is: start from the offset
basis value, then for each byte of the line, xor the running value with that byte, multiply
by the prime, and mask back down to unsigned 32-bit width, then return the result. The two
constants involved are the well-known FNV offset basis and the FNV prime, and the mask
forces the value to stay within 32 bits. In numbers, the offset basis is 2166136261 and the
prime is 16777619.

That choice is deliberate on three counts. It is very quick to compute, a loop of integer
arithmetic with no allocations. It is good enough for spotting equality, since collisions
are possible in principle but vanishingly unlikely across ordinary source lines. And it is
not cryptographically strong, nor does it need to be, because the job is change detection,
not defence against an adversary.

Alongside the labels, the system keeps two different non-cryptographic 32-bit hashes, and
they serve different purposes. A whole-file hash watches for any change at all between
reads, existing purely so unchanged content does not have to be sent again. A per-line hash
stands in for line content while the reconciliation procedure compares old and new versions,
and the model never sees it.

## Tracked state for one file, and the shape of an edit

For every file under watch, the system carries four things: an array of 32-bit integers
holding one per-line hash per line; an array of label strings, one per line; a set of the
label words currently in use; and a queue of pre-generated unused label words.

An edit, as the model states it, carries four fields. The first is the starting label,
written as the label word, the delimiter, and the expected line content. The second, for
replacements only, is the ending label, written the same way for the last line to be
replaced. The third is the kind of edit, one of replacing, inserting after, or inserting
before, defaulting to replacing. The fourth is the new text content, without labels.

Once the edit has been validated, it is pinned down to real positions as a resolved edit,
carrying the zero-based line index of the starting label, the zero-based line index of the
ending label (the same as the start for insertions), and the original edit specification.

The three operations behave as follows, in prose rather than as a table. Replacing swaps the
inclusive range from the starting label to the ending label with the new text, and requires
both labels. Inserting after puts the new text after the line identified by the starting
label and removes nothing. Inserting before puts the new text before the line identified by
the starting label and removes nothing.

## Reconciliation: how labels survive a change

This is the heart of the whole design: the procedure that decides which label each line of a
file gets, holding labels steady for lines that have not changed.

What goes in is the file's unique identifier, meaning its absolute path; the file's present
content, split on newlines; and the execution session identifier, which keeps sessions
isolated from one another.

How much state is kept is capped so it cannot grow without bound: at most 50 concurrent
sessions with least-recently-used eviction, at most 1,024 files per session with the same
eviction, and at most 50,000 lines per file.

The procedure, step by step, runs as follows. First, a guard for massive files: when the
line count passes 50,000, plain number labels are returned and nothing else happens. Second,
hashes are computed for the current lines. Third, the tracked state for this
session-and-path pair is looked up. Fourth, a fast path: if tracked state exists and every
hash matches, the existing labels are returned untouched, with no further work. Fifth, a
first sighting: when no tracked state exists, fresh labels are assigned line by line from
the pool, the state is saved, and the new labels are returned. Sixth, a changed file: the
old hash array and the new hash array are diffed with Myers diff, which operates on
sequences and produces a minimal edit script, and the script's groups are walked in order.
Added lines, present in the new version but not the old, receive fresh labels. Removed
lines, present in the old but not the new, are skipped, freeing their labels. Unchanged
lines, present in both, keep the exact label they had, taken from the tracked labels at the
matching old index. Seventh, the tracked state is updated to the new hashes, the new labels,
the new used set, and the pool, and the new labels are returned.

In short pseudocode, keeping each line brief:

```
if too big:
  return numbers
h = hashes(lines)
old = lookup(path)
if old and old.h == h:
  return old.tags
if no old:
  return fresh(lines)
d = diff(old.h, h)
out = []
i = 0
for g in d:
  if g.added:
    out += fresh(g.n)
  elif g.removed:
    i += g.n
  else:
    out += old.tags[i:i+g.n]
    i += g.n
save(path, h, out)
return out
```

Step six is where the guarantee is made: a line whose content has not changed keeps its word
label. The consequences are worth spelling out. A line keeps its label even when lines above
or below it are added or removed. The label is bound to what the line says, not to where the
line sits. And the model may safely address a labelled line even after a hundred lines have
been inserted above it.

To keep memory from leaking, the state store evicts its oldest entries. When a new session
would pass the 50-session ceiling, the least recently used session is dropped. When a new
file inside a session would pass the 1,024-file ceiling, the least recently used tracked
file is dropped.

## Editing: from a label to bytes on disk

The pipeline, end to end, has seven stages. Preparation reads the file from disk, splits it
into lines, and reconciles labels. Resolution turns label references into line indices,
collecting failures as it goes. If no edit resolves, the pipeline returns an error built
from the concatenated failure messages. Application applies the resolved edits to the
in-memory lines. Saving writes the joined lines to disk, and the finished content is read
back, since it may already differ after auto-formatting. Re-reconciliation runs over the
finished lines. Diagnostics run a linter and a syntax check. And formatting builds the
response from the applied edits, the failed edits, the diagnostics, and the new labels.

Turning labels into line numbers works like this. Each edit's labels are trimmed, the
starting label is resolved, and for a replacement the ending label is resolved as well;
insertions take the starting index as their ending index. A range check then confirms the
ending index is not before the starting index. Edits with any diagnostic attached go to the
failed list with their diagnostics joined; the rest go to the resolved list.

One label passes through four checks. First, format validation: the label name must match a
pattern of one capital letter followed by letters only, and anything else is rejected as
missing or incorrectly formatted. Second, existence: the label name must be found among the
file's labels, and anything else is rejected as not found in the file. Third, no newlines:
the supplied content must not contain a newline or carriage return, and anything else is
rejected as containing a newline character. Fourth, content verification, the core safety
check: the text actually sitting at the label's position must equal, exactly, the text
supplied after the delimiter, and a mismatch is rejected with a message naming the expected
and supplied texts.

Content verification is the safety net the whole system leans on. Even when a label exists
in the file, the system insists that the text the model supplied after the delimiter and the
text actually sitting at that label's position are identical. That stops blind edits in
exactly the risky cases: the user changed the file between the read and the edit; another
tool changed the file in the meantime; or a label somehow ended up pointing at a different
line, for example through a hash collision.

Applying edits works from the bottom up, and the reason is worth stating plainly. Working
top-to-bottom would move the goalposts, since each early edit would shift the indices of
every edit below it. Sorting in descending order by line index avoids that, because each
edit then operates in the original index space, and everything it could disturb sits above
it, already handled. For each edit in that order, any accidental label prefixes are stripped
from the replacement text, the replacement is split into lines, and a splice is computed:
inserting after splices at one past the index with nothing removed, inserting before splices
at the index with nothing removed, and replacing splices at the index removing the range
length. The splice removes that many items at that position and inserts the replacement
lines there. Applied-edit metadata is then computed in the original ascending order, working
out how many net lines were added above each edit, and from that the final start and end
indices, the original start and end indices, and the counts of lines added and deleted.

Replacement text sometimes arrives with labels still attached, because the model copied
lines straight out of a read result. Before anything is applied, the system strips label
prefixes matching a pattern of a capital-led word followed by the delimiter from every line
of the replacement text.

Every conflict check, gathered in prose: label format is checked at resolution and must
match the capital-led pattern; label existence is checked at resolution and the label must
be found; newline freedom is checked at resolution and the supplied content must not contain
newlines; content equality is checked at resolution and the supplied content must equal the
file's content exactly; ordering is checked at resolution and the start must not come after
the end; an empty resolved list is checked at preparation and yields the concatenated
failures; a file read failure at preparation yields a preparation error; and a write failure
at saving yields an application error.

## After the save, and what comes back

Once the edited lines are in memory and written out, the finished content is read back,
since it may already differ from what was written if an editor or formatter stepped in.
Reconciliation runs again over the new content: lines that were untouched keep their labels,
lines that were removed release their labels, lines that were added, by the edit or by
formatting, receive fresh labels, and lines touched by the edit whose text ended up
unchanged keep their labels. The next read therefore shows correct labels for the updated
file immediately, with no stale state lingering.

The reply to the model bundles five things: diff blocks marking what changed, with minus
signs for lines taken out and plus signs for lines put in; context lines, two on either side
of each edit, so the change can be read in its surroundings; failed edit reports, every edit
that did not go through with the reason it failed; fresh labels for the whole file when more
than roughly seventy percent of its lines changed, and otherwise just the diff; and
diagnostics, fresh linter or syntax errors the edit may have introduced.

## Speed, memory, and the unchanged-file shortcut

Hashing is a single multiply-xor loop per line, so hashing a 10,000-line file takes
microseconds. Diffing runs over integer hash arrays rather than the text itself, and that is
a large part of why it stays fast: comparing two integers is constant time, while comparing
two strings costs time proportional to length, and the arrays are compact in memory at four
bytes per entry. For files below 50,000 lines, the diff finishes in milliseconds in
practice. When a file has not moved at all, with every hash identical, the diff is skipped
completely: one linear scan establishes identity and the existing labels are handed straight
back. Minting 10,000 distinct two-word pairings takes at most about 50,000 random draws once
collision retries are counted, and that work happens once and is spread across every label
assignment afterwards.

Memory ceilings run as follows. Per file, up to 50,000 lines times roughly a four-byte hash
plus roughly twenty bytes of label works out near 1.2 MB. Per session, up to 1,024 files at
that size gives a maximum theoretical figure near 1.2 GB, practically much smaller. Across
sessions, up to 50 sessions are kept, with least-recently-used eviction.

## Edge cases, one by one

A file seen for the first time gets a freshly drawn label on every line, since there is
nothing to carry over from. A file rewritten wholesale diffs as every old line removed and
every new line added, so every line gets a new label and none survive. With exactly one line
changed, the diff's minimal script is one removal plus one addition, and all other lines
hold their labels. With lines added at the top, the old lines all slide down a few positions
and keep their labels, while the new top lines get fresh ones, so edits naming the old lines
still resolve. With lines removed from the top, the surviving lines slide up and keep their
labels, and edits naming them still resolve. With two lines hashing alike, a collision
possible in theory but vanishingly rare for source lines of ordinary length, the diff treats
them as the same line and the label at that position is preserved, while the content
verification step during edit resolution is the backstop: even if a label resolves to the
wrong line because of a collision, the content check refuses the edit, since the line text
will not match. With a file past 50,000 lines, labels switch to numbers, which are not
durable and move with insertions and deletions, so the model is expected to re-read the file
before editing it. With a session pushed out of the cache, all of its label state goes with
it, the next read of a file in that session is treated as a first read, every line gets a
new label, and labels the model remembered from before will no longer be found. With several
files in a single edit call, edits aimed at different files are grouped and handled
separately, each file running the whole pipeline on its own, concurrently with the others.
With formatting that runs after the save, an editor such as a code formatter may reformat
the file, changing its content and forcing a full re-reconciliation, and labels on lines the
formatter touched, where an indentation change is enough, are not preserved, because their
content hash changed and they therefore receive new labels.

## Notes for anyone building this again

Three pieces are needed. A Myers diff implementation, meaning any library that implements
Myers' algorithm over arbitrary sequences and returns a grouped edit script marking added,
removed, and unchanged regions, with pure Myers preferred to longest-common-subsequence
diffs for speed. A 32-bit FNV-1a hash, a few lines of integer arithmetic as shown in the
hashing section above. And a random number generator for drawing label words, which only
needs to be seeded, or cryptographically strong, if collisions must be avoided outright; an
ordinary pseudo-random generator is enough in practice.

The section sign was picked as the delimiter because it stands out visually from ASCII
source characters, very rarely shows up naturally in source code, and splits apart cleanly
when parsing. Any delimiter with those traits, absent from source code and simple to parse,
would do the job.

The reference design keeps label state in memory only, scoped to one execution session. A
longer-lived design could write that state to disk, keyed by session identifier, absolute
path, and file modification timestamp, with the cache invalidated whenever the modification
time moves.

In a multi-threaded setting, the state store needs guarding with a mutex or a similar
synchronisation primitive, because reconciliation both reads and writes shared state.
