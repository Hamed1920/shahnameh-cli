# EP001 — Zahhak's Entry · asset map

The source document uses its own ID scheme (`CHAR_ZAHHAK`, `LOC_MOUNTAIN_ROUTE`, …). This maps
each one to a project entity so every `[MENTION …]` placeholder can be replaced with an `@`
reference token the CLI can resolve to a real file.

**The document cannot be submitted until every row below is `READY`.** Its own execution
instruction #3 requires each placeholder to be replaced with a real uploaded asset — a video
generated against a missing reference would invent the character, which is exactly the drift
the index exists to prevent.

Status: `READY` file exists · `NEEDS ART` entity exists, no image · `NEW` must be registered ·
`DECIDE` mapping needs Hamed

---

## Characters and groups

| Doc ID | Entity | Status | Note |
|---|---|---|---|
| `CHAR_ZAHHAK` | `SHM-CHR-001-ZAHHAK` | **READY** | Variant switches at block 6 — see below |
| `CHAR_JAMSHID_ROYAL` | `SHM-CHR-002-JAMSHID` V01 | **READY** | |
| `CHAR_JAMSHID_ESCAPE` | `SHM-CHR-002-JAMSHID` **V02** | **NEEDS ART** | "same Jamshid, fewer royal signs" — a variant, not a new character |
| `CHAR_IRANIAN_NOBLES` | *new* `GRP` | **NEW** | 5–8 nobles and commanders with variation |
| `CHAR_IRANIAN_RIDERS` | *new* `GRP` | **NEW** | political escort, explicitly *not* an invading army |
| `CHAR_JAMSHID_ATTENDANTS` | ? | **DECIDE** | Could be `SHM-GRP-005-PALACE-GUARDS`, or new. Doc says "servants **and** guards" |
| `CREATURE_JAMSHID_MOUNT` | ? | **DECIDE** | Doc says **bipedal**, flightless, kneels. All three existing `CRT` beasts are four-legged |

### Zahhak's variant by block — this is the episode's spine

The document's central rule is that Zahhak swaps staffs at block 6 and never goes back. The
existing variants already encode exactly that, so no new art is needed:

| Blocks | Variant | Staff |
|---|---|---|
| P02–P05 | `@CHR-001/V02` | old wood staff (`PROP_ZAHHAK_OLD_STAFF`) |
| P06–P12 | `@CHR-001/V03` | royal serpent staff (`PROP_ROYAL_SERPENT_STAFF`) |

## Locations

| Doc ID | Entity | Status | Note |
|---|---|---|---|
| `LOC_MOUNTAIN_ROUTE` | `SHM-LOC-004-MOUNTAIN-PASS` | **READY** | |
| `LOC_JAMSHID_THRONE` | `SHM-LOC-010-THRONE-TAKHT-E-JAMSHID` | **READY** | Doc: "no redesign" |
| `LOC_ESCAPE_ROUTE` | `SHM-LOC-011-PALACE-UNDERLEVELS` **V01** | **READY** | Descending corridor + stairs. **Resolves open question Q1** |
| `LOC_ZAHHAK_AUDIENCE_HALL` | `SHM-LOC-009-CEREMONIAL-RECEPTION-HALL` | **DECIDE** | Cold stone hall, empty dais — good fit, but `LOC-007` is also plausible |
| `LOC_IRAN_MAIN_GATE` | one of `LOC-001` / `002` / `003` | **DECIDE** | **Resolves Q2.** Gate opens from inside, Iran is green and liveable — suggests `LOC-002` (cypress court, bronze door) |
| `LOC_HALL_OF_COLUMNS` | `SHM-LOC-006-MERDAS-PRIVATE-HALL` | **DECIDE** | Right architecture, but ours is named for *Merdas* and the doc calls it Jamshid's hero location |
| `LOC_FINAL_DESERT` | `SHM-LOC-005-IRANIAN-PLATEAU` | **DECIDE** | Plateau has scrub; doc wants open-horizon desert |
| `LOC_ZAHHAK_APPROACH` | *new* | **NEW** | Cold rocky plain and road to Zahhak's complex |
| `LOC_ZAHHAK_OUTER_COURT` | *new* | **NEW** | Outer courtyard where riders wait |
| `LOC_IRAN_OUTSKIRTS` | *new* | **NEW** | Healthy, liveable edge of the Iranian city |
| `LOC_ROYAL_CAUSEWAY` | *new* | **NEW** | Ascending ramp and stair to the seat of power |
| `LOC_LOWER_GATE_MOUNT` | *new* | **NEW** | Side gate where the mount waits |

## Props

| Doc ID | Entity | Status | Note |
|---|---|---|---|
| `PROP_GIFT_BUNDLE` | `SHM-PRP-010-GIFT-DIPLOMATIC-SET` | **READY** | |
| `PROP_ZAHHAK_OLD_STAFF` | `SHM-PRP-002-STAFF-OLDWOOD-PLAIN` | **NEEDS ART** | Entity exists, no hero sheet — already queued as `J-20260903-4FA` |
| `PROP_ROYAL_SERPENT_STAFF` | `SHM-PRP-001-STAFF-COBRA-BRONZE` | **CONFLICT** | See below |
| `PROP_IRANIAN_BANNER` | *new* | **NEW** | |
| `PROP_RITUAL_VESSEL` | *new* | **NEW** | May be split out of `PRP-010` — relates to Q5 |
| `PROP_POWER_INSIGNIA` | *new* | **NEW** | Same |
| `PROP_JAMSHID_REGALIA` | *new* | **NEW** | Droppable regalia for the escape |
| `PROP_MOUNT_HARNESS` | *new* | **NEW** | |

### ⚠ `PROP_ROYAL_SERPENT_STAFF` contradicts `SHM-PRP-001`

The document specifies, twice and emphatically:

> "long, dark and minimal, with **one abstract serpent motif**; no dragon head, jewels, light or
> magic" — and in the registry, "بدون اژدها، جادو یا نور" (no dragon, magic or light)

`SHM-PRP-001-STAFF-COBRA-BRONZE` is a **literal bronze cobra head, hood flared, mouth open with
visible fangs**. That is close to the "dragon head" the spec rules out.

This is the single most important object in the episode — block 6 exists solely to hand it over.
It needs a decision before any block from P04 onward can be generated:

- **A.** Regenerate `PRP-001` to match the spec (abstract motif, minimal), or
- **B.** Register the spec's staff as a **new** `PRP` number and keep the cobra staff as a
  separate object, or
- **C.** Accept the existing cobra staff and relax the spec.

Under the indexing rules these are genuinely different objects, so B is the safe default — but
it is a creative call, not a mechanical one.
