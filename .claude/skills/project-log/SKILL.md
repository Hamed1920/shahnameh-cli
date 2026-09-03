---
name: project-log
description: Read and update the Shahnameh project log and registries. Invoke at the START of any work session to load project state, and at the END to record what changed. Also use when asked to "log this", "update the log", "what's the state of the project", "catch me up", or when adding/renaming/retiring any asset, entity, episode, scene or shot.
---

# Project Log

Keeps `00_PROJECT/PROJECT_LOG.md`, `00_PROJECT/OPEN_QUESTIONS.md` and the registries accurate so
any chat, agent or machine can pick this project up cold.

All paths are relative to the project root: `D:\Digianzu\Shahnameh MODERN\Shahnameh CLI`.

---

## Mode A — Catch up (start of session, or "what's the state of things?")

1. Read `00_PROJECT/PROJECT_LOG.md`.
2. Read `00_PROJECT/OPEN_QUESTIONS.md`.
3. Read `00_PROJECT/INDEXING.md` — naming is already defined there, do not invent any.
4. If prompts from Claude Chat or Cowork are involved, read `00_PROJECT/SYNC_PROTOCOL.md`.
5. Run the validator so your picture of the project is real, not remembered:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "00_PROJECT\tools\Validate-Project.ps1"
```

Report back concisely: phase, counts, open questions, next up, and whether the index is clean.
Do not dump the files at the user.

If they only asked for status, stop here.

## Mode B — Record (end of session, or "log this")

### 1. Verify before you write

Never log from memory. The validator is the source of truth for counts and integrity:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "00_PROJECT\tools\Validate-Project.ps1"
```

If it fails, fix the errors before logging. Logging over a broken index buries the problem.

### 2. Update the registries

- New entity → append to `registry/ENTITIES.csv`. Take the **next free number the validator
  printed**; never reuse a number, even a retired one. Slug leads with the family word.
- New file → append to `registry/ASSET_MANIFEST.csv`, including `original_filename` so the
  rename stays reversible.
- New episode / scene / shot → `registry/EPISODES.csv` and the episode's `SHOTLIST.csv`.
- Changed status → edit the row in place.
- Entity promoted out of `RESERVED` → give it a real description, a `canonical_variant` and a
  correct `variant_count`.

### 3. Update `OPEN_QUESTIONS.md`

- A decision the user made → delete that question, and record the decision in the log entry.
- A decision you made on their behalf → it does **not** go here. It goes in "Notable judgement
  calls" in the log entry.
- A new thing only they can decide → add it as the next `### Q<n>`.

This file is shipped to Claude Chat and Cowork in the context pack, so stale questions there
actively mislead the authoring side.

### 4. Update `PROJECT_LOG.md`

Refresh the **Current state** block — phase, counts, what exists, next up. Counts come from the
validator, not from guessing.

Then prepend a new entry directly under `## Log`:

```markdown
### YYYY-MM-DD — <short title of what happened>

**Agent:** <model / agent name> · **Chat:** <one-line context>

<What was done, in plain prose. Enough that someone who wasn't here can continue.>

Done:
- <concrete change, with entity IDs and file paths>

Notable judgement calls made (flag if wrong):
- <anything decided that the user did not explicitly specify>
```

Use today's real date. Reference entities by full ID, never by loose description.

### 5. Confirm

Two or three lines on what was logged and what changed. Do not paste the log entry back.

If entities changed, remind the user to run `/sync-out` before their next prompt-authoring
session — otherwise Claude Chat and Cowork are working from a stale index.

---

## Rules

- **Newest log entries on top**, immediately under `## Log`. Never rewrite history — if an
  earlier entry was wrong, correct it in the new entry and say so.
- **The log is prose, the registries are data, the questions are decisions.** Do not put asset
  inventories in the log, narrative in the CSVs, or your own choices in the questions.
- **Never leave an asset unindexed.** Anything unclassifiable goes in `99_INBOX/` and is named in
  the log as unresolved.
- **Never hand-edit `sync/CONTEXT_PACK.md`** — it is generated. Edit the sources and rebuild.
