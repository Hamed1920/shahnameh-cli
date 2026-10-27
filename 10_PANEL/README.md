# Film Making for Dummies — Panel and Worker

Local web panel for every film in the repo, plus the generation worker that runs each one's
Higgsfield jobs. `http://localhost:3000` is the project picker; each project lives under
`/<slug>/` (Review, Prompts, Studio, Gallery, Episodes, Decided, References, Learnings, Queue).

Next.js 16.3 · React 19.2 · Tailwind 4 · localhost only.

---

## Run it

```powershell
cd 10_PANEL
npm run up         # panel at http://localhost:3000, production build (rebuilt when the code changed); its server starts one worker per project and keeps them running
# or separately:
npm run dev        # the dev server, for editing the panel's code (same as npm run up -- --dev)
npm run worker -- --project <slug>   # one project's worker by hand, only with SHM_WORKER=off (otherwise the panel runs it)
npm test           # panel lib + worker tests
```

Open it at `http://localhost:3000` (or `127.0.0.1`). Opened at the machine's network address,
the page renders but never responds. The Higgsfield CLI needs a workspace chosen once per
machine (`higgsfield workspace list`, then `higgsfield workspace set <id>`); until then the
worker holds jobs and says so on the Queue and Prompts pages.

> If PowerShell blocks `npm` with "running scripts is disabled", either use `npm.cmd run dev`
> or set the standard developer policy once:
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

## The loop

```
enqueue ──> QUEUE.jsonl ──> worker ──> higgsfield generate ──> download
                                                                  │
                                                       09_OUTPUT/_staging/<hfJobId>/
                                                                  │
                                                            panel  /
                                                                  │
                                            ┌─────── accept ──────┴─────── deny ───────┐
                                            │                                          │
                                   promoted into the                        kept in _rejected,
                                   entity folder + manifest                 requeued with the note
                                            │                                          │
                                            └──────────── /learn ─────────────────────┘
                                                            │
                                                    proposed rules
                                                            │
                                                   Hamed approves in /learnings
                                                            │
                                        injected into revision prompts AND CONTEXT_PACK.md
```

## Who writes what

This is the invariant that keeps the registries intact — the PowerShell tools, the worker and
the panel all touch the same files.

| Process | Writes |
|---|---|
| **Worker** | asset files, `ASSET_MANIFEST.csv`, `ENTITIES.csv`, `JOB_LEDGER.csv`, `QUEUE.jsonl` |
| **Worker** (also) | files reviewer uploads, `FILINGS.jsonl`, `queue/state.<machine>.json`, `INDEX_OPS_RESULTS.jsonl`, `JOB_REQUEST_RESULTS.jsonl` |
| **Panel** | `REVIEW_LOG.jsonl`, `LEARNINGS.jsonl`, `INDEX_OPS.jsonl`, `JOB_REQUESTS.jsonl` — **append-only**; raw uploads into `09_OUTPUT/_uploads/<decision-id>/`; `queue/worker.stop` to ask the worker to stop |
| **PowerShell tools** | registries, when the worker is not running |

The panel never names, moves or registers a file and never edits a CSV. It records a decision
(and drops any uploaded image beside it); the worker acts on it. One writer for the registries
means no torn CSVs and no races. Two panel tabs appending at the same instant could in theory
interleave one JSONL line; appends are serialised inside the panel process and a torn line is
skipped on read, which is enough for a localhost panel with one reviewer.

## Prompts page

`/prompts` is where prompts come in. Paste text, SHM-JOB blocks or a batch JSON array, or drop
`.txt`, `.md`, `.json`, `.docx` or `.pdf` files (docx is unzipped and de-tagged on the server;
pdf goes through pdf.js and its text order is unreliable for Persian, so the extracted text is
shown before parsing and `.docx` is recommended). `lib/prompt-parser.ts` splits a document into
prompt blocks only on `P01` / `PROMPT 2` / `پرامپت ۳` headings; without them the whole document
is one prompt, because a 15-second block is often written as `SHOT 1..5` with shared camera and
sound sections. The document's line on the page offers the other cuts it found (`SHOT n`
headings, numbered items, double blank lines) in a dropdown, and choosing one rebuilds that
document's rows. Each block's text is kept as written. Text before the first heading (a
document's rules) can be prepended to every prompt with one checkbox.

Each row says where an accepted result is **filed** — a shot, an entity from the index, or a
**new entity** — plus look, model, first render (draft/final), references and the prompt. The
target is not who is in the frame; that is the references. `lib/batch-rules.ts` `initialTarget`
picks it: a target the document gives, else a shot the file name or label names (`sc013`), else
for a video the **next free scene** (`NEXT/EP001`, numbered by the worker at approval,
`worker/lib/scenes.mjs`), else for an image the one entity its references or words point at.
`lib/ref-suggest.ts` offers references as chips, nothing attached until clicked: entity names and
slug words only one entity has, pick-one groups for shared words ("staff", "creature"), and the
references of the latest queued jobs, each with the look a recent job used.
Batch settings cover model, aspect ratio, duration and **Sound** (on by default). A row with a
problem blocks Submit until it is fixed or removed; nothing is silently skipped.

Submit appends one `batch.submit` line to `00_PROJECT/review/JOB_REQUESTS.jsonl`. The worker
(`worker/lib/job-requests.mjs`) validates every row against the registries, pre-assigns job ids,
then prices each job with `higgsfield generate cost` outside its registry lock and appends
events to `00_PROJECT/queue/JOB_REQUEST_RESULTS.jsonl`: `validated`, one `price` per job,
`priced`. **Nothing generates until Approve** on the page appends `batch.approve` with the total
it showed; a total that changed since is refused and shown again. On approve the worker reserves
a number for each `NEW/KIND/SLUG` (same rule as every other allocator), appends the jobs to
`QUEUE.jsonl` as `panel:batch`, and records the receipt (`queued`, with the assigned ids).
Discard is allowed until then and burns nothing. `queue/state.<machine>.json` keeps the cursor
in `processedRequests`.

**Regenerate** on an accepted take (Decided page) is the same channel, type `regenerate`. It opens
a dialog prefilled from the accepted job's `QUEUE.jsonl` record where the prompt, references (same
picker as Review), model, first render, look, aspect ratio, duration, sound and a note can all be
changed; anything left alone is kept. The worker checks the references, re-queues the job as the
next attempt (moving the resolution with a draft/final change), and the result comes to Review
like any other take; accepting it files the next `_T`. The click is the approval, as with a
deny-and-regenerate; the ledger price is shown while the settings that decide it are unchanged.

## Reference pack PDF

The Index page has **Download PDF** (the full pack) and **Index only**, for attaching to ChatGPT,
Gemini or Claude before asking for prompts. `/api/index-pdf?part=full|index` builds it on every
click from the registries (`lib/index-pack.ts`, laid out by `lib/pdf-writer.ts` on `pdf-lib`):
how to write reference tokens and a Prompts-page document, the scenes queued so far with their
references, then every entity with a thumbnail of each look and the exact `@KIND-NNN/Vnn` token
under it. Upload bookkeeping in registry notes is left out. The guide restates what the parser,
`initialTarget` and `worker/lib/prompt.mjs` do, so update it when they change. Thumbnails come
from `lib/thumbs.ts` (`sharp`, cached in memory), also served at `/api/thumb` for the reference
tiles and hover previews on the Prompts page. The buttons (`components/pdf-download.tsx`) fetch
`&format=json` (the PDF base64-encoded) and save it from a blob made in the page. A plain link,
or a fetch of the PDF itself, is grabbed by Internet Download Manager: the page gets an empty
204 and IDM saves `index-pdf.txt`. IDM leaves JSON and blob URLs alone. A failure shows the
server's message and an "open it in a tab" button.

Dropdowns everywhere are the panel's own (`components/ui/select.tsx`): same `<option>` children
and `value`/`onChange` as a native select, drawn in the panel's type, keyboard-operable, and
portalled so a card or dialog never clips the list.

## Sound

`seedance_2_5` generates audio unless told not to. The worker turns `generate_audio` on for every
video job that does not say otherwise (`videoSound` in `config.json`), the Review form has a
Sound checkbox for the revision or final a decision queues, and the Prompts page has one per
batch. Older jobs and sidecars carry the string `"false"` from the first EP001 batch file; the
worker normalises it to a boolean, so those stay silent only if a reviewer leaves Sound off.

## Workers

The panel's server starts one worker per project and keeps them running
(`lib/worker-supervisor.ts`), restarting a worker when its code changes. Every page shows the
worker's state; its log is `00_PROJECT/queue/worker.log`. **Stop all workers** on the Queue page
lets each finish the job in hand and stops new ones; wait for "All workers stopped" before
committing. Set `SHM_WORKER=off` in `.env.local` on a machine that must never price or generate.

Every machine runs its own workers, and each record (request, decision, index op, queued job)
carries the `machine` that wrote it, so only that machine's worker acts on it
(`worker/lib/machine.mjs`). Worker state is one file per machine, `queue/state.<machine>.json`,
tracked in git: without it a worker would replay past decisions and spend again. Before writing a
project's registries a worker checks git for unpulled changes to that index and holds with
"pull first" (`worker/lib/git-guard.mjs`).

Generations run in parallel, up to `maxConcurrentGenerations` across every project on the
machine. Each running generation holds a slot in `.generate-slots/` at the repo root;
`.generate.lock` is held only while a worker checks the spend ceiling and takes a slot.

## References page

`/references` browses every entity by kind, with its looks, and manages them. Each change is a
request appended to `00_PROJECT/review/INDEX_OPS.jsonl`. The worker applies it
(`worker/lib/index-ops.mjs`) and records the outcome in `00_PROJECT/queue/INDEX_OPS_RESULTS.jsonl`.
While requests are pending, the page polls and shows each result. The worker checks for requests
every 3 seconds, including while a generation is running (they share an in-process registry lock
with the passes), so a result normally shows within seconds. If it doesn't, the page says whether
the worker is stopped or was started before its code last changed (`getWorkerStatus`, from
`queue/worker.lock`).

| Request | What the worker does |
|---|---|
| `add` | Files uploads exactly like review uploads (new look or new entity). |
| `rename` | Name, description, and the ID wording. It renames every file and updates `related` links. The number is kept, so `@KIND-NNN` tokens still resolve. |
| `retire` / `restore` / `status` | Entity status. Retired entities leave the pickers but keep their number and files. |
| `canonical` / `role` | Main look; role on selected looks. |
| `archive` / `unarchive` | Moves a look to `09_OUTPUT/_archive/<id>/` and saves its manifest row in `index.jsonl`. A look already archived by an earlier request is noted, not refused. Its V number stays reserved while archived, so new looks never reuse it. |
| `move` | Re-files looks under another entity as its next V numbers. |

Every request is validated in full, then applied as one transaction: file moves are recorded and
both CSVs snapshotted, so a failure part-way puts everything back. Archive, move and rename are
refused while a queued or generating job, or an unapplied decision, still needs the files. A result
waiting for review is not a reason to refuse: its `job.json` is rewritten in the same transaction
(archive → the entity's main look, or dropped if another ref covers the entity; move → the look's
new token; rename → the new target id), and the summary names each video that changed. A refusal is
recorded and shown; an I/O error (a locked file) is retried a few seconds later.

The page gets `usedBy` per look from `getLookUsage` (same rules as the worker), shows it under each
look, and disables Archive/Move for looks a job is generating or queued with. Results are toasts
portalled above every dialog; problems stay until dismissed.

## References on a decision

On the Accept/Deny form a reviewer can remove references, add one from the index, or upload an
image. An upload is filed either as a **new look** of an existing entity (its next `_V`) or as a
**new entity** (the worker assigns the number). The decision records the full new `refs` list,
with `upload:<id>` placeholders the worker swaps for the filed token.

- Reference edits only apply when the decision generates something: a denial with *Regenerate*
  ticked, or an accepted **draft** (the edits go into the 1080p final).
- Uploads, reference changes and resolvability are all checked **before** the candidate is moved.
  A decision that fails (for example a name that already exists) is marked failed in
  `state.json`, logged to `FILINGS.jsonl`, and the candidate goes back on the Review page.
- Notes may be written in Farsi or English, in one box, and go into the revision prompt as written.
  (Older decisions may carry `notesEn`; the worker still prefers it when present.)
- **@-mentions.** Typing `@` in the note opens a searchable picker of the references in use for
  this job (only those). A mention is stored as its token (`@LOC-007/V02`, or `@upload:u1` for an
  upload on the same decision, swapped for the filed token when the revision is queued). When
  building the prompt the worker rewrites each mention to the token Higgsfield's own panel uses
  for an attached image, `<<<image_2>>>` (1-based, in attachment order), inline where the mention
  sits; nothing is listed at the end. An attached image the text never calls gets one sentence
  naming it (`<<<image_3>>> is Ceremonial Reception Hall (LOC-009 V01); match it wherever ...`),
  so it is still called. A job re-used from the Higgsfield panel therefore shows its references
  as references. The panel rejects a mention that isn't in the job's reference list.

## Queue a generation

```powershell
npm run enqueue -- --target PRP-002 --prompt "Plain weathered wood staff, museum turnaround" --ref "@CHR-001/V02"
```

| Flag | |
|---|---|
| `--target` | entity id, short (`PRP-002`) or full. **Must already exist** — never auto-created |
| `--prompt` | the prompt |
| `--variant` | defaults to the entity's canonical variant |
| `--model` | defaults to `config.json` `defaultImageModel` |
| `--ref` | reference asset token, repeatable (`@CHR-001/V02`) — resolved to a real file path |
| `--param` | extra CLI param, repeatable (`--param aspect_ratio=16:9`) |

## Worker modes

```powershell
npm run worker        # watch loop
npm run worker:once   # single pass, exit
npm run worker:dry    # plan and price only - generates nothing, spends nothing
```

`worker:dry` is the safe way to check a queue before committing credits.

## Spend controls

`worker/config.json`:

| Key | Meaning |
|---|---|
| `perJobCostCeilingCredits` | a single job above this is held, not run |
| `costCeilingCredits` | ceiling on spend over the last `costWindowHours`, summed from every project's `JOB_LEDGER.csv` rows this machine spent; a job over it is held |
| `maxConcurrentGenerations` | generations running at once, machine-wide (8, the Ultra plan's limit) |
| `defaultImageModel` / `defaultVideoModel` | `nano_banana_pro` / `seedance_2_5`; `pinnedModels` only orders the pickers |
| `maxJobsPerRun` | cap per pass |
| `maxAttempts` | after this many failed revisions the loop stops and asks for a human rethink |

Every job is priced with `higgsfield generate cost` **before** `generate create`. A job whose
references cannot be resolved is skipped before any spend.

Models come from `worker/MODEL_CATALOG.json`, which the worker fetches from `higgsfield model
list` / `model get` once a day (`worker/lib/models.mjs`). Never edit it by hand: image vs video,
the reference limit and how references are sent all come from it (`worker/lib/model-schema.mjs`).

## Configuration

| Env | Default |
|---|---|
| `SHM_PROJECTS` | the repo root — the folder the projects sit in |
| `SHM_ROOT` | one project's folder; the supervisor sets it for each worker it starts |
| `SHM_WORKER` | on; `off` stops the panel starting workers |
| `SHM_MACHINE` | the host name — stamped on every record |
| `SHM_REVIEWER` | `hamed` — recorded on every decision |
| `SHM_HIGGSFIELD_JS` | the real CLI; point it at `scripts/stub-higgsfield.js` to spend nothing |
| `SHM_MODEL_CATALOG` | `worker/MODEL_CATALOG.json` (beside the sandbox when the stub is in use) |
| `SHM_GIT_GUARD` | on; `off` skips the "pull first" check |

## Sandbox testing (spends nothing)

The worker can be pointed at a copy of a project with `SHM_ROOT` (or of the whole repo with
`SHM_PROJECTS`), and at a stand-in CLI with
`SHM_HIGGSFIELD_JS`. `scripts/stub-higgsfield.js` answers `auth token`, `model get`,
`generate cost` (12 credits for an image, 37.5 / 135 for a 480p / 1080p video) and
`generate create` (a completed job whose `result_url` is served by `scripts/sandbox-serve.mjs`),
and logs every argv to `STUB_LOG`. **A sandbox worker without the stub spends real credits.**

```powershell
robocopy "D:\...\Shahnameh CLI" C:\path\to\sandbox /E /XD node_modules .next .git .agents /XF worker.lock
node scripts/sandbox-serve.mjs C:\path\to\sandbox 3199
$env:SHM_ROOT='C:\path\to\sandbox'; $env:SHM_HIGGSFIELD_JS="$PWD\scripts\stub-higgsfield.js"
$env:STUB_LOG='C:\path\to\stub-calls.jsonl'; $env:STUB_VIDEO='09_OUTPUT/_drafts/<id>/T01.mp4'
$env:STUB_IMAGE='01_CHARACTERS/<some>.jpeg'
node worker/worker.mjs
node scripts/sandbox-flows.mjs C:\path\to\sandbox   # submit, price, approve, discard, regenerate, stop
```

The stub also answers `model list` / `model get` from `scripts/stub-models.json` (five real
schemas: Seedance 2.5, Kling 3.0, Nano Banana Pro, Seedream 5 Pro and a tool), so the sandbox
worker builds its own model catalogue beside the sandbox and never touches
`worker/MODEL_CATALOG.json`. `node scripts/sandbox-studio.mjs <sandbox project> <stub log>`
checks the newer paths: a Kling row sent as `--start-image` / `--sound on`, too many references
and tool models refused, a Prompts batch carrying an uploaded file, and a whole reference-studio
session (priced, stale total refused, priority jobs, number allocated at the pick, second pick a
take, close to `_rejected`). Set `STUB_LOG` in the shell for `sandbox-flows.mjs` too.

`sandbox-flows.mjs` is the end-to-end check for the Prompts channel: it appends the same lines the
panel appends and asserts what the worker does (numbers reserved only at approval, `--generate-audio`
on the CLI argv, stale totals refused, graceful stop). The panel itself cannot run a second dev
server from the same folder, and Turbopack refuses a junctioned `node_modules`, so page rendering
is checked against the running panel with plain GETs.

## Login and database (off by default)

The panel runs without a login unless `SHM_AUTH=on` is set in `.env.local`. With it on, people
sign in (BetterAuth) and what they can see depends on their role; accounts, project membership,
releases, client comments and approval requests live in Postgres. With it off nothing here is
needed and the panel never connects to a database.

1. Copy `.env.example` to `.env.local` and fill it in.
2. Start a database: `docker compose -f docker-compose.db.yml up -d` (Postgres on port 5433, matches
   the example `DATABASE_URL`), or put a Supabase direct / session-pooler URL in `DATABASE_URL`.
3. Create the tables: `npm run db:migrate`.

After changing `lib/db/schema.ts`, run `npm run db:generate` and commit the new file in `drizzle/`.
