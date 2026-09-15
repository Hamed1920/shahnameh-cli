# Open Questions

Decisions only Hamed can make. This file is the single source — `PROJECT_LOG.md` links here and
`CONTEXT_PACK.md` ships it to Claude Chat / Cowork so the authoring side knows what is unsettled.

Resolve one by deleting it and logging the decision with `/project-log`.

---

### Q4 — Confirm canonical for `PRP-010` (diplomatic gift set)

Provisionally `V01`, the stone-slab flat-lay, since it reads as a *set*. `V02` is the staged
niche version. Flagged `NEEDS-CANONICAL`. On 2026-09-14, review `rev_mu18hin2vjk9` asked for
`V02` when the gifts are unwrapped in `SHM-EP001-SC004-SH0010`, which points to `V02`.

### Q5 — Split the gift set into individual props?

`SHM-PRP-010-GIFT-DIPLOMATIC-SET` contains roughly eight distinct objects (dagger, mace, textiles,
jar, crystal, casket, belt, bird vessel). Keep as one set entity, or give each its own `PRP`
number so they can be staged individually?

### Q6 — Generate the missing hero sheets?

Two entities are registered with no asset of their own:
- `SHM-PRP-002-STAFF-OLDWOOD-PLAIN` — exists only inside the Zahhak plates
- `SHM-GRP-002-CRAFTSMEN` — exists only inside `REF-001`

Both are flagged `NO-ASSET;NEEDS-HERO-SHEET`. Worth a generation pass?

### Q7 — Episode structure

How many episodes, and what are they? Nothing can be bound to a shot until `SHM-EP001` exists.

### Q8 — Which Higgsfield models should be the defaults?

`10_PANEL/worker/config.json` currently defaults to `nano_banana_2` for images and
`seedance_2_0` for video, taken from the CLI's own help examples. Once authenticated, run
`higgsfield model list --json` and pick deliberately — the choice affects cost per generation and
how well reference images are honoured.

### Q9 — Spend ceilings

The worker holds any job over **60 credits** and pauses entirely after **200 credits** in a run
(`perJobCostCeilingCredits` / `costCeilingCredits`). Those are placeholders chosen without
knowing the plan's credit balance. Set them against the real budget.

### Q10 — Are these uploads new looks of existing entities?

Review uploads created three new numbers that may be the same object as an existing entity. By
`INDEXING.md`, the same object in a different look should be a new `_V`, not a new number:
- `SHM-CHR-003-ZAHHAK-OLD-WOOD` is `CHR-001/V02` with the snakes and embroidery recoloured black.
- `SHM-LOC-018-ZAHHAK-PALACE-OUTSIDE` has the source prompt "monumental austere royal audience
  platform", the same idea as `SHM-LOC-007-ROYAL-AUDIENCE-PLATFORM`.
- `SHM-PRP-016-PERISAN-IRANIAN-FLAG` may be the look for the reserved
  `SHM-PRP-011-BANNER-IRANIAN-ROYAL`. Its slug and family also misspell "Persian".

Numbers are never reused. Folding one in means retiring it and adding its image to the other
entity as a new look, both from the References page. Proposed rules `L-0002`, `L-0003` and `L-0004` cite
these IDs.

### Q11 — Should entity rules reach shot prompts?

The worker gives a shot job only the rules that apply to every prompt, because a shot has no entity. So
the Zahhak, flag, palace and Jamshid rules (`L-0002` to `L-0005`), once approved, would reach the
context pack but never an EP001 revision. One option: also inject a rule when its entity is among
the shot's attached references. That needs a change to `applicableLearnings` in
`10_PANEL/worker/worker.mjs`.

---

*Resolved 2026-09-03 by the EP001 script:*
*Q1 — `LOC-011` V01 is the escape route; kept as one location.*
*Q2 — `LOC-002` is Iran's main gate. `LOC-001` and `LOC-003` remain separate gates.*
