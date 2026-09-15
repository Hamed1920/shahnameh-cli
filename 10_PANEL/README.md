# Shahnameh Review Panel

Local web panel for reviewing Higgsfield generations, plus the worker that runs them.

Next.js 16.3 · React 19.2 · Tailwind 4 · localhost only.

---

## Run it

```powershell
cd 10_PANEL
npm run dev        # panel at http://localhost:3000
npm run worker     # generation worker, in a second terminal
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
| **Worker** (also) | files reviewer uploads, `FILINGS.jsonl`, `state.json` `failedDecisions` |
| **Panel** | `REVIEW_LOG.jsonl`, `LEARNINGS.jsonl` — **append-only**; raw uploads into `09_OUTPUT/_uploads/<decision-id>/` |
| **PowerShell tools** | registries, when the worker is not running |

The panel never names, moves or registers a file and never edits a CSV. It records a decision
(and drops any uploaded image beside it); the worker acts on it. One writer for the registries
means no torn CSVs and no races.

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
