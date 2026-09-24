# Reading the picture, not the filename — deferred

**Status: parked 2026-09-21, on Hamed's call. Nothing here is built.**

The References page's batch add works today by reading **filenames**
(`10_PANEL/lib/batch-add.ts`). This file records why that is not enough, and the design for the
vision pass that would replace it, so it can be picked up cold.

## The problem with filenames

Batch add cleans a filename, matches its words against `ENTITIES.csv`, and proposes what the file
is. That works for a file this system named itself — `SHM-CHR-001-ZAHHAK_V02_head-detail.png` — and
falls apart on everything else, which is most of what actually gets dropped:

```
Man_walking_with_black_snakes_202609031256.jpeg    a Higgsfield export
group_of_primitive_fire_priests3.png_2026...jpeg   a Higgsfield export
IMG_1234 (1) copy.jpg                              nothing at all
```

Hamed's objection, and it is the right one: *if the filenames were already good enough to name the
asset from, there would have been no reason to build an indexing system.* The name is the one thing
you cannot trust. The picture is the thing that is actually true.

## The design

**One request per image, with the entity catalog in the prompt.** The question is not the
open-ended "what is this" but the answerable "which of these 44 is it, or is it new?" — which is
tractable because `ENTITIES.csv` already carries a written `description` for every entity:

> `SHM-CHR-001-ZAHHAK` — "Masked king. Cracked copper-red face mask, tall spiked bone-and-metal
> crown, long grey-black hair, floor-length black velvet robe. V01 black snakes coiled at
> shoulders + plain staff; V02 dragon-embroidered robe + old-wood staff…"

INDEXING.md §8 says that column is written "so someone who has never opened the file can still tell
it apart from its siblings". That is exactly this job. The whole catalog is **~3.1k tokens** for 44
entities — small, and stable enough to prompt-cache across a batch.

- **Returns**, under a schema (`output_config.format`, so a malformed reply cannot become a bad
  row): an existing entity id **or** new + kind + English name; a short descriptor; a role; and a
  confidence.
- **Where it runs**: the panel's server action on drop, before the table renders — it has to be
  synchronous, since the point is that the table arrives filled in. This is read-only
  classification: it moves no file and writes no registry, so the "only the worker writes" rule in
  CLAUDE.md is untouched. Nothing about who allocates numbers changes: the model proposes, Hamed
  confirms in the table, the worker numbers.
- **Keep the filename pass as the fallback.** Two reasons, both real: a file already carrying a
  full ID is a re-import where the name *is* authoritative and vision would be strictly worse; and
  if the key is missing or a call fails, the batch still works instead of dying.
- SDK: `@anthropic-ai/sdk` (TypeScript). Use `messages.count_tokens` to re-baseline the estimates
  below rather than trusting them.

## Cost, per 40-image batch

Catalog cached across the batch, ~1.5k tokens per image, ~150 out.

| Model | Per batch of 40 |
|---|---|
| `claude-opus-5` | ~$0.50 |
| `claude-sonnet-5` | ~$0.25 |
| `claude-haiku-4-5` | ~$0.10 |

Opus is the recommendation: the call that costs real money when it goes wrong is "is this Zahhak,
or a different masked figure?", and a wrong answer burns a number that can never be reused. Haiku
is fine on obvious cases (a moodboard, a closeup) and weakest exactly where the three staffs live.

This spend is **not** Higgsfield credits and does not touch `costCeilingCredits` or
`JOB_LEDGER.csv` — it is a different account. It should still be logged somewhere before it
becomes a habit.

## Prerequisites

- **No Anthropic credential exists on this machine** and no LLM dependency exists anywhere in the
  repo — this would be the first. Needs `ANTHROPIC_API_KEY` in `10_PANEL/.env.local`, or
  `ant auth login`.
- `.env.local` must stay out of git (`.gitignore` is an allowlist, so it already is — verify
  before the first push after adding it).

## Open decisions

1. Which model (table above).
2. Whether a vision proposal may ever arrive pre-confirmed, or always lands in the table as now.
   Current answer: always the table — a wrong guess burns a number.
3. Whether to log Anthropic spend, and where.

## Prompt asset extraction — the same idea, for the Prompts page

**Status: parked 2026-09-24, same reason (no Anthropic key yet). The plug-in point is built.**

The Prompts page arranges each row's references into slots by what the prompt names: Characters,
Locations, Props & vehicles, and so on (`10_PANEL/lib/ref-slots.ts`). What fills those slots is a
**detector** (`10_PANEL/lib/asset-detect.ts`). Today there is one, `keyword`, which matches words
against `ENTITIES.csv` names and slug words. It only knows things already in the index.

A model-backed detector would also read the script for things the index does not have yet (a new
character the scene introduces) and return them as `proposal` slots. Hamed then fills such a slot
with **Create**, the reference studio, which numbers the new entity only when a result is picked.

To add it:

- Implement `AssetDetector` (`id`, async `detect(prompt, { catalog, recent })` returning
  `DetectedAsset[]`: kind, entity or proposal, candidates, matched words) and `registerDetector` it.
  It must run server-side (a server action), since the key cannot reach the browser.
- Set `"detector": "<id>"` in `10_PANEL/worker/config.json`.
- `detectAssets` already falls back to `keyword` when a detector throws, so a missing key or a
  failed call still leaves the page working.
- Same cost shape as above: the catalog (~3k tokens) is cached across a document's prompts; a
  prompt is a few hundred tokens in and ~200 out. Log the spend as noted in the open decisions.
- Today the page calls the keyword detector directly on every keystroke (`detect` in
  `app/[project]/prompts/prompt-intake.tsx`). A model-backed one needs a debounced async call
  there, merged with `mergeDetected(..., 'ai')`; the merge already keeps what Hamed placed.
