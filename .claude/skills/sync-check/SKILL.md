---
name: sync-check
description: Audit the Shahnameh project index for drift - orphan files, missing files, broken references, bad IDs, missing canonical variants. Use when the user says "check the index", "validate", "sync check", "is anything broken", after any manual file shuffling, or before shipping a context pack.
---

# Sync Check — audit the index

Runs the validator and explains what it found in terms the user can act on.

## Steps

**1. Run it.**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "00_PROJECT\tools\Validate-Project.ps1"
```

**2. Also check the inbox and reserved entities** — the validator does not cover these:

```powershell
Get-ChildItem '00_PROJECT\sync\inbox' -File | Select-Object Name, Length
Import-Csv '00_PROJECT\registry\ENTITIES.csv' | Where-Object { $_.status -eq 'RESERVED' } | Select-Object id, flags
Get-ChildItem '99_INBOX' -File -Recurse | Select-Object Name
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
| `UNFILED media in project root` | Something was dropped in without being indexed. |

Give the count, the top issues, and a concrete fix for each. If it passes clean, say so in one
line with the entity/asset counts and the `state_hash` — do not pad it.

**4. Offer to fix.** Most findings are mechanical. Fix them if the user agrees, then re-run the
validator to confirm, and log it with `/project-log`.

## When to run

- After any manual file move, rename or delete
- Before `/sync-out` (that skill does this itself)
- After `/sync-in`
- Any time the project has been touched by another chat, agent or machine
