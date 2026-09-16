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
  `Ingest-Jobs.ps1` do it, or the worker: when it files a reviewer upload proposed as a new
  entity, or when it approves a Prompts-page batch with a `NEW/KIND/SLUG` row (same max+1 rule,
  `nextEntityNumber` in `worker/lib/promote.mjs`).
- **Numbers are never reused**, including after `RETIRED`.
- **Never move or rename an asset** without updating `registry/ASSET_MANIFEST.csv`.
- **Never auto-create a missing target entity** to make a job succeed. Reject and ask.
- **The validator must pass** before you finish any session that touched files or registries.
- Anything you can't classify goes in `99_INBOX/`, never the project root.
- **The worker is the only process that moves asset files or edits the CSV registries.** The
  panel appends to JSONL, plus one exception: it drops raw reviewer uploads into
  `09_OUTPUT/_uploads/<decision-id>/`, which the worker then names, files and registers. The
  References page works the same way: it appends requests (rename, retire, archive, move, role,
  main look, add) to `00_PROJECT/review/INDEX_OPS.jsonl` and the worker applies them
  (`worker/lib/index-ops.mjs`). The Prompts page and Regenerate append to
  `00_PROJECT/review/JOB_REQUESTS.jsonl`; the worker validates and prices, and only after Hamed
  approves the priced batch in the panel does it queue the jobs (`worker/lib/job-requests.mjs`).
  Don't add a second writer.
- **Nothing is deleted from the index.** Retiring keeps an entity's number and files. Archiving a
  look moves it to `09_OUTPUT/_archive/` with its registry row saved, so it can be restored.
  Renaming changes the ID wording and the files, never the number.
- **When testing the worker against an `SHM_ROOT` sandbox, it still spends real credits.** Mark
  every sandbox queue job processed before any non-dry pass.
- **Never mark a learning `approved` yourself** - only Hamed does, in the panel. Only approved
  rules reach a prompt.
- **Never spend credits without pricing first.** `generate cost` before `generate create`.
- **The spend ceiling is a rolling window.** `costCeilingCredits` per `costWindowHours`, summed from
  `JOB_LEDGER.csv`; a job over it is held (`state.held`, shown on the Queue page), never failed.

## Tools

```powershell
# must pass before you finish
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "00_PROJECT\tools\Validate-Project.ps1"

# CLI -> Chat / Cowork
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "00_PROJECT\tools\Build-ContextPack.ps1"

# Chat / Cowork -> CLI   (always -WhatIf first)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "00_PROJECT\tools\Ingest-Jobs.ps1" -WhatIf
```

```powershell
# review panel + generation worker (from 10_PANEL)
npm run up         # same as dev; the panel server starts the worker and keeps it running
npm run dev        # http://localhost:3000
npm run worker     # add --dry-run to price without spending
npm test           # prompt parser tests
```

Hamed's normal path for new prompts is now the panel's **Prompts** page (paste or drop a
document, fix targets, submit, approve the priced total). `/run-prompts` and `/sync-in` remain
for documents that need judgement or non-generation SHM-JOB types.

Skills: `/project-log`, `/sync-out`, `/sync-in`, `/sync-check`, `/learn`.

## Layout

```
00_PROJECT/     docs, registries, tools, sync
01_CHARACTERS/  CHR      02_GROUPS/    GRP      03_LOCATIONS/  LOC
04_PROPS/       PRP VEH  05_CREATURES/ CRT      06_COSTUMES/   COS
07_EPISODES/    EP SQ SC SH             08_REFERENCE/ REF FX
09_OUTPUT/      renders; _staging and _rejected are working space
10_PANEL/       Next.js review panel + generation worker
99_INBOX/       unindexed drop zone
```

Any path segment starting with `_` is working space and is ignored by the validator.

## Git

Remote: `https://github.com/Hamed1920/shahnameh-cli.git` — **the whole project: code, metadata and
assets**, so another machine can clone it and work. Anyone who can see the repo can download
every render.

- **Media goes through Git LFS** (`.gitattributes`). Never commit an image or video as a plain
  blob. `git lfs install` once per machine, or pushes send pointers without the media.
- `.gitignore` is still an allowlist (`/*` deny, then re-include) so a stray root file stays out
  until opted in. Do not convert it to a denylist. A new top-level folder must be added to it.
- **One worker at a time, across all machines.** The CSV registries and `queue/state.json` are
  rewritten whole, so two workers between syncs conflict. `state.json` is tracked on purpose:
  without it a worker would replay every past decision and spend credits. The panel's server
  starts the worker and keeps it running (`lib/worker-supervisor.ts`), so on any other machine
  set `SHM_WORKER=off` in `10_PANEL/.env.local` before running the panel. Pull before starting
  the panel; commit and push after stopping the worker (`queue/worker.stop`). The panel can run anywhere, since JSONL is
  append-only and union-merged.
- **Author is Hamed alone.** Every commit is authored by Hamed, with exactly one trailer:

  ```
  Co-Authored-By: Parsa Xavier <parsaxavier@gmail.com>
  ```

  **No AI co-author, ever.** No `Co-Authored-By: Claude`, no "Generated with Claude Code" line,
  no Claude or Anthropic attribution of any kind, in the commit message or the PR body.
- **"commit" is an instruction, not a question.** When Hamed says "commit" in a Claude chat,
  stage and commit the working tree right then, with the trailer above. Don't ask first, don't
  push unless he says push.
- Verify before pushing: `git add -A --dry-run` lists nothing from `node_modules`, `.next` or
  `.env`, and after staging `git lfs ls-files` lists every media file.

## Environment

Windows 11, PowerShell 5.1, Node 24 LTS, Git 2.55.

- PowerShell scripts are **ASCII-only on purpose** — PS 5.1 reads BOM-less `.ps1` as ANSI, so
  non-ASCII characters corrupt silently.
- **Never write JSON with PowerShell's `Set-Content -Encoding utf8`** — PS 5.1 emits a BOM and
  Node refuses to parse it. Use `[System.IO.File]::WriteAllText` with `UTF8Encoding($false)`.
- If `npm` fails with "running scripts is disabled", use `npm.cmd` or
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
