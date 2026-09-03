# Shahnameh CLI

Asset and production repository for a modern Shahnameh adaptation, driven through Higgsfield.

Prompts are authored in **Claude Chat** and **Claude Cowork**. This CLI **executes** them, owns
the filesystem, and owns every ID. See `00_PROJECT/SYNC_PROTOCOL.md`.

## Read these first

Run `/project-log` at the start of a session, or read directly:

1. `00_PROJECT/PROJECT_LOG.md` — current state and history
2. `00_PROJECT/OPEN_QUESTIONS.md` — decisions waiting on Hamed
3. `00_PROJECT/INDEXING.md` — the naming and numbering law. **Non-negotiable.**
4. `00_PROJECT/SYNC_PROTOCOL.md` — how prompts get here from Chat / Cowork
5. `00_PROJECT/registry/ENTITIES.csv` — the master index

## Hard rules

- **Every asset has an ID.** `SHM-KIND-NNN-SLUG`, per `INDEXING.md`. Short form `KIND-NNN` is
  fine in conversation. Never refer to anything by loose description — there are three staffs.
- **Different object → different number. Same object, different look → new `_V`. Same look,
  re-rolled → new `_T`.**
- **Only the CLI allocates numbers.** Chat and Cowork propose `NEW/KIND/SLUG`; the CLI assigns.
  This is the only reason collisions are impossible. Never allocate one by hand either — let
  `Ingest-Jobs.ps1` do it.
- **Numbers are never reused**, including after `RETIRED`.
- **Never move or rename an asset** without updating `registry/ASSET_MANIFEST.csv`.
- **Never auto-create a missing target entity** to make a job succeed. Reject and ask.
- **The validator must pass** before you finish any session that touched files or registries.
- Anything you can't classify goes in `99_INBOX/`, never the project root.

## Tools

```powershell
# must pass before you finish
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "00_PROJECT\tools\Validate-Project.ps1"

# CLI -> Chat / Cowork
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "00_PROJECT\tools\Build-ContextPack.ps1"

# Chat / Cowork -> CLI   (always -WhatIf first)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "00_PROJECT\tools\Ingest-Jobs.ps1" -WhatIf
```

Skills: `/project-log`, `/sync-out`, `/sync-in`, `/sync-check`.

## Layout

```
00_PROJECT/     docs, registries, tools, sync
01_CHARACTERS/  CHR      02_GROUPS/    GRP      03_LOCATIONS/  LOC
04_PROPS/       PRP VEH  05_CREATURES/ CRT      06_COSTUMES/   COS
07_EPISODES/    EP SQ SC SH             08_REFERENCE/ REF FX
09_OUTPUT/      renders and deliverables
99_INBOX/       unindexed drop zone
```

## Environment

Windows 11, PowerShell 5.1. Not a git repository. Scripts are ASCII-only on purpose — PS 5.1
reads BOM-less `.ps1` as ANSI, so non-ASCII characters in them corrupt silently.
