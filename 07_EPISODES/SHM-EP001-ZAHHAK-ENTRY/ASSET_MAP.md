# EP001 — Zahhak's Entry · asset map

The source document uses a legacy ID scheme (`CHAR_ZAHHAK`, `LOC_MOUNTAIN_ROUTE`, …). This maps
each one to a project entity so every `[MENTION …]` placeholder can be replaced with an `@`
reference token the CLI resolves to a real file.

**Decision (Hamed, 2026-09-03): the document's names and typing are legacy. This index is
authoritative.** Where the two disagree, the `SHM-` entity wins.

**No block can be submitted until the assets it references are `READY`.** The document's own
execution instruction #3 requires each placeholder to be replaced with a real uploaded asset. A
video generated against a missing reference invents the character, which is the exact drift the
index exists to prevent.

Status: **READY** image exists · **NEEDS ART** entity registered, no image yet

---

## Characters and groups

| Doc ID | Entity | Status |
|---|---|---|
| `CHAR_ZAHHAK` | `SHM-CHR-001-ZAHHAK` | **READY** — variant switches at block 6, see below |
| `CHAR_JAMSHID_ROYAL` | `SHM-CHR-002-JAMSHID` V01 | **READY** |
| `CHAR_JAMSHID_ESCAPE` | `SHM-CHR-002-JAMSHID` **V02** | **NEEDS ART** — same Jamshid with fewer royal signs; a variant, not a new character |
| `CHAR_IRANIAN_NOBLES` | `SHM-GRP-006-NOBLES-IRANIAN` | **NEEDS ART** |
| `CHAR_IRANIAN_RIDERS` | `SHM-GRP-007-RIDERS-IRANIAN` | **NEEDS ART** |
| `CHAR_JAMSHID_ATTENDANTS` | `SHM-GRP-008-ATTENDANTS-JAMSHID` | **NEEDS ART** — registered apart from `GRP-005`: attendants serve, guards stand post |
| `CREATURE_JAMSHID_MOUNT` | `SHM-CRT-001-RIDING-BEAST-PALE-BEAKED` **V02** | **NEEDS ART** — adapt `CRT-001` into a standing bipedal variant; its seated pose and existing tack are the closest start |

### Zahhak's variant by block — the episode's spine

The document's central rule is that Zahhak swaps staffs at block 6 and never goes back. The
existing variants already encode exactly that, so no new Zahhak art is needed:

| Blocks | Reference | Staff |
|---|---|---|
| P02–P05 | `@CHR-001/V02` | old wood staff (`PROP_ZAHHAK_OLD_STAFF`) |
| P06–P12 | `@CHR-001/V03` | royal serpent staff (`PROP_ROYAL_SERPENT_STAFF`) |

## Locations

| Doc ID | Entity | Status |
|---|---|---|
| `LOC_MOUNTAIN_ROUTE` | `SHM-LOC-004-MOUNTAIN-PASS` | **READY** |
| `LOC_JAMSHID_THRONE` | `SHM-LOC-010-THRONE-TAKHT-E-JAMSHID` | **READY** — doc: "no redesign" |
| `LOC_ESCAPE_ROUTE` | `SHM-LOC-011-PALACE-UNDERLEVELS` **V01** | **READY** — descending corridor and stairs. **Resolves Q1**: V01 is the escape route |
| `LOC_ZAHHAK_AUDIENCE_HALL` | `SHM-LOC-009-CEREMONIAL-RECEPTION-HALL` | **READY** — the empty dais is Zahhak's "low severe platform" |
| `LOC_IRAN_MAIN_GATE` | `SHM-LOC-002-GATE-CEREMONIAL-CYPRESS-COURT` | **READY** — **resolves Q2**: bronze door that opens from inside; cypresses and water channels read as the liveable Iran the doc requires |
| `LOC_HALL_OF_COLUMNS` | `SHM-LOC-006-HALL-OF-COLUMNS` | **READY** — renamed from `MERDAS-PRIVATE-HALL`; same number, same image |
| `LOC_ZAHHAK_APPROACH` | `SHM-LOC-012-APPROACH-ZAHHAK-DOMAIN` | **NEEDS ART** |
| `LOC_ZAHHAK_OUTER_COURT` | `SHM-LOC-013-COURT-ZAHHAK-OUTER` | **NEEDS ART** |
| `LOC_IRAN_OUTSKIRTS` | `SHM-LOC-014-OUTSKIRTS-IRAN` | **NEEDS ART** |
| `LOC_ROYAL_CAUSEWAY` | `SHM-LOC-015-CAUSEWAY-ROYAL` | **NEEDS ART** |
| `LOC_LOWER_GATE_MOUNT` | `SHM-LOC-016-GATE-LOWER-MOUNT` | **NEEDS ART** |
| `LOC_FINAL_DESERT` | `SHM-LOC-017-DESERT-FINAL` | **NEEDS ART** — registered new: `LOC-005` has a ridge across frame, the closing shot needs an open horizon |

## Props

| Doc ID | Entity | Status |
|---|---|---|
| `PROP_GIFT_BUNDLE` | `SHM-PRP-010-GIFT-DIPLOMATIC-SET` | **READY** |
| `PROP_ROYAL_SERPENT_STAFF` | `SHM-PRP-001-STAFF-COBRA-BRONZE` | **READY** — see note below |
| `PROP_ZAHHAK_OLD_STAFF` | `SHM-PRP-002-STAFF-OLDWOOD-PLAIN` | **NEEDS ART** — queued as `J-20260903-4FA` |
| `PROP_IRANIAN_BANNER` | `SHM-PRP-011-BANNER-IRANIAN-ROYAL` | **NEEDS ART** |
| `PROP_RITUAL_VESSEL` | `SHM-PRP-012-VESSEL-RITUAL` | **NEEDS ART** |
| `PROP_POWER_INSIGNIA` | `SHM-PRP-013-INSIGNIA-POWER` | **NEEDS ART** |
| `PROP_JAMSHID_REGALIA` | `SHM-PRP-014-REGALIA-JAMSHID` | **NEEDS ART** |
| `PROP_MOUNT_HARNESS` | `SHM-PRP-015-HARNESS-MOUNT` | **NEEDS ART** |

### `PROP_ROYAL_SERPENT_STAFF` — resolved in favour of the existing asset

The document specifies "one abstract serpent motif; no dragon head, jewels, light or magic",
while `SHM-PRP-001-STAFF-COBRA-BRONZE` is a literal bronze cobra head with a flared hood.

Resolved per the decision at the top of this file: `SHM-PRP-001` **is** the royal serpent staff.
It is already the staff Zahhak carries in his `V03` plate, so this also keeps the block-6 swap
consistent with art that exists. Read the document's "no dragon head" line as ruling out fantasy
ornament rather than rejecting this design.

If that ever proves wrong, the fix is a **new** `PRP` number, never a redefinition of this one —
numbers are never reused.

---

## What has to happen before block 1 can run

14 entities are registered but have no image, plus two new variants. Every one is referenced by
at least one block, so the stills pass comes first:

| Wave | Work |
|---|---|
| 1 | 14 hero stills for the `NEEDS ART` entities above |
| 2 | `CHR-002` V02 (Jamshid in escape) and `CRT-001` V02 (standing bipedal mount) |
| 3 | Review and approve each in the panel — an unapproved still is not a usable reference |
| 4 | 12 video blocks, in order, P01 → P12 |

Only after wave 3 does every `@` token in the 12 blocks resolve.
