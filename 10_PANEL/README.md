# Shahnameh Review Panel

Local web panel for reviewing Higgsfield generations, plus the worker that runs them.

Next.js 16.3 · React 19.2 · Tailwind 4 · localhost only.

---

## Run it

```powershell
cd 10_PANEL
npm run up         # panel at http://localhost:3000 and the worker, one terminal
# or separately:
npm run dev        # panel only
npm run worker     # generation worker, in a second terminal (or Start it from the Queue page)
```

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
| **Worker** (also) | files reviewer uploads, `FILINGS.jsonl`, `state.json` `failedDecisions`, `INDEX_OPS_RESULTS.jsonl`, `JOB_REQUEST_RESULTS.jsonl` |
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
prompt blocks on `P01` / `PROMPT 2` / `پرامپت ۳` headings, then `SHOT n`, then numbered items,
then blank lines, and keeps each block's text as written. Text before the first heading (a
document's rules) can be prepended to every prompt with one checkbox.

Each row gets a target — an entity from the index, a shot id, or a **new entity** — plus look,
model, first render (draft/final), references (from the same picker as Review) and the prompt.
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
Discard is allowed until then and burns nothing. `state.json` keeps the cursor in
`processedRequests`.

**Regenerate** on an accepted take (Decided page) is the same channel, type `regenerate`: the
worker re-queues the accepted job from its `QUEUE.jsonl` record as the next attempt, with an
optional note and the Sound choice, and the result comes to Review like any other take; accepting
it files the next `_T`. One click is the approval, as with a deny-and-regenerate.

## Sound

`seedance_2_5` generates audio unless told not to. The worker turns `generate_audio` on for every
video job that does not say otherwise (`videoSound` in `config.json`), the Review form has a
Sound checkbox for the revision or final a decision queues, and the Prompts page has one per
batch. Older jobs and sidecars carry the string `"false"` from the first EP001 batch file; the
worker normalises it to a boolean, so those stay silent only if a reviewer leaves Sound off.

## Worker from the panel

The Queue and Prompts pages show whether the worker is running (from `queue/worker.lock`) and can
start it (spawned detached, console in `queue/worker.stdout.log`), stop it after its current job
(the panel writes `queue/worker.stop`; the worker exits between jobs and releases its lock), or
restart it when it is running code from before an update. Force stop kills the process: the
Higgsfield job keeps running server-side and its credits are spent, so it sits behind a confirm.
`npm run up` starts the panel and the worker together in one terminal.

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
  building the prompt the worker rewrites each mention to the attached image's position and name
  (`@Image2 (LOC-007 V02, Royal Audience Platform)`) and appends a key listing every attached
  image. The panel rejects a mention that isn't in the job's reference list.

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
| `costCeilingCredits` | cumulative ceiling for the worker's lifetime; pauses rather than loops |
| `maxJobsPerRun` | cap per pass |
| `maxAttempts` | after this many failed revisions the loop stops and asks for a human rethink |

Every job is priced with `higgsfield generate cost` **before** `generate create`. A job whose
references cannot be resolved is skipped before any spend.

## Configuration

| Env | Default |
|---|---|
| `SHM_ROOT` | the parent of `10_PANEL` |
| `SHM_REVIEWER` | `hamed` — recorded on every decision |

## Known gaps

- **Auth is not done.** `higgsfield auth login` needs an interactive browser sign-in, then
  `higgsfield workspace set <id>`. Until then the worker holds queued jobs and logs why.
- **The generate response schema is unverified.** `extractResultUrls` / `extractJobId` in
  `worker/lib/hf.mjs` are deliberately tolerant because no live response has been seen yet. If a
  generation produces no downloadable URL, the worker writes `raw-response.json` into the
  staging folder instead of guessing — tighten those two functions against it.
- Video review renders as an `<img>`; it needs a `<video>` branch once the first video lands.

## Sandbox testing (spends nothing)

The worker can be pointed at a copy of the project with `SHM_ROOT`, and at a stand-in CLI with
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

`sandbox-flows.mjs` is the end-to-end check for the Prompts channel: it appends the same lines the
panel appends and asserts what the worker does (numbers reserved only at approval, `--generate-audio`
on the CLI argv, stale totals refused, graceful stop). The panel itself cannot run a second dev
server from the same folder, and Turbopack refuses a junctioned `node_modules`, so page rendering
is checked against the running panel with plain GETs.
