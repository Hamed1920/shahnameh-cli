# Shahnameh CLI — Project Log

The running record of this project. **Any agent or chat picking this project up reads this file
first**, top to bottom, before touching anything.

Newest entries at the top of the log. Append with `/project-log`.

---

## Current state

**Phase:** Indexing v2.0 and the Chat/Cowork sync protocol are in place and tested.
Higgsfield engine not yet wired up.
**Last updated:** 2026-09-03 · `state_hash: e04f07a2`

| | |
|---|---|
| Assets filed | 28 |
| Entities registered | 25 |
| Episodes defined | 0 |
| Shots defined | 0 |
| Validator | PASS, 0 warnings |

### What exists

```
00_PROJECT/          INDEXING.md v2, SYNC_PROTOCOL.md, OPEN_QUESTIONS.md, registry/, tools/, sync/
01_CHARACTERS/       4 files  — Zahhak (3 looks), Jamshid
02_GROUPS/           4 files  — workers, fire priests, royal warriors, palace guards
03_LOCATIONS/       12 files  — 11 locations (LOC-011 has 2 variants)
04_PROPS/            3 files  — cobra staff turnaround, diplomatic gift set x2
05_CREATURES/        3 files  — three riding beasts
06_COSTUMES/         empty
07_EPISODES/         _TEMPLATE only
08_REFERENCE/        2 files  — civilization caste contact boards
09_OUTPUT/           empty
99_INBOX/            empty
```

Open decisions live in [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) — 7 outstanding.

### Next up

- [ ] Receive the Higgsfield prompt from Hamed and wire the engine into `/sync-in` step 4
- [ ] Resolve the open questions
- [ ] Define `SHM-EP001` and its shotlist

---

## Log

### 2026-09-03 — Indexing v2.0 and the Chat/Cowork sync protocol

**Agent:** Claude (Opus 5) · **Chat:** initial setup, second pass

Prompts will be authored in Claude Chat and Claude Cowork and executed here. Those surfaces
cannot see this disk, so left informal the arrangement fails in three specific ways: naming
drift, ID collisions, and lost provenance. Built a closed loop that makes each structurally
impossible rather than merely unlikely.

Done:

- **`INDEXING.md` v2.0.** Added short IDs (`CHR-001`), canonical variants, take numbers (`_T`)
  as distinct from variants (`_V`), `@` reference tokens, `related` cross-links, the `RESERVED`
  status, formal regex grammar, and shot binding. No files needed renaming for the grammar —
  v1.0 names already conformed.
- **`SYNC_PROTOCOL.md`.** The four-step loop: `/sync-out` builds a context pack → author in
  Chat/Cowork → `/sync-in` ingests JOB blocks → paste the receipt back. One authority per
  concern: Chat owns creative intent, the CLI owns names, numbers and files.
- **Reference tokens.** A prompt cites `@CHR-001/V02` and the CLI resolves it to a real file
  path before spending anything. The authoring side never needs to know a path.
- **Number allocation moved entirely to the CLI.** Chat proposes `NEW/PRP/STAFF-IRON-CAPPED`;
  `Ingest-Jobs.ps1` assigns the number. Chat is now incapable of causing a collision.
- **Three tools**, sharing `Shm-Common.ps1` so the state hash cannot diverge between them:
  `Validate-Project.ps1`, `Build-ContextPack.ps1`, `Ingest-Jobs.ps1`.
- **Registries upgraded.** `ENTITIES.csv` gained `short_id`, `slug`, `canonical_variant`,
  `related`, `flags`. `ASSET_MANIFEST.csv` gained `take`, `role`, `status`.
- **Renamed 8 files** so every slug leads with its family word — `GATE-CEREMONIAL-*`,
  `THRONE-TAKHT-E-JAMSHID`, `GIFT-DIPLOMATIC-SET`, `BOARD-CIVILIZATION-CASTE`. Originals still
  recorded in the manifest.
- **Skills:** added `/sync-out`, `/sync-in`, `/sync-check`; rewrote `/project-log` for v2.
- **Tested the loop for real** with a four-job batch: a valid job resolved short-ID to full;
  a `NEW/` proposal was assigned `SHM-PRP-011`; an unresolvable `@CHR-009` ref was rejected
  before any spend; a colliding slug was rejected naming `SHM-PRP-001`. Re-ran the identical
  batch and every job came back `DUPLICATE` with nothing re-allocated — idempotency holds.
  All test artifacts were rolled back; validator returns to `e04f07a2`, PASS.

Corrections to the previous entry:

- The five `related` cross-references written in the first session pointed at IDs that the
  family-first rename invalidated. The validator caught all five. This is the class of error
  the whole v2 pass exists to prevent, and it appeared within an hour of v1.

Notable judgement calls made (flag if wrong):

- **Set provisional canonical variants** for the three entities that had none: Zahhak `V03`,
  `LOC-011` `V01`, `PRP-010` `V01`. Canonical variants are now a hard validator error, so
  leaving them blank meant a permanently failing build. All three keep the `NEEDS-CANONICAL`
  flag and are Q3/Q4 in `OPEN_QUESTIONS.md` — they read as unconfirmed, not decided.
- **Renamed 8 files for family-first slugs.** Churn now, while the project is 28 assets, rather
  than at 500. The `family` column would have grouped them anyway; this makes the ID itself
  carry the grouping.
- **Moved open questions out of this log** into `OPEN_QUESTIONS.md`, so the context pack can
  ship them to Chat/Cowork from a single source rather than a parsed heading.
- **Ingest does not call any generation engine.** It validates, reserves and plans; the agent
  executes. Written this way because Higgsfield is not wired up yet, and a tool that pretends
  to generate is worse than one that admits it cannot.

### 2026-09-03 — Project scaffolding, asset intake, indexing system

**Agent:** Claude (Opus 5) · **Chat:** initial setup

Started from 28 loose image files in the project root with generator-default filenames
(Midjourney job IDs and web-download names). Nothing was categorized or indexed.

Done:

- Reviewed all 28 images individually — categorization is based on image content, not filenames.
  Several filenames were misleading (e.g. `group_of_primitive_civilization_worker` and
  `Guard` are two clearly different castes; the `Zahhak_Hair` / `Zahhak-_Old_Wood` pair differ
  by *staff*, not hair).
- Created the folder structure above.
- Designed the indexing system — written up in [INDEXING.md](INDEXING.md). Core rule:
  `SHM-KIND-NNN-NAME-SLUG`, human-readable, family word first in the slug, distinct physical
  objects always get distinct numbers, and different renders of one object get `_V01/_V02`.
- Filed and renamed all 28 assets. Every original filename is preserved in
  [registry/ASSET_MANIFEST.csv](registry/ASSET_MANIFEST.csv), so every rename is reversible.
- Registered 25 entities in [registry/ENTITIES.csv](registry/ENTITIES.csv), each with a written
  visual description so a future agent can tell them apart without opening the files.
- Created the `/project-log` skill so this file gets updated on every work session.

Notable judgement calls made (flag if wrong):

- `Guard` was split out as its own group (`GRP-005`) rather than folded into royal warriors —
  the guards have featureless stone-egg heads and no shields, the warriors have carved masks,
  spears and sunburst shields. Different castes.
- The two `descending_secondary_circulation_route` images were kept as one location with two
  variants, but flagged for review — see open question 1.
- Zahhak's three plates were kept as one character with three looks (`V01`–`V03`) rather than
  three characters, since the mask, crown and robe silhouette are consistent.
