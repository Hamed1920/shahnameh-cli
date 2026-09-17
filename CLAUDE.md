# Film Making for Dummies

A system for making films with generative video, driven through Higgsfield. One repo, one set of
rules, any number of films.

The repo root is the **system**: the panel and its worker, the PowerShell tools, the docs, the
project template. Every **project** — one film — is a top-level folder beside them holding its own
`project.json`, registries, assets and queue. `shahnameh-cli/` is the first one (code `SHM`).

Prompts are authored in the panel's **Prompts** page, or in **Claude Chat** / **Claude Cowork**.
This CLI **executes** them, owns the filesystem, and owns every ID. See `docs/SYNC_PROTOCOL.md`.

## Which project?

Everything below happens inside one project. Before touching anything, know which:

1. The user names it ("Shahnameh", `shahnameh-cli`, `SHM`) → that one.
2. Only one folder in the repo has a `project.json` → that one.
3. Otherwise **ask**. Never guess, and never spread one session's work across two projects.

A folder is a project because it contains `project.json`:
`{ schema, name, slug, code, description, mark, created }`. The `slug` is the folder name and the
first URL segment in the panel; the `code` is the ID prefix. Nothing registers a project anywhere
else.

## Read these first

Run `/project-log` at the start of a session, or read directly:

1. `<project>/00_PROJECT/PROJECT_LOG.md` — current state and history
2. `<project>/00_PROJECT/OPEN_QUESTIONS.md` — decisions waiting on Hamed
3. `docs/INDEXING.md` — the naming and numbering law. **Non-negotiable.**
4. `docs/SYNC_PROTOCOL.md` — how prompts get here from Chat / Cowork
5. `<project>/00_PROJECT/registry/ENTITIES.csv` — that project's master index

## Hard rules

- **Every asset has an ID.** `<CODE>-KIND-NNN-SLUG`, per `docs/INDEXING.md`, where `<CODE>` is the
  `code` in that project's `project.json` (`SHM` for Shahnameh). Short form `KIND-NNN` is fine in
  conversation. Never refer to anything by loose description — there are three staffs.
- **Only the ID prefix differs between projects.** Kinds, the kind → folder map, statuses, roles
  and the `EPnnn/SQnn/SCnnn/SHnnnn` shape are system-wide (`10_PANEL/worker/lib/ids.mjs`).
- **Different object → different number. Same object, different look → new `_V`. Same look,
  re-rolled → new `_T`.**
- **Only the CLI allocates numbers.** Chat and Cowork propose `NEW/KIND/SLUG`; the CLI assigns.
  This is the only reason collisions are impossible. Never allocate one by hand either — let
  `Ingest-Jobs.ps1` do it, or the worker: when it files a reviewer upload proposed as a new
  entity, or when it approves a Prompts-page batch with a `NEW/KIND/SLUG` row (same max+1 rule,
  `nextEntityNumber` in `worker/lib/promote.mjs`). Scene numbers work the same way: a Prompts-page
  row targeting `NEXT/EPnnn` gets the next free `SCnnn-SH0010` at approval, past every scene in
  that project's `QUEUE.jsonl` or on disk (`assignScenes` in `worker/lib/scenes.mjs`). Numbers are
  per project: `SHM-PRP-001` and another project's `XXX-PRP-001` are unrelated.
- **Numbers are never reused**, including after `RETIRED`.
- **Never move or rename an asset** without updating that project's
  `00_PROJECT/registry/ASSET_MANIFEST.csv`.
- **Never auto-create a missing target entity** to make a job succeed. Reject and ask.
- **The validator must pass** before you finish any session that touched files or registries.
- Anything you can't classify goes in the project's `99_INBOX/`, never a project root and never
  the repo root.
- **The worker is the only process that moves asset files or edits the CSV registries.** The
  panel appends to JSONL, plus two exceptions. First, it drops raw reviewer uploads into
  `09_OUTPUT/_uploads/<decision-id>/`, which the worker then names, files and registers. The
  References page works the same way: it appends requests (rename, retire, archive, move, role,
  main look, add) to `00_PROJECT/review/INDEX_OPS.jsonl` and the worker applies them
  (`worker/lib/index-ops.mjs`). The Prompts page and Regenerate append to
  `00_PROJECT/review/JOB_REQUESTS.jsonl`; the worker validates and prices, and only after Hamed
  approves the priced batch in the panel does it queue the jobs (`worker/lib/job-requests.mjs`).
  Second, **creating a project**: the picker's "start a new project" form copies
  `templates/project/` into a new folder, writes its `project.json` and adds the folder to
  `.gitignore`'s allowlist (`10_PANEL/lib/scaffold.ts`). Creating empty registries is not writing
  to them — a project with no folder has no worker yet — and the panel never edits an existing
  registry. Don't add a third writer.
- **Nothing is deleted from the index.** Retiring keeps an entity's number and files. Archiving a
  look moves it to `09_OUTPUT/_archive/` with its registry row saved, so it can be restored.
  Renaming changes the ID wording and the files, never the number.
- **When testing a worker against a sandbox copy (`SHM_PROJECTS`, or `SHM_ROOT` on a copied
  project folder), it still spends real credits** unless `SHM_HIGGSFIELD_JS` points at the stub
  CLI. Mark every sandbox queue job processed before any non-dry pass.
- **Never mark a learning `approved` yourself** — only Hamed does, in the panel. Only approved
  rules reach a prompt.
- **Never spend credits without pricing first.** `generate cost` before `generate create`.
- **The spend ceiling is a rolling window, and it is account-wide.** `costCeilingCredits` per
  `costWindowHours` in `10_PANEL/worker/config.json`, summed from **every** project's
  `00_PROJECT/sync/JOB_LEDGER.csv`, because all of them spend from the same Higgsfield account
  (`spentWithin` in `worker/lib/project.mjs`). A job over the ceiling is held (`state.held`, shown
  on the Queue page), never failed.
- **One generation at a time, machine-wide.** A worker takes `.generate.lock` at the repo root
  from the ceiling check until the ledger records the spend, so two projects can never both spend
  the same remaining room. Decisions and index requests still run in parallel.
- **A worker refuses to start** if its `queue/state.json` is missing or corrupt while the queue,
  review log, job requests or index ops have history — starting would replay them and spend again,
  so restore `state.json` from git first. It also refuses if `SHM_HIGGSFIELD_JS` names a file that
  does not exist, rather than falling back to the real CLI.

## Tools

All four live in `tools\` and take `-Project <slug>`. It is required once more than one project
exists; with exactly one they find it themselves.

```powershell
# must pass before you finish   (no -Project: every project, plus the system-level checks)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "tools\Validate-Project.ps1" -Project shahnameh-cli

# CLI -> Chat / Cowork
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "tools\Build-ContextPack.ps1" -Project shahnameh-cli

# Chat / Cowork -> CLI   (always -WhatIf first)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "tools\Ingest-Jobs.ps1" -Project shahnameh-cli -WhatIf

# once per machine after pulling the multi-project branch: moves the leftover
# gitignored runtime files out of the old single-project root layout
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "tools\Move-ToProjects.ps1" -WhatIf
```

```powershell
# review panel + generation workers (from 10_PANEL)
npm run up         # same as dev; the panel server starts one worker per project and keeps them running
npm run dev        # http://localhost:3000 — the project picker
npm run worker -- --project <slug>    # one project by hand; add --dry-run to price without spending
npm test           # prompt parser tests
```

Hamed's normal path for new prompts is the panel's **Prompts** page (paste or drop a document, fix
targets, submit, approve the priced total). `/run-prompts` and `/sync-in` remain for documents that
need judgement or non-generation SHM-JOB types.

Skills: `/project-log`, `/sync-out`, `/sync-in`, `/sync-check`, `/learn`, `/run-prompts`.

## Layout

```
10_PANEL/       Next.js review panel + generation worker — the system's only code
tools/          Validate-Project, Build-ContextPack, Ingest-Jobs, Move-ToProjects, Shm-Common
docs/           INDEXING.md, SYNC_PROTOCOL.md, reference/HIGGSFIELD-CLI.md
templates/      project/ — the skeleton the panel copies to start a new film
shahnameh-cli/  a project (code SHM). Any top-level folder with a project.json is one.
.generate.lock  machine-wide: one generation at a time. Never committed.
```

Inside a project:

```
project.json    schema, name, slug, code, description, mark, created
00_PROJECT/     log, open questions, registries, review, queue, sync
01_CHARACTERS/  CHR      02_GROUPS/    GRP      03_LOCATIONS/  LOC
04_PROPS/       PRP VEH  05_CREATURES/ CRT      06_COSTUMES/   COS
07_EPISODES/    EP SQ SC SH             08_REFERENCE/ REF FX
09_OUTPUT/      renders; _staging, _drafts, _rejected, _uploads and _archive are working space
99_INBOX/       unindexed drop zone
```

Any path segment starting with `_` is working space and is ignored by the validator.

## Git

Remote: `https://github.com/Hamed1920/shahnameh-cli.git` — **the system and every project: code,
metadata and assets**, so another machine can clone it and work. Anyone who can see the repo can
download every render.

- **Media goes through Git LFS** (`.gitattributes`). Never commit an image or video as a plain
  blob. `git lfs install` once per machine, or pushes send pointers without the media.
- `.gitignore` is still an allowlist (`/*` deny, then re-include) so a stray root file stays out
  until opted in. Do not convert it to a denylist. A new top-level folder must be added to it —
  including a new project, which adds its own line (`!/<slug>/`), written by the panel when it
  creates the project.
- **One worker per project, and all of them on one machine.** The CSV registries and
  `queue/state.json` are rewritten whole, so two workers on the same project between syncs
  conflict. `state.json` is tracked on purpose: without it a worker would replay every past
  decision and spend credits. The panel's server starts one worker per project and keeps them
  running (`lib/worker-supervisor.ts`), so on any other machine set `SHM_WORKER=off` in
  `10_PANEL/.env.local` before running the panel. Pull before starting the panel; commit and push
  after stopping the workers (each project's `queue/worker.stop`). The panel can run anywhere,
  since JSONL is append-only and union-merged.
- **Author is Hamed alone.** Every commit is authored by Hamed, with exactly one trailer:

  ```
  Co-Authored-By: Parsa Xavier <parsaxavier@gmail.com>
  ```

  **No AI co-author, ever.** No `Co-Authored-By: Claude`, no "Generated with Claude Code" line,
  no Claude or Anthropic attribution of any kind, in the commit message or the PR body.
- **"commit" is an instruction, not a question.** When Hamed says "commit" in a Claude chat,
  stage and commit the working tree right then, with the trailer above. Don't ask first.
- **Always sync, never just commit.** A commit that only sits on this machine isn't done. After
  committing, pull (`git pull --rebase`) and push, so the other machine can clone the work.
  Media pushes through LFS, so give the upload time to finish and confirm it did.
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
