---
name: sync-out
description: Build the Shahnameh CONTEXT PACK to paste into Claude Chat or Claude Cowork, so the authoring side knows every entity ID, the naming rules and the open questions. Use when the user says "sync out", "context pack", "brief Claude Chat", "brief Cowork", "I'm going to write prompts elsewhere", or before any prompt-authoring session on another surface.
---

# Sync Out — CLI to Chat / Cowork

Produces `00_PROJECT/sync/CONTEXT_PACK.md`: the complete, current, paste-ready state of the
project. Without it, the authoring surface invents names and numbers, and everything drifts.

## Steps

**1. Validate first.** Never ship a broken index outward.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "00_PROJECT\tools\Validate-Project.ps1"
```

If it fails, **stop** and fix the errors. A context pack built on a broken registry propagates
the breakage into every prompt written against it.

**2. Build the pack.**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "00_PROJECT\tools\Build-ContextPack.ps1"
```

**3. Hand it over.** Report to the user:

- the path, the entity count, and the `state_hash`
- how to use it: paste as the first message in a Claude Chat conversation, or add it to the
  files of a Claude Cowork project so it persists across turns
- anything in `00_PROJECT/OPEN_QUESTIONS.md` that the authoring side will trip over

Offer to print the pack if they want to copy it straight out of the terminal. Do not print it
unasked — it is long.

## When to regenerate

Whenever the registry has changed: new entities, new variants, a canonical variant decided, an
open question resolved. The `state_hash` is how staleness is caught later — a job that comes back
carrying an old hash gets flagged at ingest, but that is a warning after the fact. Regenerating
is cheap; working from a stale pack is not.

## Notes

- The pack is generated. **Never hand-edit it** — edit `ENTITIES.csv` or `OPEN_QUESTIONS.md`
  and rebuild.
- It deliberately contains no file paths. The authoring side works in IDs and `@` reference
  tokens only; path resolution is the CLI's job.
