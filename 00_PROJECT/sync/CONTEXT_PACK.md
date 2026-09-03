# Shahnameh - Context Pack

Generated 2026-09-03 14:22 - `state_hash: e04f07a2`

Paste or attach this at the start of a Claude Chat conversation, or add it to the files of a
Claude Cowork project. It is the complete current state of the Shahnameh asset index.
Regenerate it (`/sync-out`) whenever the CLI has added or changed entities.

---

## Your role

You are the **authoring** side. You write creative direction and prompts. You do **not** name
files, invent ID numbers, or guess at paths - the CLI owns all of that.

Three rules:

1. **Refer to everything by ID.** Never `the walking stick` - there are several. Say `PRP-001`.
2. **Never assign a number.** To propose something new, write `NEW/KIND/SLUG-YOU-WANT` and the
   CLI will allocate the real number and tell you what it was.
3. **Emit work as JOB blocks** in exactly the format below. Anything else has to be retyped by
   hand at the other end.

## Reference tokens

Cite an existing asset inside a prompt or in `refs` with an `@` token. The CLI resolves each
one to a real image before it spends anything on generation.

```
@CHR-001            the canonical look of that entity
@CHR-001/V02        a specific variant
@CHR-001/V02/T03    a specific take
```

An unresolvable token means the whole job is rejected. If you are unsure a variant exists,
use the bare `@CHR-001` form and let the CLI pick the canonical.

## JOB block format

```
=== SHM-JOB ===
job_id: J-20260903-001
author: claude-chat
state_hash: e04f07a2
type: generate.image
target: SHM-PRP-001-STAFF-COBRA-BRONZE
variant: V02
engine: higgsfield
refs: @CHR-001/V02; @PRP-001
params: ar=16:9; count=4
notes: free text for the human
--- prompt ---
Your prompt here. Any length, any punctuation, any number of lines.
Nothing needs escaping.
--- end prompt ---
=== END SHM-JOB ===
```

`type` is one of: `generate.image`, `generate.video`, `register.entity`,
`update.entity`, `retire.entity`, `define.shot`.

`target` is an existing ID (short or full), or `NEW/KIND/SLUG`. `job_id` must be unique;
re-sending the same one with the same content is a safe no-op.

Always echo `state_hash: e04f07a2` so the CLI can tell you if you were working from a stale
copy of this pack.

## Naming rules you need to know

- ID shape: `SHM-KIND-NNN-SLUG`. Short form `KIND-NNN` is always acceptable.
- Kinds: `CHR` character, `GRP` group/caste, `LOC` location, `PRP` prop, `CRT` creature,
  `COS` costume, `VEH` vehicle, `FX` effect, `REF` reference board.
- **Different physical object -> different number. Same object, different look -> same number,
  new variant `V`. Same look, re-rolled -> same variant, new take `T`.**
- Slugs are `UPPER-KEBAB` and lead with a family word (`STAFF-`, `GATE-`, `THRONE-`).
  Two things in a family must be tellable apart from the slug alone.
- Shots: `SHM-EP001-SC014-SH0030`. Shots count in tens so they can be inserted between.

## Next free number per kind

Use these only to understand the shape of the space. **Do not allocate from them** - propose
`NEW/KIND/SLUG` instead and let the CLI assign.

`CHR 003   GRP 006   LOC 012   PRP 011   CRT 004   COS 001   VEH 001   FX 001   REF 002`

---

## The index

### Characters (CHR)

**CHR-001** `SHM-CHR-001-ZAHHAK`
  - status CONCEPT | variants V01, V02, V03 (canonical) | related SHM-PRP-001-STAFF-COBRA-BRONZE;SHM-PRP-002-STAFF-OLDWOOD-PLAIN | FLAGS NEEDS-CANONICAL
  - Masked king. Cracked copper-red face mask, tall spiked bone-and-metal crown, long grey-black hair, floor-length black velvet robe. V01 black snakes coiled at shoulders + plain staff; V02 dragon-embroidered robe + old-wood staff; V03 dragon-embroidered robe + cobra staff. Mask, crown and silhouette are constant across all three.

**CHR-002** `SHM-CHR-002-JAMSHID`
  - status CONCEPT | variants V01 (canonical) | related SHM-LOC-010-THRONE-TAKHT-E-JAMSHID
  - White mask carved with gold sunburst rosettes, long straight black hair, gold five-point crown, red-and-cream block-print robe over floral lining. Photographed in a pale stone niche.

### Groups and castes (GRP)

**GRP-001** `SHM-GRP-001-WORKERS`
  - status CONCEPT | variants V01 (canonical) | related SHM-REF-001-BOARD-CIVILIZATION-CASTE
  - Rough white block masks with protruding peg noses and two drilled eyes. Dyed wool tunics in maroon, olive, teal. Slung stone satchels, wooden digging poles.

**GRP-002** `SHM-GRP-002-CRAFTSMEN`
  - status CONCEPT | no assets yet | related SHM-REF-001-BOARD-CIVILIZATION-CASTE | FLAGS NO-ASSET;NEEDS-HERO-SHEET
  - Block masks with red-clay peg noses. Pink, cream and teal tunics. Carry hand tools, a stone tablet and a basket. Currently exists only inside SHM-REF-001.

**GRP-003** `SHM-GRP-003-FIRE-PRIESTS`
  - status CONCEPT | variants V01 (canonical) | related SHM-REF-001-BOARD-CIVILIZATION-CASTE
  - Long beaked pale masks incised with red sun glyphs, round tasselled side-discs. Red and black layered robes. Hold slender rods and low censers.

**GRP-004** `SHM-GRP-004-ROYAL-WARRIORS`
  - status CONCEPT | variants V01 (canonical) | related SHM-REF-001-BOARD-CIVILIZATION-CASTE
  - Dark green-grey stone block masks with hollow ringed eyes and a heavy carved nose. Hide-and-sackcloth mantles. Long spears, crimson shields with a gold sunburst.

**GRP-005** `SHM-GRP-005-PALACE-GUARDS`
  - status CONCEPT | variants V01 (canonical)
  - Completely featureless pale stone egg-shaped heads, no eyes or mouth. Dark blue-black quilted coats with small dagger loops. Distinct from GRP-004: no carved features, no shields, no spears.

### Locations (LOC)

**LOC-001** `SHM-LOC-001-GATE-CEREMONIAL-STONE-RELIEF`
  - status CONCEPT | variants V01 (canonical) | family GATE | FLAGS REVIEW-SPLIT
  - Weathered blue-grey and ochre stone gate, standing horse reliefs on the four flanking slabs, black void doorway, shallow tiered step platform, flat dusk sky.

**LOC-002** `SHM-LOC-002-GATE-CEREMONIAL-CYPRESS-COURT`
  - status CONCEPT | variants V01 (canonical) | family GATE | FLAGS REVIEW-SPLIT
  - Tall dark bronze door recessed in a carved sandstone wall, cypresses flanking a stepped ramp, twin stone water channels, warm low sunset light on the stone.

**LOC-003** `SHM-LOC-003-GATE-CEREMONIAL-MARBLE-SCREEN`
  - status CONCEPT | variants V01 (canonical) | family GATE | FLAGS REVIEW-SPLIT
  - Folded screen of cream and red-veined marble slabs, single tall dark doorway, two rows of cypresses, pale paved approach, near-black storm sky.

**LOC-004** `SHM-LOC-004-MOUNTAIN-PASS`
  - status CONCEPT | variants V01 (canonical)
  - Single ochre rock peak rising from an empty rust-coloured plain, pale dirt road winding in from the foreground. Painterly, matte-painting surface texture.

**LOC-005** `SHM-LOC-005-IRANIAN-PLATEAU`
  - status CONCEPT | variants V01 (canonical)
  - Late dry season. Grey rocky ridge line across the frame, teal haze sky, rust and sage scrub in the foreground. Establishing wide, no architecture.

**LOC-006** `SHM-LOC-006-MERDAS-PRIVATE-HALL`
  - status CONCEPT | variants V01 (canonical)
  - Night. Two rows of massive weathered columns, a throne entirely buried under a vast white shroud that pools across the floor, a small gold crown set alone on a plinth beside it, deep blue void beyond the arch.

**LOC-007** `SHM-LOC-007-ROYAL-AUDIENCE-PLATFORM`
  - status CONCEPT | variants V01 (canonical)
  - Dark green-black monolithic facade with a torn mountain-like silhouette, tiled pointed-arch doorway, small red-and-gold tiled windows, wide brick step platform, twin pale peaks behind in flat fog.

**LOC-008** `SHM-LOC-008-ZAHHAK-RITUAL-KITCHEN`
  - status CONCEPT | variants V01 (canonical) | related SHM-CHR-001-ZAHHAK
  - Vast low underground vault, pale blue-grey square piers, a small stone hearth with live fire at the far end, the whole floor covered in flower bundles, fruit, grain dishes and dark domed vessels.

**LOC-009** `SHM-LOC-009-CEREMONIAL-RECEPTION-HALL`
  - status CONCEPT | variants V01 (canonical)
  - Wide frontal symmetry. Green-black piers left and right, pale ashlar back wall, low empty stone dais, a row of small oil lamps casting rust stains up the wall, broad tiered steps.

**LOC-010** `SHM-LOC-010-THRONE-TAKHT-E-JAMSHID`
  - status CONCEPT | variants V01 (canonical) | family THRONE | related SHM-CHR-002-JAMSHID
  - Small gilded jewelled throne with a rose-and-turquoise back panel, set inside a weathered stone aedicule on a stepped platform, heavy fog rolling across the frame. Hero throne plate.

**LOC-011** `SHM-LOC-011-PALACE-UNDERLEVELS`
  - status CONCEPT | variants V01 (canonical), V02 | FLAGS NEEDS-CANONICAL;REVIEW-SPLIT
  - Descending secondary circulation. V01 a carved-rock corridor with blue-washed arched niches and one long central stair. V02 a large mudbrick multi-level courtyard with several stairs and small trees. These may be two different places.

### Props (PRP)

**PRP-001** `SHM-PRP-001-STAFF-COBRA-BRONZE`
  - status CONCEPT | variants V01 (canonical) | family STAFF | related SHM-CHR-001-ZAHHAK
  - Twisted dark wood shaft with a bronze hooded cobra head, mouth open, fangs showing. Full turnaround sheet with front, back, head detail and base detail. Carried by CHR-001 in V03.

**PRP-002** `SHM-PRP-002-STAFF-OLDWOOD-PLAIN`
  - status CONCEPT | no assets yet | family STAFF | related SHM-CHR-001-ZAHHAK | FLAGS NO-ASSET;NEEDS-HERO-SHEET
  - Plain pale weathered wood, no head, slight natural curve, roughly shoulder height. Visible only inside CHR-001 V01 and V02. Deliberately the anti-cobra staff.

**PRP-010** `SHM-PRP-010-GIFT-DIPLOMATIC-SET`
  - status CONCEPT | variants V01 (canonical), V02 | family GIFT | FLAGS NEEDS-CANONICAL;REVIEW-SPLIT
  - V01 flat-lay on a stone slab: sheathed dagger on black velvet, ornate silver mace, folded crimson gold-thread textiles, black lidded jar, raw crystal, silver casket. V02 staged in a niche: carved stone bird vessel, jewelled textile hanging, tooled belt with gold buckle, gold casket, gold chain.

### Creatures (CRT)

**CRT-001** `SHM-CRT-001-RIDING-BEAST-PALE-BEAKED`
  - status CONCEPT | variants V01 (canonical) | family RIDING-BEAST
  - Seated. White and pale blue shaggy coat, heavy smooth bone-coloured beak, single short horn, crimson embroidered saddle blanket. Highland scrub setting, dusk.

**CRT-002** `SHM-CRT-002-RIDING-BEAST-LONGBEAK-BLACK`
  - status CONCEPT | variants V01 (canonical) | family RIDING-BEAST
  - Standing, horse proportions. Black matted dripping coat, very long tapered pale beak, weathered green panel blanket and leather harness. Two small figures in frame for scale. Misty conifer hillside.

**CRT-003** `SHM-CRT-003-RIDING-BEAST-STONE-HIDE`
  - status CONCEPT | variants V01 (canonical) | family RIDING-BEAST
  - Standing, bear-like bulk. Blue lichen-and-stone hide flecked with pale mineral, blunt heavy muzzle, small ears, massive pale splayed claws. Three robed figures for scale on an open plain.

### Reference boards (REF)

**REF-001** `SHM-REF-001-BOARD-CIVILIZATION-CASTE`
  - status CONCEPT | variants V01, V02 (canonical) | family BOARD | related SHM-GRP-001-WORKERS;SHM-GRP-002-CRAFTSMEN;SHM-GRP-003-FIRE-PRIESTS;SHM-GRP-004-ROYAL-WARRIORS
  - 4-up contact sheets. V01 quadrants workers / craftsmen / priests / civilization. V02 quadrants workers / craftsmen / priests / warriors. Source board for GRP-001 through GRP-004.

---

## Open questions

### Q1 â€” Is `LOC-011` one location or two?

`SHM-LOC-011-PALACE-UNDERLEVELS` holds two variants that look like **different places**:
V01 a carved-rock corridor with blue-washed niches, V02 a mudbrick multi-level courtyard.
Split into two `LOC` numbers, or keep as one location seen two ways?
*Currently:* one entity, canonical `V01` (provisional). Flagged `REVIEW-SPLIT`.

### Q2 â€” Are the three ceremonial gates three gates, or three takes of one?

`LOC-001` (stone relief), `LOC-002` (cypress court), `LOC-003` (marble screen) are registered as
three separate locations. If they are actually rejected takes of a single gate, they should
collapse into one entity with three variants.
*Currently:* three entities. All flagged `REVIEW-SPLIT`.

### Q3 â€” Confirm Zahhak's canonical look

`SHM-CHR-001-ZAHHAK` canonical is provisionally `V03` (dragon-embroidered robe + cobra staff),
picked because it is the most fully realised plate and the cobra staff is his signature prop.
The alternative is `V01` (black snakes at the shoulders), which is the more literal Shahnameh read.
**This decides which reference image every future prompt gets.** Flagged `NEEDS-CANONICAL`.

### Q4 â€” Confirm canonical for `PRP-010` (diplomatic gift set)

Provisionally `V01`, the stone-slab flat-lay, since it reads as a *set*. `V02` is the staged
niche version. Flagged `NEEDS-CANONICAL`.

### Q5 â€” Split the gift set into individual props?

`SHM-PRP-010-GIFT-DIPLOMATIC-SET` contains roughly eight distinct objects (dagger, mace, textiles,
jar, crystal, casket, belt, bird vessel). Keep as one set entity, or give each its own `PRP`
number so they can be staged individually?

### Q6 â€” Generate the missing hero sheets?

Two entities are registered with no asset of their own:
- `SHM-PRP-002-STAFF-OLDWOOD-PLAIN` â€” exists only inside the Zahhak plates
- `SHM-GRP-002-CRAFTSMEN` â€” exists only inside `REF-001`

Both are flagged `NO-ASSET;NEEDS-HERO-SHEET`. Worth a generation pass?

### Q7 â€” Episode structure

How many episodes, and what are they? Nothing can be bound to a shot until `SHM-EP001` exists.

---

_End of context pack. `state_hash: e04f07a2`_
