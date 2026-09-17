---
name: sync-check
description: Audit a project's index for drift - orphan files, missing files, broken references, bad IDs, missing canonical variants. Use when the user says "check the index", "validate", "sync check", "is anything broken", after any manual file shuffling, or before shipping a context pack.
---

# Sync Check — audit the index

Runs the validator and explains what it found in terms the user can act on.

**Pick the project first:** use the one the user names (by name, folder slug or code); if only one
folder in the repo has a `project.json`, use that; otherwise ask, or run with no `-Project` to
check every project at once. `<project>` below is that folder and `<slug>` its name.

## Steps

**1. Run it.**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "tools\Validate-Project.ps1" -Project <slug>
```

Without `-Project` it validates every project in turn and adds the system-level checks: each
project folder has a sound `project.json`, no two projects share a code, and nothing stray sits in
the repo root.

**2. Also check the inbox and reserved entities** — the validator does not cover these:

```powershell
Get-ChildItem '<project>\00_PROJECT\sync\inbox' -File | Select-Object Name, Length
Import-Csv '<project>\00_PROJECT\registry\ENTITIES.csv' | Where-Object { $_.status -eq 'RESERVED' } | Select-Object id, flags
Get-ChildItem '<project>\99_INBOX' -File -Recurse | Select-Object Name
```

Unprocessed inbox jobs, entities stuck at `RESERVED`, and anything sitting in `99_INBOX` are all
real debt even though the registry is internally consistent.

**3. Report.** Do not paste raw validator output at the user. Translate:

| Finding | What it means |
|---|---|
| `ORPHAN FILE` | A file was added or renamed without a manifest row. Index it or delete it. |
| `MISSING FILE` | A manifest row points at nothing. The file was moved or deleted outside the system. |
| `related id does not exist` | A cross-reference broke, usually after a rename. |
| `no canonical_variant` | Prompts cannot resolve a hero reference for that entity. Blocks generation. |
| `variant_count` mismatch | Registry and manifest disagree about how many variants exist. |
| `UNFILED media in project root` | Something was dropped in without being indexed. Move it to that project's `99_INBOX`. |
| `STRAY folder in repo root` | Project data outside a project folder, or a folder missing from the layout. |
| `PROJECT ... code is used by both` | Two projects claim one ID prefix. Fix before either generates. |

Give the count, the top issues, and a concrete fix for each. If it passes clean, say so in one
line with the entity/asset counts and the `state_hash` — do not pad it.

**4. Offer to fix.** Most findings are mechanical. Fix them if the user agrees, then re-run the
validator to confirm, and log it with `/project-log`.

## When to run

- After any manual file move, rename or delete
- Before `/sync-out` (that skill does this itself)
- After `/sync-in`
- After creating a new project, to prove its skeleton and code are sound
- Any time the project has been touched by another chat, agent or machine
