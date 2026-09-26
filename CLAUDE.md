# Film Making for Dummies

A system for making films with generative video, driven through Higgsfield. One repo, one set of
rules, any number of films.

The repo root is the **system**: the panel and its worker, the PowerShell tools, the docs, the
project template. Every **project** — one film — is a top-level folder beside them holding its own
`project.json`, registries, assets and queue. `shahnameh-cli/` is the first one (code `SHM`).

Prompts are authored in the panel's **Prompts** page, or in **Claude Chat** / **Claude Cowork**.
This CLI **executes** them, owns the filesystem, and owns every ID. See `docs/SYNC_PROTOCOL.md`.

## Pending on the machine that runs the workers (delete this section once done)

Since 2026-09-24 the panel on the main machine (the one with the Higgsfield account that has
credits) renders but does not respond: Submit and "Add these" stay disabled, so nothing reaches the
queue. The committed code works on another machine, so the cause is on this one. **At the start of
a session on that machine** (`higgsfield workspace status` shows credits), before anything else:

1. With the panel running the usual way (`npm run up`), run
   `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "tools\Check-Panel.ps1"` and read
   `%TEMP%\fmfd-panel-check.txt`.
2. Remedies, in this order. Say what you found and what you are about to do before each one:
   - Something other than this panel listens on port 3000 (an old panel from the old
     `Kagu\shahnameh-cli` folder, another Next app): name it and ask before stopping it.
   - The `.next` build cache is older than the last pull: stop the panel, delete `10_PANEL\.next`,
     start it again.
   - `higgsfield workspace status` says no workspace: `higgsfield workspace list`, then
     `higgsfield workspace set <id>` for the paid workspace (ask which).
   - The panel is being opened at `127.0.0.1` or the machine's network address: use
     `http://localhost:3000` (only `127.0.0.1` is allowed besides localhost).
   - `node -v` is older than 22.6: install Node 24 LTS.
3. If the Prompts page still does not respond, ask the user to open DevTools (F12) → Console on it
   and paste the red errors.
4. Record what the cause was in `shahnameh-cli/00_PROJECT/PROJECT_LOG.md`, then delete this section
   and commit.

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
  `09_OUTPUT/_uploads/<id>/` — a Review decision, a References add, or a Regenerate request —
  which the worker then names, files and registers. The
  References page works the same way: it appends requests (rename, retire, archive, move, role,
  main look, add) to `00_PROJECT/review/INDEX_OPS.jsonl` and the worker applies them
  (`worker/lib/index-ops.mjs`). Assigning footage to another episode, from the Gallery or Decided
  page, is one more of those requests (`move-shot`); the worker moves the files, numbers the new
  scene and records the move in `00_PROJECT/queue/SHOT_MOVES.jsonl`. The Prompts page and Regenerate append to
  `00_PROJECT/review/JOB_REQUESTS.jsonl`; the worker validates and prices, and only after Hamed
  approves the priced batch in the panel does it queue the jobs (`worker/lib/job-requests.mjs`).
  Files dropped onto a Prompts row travel with the batch (`_uploads/<request id>/`) and are filed
  when the worker validates it. The **reference studio** is the same channel: `studio.price`,
  then `studio.approve` (the priced Generate button is the approval), `studio.pick` to file a
  result, and `studio.close` (`worker/lib/studio.mjs`). A studio try for a new thing carries a
  proposal and is numbered only at the pick. Pictures dropped into the studio are inputs in
  `_uploads/<session>/`, never filed.
  Second, **creating a project**: the picker's "start a new project" form copies
  `templates/project/` into a new folder, writes its `project.json` and adds the folder to
  `.gitignore`'s allowlist (`10_PANEL/lib/scaffold.ts`). Creating empty registries is not writing
  to them — a project with no folder has no worker yet — and the panel never edits an existing
  registry. Don't add a third writer.
- **Nothing is deleted from the index.** Retiring keeps an entity's number and files. Archiving a
  look moves it to `09_OUTPUT/_archive/` with its registry row saved, so it can be restored.
  Renaming changes the ID wording and the files, never the number.
- **Append-only history is never rewritten.** When footage moves to another episode its old shot
  id stays in `QUEUE.jsonl` and `REVIEW_LOG.jsonl` — that is what happened — and `SHOT_MOVES.jsonl`
  is what reads it forward. Don't be tempted to edit the history instead.
- **When testing a worker against a sandbox copy (`SHM_PROJECTS`, or `SHM_ROOT` on a copied
  project folder), it still spends real credits** unless `SHM_HIGGSFIELD_JS` points at the stub
  CLI. Mark every sandbox queue job processed before any non-dry pass.
- **Never mark a learning `approved` yourself** — only Hamed does, in the panel. Only approved
  rules reach a prompt.
- **Never spend credits without pricing first.** `generate cost` before `generate create`.
- **Models come from the catalogue.** `10_PANEL/worker/MODEL_CATALOG.json` is fetched by the
  worker from `higgsfield model list` / `model get`; never edit it by hand. Image vs video, the
  reference limit, and whether references go as a list or a start frame all come from it
  (`worker/lib/model-schema.mjs`), never from a model's name. Defaults: `seedance_2_5` for video,
  `nano_banana_pro` for images; `pinnedModels` in `config.json` only orders the pickers.
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

They live in `tools\` and take `-Project <slug>`. It is required once more than one project
exists; with exactly one they find it themselves. (`Check-Panel.ps1` is for the whole machine.)

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

# the panel renders but does not respond, or workers will not start: read-only report
# of this machine (Node, CLI workspace, ports, .next age, worker logs) to %TEMP%\fmfd-panel-check.txt
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "tools\Check-Panel.ps1"
```

```powershell
# review panel + generation workers (from 10_PANEL)
npm run up         # the fast production build (rebuilt only when the code changed); the panel server starts one worker per project and keeps them running
npm run dev        # the dev server, for editing the panel's code; http://localhost:3000 — the project picker
npm run worker -- --project <slug>    # one project by hand; add --dry-run to price without spending
npm test           # panel lib + worker tests (Node 22.6+)
```

Hamed's normal path for new prompts is the panel's **Prompts** page (paste or drop a document, fix
targets, submit, approve the priced total). `/run-prompts` and `/sync-in` remain for documents that
need judgement or non-generation SHM-JOB types.

Skills: `/project-log`, `/sync-out`, `/sync-in`, `/sync-check`, `/learn`, `/run-prompts`.

## Layout

```
10_PANEL/       Next.js review panel + generation worker — the system's only code
tools/          Validate-Project, Build-ContextPack, Ingest-Jobs, Move-ToProjects, Check-Panel, Shm-Common
docs/           INDEXING.md, SYNC_PROTOCOL.md, VISION-BATCH-ADD.md (parked), reference/HIGGSFIELD-CLI.md
templates/      project/ — the skeleton the panel copies to start a new film
shahnameh-cli/  a project (code SHM). Any top-level folder with a project.json is one.
.generate.lock  machine-wide: one generation at a time. Never committed.
.workers-paused "Stop all workers" on the Queue page is in force. Never committed.
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
  after stopping the workers: **Stop all workers** on the Queue page, then wait until it says
  "All workers stopped" (each finishes the job in hand first). Without the panel running, create
  each project's `queue/worker.stop` instead. Don't drop a `worker.stop` while the panel runs and
  expect it to stick unless it is the Queue page's: the supervisor restarts a worker on new code.
  The panel can run anywhere, since JSONL is append-only and union-merged.
- **Author is Parsa Mansouri alone.** Every commit is authored and committed by
  `Parsa Mansouri <parsaxavier@gmail.com>` (the repo's local `user.name` / `user.email`), with no
  trailer. Commits before 2026-09-26 carry Hamed as author; they are not rewritten.

  **No AI co-author, ever.** No `Co-Authored-By: Claude`, no "Generated with Claude Code" line,
  no Claude or Anthropic attribution of any kind, in the commit message or the PR body.
- **"commit" is an instruction, not a question.** When the user says "commit" in a Claude chat,
  stage and commit the working tree right then. Don't ask first.
- **Always sync, never just commit.** A commit that only sits on this machine isn't done. After
  committing, pull (`git pull --rebase`) and push, so the other machine can clone the work.
  Media pushes through LFS, so give the upload time to finish and confirm it did.
- Verify before pushing: `git add -A --dry-run` lists nothing from `node_modules`, `.next` or
  `.env`, and after staging `git lfs ls-files` lists every media file.

## Environment

Windows 11, PowerShell 5.1, Node 24 LTS (22.6 at the least), Git 2.55.

- **The Higgsfield CLI needs a workspace chosen, once per machine** (CLI 1.1.26+): without it every
  `generate` and `cost` call fails with "No workspace selected". `higgsfield workspace list`, then
  `higgsfield workspace set <id>` for the workspace with the credits. The worker holds jobs and says
  so on the Queue and Prompts pages when it is missing.
- Open the panel at `http://localhost:3000`. Next's dev server blocks its own scripts for other
  addresses (a network IP), and the page then renders but never responds. `127.0.0.1` is allowed
  in `next.config.ts`.

- PowerShell scripts are **ASCII-only on purpose** — PS 5.1 reads BOM-less `.ps1` as ANSI, so
  non-ASCII characters corrupt silently.
- **Never write JSON with PowerShell's `Set-Content -Encoding utf8`** — PS 5.1 emits a BOM and
  Node refuses to parse it. Use `[System.IO.File]::WriteAllText` with `UTF8Encoding($false)`.
- If `npm` fails with "running scripts is disabled", use `npm.cmd` or
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
