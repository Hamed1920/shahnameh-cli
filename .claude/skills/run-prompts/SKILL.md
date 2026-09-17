---
name: run-prompts
description: Take a pasted list of prompts, or a PDF/DOCX/TXT dropped in a project, and turn it into queued Higgsfield generations. Use when Hamed says "run this", "run these prompts", "here's the prompt list", "I dropped a file", "generate these", or pastes a block of prompts. Handles Persian and English documents.
---

# Run prompts

Hamed's normal workflow: he hands over a document or pastes a pile of prompts and says "run it."
This turns that into queued, priced, reference-resolved generations without him doing any
bookkeeping.

**Pick the project first:** use the one the user names (by name, folder slug or code); if only one
folder in the repo has a `project.json`, use that; otherwise ask. Never guess — a prompt queued in
the wrong project targets the wrong entities. `<project>` below is that folder, e.g.
`shahnameh-cli`, and `<slug>` its name.

**First choice since 2026-09-15: the panel's Prompts page** (`http://localhost:3000/<slug>/prompts`).
It takes pasted text, SHM-JOB blocks, batch JSON, `.txt/.md/.docx/.pdf`, splits the document
deterministically (`10_PANEL/lib/prompt-parser.ts`), lets Hamed set targets and references with
pickers, and that project's worker validates, prices and waits for his Approve before spending.
Use this skill when a document needs judgement the page cannot give: mapping an author's own IDs to
entities, spotting a spec that contradicts an existing asset, or ordering stills before video.
Even then, the batch can be handed to the page (paste the batch JSON) instead of
`enqueue-batch.mjs`, so the spend gate is his click.

---

## 1. Get the text

| Input | How |
|---|---|
| Pasted into chat | Save verbatim to `<project>/99_INBOX/<yyyyMMdd-HHmm>-prompts.txt` |
| `.pdf` | `Read` tool with the `pages` parameter |
| `.txt` / `.md` | `Read` tool |
| `.docx` | Extract `word/document.xml` from the zip, then strip tags — see below |

`.docx` extraction (no dependencies, preserves Persian):

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead('<abs path>.docx')
$e = $zip.Entries | Where-Object { $_.FullName -eq 'word/document.xml' }
[System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, '<out>.xml', $true)
$zip.Dispose()
```

Then convert with Node — **not** PowerShell, which mangles non-ASCII: replace `<w:br/>` and
`</w:p>` with newlines, strip remaining tags, decode entities, write UTF-8.

**Never** paraphrase or "clean up" a prompt. Generation prompts are precise instruments; a
reworded prompt is a different prompt. Store the source verbatim.

## 2. Understand the document before touching anything

Read it properly. Production documents usually carry more than prompts:

- an **asset registry** with the author's own IDs and reference placeholders
- **continuity rules** that apply to every generation
- a **block/shot structure** with timings
- **acceptance criteria**

All of it matters. The continuity rules in particular belong in the prompts you eventually
submit, and often deserve to become approved learnings (see `/learn`).

## 3. Map the author's IDs to project entities

The author's IDs will not match this project's IDs (they all start with its `code`, e.g. `SHM-`).
Build a mapping table and write it to the episode folder as `ASSET_MAP.md`. For each one, decide:

- **maps to an existing entity** — record the ID, and the variant if it matters
- **maps to a new variant** of an existing entity (a costume change, a different state)
- **is genuinely new** — needs registering
- **is ambiguous** — do **not** guess; put it to Hamed

Watch for the case where a spec **contradicts** an existing asset. That is a real finding, not a
detail to smooth over — surface it before anything is generated against the wrong reference.

## 4. Register what's missing — through the one allocator

**Never write an entity number by hand and never let the worker invent one.** Write a JOB block
file into `<project>/00_PROJECT/sync/inbox/` using `NEW/KIND/SLUG` targets and a
`project: <CODE>` line, then:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "tools\Ingest-Jobs.ps1" -Project <slug> -WhatIf
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "tools\Ingest-Jobs.ps1" -Project <slug>
```

`Ingest-Jobs.ps1` is the only PowerShell tool that allocates numbers; the worker does the same at
Prompts-page approval and when filing an upload. Keeping the list that short is why collisions are
impossible. Fill in a real `description` for each reserved entity afterwards.

## 5. Check the dependency order

A video prompt that references a character still has no still image **cannot run yet**. Sort the
work:

1. **Stills first** — every referenced entity needs an approved hero image
2. **Then video** — once every `@` token resolves

If the document is video and the references do not exist, say so plainly rather than queuing
work that will fail or, worse, silently invent the character.

## 6. Build the batch

Write a JSON array to `<project>/00_PROJECT/sync/batch-<name>.json`:

```json
[
  { "label": "P01 approach",
    "target": "SHM-LOC-020-...",
    "variant": "V01",
    "model": "seedance_2_5",
    "prompt": "<verbatim prompt, with [MENTION x] replaced by nothing - refs go in refs[]>",
    "refs": ["@CHR-001/V02", "@LOC-004"],
    "params": { "aspect_ratio": "16:9", "duration": "15" } }
]
```

Sound is **on** for every video unless a row says `"generate_audio": false` (the worker's
`videoSound` default). Never write `"generate_audio": "false"` into a batch unless the shot is
meant to be silent: that string is exactly what kept every EP001 block silent until 2026-09-15.

Then:

```powershell
cd 10_PANEL
node worker/enqueue-batch.mjs --project <slug> ..\<project>\00_PROJECT\sync\batch-<name>.json --dry-run
node worker/enqueue-batch.mjs --project <slug> ..\<project>\00_PROJECT\sync\batch-<name>.json
```

Invalid rows are skipped and reported; valid rows still queue.

## 7. Price before spending — always

```powershell
npm run worker:dry -- --project <slug>     # prices every queued job, generates nothing
```

**Report the total to Hamed and wait** before letting the real worker run. A 12-block video batch
is not a small spend, and `worker/config.json` ceilings are a backstop, not permission — and they
are account-wide, shared with every other project.

The panel normally has a worker running for each project already, so an approved batch starts
generating by itself. By hand, for one project:

```powershell
npm run worker -- --project <slug>         # actually generates
```

## 8. Hand off

Tell him: how many jobs queued, the total cost, what was skipped and why, and what still needs a
decision. Then he reviews in the panel at `http://localhost:3000/<slug>/review`.

Finish with `/project-log`.

---

## Rules

- **Never reword a prompt.** Store and submit it verbatim.
- **Never auto-create an entity.** Unknown target → ask, or register explicitly via
  `Ingest-Jobs.ps1`.
- **Never generate against an unresolved reference.** The whole point of the index is that
  "Zahhak" means one specific set of pixels.
- **Never queue into a project the document is not for.** Check the code before the first job.
- **Never spend without reporting the price first.**
- **Never silently drop a prompt.** If a row cannot run, name it and say why.
- If the document contradicts an existing asset, **stop and surface it**.
