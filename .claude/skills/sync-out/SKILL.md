---
name: sync-out
description: Build a project's CONTEXT PACK to paste into Claude Chat or Claude Cowork, so the authoring side knows every entity ID, the naming rules and the open questions. Use when the user says "sync out", "context pack", "brief Claude Chat", "brief Cowork", "I'm going to write prompts elsewhere", or before any prompt-authoring session on another surface.
---

# Sync Out — CLI to Chat / Cowork

Produces `<project>/00_PROJECT/sync/CONTEXT_PACK.md`: the complete, current, paste-ready state of
one project. Without it, the authoring surface invents names and numbers, and everything drifts.

**Pick the project first:** use the one the user names (by name, folder slug or code); if only one
folder in the repo has a `project.json`, use that; otherwise ask. Never guess. `<slug>` below is
that folder's name, e.g. `shahnameh-cli`.

## Steps

**1. Validate first.** Never ship a broken index outward.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "tools\Validate-Project.ps1" -Project <slug>
```

If it fails, **stop** and fix the errors. A context pack built on a broken registry propagates
the breakage into every prompt written against it.

**2. Build the pack.**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "tools\Build-ContextPack.ps1" -Project <slug>
```

**3. Hand it over.** Report to the user:

- the project, the path, the entity count, and the `state_hash`
- how to use it: paste as the first message in a Claude Chat conversation, or add it to the
  files of a Claude Cowork project so it persists across turns
- anything in `<project>/00_PROJECT/OPEN_QUESTIONS.md` that the authoring side will trip over

Offer to print the pack if they want to copy it straight out of the terminal. Do not print it
unasked — it is long.

## When to regenerate

Whenever the registry has changed: new entities, new variants, a canonical variant decided, an
open question resolved. The `state_hash` is how staleness is caught later — a job that comes back
carrying an old hash gets flagged at ingest, but that is a warning after the fact. Regenerating
is cheap; working from a stale pack is not.

## Notes

- **One pack per project, one project per conversation.** The pack carries the project's `code`
  and tells the authoring side to put `project: <CODE>` on every JOB block, so a block written
  from the wrong pack is rejected at ingest rather than landing in the wrong film.
- The pack is generated. **Never hand-edit it** — edit `ENTITIES.csv` or `OPEN_QUESTIONS.md`
  and rebuild.
- It deliberately contains no file paths. The authoring side works in IDs and `@` reference
  tokens only; path resolution is the CLI's job.
