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
| **Panel** | `REVIEW_LOG.jsonl`, `LEARNINGS.jsonl` — **append-only, nothing else** |
| **PowerShell tools** | registries, when the worker is not running |

The panel never moves a file or edits a CSV. It records a decision; the worker acts on it. One
writer for the filesystem means no torn CSVs and no races.

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
