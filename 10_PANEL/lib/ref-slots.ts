import type { DetectedAsset } from './asset-detect.ts'
import type { CatalogEntity } from './types.ts'

/**
 * A row's references, arranged by what they are. Each slot holds one picture
 * for one thing the prompt is about (a character, a location, a prop); the tray
 * holds everything else. The worker still receives one ordered list, built by
 * refsOf: slots in group order, then the tray.
 *
 * The slots are a guide, never a rule. A slot can stay empty, anything can be
 * dropped anywhere, and a slot of one kind can hold a picture of another.
 * Pure, so the page and the tests share it.
 */

export type SlotSource = 'keyword' | 'ai' | 'manual' | 'doc'

export interface RefSlot {
  key: string
  kind: string
  /** "Zahhak", "“staff” · pick one", or "Character 2" for a slot added by hand. */
  label: string
  /** What the slot holds: `@CHR-001/V03`, or `upload:u1` for a file added on this page. Null when empty. */
  token: string | null
  /** Short id of the entity the slot stands for, when known. Survives the slot being emptied. */
  entity: string | null
  /** A thing not in the index yet: Create makes it, and its number comes when a result is picked. */
  proposal: { name: string; description?: string } | null
  candidates: string[]
  matched: string | null
  source: SlotSource
  /** Hamed changed it: a re-read of the prompt never removes or refills it. */
  touched?: boolean
}

export interface SlotGroup {
  id: string
  kinds: string[]
  label: string
  /** "Character" for the "+ Character" button and "Character 2" labels. */
  one: string
}

export const SLOT_GROUPS: SlotGroup[] = [
  { id: 'CHR', kinds: ['CHR'], label: 'Characters', one: 'Character' },
  { id: 'GRP', kinds: ['GRP'], label: 'Groups', one: 'Group' },
  { id: 'CRT', kinds: ['CRT'], label: 'Creatures', one: 'Creature' },
  { id: 'LOC', kinds: ['LOC'], label: 'Locations', one: 'Location' },
  { id: 'PRP', kinds: ['PRP', 'VEH'], label: 'Props & vehicles', one: 'Prop' },
  { id: 'COS', kinds: ['COS'], label: 'Costumes', one: 'Costume' },
  { id: 'REF', kinds: ['FX', 'REF'], label: 'Style & reference', one: 'Reference' },
]

export const groupOf = (kind: string): SlotGroup => SLOT_GROUPS.find((g) => g.kinds.includes(kind)) ?? SLOT_GROUPS[SLOT_GROUPS.length - 1]

const idOf = (token: string) => token.replace(/^@/, '').split('/')[0]
const sameEntity = (token: string | null, shortId: string | null) => !!token && !!shortId && idOf(token) === shortId

/** Slots in the order the model sees them: by group, then as added. */
export function orderedSlots(slots: RefSlot[]): RefSlot[] {
  const rank = (s: RefSlot) => SLOT_GROUPS.indexOf(groupOf(s.kind))
  return slots.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i).map((x) => x.s)
}

/** The one list the worker gets. A token in two places is sent once, at its first. */
export function refsOf(slots: RefSlot[], loose: string[]): string[] {
  const out: string[] = []
  for (const s of orderedSlots(slots)) if (s.token && !out.includes(s.token)) out.push(s.token)
  for (const t of loose) if (!out.includes(t)) out.push(t)
  return out
}

let seq = 0
export const newSlotKey = () => `s${Date.now().toString(36)}${(++seq).toString(36)}`

/** "Character 3": the next free number among the hand-added slots of that group. */
export function nextLabel(slots: RefSlot[], kind: string): string {
  const g = groupOf(kind)
  const used = new Set(slots.filter((s) => groupOf(s.kind) === g).map((s) => s.label))
  let n = 1
  while (used.has(`${g.one} ${n}`)) n++
  return `${g.one} ${n}`
}

export function manualSlot(slots: RefSlot[], kind: string): RefSlot {
  return { key: newSlotKey(), kind, label: nextLabel(slots, kind), token: null, entity: null, proposal: null, candidates: [], matched: null, source: 'manual', touched: true }
}

const labelFor = (a: DetectedAsset, catalog: CatalogEntity[]) => {
  if (a.entity) return catalog.find((e) => e.shortId === a.entity)?.name ?? a.entity
  if (a.proposal) return a.proposal.name
  return `“${a.matched ?? '?'}” · pick one`
}

/**
 * Fold a fresh reading of the prompt into the row's slots. What Hamed filled or
 * touched stays exactly as it is; an untouched slot the prompt no longer
 * mentions goes; a newly mentioned thing gets a slot, filled with its usual
 * look when it has one and that look is not already in use elsewhere.
 */
export function mergeDetected(
  slots: RefSlot[], loose: string[], detected: DetectedAsset[], catalog: CatalogEntity[], source: SlotSource = 'keyword',
): { slots: RefSlot[]; loose: string[] } {
  const inUse = new Set([...slots.map((s) => s.token).filter(Boolean) as string[], ...loose])
  const holds = (a: DetectedAsset, s: RefSlot) =>
    (a.entity && (s.entity === a.entity || sameEntity(s.token, a.entity)))
    || (a.proposal && s.proposal?.name.toLowerCase() === a.proposal.name.toLowerCase())
    || (!a.entity && !a.proposal && a.matched && s.matched === a.matched && !s.entity)

  const keep = slots.filter((s) => s.touched || s.source === 'manual' || s.source === 'doc' || detected.some((a) => holds(a, s)))
  const out = keep.map((s) => {
    const a = detected.find((x) => holds(x, s))
    if (!a || s.touched) return s
    return { ...s, candidates: a.candidates, matched: a.matched ?? s.matched }
  })
  for (const a of detected) {
    if (out.some((s) => holds(a, s))) continue
    // An entity already attached (in the tray, or a slot of another kind) needs no second slot.
    if (a.entity && [...inUse].some((t) => sameEntity(t, a.entity))) continue
    out.push({
      key: newSlotKey(),
      kind: a.kind,
      label: labelFor(a, catalog),
      token: a.token && !inUse.has(a.token) ? a.token : null,
      entity: a.entity,
      proposal: a.proposal,
      candidates: a.candidates,
      matched: a.matched,
      source,
    })
  }
  return { slots: out, loose }
}

/**
 * References the document already named (a `refs:` line, @mentions). Each one
 * goes to the slot of its entity, a new slot when there is none, or the tray
 * when it is not in the index at all.
 */
export function placeDocRefs(tokens: string[], catalog: CatalogEntity[]): { slots: RefSlot[]; loose: string[] } {
  const slots: RefSlot[] = []
  const loose: string[] = []
  for (const t of tokens) {
    const e = catalog.find((x) => x.shortId === idOf(t) || x.id === idOf(t))
    if (!e) { if (!loose.includes(t)) loose.push(t); continue }
    if (slots.some((s) => s.token === t)) continue
    slots.push({ key: newSlotKey(), kind: e.kind, label: e.name, token: t, entity: e.shortId, proposal: null, candidates: [], matched: null, source: 'doc', touched: true })
  }
  return { slots, loose }
}

export type Place = { slot: string } | { tray: number }

/** Take a token out of wherever it is. */
function lift(slots: RefSlot[], loose: string[], token: string) {
  return {
    slots: slots.map((s) => (s.token === token ? { ...s, token: null, touched: true } : s)),
    loose: loose.filter((t) => t !== token),
  }
}

/**
 * Put a token somewhere. It leaves where it was, so one picture is never in two
 * places. Onto a filled slot: the picture already there goes where the new one
 * came from (a swap), or to the tray when the new one came from outside.
 */
export function placeToken(slots: RefSlot[], loose: string[], token: string, to: Place): { slots: RefSlot[]; loose: string[] } {
  const fromSlot = slots.find((s) => s.token === token)?.key ?? null
  const fromTray = loose.indexOf(token)
  let next = lift(slots, loose, token)
  if ('slot' in to) {
    const target = next.slots.find((s) => s.key === to.slot)
    if (!target) return { slots, loose }
    const displaced = target.token
    next.slots = next.slots.map((s) => (s.key === to.slot ? { ...s, token, touched: true, entity: s.entity ?? idOf(token) } : s))
    if (displaced && displaced !== token) {
      if (fromSlot) next.slots = next.slots.map((s) => (s.key === fromSlot ? { ...s, token: displaced, touched: true } : s))
      else if (fromTray >= 0) next.loose = [...next.loose.slice(0, fromTray), displaced, ...next.loose.slice(fromTray)]
      else next.loose = [...next.loose, displaced]
    }
    return next
  }
  const at = Math.max(0, Math.min(to.tray, next.loose.length))
  next = { ...next, loose: [...next.loose.slice(0, at), token, ...next.loose.slice(at)] }
  return next
}

export function removeToken(slots: RefSlot[], loose: string[], token: string) {
  return lift(slots, loose, token)
}

export function removeSlot(slots: RefSlot[], loose: string[], key: string) {
  return { slots: slots.filter((s) => s.key !== key), loose }
}

/** Swap a token for another in place (an upload once filed, a look swapped for another). */
export function replaceToken(slots: RefSlot[], loose: string[], from: string, to: string) {
  return {
    slots: slots.map((s) => (s.token === from ? { ...s, token: to } : s)),
    loose: loose.map((t) => (t === from ? to : t)),
  }
}
