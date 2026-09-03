# Open Questions

Decisions only Hamed can make. This file is the single source — `PROJECT_LOG.md` links here and
`CONTEXT_PACK.md` ships it to Claude Chat / Cowork so the authoring side knows what is unsettled.

Resolve one by deleting it and logging the decision with `/project-log`.

---

### Q1 — Is `LOC-011` one location or two?

`SHM-LOC-011-PALACE-UNDERLEVELS` holds two variants that look like **different places**:
V01 a carved-rock corridor with blue-washed niches, V02 a mudbrick multi-level courtyard.
Split into two `LOC` numbers, or keep as one location seen two ways?
*Currently:* one entity, canonical `V01` (provisional). Flagged `REVIEW-SPLIT`.

### Q2 — Are the three ceremonial gates three gates, or three takes of one?

`LOC-001` (stone relief), `LOC-002` (cypress court), `LOC-003` (marble screen) are registered as
three separate locations. If they are actually rejected takes of a single gate, they should
collapse into one entity with three variants.
*Currently:* three entities. All flagged `REVIEW-SPLIT`.

### Q3 — Confirm Zahhak's canonical look

`SHM-CHR-001-ZAHHAK` canonical is provisionally `V03` (dragon-embroidered robe + cobra staff),
picked because it is the most fully realised plate and the cobra staff is his signature prop.
The alternative is `V01` (black snakes at the shoulders), which is the more literal Shahnameh read.
**This decides which reference image every future prompt gets.** Flagged `NEEDS-CANONICAL`.

### Q4 — Confirm canonical for `PRP-010` (diplomatic gift set)

Provisionally `V01`, the stone-slab flat-lay, since it reads as a *set*. `V02` is the staged
niche version. Flagged `NEEDS-CANONICAL`.

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
