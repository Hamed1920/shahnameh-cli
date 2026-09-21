# Film Making for Dummies — Indexing System (v2.0)

The single source of truth for how everything in **every** project is named, numbered and
referenced. One law, one shape, however many films the repo holds.

**Nothing enters a project without an ID.** If you can't give it an ID, it goes in that project's
`99_INBOX/`.

Only one thing differs between projects: the **project code**, the prefix every ID starts with.
Kinds, folders, variants and takes, statuses, roles and the episode/scene/shot shape are identical
everywhere (`10_PANEL/worker/lib/ids.mjs` is the code's copy of this, and
`tools/Shm-Common.ps1` the tools' — keep all three in step).

This spec is **machine-enforced**. `tools/Validate-Project.ps1` checks every rule below and fails
loudly. If the spec and the validator ever disagree, that is a bug — fix both.

> Changed in v2.0: short IDs, canonical variants, take numbers, reference tokens, cross-links,
> the `RESERVED` status, formal grammar, and shot binding. See §11 for the migration note.

---

## 1. Entity IDs

Entities are the reusable nouns of a film: characters, groups, locations, props, creatures,
costumes, reference boards. They are **global within their project** — one Zahhak across all
episodes of Shahnameh, and nothing to do with any other project's `CHR-001`.

```
CODE - KIND - NNN - SLUG
 |      |      |     |
 |      |      |     +-- UPPER-KEBAB name, family word first
 |      |      +-------- 3-digit number, unique within KIND, NEVER reused
 |      +--------------- 3-letter kind code
 +---------------------- the project code, from its project.json
```

### The project code

The prefix is the `code` field of the project's `project.json` — 2 to 4 capital letters, unique
across the repo, and never one of the words that already appear in an ID (`CHR`…`REF`, `EP`, `SQ`,
`SC`, `SH`, `NEW`, `NEXT`, `JOB`). The panel suggests one when a project is created and refuses a
clash, because two projects sharing a code would make IDs ambiguous the moment they met in one
document.

Shahnameh's code is `SHM`, and it is the worked example throughout this file:

```
SHM-CHR-001-ZAHHAK
SHM-LOC-008-ZAHHAK-RITUAL-KITCHEN
SHM-PRP-001-STAFF-COBRA-BRONZE
SHM-CRT-002-RIDING-BEAST-LONGBEAK-BLACK
```

Read every `SHM-` below as `<CODE>-` for the project you are working in.

### Kind codes

| Code | Meaning | Folder |
|---|---|---|
| `CHR` | Named individual character | `01_CHARACTERS/` |
| `GRP` | Group / caste / faction archetype | `02_GROUPS/` |
| `LOC` | Location or set | `03_LOCATIONS/` |
| `PRP` | Prop — anything hand-held, worn-adjacent or placed | `04_PROPS/` |
| `CRT` | Creature / beast | `05_CREATURES/` |
| `COS` | Costume, when tracked apart from its character | `06_COSTUMES/` |
| `VEH` | Vehicle / conveyance | `04_PROPS/` |
| `FX` | Effect, atmosphere, recurring visual motif | `08_REFERENCE/` |
| `REF` | Reference / mood / contact board — not a story object | `08_REFERENCE/` |

### Short IDs

`KIND-NNN` is the **short ID** and is unambiguous within a project, because the number is unique
within the kind. Use it in shotlists, prompts, chat and anywhere the full name is noise:

```
CHR-001     ==  SHM-CHR-001-ZAHHAK
PRP-001     ==  SHM-PRP-001-STAFF-COBRA-BRONZE
```

Both forms are legal input everywhere. **Registries always store the full form.** Tools expand
short IDs to full on read and never write short IDs to disk. A short ID is only ever resolved
against the open project — nothing reaches across projects.

---

## 2. The rule that stops confusion

> **Different object → different number.**
> **Same object, different picture → same number, different `V`.**
> **Same picture, regenerated → same `V`, different `T`.**

Decision test: *could these two appear in the same frame, and would a viewer call them two
different things?*

- **Yes** → two entities, two numbers.
- **No** → one entity, two variants.

### Worked example — the three walking sticks

Zahhak carries a plain weathered staff in some looks and a bronze cobra-headed staff in others.
Two physical objects, two numbers:

```
SHM-PRP-001-STAFF-COBRA-BRONZE      bronze hooded cobra head, twisted dark shaft
SHM-PRP-002-STAFF-OLDWOOD-PLAIN     plain pale weathered wood, no head
SHM-PRP-003-STAFF-...               the next distinct staff, when it exists
```

Every slug leads with the **family word** `STAFF-`, so all three sort together in the registry
and read as siblings. Two renders of the *same* cobra staff are not new numbers — they are
`V01` and `V02` of `SHM-PRP-001`.

### Family words

The first token of a slug is the family. Group look-alikes by making them share it:

```
STAFF-      GATE-       CROWN-      THRONE-     MASK-
RIDING-BEAST-           GIFT-       SHIELD-     ROBE-
```

Two entities in the same family must differ in the **rest** of the slug by something visible.
`STAFF-COBRA-BRONZE` vs `STAFF-OLDWOOD-PLAIN` — you could pick either out of a lineup from the
slug alone. That is the bar.

---

## 3. Variants, takes, and the canonical variant

| Level | Syntax | Means |
|---|---|---|
| Entity | `SHM-PRP-001-...` | The object itself |
| Variant | `_V01`, `_V02` | A distinct **design or look** of that object |
| Take | `_T01`, `_T02` | A **regeneration** of one variant — same intent, new roll |

Variants are creative decisions. Takes are attempts. Never use a new variant number to mean
"I re-rolled it."

**A batch of N candidates from one prompt is N takes of one variant**, not N variants. The
reviewer promotes the one that works; the rest are kept in `09_OUTPUT/_rejected/` as the
negative half of the training signal. This follows from the rule above, but it is the thing
people get wrong most often.

### Canonical variant

Every entity with more than one variant **must** declare a `canonical_variant` in
`ENTITIES.csv`. That is the hero look — the one fed to Higgsfield as the reference image when
a prompt just says "Zahhak" with no variant.

An entity with variants and no canonical variant is a validation **error**, not a warning. It is
the single most common way a project like this drifts: two agents each pick a different plate
and the character quietly changes appearance mid-season.

---

## 4. Filenames

```
<FULL-ID>_V<nn>[_T<nn>]_<lower-kebab-description>.<ext>
```

```
SHM-CHR-001-ZAHHAK_V02_dragon-robe-oldwood-staff.jpeg
SHM-LOC-011-PALACE-UNDERLEVELS_V01_carved-rock-stair-corridor.png
SHM-PRP-001-STAFF-COBRA-BRONZE_V01_T03_tighter-head-detail.png
```

- Full ID, never short, in filenames.
- `_T<nn>` is omitted for `T01`. Present only from the second take onward.
- Description is free lower-kebab text — whatever helps you find it in a thumbnail grid.
- **Never rename or move a file without updating `registry/ASSET_MANIFEST.csv`.** The manifest
  stores the original source filename, which is what makes every rename reversible.

### Formal grammar

```
full_id     = code "-" kind "-" NNN "-" slug
code        = [A-Z]{2,4}            the project's `code`, e.g. "SHM"
kind        = "CHR" | "GRP" | "LOC" | "PRP" | "CRT" | "COS" | "VEH" | "FX" | "REF"
NNN         = [0-9]{3}
slug        = [A-Z0-9]+ ("-" [A-Z0-9]+)*
short_id    = kind "-" NNN
variant     = "V" [0-9]{2}
take        = "T" [0-9]{2}
descriptor  = [a-z0-9]+ ("-" [A-Z0-9a-z]+)*
filename    = full_id "_" variant ["_" take] "_" descriptor "." ext
ext         = "png" | "jpg" | "jpeg" | "webp" | "mp4" | "mov"
```

Regex used by the validator, with `SHM` standing for the project's own code (the validator builds
it from `project.json`):

```
^SHM-(CHR|GRP|LOC|PRP|CRT|COS|VEH|FX|REF)-\d{3}-[A-Z0-9]+(-[A-Z0-9]+)*_V\d{2}(_T\d{2})?_[a-z0-9]+(-[a-z0-9]+)*\.(png|jpg|jpeg|webp|mp4|mov)$
```

---

## 5. Reference tokens — how prompts cite assets

This is the bridge between prompt authoring and execution. A prompt written anywhere — Claude
Chat, Claude Cowork, a note on your phone — cites an asset with an `@` token:

```
@CHR-001            the canonical variant of Zahhak
@CHR-001/V02        that specific variant
@CHR-001/V02/T03    that specific take
@PRP-001            the canonical cobra staff
```

The CLI resolves every token to a real file path before submitting to Higgsfield. An
unresolvable token is a hard failure — the job is rejected, not guessed at.

This means an authoring surface never needs to know a file path, a folder or your disk layout.
It only needs the ID list of the project it is writing for. See `SYNC_PROTOCOL.md`.

---

## 6. Status lifecycle

```
RESERVED  ->  CONCEPT  ->  APPROVED  ->  LOCKED  ->  RETIRED
```

| Status | Means |
|---|---|
| `RESERVED` | Number claimed by an inbound job, no asset yet. Set by the CLI, never by hand. |
| `CONCEPT` | Assets exist, look not settled |
| `APPROVED` | Look agreed, still open to revision |
| `LOCKED` | Final. **Do not regenerate without a `PROJECT_LOG.md` entry saying why.** |
| `RETIRED` | Out of the show. Number stays burned forever. |

Entities and individual assets each carry their own status. An entity can be `APPROVED` while
one of its variants is still `CONCEPT`.

---

## 7. Story IDs — episodes, scenes, shots

Entities are flat and global within the project. Story IDs are hierarchical and per-episode. Same
shape in every project; only the code changes.

```
SHM-EP001                      Episode 1
SHM-EP001-SQ02                 Sequence 2
SHM-EP001-SC014                Scene 14        (scenes number per episode)
SHM-EP001-SC014-SH0030         Shot 30         (shots number per scene)
```

- **Scenes**: 3 digits, per episode, in order. A Prompts-page video row that names no scene is
  sent as `NEXT/EP001`; the worker gives it the next free scene when the batch is approved. A
  scene counts as used once any queued job has targeted it, so its number is never reused.
- **Shots**: 4 digits, counted **in tens** (`0010, 0020, 0030`) so you can insert `0015` later
  without renumbering anything.

Grammar: `^<CODE>-EP\d{3}(-SQ\d{2})?(-SC\d{3})?(-SH\d{4})?$`

### Shot binding

A shot never re-describes an asset. It **points at IDs**, in `SHOTLIST.csv`:

```
shot_id,scene_id,description,location,characters,props,creatures,duration_s,status,notes
SHM-EP001-SC014-SH0030,SHM-EP001-SC014,"Zahhak enters the kitchen",LOC-008,CHR-001/V02,PRP-001,,6,TODO,
```

Multiple IDs are semicolon-separated. A bare short ID means the canonical variant. Add `/V02`
to pin a specific one.

Shot output files:

```
SHM-EP001-SC014-SH0030_V01_T02.mp4
```

---

## 8. Registries

Everything lives in the project's own `00_PROJECT/registry/`
(e.g. `shahnameh-cli/00_PROJECT/registry/`). No registry is ever shared between projects:

| File | Holds |
|---|---|
| `ENTITIES.csv` | Every entity — the master index |
| `ASSET_MANIFEST.csv` | Every media file → its entity, variant, take, role, and original filename |
| `EPISODES.csv` | Episodes, sequences, scenes |

`ENTITIES.csv` columns:

```
id, short_id, kind, number, slug, name, family, status, canonical_variant,
variant_count, folder, related, flags, description
```

- `related` — semicolon-separated IDs this entity is bound to (a staff to its bearer, a group to
  its location). Lets an authoring surface reason about the world without seeing the files.
- `flags` — semicolon-separated machine-readable markers: `NEEDS-HERO-SHEET`, `NEEDS-CANONICAL`,
  `REVIEW-SPLIT`, `NO-ASSET`.
- `description` — written so someone who has never opened the file can still tell it apart from
  its siblings. This is what gets shipped to Claude Chat and Cowork in the context pack, so it
  has to carry its own weight.

`ASSET_MANIFEST.csv` columns:

```
filename, entity_id, variant, take, role, status, folder, source,
original_filename, added, notes
```

`role` vocabulary: `HERO`, `TURNAROUND`, `PLATE`, `DETAIL`, `BOARD`, `RENDER`.

`role` says what kind of picture a file is. It is a filing label only — nothing in generation
reads it; the validator just checks the value is in this list.

| Role | Meaning | Example |
|---|---|---|
| `HERO` | The main "this is what it looks like" image, usually the first good one | LOC-007 V01 dark monolith facade |
| `PLATE` | One specific look or version; several plates of one subject sit side by side as V01, V02… | CHR-001 Zahhak V01, V02, V03 |
| `TURNAROUND` | One object from several angles (front, side, back) on a single sheet | PRP-001 V01 turnaround sheet |
| `DETAIL` | A close-up of one part: a mask, a hand, a pattern | — |
| `BOARD` | A mood or contact sheet: many images in one grid, not one object | REF-001 civilization caste board |
| `RENDER` | A generation accepted in the review panel. Set by the worker only | — |

For a reviewer upload: a first good image of something new → `HERO`; another look of something
that already has one → `PLATE`; a collage → `BOARD`. The panel's role help (`?`) carries the same
definitions in Persian (`10_PANEL/components/role-help.tsx`) — keep the two in step.

---

## 8b. Retiring, archiving, renaming and moving

Done from the panel's References page and applied by the worker. None of them frees a number.

- **Retire:** `status` becomes `RETIRED`. The entity keeps its number, rows and files. Pickers
  hide it, and uploads can't attach to it. Restoring sets `CONCEPT`, or a chosen status.
- **Archive a look:** every manifest row for that entity + variant is removed, and its files move
  to `09_OUTPUT/_archive/<archive-id>/`. The removed row is saved in
  `09_OUTPUT/_archive/index.jsonl`. If the main look was archived, the lowest remaining variant
  becomes canonical; with no looks left the entity gets `NO-ASSET`. Restoring puts the file back,
  under the next free `_V` if its old variant has been reused since.
- **Rename:** only the slug and name change. `SHM-PRP-016-OLD` becomes `SHM-PRP-016-NEW`, every
  file of the entity is renamed to match, and `related` links elsewhere are updated. `short_id`
  never changes, so `@PRP-016` tokens keep resolving. Full IDs written into documents by hand
  (e.g. an episode's `ASSET_MAP.md`) are not rewritten.
- **Move looks:** a look re-files under another entity as that entity's next `_V`, keeping its
  takes and descriptor.
- **Move footage to another episode:** a shot takes all of its takes with it and lands on the
  **next free scene** of the episode it moves to. The scene number it leaves behind is burned for
  good, like every other number here — a gap in `EP001` is the correct record of a scene that used
  to be there. Asked for from the panel's Gallery (any number at once) or Decided page, applied by
  the worker (`move-shot` in `worker/lib/index-ops.mjs`).

Archive, move and rename are refused while a queued job or an unapplied decision still points at
the files involved. Moving footage is refused for the same reasons, and also while one of its
takes is still waiting for review — decide it first.

### Reading an old shot id forward

`QUEUE.jsonl` and `REVIEW_LOG.jsonl` are append-only history and keep the shot id a job was made
under, which is right: that is what happened. Every move is recorded in
`00_PROJECT/queue/SHOT_MOVES.jsonl` instead — old id, new id, and every file that went with it —
and that is what the panel reads an old id forward through, so a decision from before the move
still shows its take and still regenerates into the right episode. A shot moved twice is followed
all the way.

## 9. Number allocation

- Numbers are assigned **sequentially per kind, per project**, from `001`. Two projects each having
  a `PRP-001` is normal and harmless — their full IDs differ by the code.
- **Numbers are never reused**, including after `RETIRED`. Gaps are fine and expected.
- Only the CLI assigns numbers. An external authoring surface proposes a `NEW/KIND/SLUG` and the
  CLI resolves it — see `SYNC_PROTOCOL.md` §3. This is what makes collisions structurally
  impossible rather than merely unlikely.
- The one other allocator is the panel worker, in two places, both using the same rule as
  `Ingest-Jobs.ps1` — highest number of that kind, `RETIRED` included, plus one
  (`nextEntityNumber` in `10_PANEL/worker/lib/promote.mjs`) — and both rejecting a slug that
  already exists:
  - A reviewer can upload a reference in the review panel and propose it as a new entity (kind +
    English name). The worker assigns the number at filing time. An upload attached to an existing
    entity gets that entity's next `_V` instead. Either way the manifest row has `source` = `upload`.
    The References page's **batch add** is the same filing for a whole folder at once: it reads each
    filename to propose what the file is, and Hamed confirms the table before anything is sent.
    Several images in one batch may be looks of **one** newly proposed entity — they carry a
    `groupOf` naming the image that proposes it, and land as `V01, V02, V03` of the single number
    the worker allocates. That is the one case where a slug proposed twice in a batch is not a
    clash; two *ungrouped* rows proposing the same slug are still rejected, as they must be. The
    batch is applied as a unit, so forty files either all land or none of them do.
  - A Prompts-page batch can target `NEW/KIND/SLUG`. The worker assigns the number **when the
    batch is approved**, not when it is submitted or priced, so a discarded batch burns nothing.
    The row is written exactly as `Ingest-Jobs.ps1` writes it (`RESERVED`, `NO-ASSET`), with
    `Reserved by <batch id>` in the description until a look lands.
- In Shahnameh, `PRP-010` was hand-assigned in v1.0, leaving `003`–`009` free. They stay free.
  Gaps are not errors.

---

## 10. Adding something new — the 4 steps

1. Pick the `KIND`. Run `tools\Validate-Project.ps1 -Project <slug>` and read the **next free
   number** it prints for that project.
2. Write the slug: family word first, then whatever makes it distinct from its siblings.
3. Drop the file in the right folder as `<FULL-ID>_V01_<description>.<ext>`.
4. Add rows to `ENTITIES.csv` and `ASSET_MANIFEST.csv`, run the validator, then `/project-log`.

Or just let `/sync-in` do all four from an inbound job block.

---

## 11. v1.0 → v2.0 migration

No files were renamed. v1.0 filenames already satisfy the v2.0 grammar. What changed:

- `ENTITIES.csv` gained `short_id`, `slug`, `canonical_variant`, `related`, `flags`; `notes`
  was renamed `description`.
- `ASSET_MANIFEST.csv` gained `take`, `role`, `status`.
- `RESERVED` added to the status lifecycle.
- Reference tokens (§5), take numbers (§3) and shot binding (§7) are new.
- The whole spec is now enforced by `tools/Validate-Project.ps1`.

---

## 12. One project or many

v2.0 was written for one film whose folders sat at the repo root. The repo now holds the system at
the root and each film in its own folder beside it, so:

- The prefix is the project's `code`, not a hard-coded `SHM` (§1).
- Numbers, registries and story IDs are per project (§8, §9).
- The tools take `-Project <slug>`; `tools/Validate-Project.ps1` with no `-Project` validates every
  project in turn plus the system-level checks (unique codes, sound `project.json`, nothing stray).

Nothing about a name, a number, a variant or a take changed. A project written under the old
layout is already correct under this one.
