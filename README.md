# Film Making for Dummies

A system for making films with generative video, driven through Higgsfield. One repo, one set of
rules, any number of films.

The repo root is the **system**: the review panel and its generation worker, the PowerShell
tools, the docs and the project template. Every **project** — one film — is a top-level folder
beside them with its own `project.json`, registries, assets and queue.

| Project | Code | |
|---|---|---|
| `shahnameh-cli/` | `SHM` | A modern adaptation of the Shahnameh, Ferdowsi's Persian Book of Kings |
| `jayson/` | `JAY` | |
| `shajarian/` | `SHA` | |

New projects are started from the panel's project picker ("start a new project"), which copies
`templates/project/`.

## Start

Windows 11, Node 24 LTS (22.6 at least), Git with LFS, the Higgsfield CLI signed in.

```powershell
git lfs install                           # once per machine
higgsfield workspace list                 # once per machine, then:
higgsfield workspace set <id>             # the workspace with the credits

cd 10_PANEL
npm install
npm run up                                # panel + one worker per project
```

Open **http://localhost:3000** — not the network address, where the page renders but never
responds. Pull before starting the panel; stop the workers (Queue page → **Stop all workers**)
before committing, then push.

A step-by-step guide for non-developers is in [startup.md](startup.md). The panel and worker are
documented in [10_PANEL/README.md](10_PANEL/README.md).

## How it works

1. Prompts come in on the panel's **Prompts** page (paste or drop a document), or from Claude
   Chat / Cowork through `/sync-in` and `/run-prompts`.
2. The worker validates and **prices** every batch; nothing generates until it is approved in the
   panel at the total shown.
3. Results land on **Review**. Accept files them under their ID; deny sends them back with the
   note. Video renders as a cheap 480p draft first, then 1080p once accepted.
4. Review notes become rules through `/learn`; only rules approved in the panel reach a prompt.

## Rules that never bend

- **Every asset has an ID**: `<CODE>-KIND-NNN-SLUG` (see [docs/INDEXING.md](docs/INDEXING.md)).
  Only the CLI and the worker allocate numbers, and a number is never reused.
- **The worker is the only process that moves asset files or edits the CSV registries.** The
  panel only appends requests to JSONL.
- **Never spend credits without pricing first.** Spend is capped per job and over a rolling
  window, per machine (`10_PANEL/worker/config.json`).
- **Nothing is deleted from the index.** Retired entities keep their number; archived looks can be
  restored.

## Layout

```
10_PANEL/       Next.js review panel + generation worker
tools/          Validate-Project, Build-ContextPack, Ingest-Jobs, Move-ToProjects, Check-Panel
docs/           INDEXING.md, SYNC_PROTOCOL.md, reference/
templates/      project/ — the skeleton of a new film
<project>/      project.json, 00_PROJECT (log, registries, queue), 01..10 asset folders, 99_INBOX
```

## Tools

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "tools\Validate-Project.ps1" -Project shahnameh-cli
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "tools\Build-ContextPack.ps1" -Project shahnameh-cli
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "tools\Check-Panel.ps1"
```

Media is stored through Git LFS. Anyone who can see this repo can download every render.
