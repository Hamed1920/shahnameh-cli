---
name: sync-in
description: Ingest and execute SHM-JOB blocks authored in Claude Chat or Claude Cowork into a project. Use when the user pastes a job block, says "ingest this", "run these jobs", "sync in", "I have prompts from Chat/Cowork", or when files are waiting in a project's 00_PROJECT/sync/inbox.
---

# Sync In — Chat / Cowork to CLI

Takes JOB blocks written elsewhere, validates them against one project's registry, allocates any
new IDs, executes them, and produces a receipt to paste back.

**Pick the project first:** the block's `project: <CODE>` line names it; otherwise use the project
the user names, or the only one in the repo with a `project.json`; otherwise ask. Never guess —
a block ingested into the wrong project means its IDs point at something else. `<project>` below is
that folder and `<slug>` its name.

`SHM-JOB` is the fixed block keyword in **every** project; the `project:` line is what says which
one. The contract is in `docs/SYNC_PROTOCOL.md`. Read it if anything below is ambiguous.

## Steps

**1. Get the jobs onto disk.**

If the user pasted the block into chat, write it verbatim to
`<project>/00_PROJECT/sync/inbox/<yyyyMMdd-HHmm>-pasted.txt` first. Do not retype or "tidy" it —
the content hash is what makes re-ingest idempotent, and editing it breaks duplicate detection.

If they dropped files in that project's inbox, skip to step 2.

**2. Dry run.** Always. Generation costs money; validation does not.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "tools\Ingest-Jobs.ps1" -Project <slug> -WhatIf
```

Read the receipt. If anything is `REJECTED`, tell the user what and why **before** doing
anything else. Common causes and their fixes are tabulated in `docs/SYNC_PROTOCOL.md` §8. A block
rejected for being *for another project* is ingested there instead, never rewritten.

Do not "helpfully" auto-create a missing target entity. A rejected unknown target usually means
the authoring side was working from a stale context pack, and silently creating the entity is
how phantom duplicates get born. Say so, and offer `/sync-out`.

**3. Ingest for real.**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "tools\Ingest-Jobs.ps1" -Project <slug>
```

This writes `<project>/00_PROJECT/sync/PLAN-<stamp>.json`, a receipt, ledger rows, and reserves IDs
for any `NEW/` proposals. It does **not** call any generation engine.

**4. Execute the plan.** Read the plan file. For each entry:

| type | what you do |
|---|---|
| `generate.image` / `generate.video` | Submit the prompt with the resolved `refs` paths to the named engine. Save the result as `<FULL-ID>_V<nn>[_T<nn>]_<description>.<ext>` in the entity's folder inside this project, then add an `ASSET_MANIFEST.csv` row. |
| `register.entity` | Already applied at ingest. Fill in a real `description` — the placeholder is useless in a context pack. |
| `update.entity` | Edit the `ENTITIES.csv` row in place. |
| `retire.entity` | Set status `RETIRED`. The number stays burned. |
| `define.shot` | Add or update the row in the episode's `SHOTLIST.csv`. |

If the engine is not yet wired up, say so plainly and leave the jobs `READY` in the ledger.
Do not fake a result.

**5. Promote reserved entities.** Any entity the ingest created is `RESERVED` with a placeholder
description. Once it has an asset, set its status to `CONCEPT`, set `canonical_variant`, update
`variant_count`, and write a real description — one that distinguishes it from its siblings in
the same family.

**6. Validate.**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "tools\Validate-Project.ps1" -Project <slug>
```

Must pass before you finish. If it does not, fix it now, not later.

**7. Close the loop.** Give the user:

- the receipt block, verbatim, in a code fence, telling them to paste it back into the
  conversation that produced the jobs — that is how Chat learns the real assigned IDs
- a one-line summary of what was generated and filed
- a nudge to run `/sync-out` if new entities were created, so the next authoring session starts
  from current state

**8. Log it** with `/project-log`.

## Rules

- **Never allocate an ID by hand.** The ingest tool owns number allocation. That is the only
  reason collisions are impossible.
- **Never edit a job block before ingesting it.** Fix the source in Chat and have it re-emit
  with a new `job_id`.
- **A re-used `job_id` with different content is a hard error**, not something to work around.
  Revisions get new job_ids.
- **Rejections are not partial.** Failing jobs are held back and the source file stays in the
  inbox; the rest still process.
