import { idRx } from '../worker/lib/ids.mjs'
import { KINDS, descriptorSlug, entitySlug, isAscii, type Kind, type UploadRole } from './indexing.ts'
import { suggestRefs } from './ref-suggest.ts'
import type { CatalogEntity } from './types.ts'

/**
 * What a dropped file is, read from its name -- the rules behind the
 * References page's batch add.
 *
 * Only ever a proposal. Hamed sees every row filled in and confirms once, and
 * the worker remains the only thing that allocates a number or a look
 * (CLAUDE.md, docs/INDEXING.md section 9). Nothing here writes anything.
 *
 * Pure and dependency-free like lib/batch-rules.ts, so the same rules run in
 * the browser as the table is edited, again in the server action, and under
 * `node --test`.
 *
 * The bar for guessing is deliberately lopsided: a missed match costs Hamed a
 * click, a wrong one burns a number that can never be reused. So anything
 * uncertain comes back as `confidence: 'none'` with the unmet fields named in
 * `needs`, and the dialog refuses to submit while any row has one.
 */

/** How far the proposal can be trusted. A `none` row cannot be submitted. */
export type Confidence = 'high' | 'low' | 'none'

/** A field inference could not fill. Any of these blocks the batch. */
export type Need = 'entity' | 'kind' | 'name' | 'descriptor'

export interface Proposal {
  mode: 'variant' | 'new'
  /** Full entity id, when this is a new look of something that already exists. */
  entity: string
  /**
   * Index in the same batch of the `mode: 'new'` file this is another look of,
   * or -1. The hook turns it into a `groupOf` upload id once the drafts exist;
   * an index keeps this module testable with plain arrays of names.
   */
  groupOf: number
  kind: string
  name: string
  description: string
  role: UploadRole
  descriptor: string
  confidence: Confidence
  /** Entity ids worth one click, when the words matched more than one thing. */
  candidates: string[]
  needs: Need[]
  /** One sentence for the row, in the terms Hamed would use. */
  why: string
}

export interface ProposeCtx {
  /** The project's ID prefix, e.g. SHM. */
  code: string
  catalog: CatalogEntity[]
}

// ---------------------------------------------------------------- vocabulary

/**
 * Words that say what kind of thing a file shows. Only a hint: the kind is a
 * <Select> in every row, and a file matching nothing here asks for one rather
 * than guessing.
 */
const KIND_HINTS: Record<Kind, string[]> = {
  CHR: ['character', 'portrait', 'face', 'king', 'shah', 'prince', 'princess', 'queen', 'warrior', 'hero', 'villain'],
  GRP: ['group', 'caste', 'faction', 'crowd', 'army', 'guards', 'soldiers', 'workers', 'priests', 'tribe', 'people'],
  LOC: ['location', 'set', 'palace', 'hall', 'gate', 'courtyard', 'corridor', 'chamber', 'room', 'temple',
    'throneroom', 'city', 'village', 'landscape', 'interior', 'exterior', 'street', 'bridge', 'tower', 'ruins'],
  PRP: ['prop', 'staff', 'sword', 'crown', 'shield', 'banner', 'standard', 'dagger', 'helmet', 'bowl', 'cup',
    'tablet', 'throne', 'torch', 'scroll'],
  CRT: ['creature', 'beast', 'dragon', 'serpent', 'snake', 'cobra', 'monster', 'mount'],
  COS: ['costume', 'robe', 'tunic', 'armour', 'armor', 'garment', 'cloak', 'outfit', 'dress', 'mask', 'veil'],
  VEH: ['vehicle', 'chariot', 'cart', 'wagon', 'boat', 'ship', 'carriage'],
  FX: ['fx', 'effect', 'smoke', 'fire', 'dust', 'ash', 'mist', 'fog', 'glow', 'atmosphere', 'sparks'],
  REF: ['board', 'moodboard', 'mood', 'collage', 'palette', 'refs', 'reference'],
}

const ROLE_HINTS: [UploadRole, string[]][] = [
  ['BOARD', ['board', 'moodboard', 'mood', 'collage', 'contact', 'sheet', 'grid', 'palette']],
  ['TURNAROUND', ['turnaround', 'orthographic', 'views']],
  ['DETAIL', ['closeup', 'detail', 'macro', 'crop']],
]

/**
 * Camera and export litter. These say how a file was made, never what it
 * shows, so they must not reach a registry name or a filename descriptor.
 */
const NOISE = new Set([
  'img', 'image', 'images', 'photo', 'photos', 'picture', 'pic', 'dsc', 'dscn', 'dscf', 'pxl',
  'screenshot', 'screen', 'shot', 'capture', 'untitled', 'unnamed', 'download', 'downloaded',
  'copy', 'final', 'draft', 'new', 'old', 'edit', 'edited', 'export', 'exported', 'render',
  'rendered', 'upscale', 'upscaled', 'generated', 'output', 'version',
  'png', 'jpg', 'jpeg', 'webp',
])

/** Function words: they name nothing, and they make a slug read badly. */
const FUNCTION_WORDS = new Set(['of', 'the', 'an', 'and', 'in', 'on', 'at', 'for', 'with', 'to', 'by', 'from'])

/**
 * Tokens that tell one look of a thing from another rather than naming a
 * different thing -- which is what makes `guard-front` and `guard-side` one
 * entity with two looks instead of two entities.
 */
const VIEW_WORDS = new Set([
  'front', 'back', 'side', 'left', 'right', 'top', 'bottom', 'rear', 'profile',
  'alt', 'alternate', 'var', 'variant', 'option', 'opt', 'look', 'angle', 'view', 'pose',
])

// ---------------------------------------------------------------- reading a name

const EXT_RX = /\.(png|jpe?g|webp)$/i

/**
 * A filename that already carries an ID: a file being re-imported, or one the
 * panel itself named. Covers the full grammar of docs/INDEXING.md section 4 and
 * the short form, so `CHR-001_night-robe.png` reads as well as
 * `SHM-CHR-001-ZAHHAK_V02_T03_head-detail.png`.
 */
export function parseIdInName(
  filename: string,
  code: string,
): { shortId: string; variant: string | null; take: string | null; rest: string } | null {
  const segs = filename.replace(EXT_RX, '').split('_')
  const head = segs[0].replace(/^@/, '')
  const id = new RegExp(`^(?:${code}-)?(${KINDS.join('|')})-(\\d{3})(?:-[A-Z0-9-]+)?$`, 'i').exec(head)
  if (!id) return null

  let variant: string | null = null
  let take: string | null = null
  const rest: string[] = []
  for (const seg of segs.slice(1)) {
    const v = /^V(\d{2})$/i.exec(seg)
    const t = /^T(\d{2})$/i.exec(seg)
    if (v && !variant && !rest.length) variant = `V${v[1]}`
    else if (t && !take && !rest.length) take = `T${t[1]}`
    else rest.push(seg)
  }
  return { shortId: `${id[1].toUpperCase()}-${id[2]}`, variant, take, rest: rest.join(' ') }
}

/**
 * The words in a filename that actually say something, plus its trailing
 * number if it has one -- in `staff_01.png` the staff is the subject and the
 * 01 is which of the drop it was.
 */
export function cleanStem(filename: string): { tokens: string[]; counter: number | null } {
  const stripped = filename
    .replace(EXT_RX, '')
    // Dates, clock times, serials and export stamps go before anything is
    // split: afterwards they look like a pile of innocent little numbers.
    .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
    .replace(/\d{2}[.\-:]\d{2}[.\-:]\d{2}/g, ' ')
    // Not \b: underscore is a word character, so there is no boundary between
    // the _ and the 2 of `_202609031257`, and the stamp would survive.
    .replace(/(?<![0-9])\d{8,}(?![0-9])/g, ' ')
    .replace(/(?<![a-z0-9])\d+\s*[x×]\s*\d+(?![a-z0-9])/gi, ' ')
    .replace(/(?<![a-z0-9])v\d+(?![a-z0-9])/gi, ' ')
    .replace(/\(\d+\)/g, ' ')

  let counter: number | null = null
  const tokens: string[] = []
  for (const raw of stripped.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw) continue
    // A counter says which of a drop this was: 01, 02, 3. Anything longer is a
    // stamp that got past the sweep above, and is not one.
    if (/^\d+$/.test(raw)) { if (raw.length <= 3) counter = Number(raw); continue }
    // A number glued to the end of a word ("priests3") is that same counter.
    const glued = /^([a-z]{3,})(\d{1,3})$/.exec(raw)
    const word = glued ? glued[1] : raw
    if (glued) counter = Number(glued[2])
    if (NOISE.has(word) || FUNCTION_WORDS.has(word) || word.length < 2) continue
    tokens.push(word)
  }
  return { tokens, counter }
}

const singular = (w: string) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)

const HINT_KINDS: [Kind, Set<string>][] =
  (Object.entries(KIND_HINTS) as [Kind, string[]][]).map(([k, ws]) => [k, new Set(ws.map(singular))])

/**
 * The kind a filename's words suggest, when any of them do. Read from the end,
 * because an English compound is head-final: a "palace guard costume" is a
 * costume, not a palace.
 */
export function inferKind(tokens: string[]): { kind: Kind; word: string } | null {
  for (const token of [...tokens].reverse()) {
    for (const [kind, words] of HINT_KINDS) {
      if (words.has(singular(token))) return { kind, word: token }
    }
  }
  return null
}

/**
 * What kind of picture this is (docs/INDEXING.md section 8, and the Persian
 * copy in components/role-help.tsx -- keep all three in step). The default is
 * the reviewer's own rule: the first good image of something is its HERO,
 * another look of something that already has one is a PLATE.
 */
export function inferRole(tokens: string[], targetHasLooks: boolean, kind: string): UploadRole {
  if (kind === 'REF') return 'BOARD'
  for (const [role, words] of ROLE_HINTS) {
    if (tokens.some((t) => words.includes(t) || words.includes(singular(t)))) return role
  }
  return targetHasLooks ? 'PLATE' : 'HERO'
}

const titleCase = (tokens: string[]) => tokens.map((t) => t[0].toUpperCase() + t.slice(1)).join(' ')

/** Every word that names an entity, so its descriptor does not repeat it. */
function wordsOf(e: CatalogEntity): Set<string> {
  return new Set(`${e.name} ${e.slug}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
}

/** A filename needs some descriptor. This one is visibly a placeholder. */
const fallbackDescriptor = (role: UploadRole) => descriptorSlug(`${role.toLowerCase()} look`)

const BLANK: Proposal = {
  mode: 'new', entity: '', groupOf: -1, kind: '', name: '', description: '',
  role: 'HERO', descriptor: '', confidence: 'none', candidates: [], needs: [], why: '',
}

// ---------------------------------------------------------------- one file

/** What one dropped file most likely is. */
export function proposeOne(filename: string, ctx: ProposeCtx): Proposal {
  const { code, catalog } = ctx
  const { tokens } = cleanStem(filename)

  // A shot id means this is footage: it belongs to exactly one episode and is
  // filed from the Episodes page, never as a reusable reference.
  if (idRx(code).shotAnywhere.test(filename)) {
    return { ...BLANK, needs: ['entity'], why: 'This looks like episode footage. Add it from the Episodes page instead.' }
  }

  // 1. The name already carries an ID.
  const parsed = parseIdInName(filename, code)
  if (parsed) {
    const ent = catalog.find((e) => e.shortId === parsed.shortId)
    // Retired entities are not in the catalog, so this covers them too: never
    // file against a number that is not there to be filed against.
    if (!ent) {
      return {
        ...BLANK,
        needs: ['entity', 'kind', 'name'],
        why: `${parsed.shortId} is not in the index. Choose what this is.`,
      }
    }
    const role = inferRole(tokens, ent.variants.length > 0, ent.kind)
    const descriptor = descriptorSlug(parsed.rest) || descriptorFrom(tokens, wordsOf(ent))
    return {
      ...BLANK,
      mode: 'variant',
      entity: ent.id,
      role,
      descriptor: descriptor || fallbackDescriptor(role),
      needs: descriptor ? [] : ['descriptor'],
      confidence: 'high',
      why: parsed.variant
        ? `The name says ${parsed.shortId}. ${parsed.variant} in the name is ignored - the worker gives it the next free look.`
        : `The name says ${parsed.shortId}.`,
    }
  }

  // 2. An entity the words name. suggestRefs already knows which slug words
  //    tell one entity apart and which are ordinary prose, so `stone-corridor`
  //    never becomes the Mountain Pass.
  const { found, groups } = suggestRefs(tokens.join(' '), catalog, [], [], { requireLook: false })
  if (found.length === 1) {
    const { entity: ent, matched } = found[0]
    const byName = matched.toLowerCase() === ent.name.toLowerCase()
    const role = inferRole(tokens, ent.variants.length > 0, ent.kind)
    const descriptor = descriptorFrom(tokens, wordsOf(ent))
    return {
      ...BLANK,
      mode: 'variant',
      entity: ent.id,
      role,
      descriptor: descriptor || fallbackDescriptor(role),
      needs: descriptor ? [] : ['descriptor'],
      confidence: byName ? 'high' : 'low',
      why: byName ? `The name says ${ent.name} (${ent.shortId}).` : `'${matched}' only appears in ${ent.shortId}.`,
    }
  }
  const ambiguous = found.length > 1 ? found.map((f) => f.entity) : (groups[0]?.options.map((o) => o.entity) ?? [])
  if (ambiguous.length > 1) {
    const shown = ambiguous.slice(0, 3)
    return {
      ...BLANK,
      needs: ['entity'],
      candidates: shown.map((e) => e.id),
      why: `'${found.length > 1 ? tokens[0] : groups[0].word}' could be ${shown.map((e) => e.shortId).join(' or ')}.`,
    }
  }

  // 3. Something new.
  const hint = inferKind(tokens)
  const kind = hint?.kind ?? ''
  const name = titleCase(tokens)
  const role = inferRole(tokens, false, kind)
  const descriptor = descriptorFrom(tokens, new Set())
  const needs: Need[] = []
  if (!kind) needs.push('kind')
  if (!name) needs.push('name')
  if (!descriptor) needs.push('descriptor')
  return {
    ...BLANK,
    mode: 'new',
    kind,
    name,
    role,
    descriptor: descriptor || fallbackDescriptor(role),
    needs,
    confidence: needs.length ? 'none' : 'low',
    why: !name
      ? `Nothing in "${filename}" says what this is.`
      : hint
        ? `'${hint.word}' suggests ${hint.kind}, and nothing in the index matches.`
        : 'Nothing in the index matches this, so it looks new. Which kind is it?',
  }
}

function descriptorFrom(tokens: string[], exclude: Set<string>): string {
  return descriptorSlug(tokens.filter((t) => !exclude.has(t)).join(' '))
}

// ---------------------------------------------------------------- the batch

/**
 * What several files have in common once the part that only tells them apart
 * is taken off. Null when nothing is left -- `IMG_0001` and `IMG_0002` share
 * no subject at all, and must never be folded into one entity.
 */
function groupKey(tokens: string[]): string | null {
  const kept = [...tokens]
  while (kept.length && VIEW_WORDS.has(kept[kept.length - 1])) kept.pop()
  return kept.length ? kept.join(' ') : null
}

/**
 * Every dropped file, with files that show the same NEW thing folded into one
 * entity: the first becomes `mode: 'new'` and the rest point at it, so the
 * worker allocates one number and files them as V01, V02, V03 (INDEXING.md
 * section 2 -- same object, different look, new _V).
 *
 * Only new entities need this. Several files of the same EXISTING entity are
 * already plain `variant` rows, and the worker gives each the next free look
 * without any help from here.
 */
export function proposeBatch(filenames: string[], ctx: ProposeCtx): Proposal[] {
  const out = filenames.map((f) => proposeOne(f, ctx))
  const stems = filenames.map((f) => cleanStem(f))

  // Files group by what they have in common, and separately by an identical
  // proposed name -- the second is the case readUploads would otherwise refuse.
  const byKey = new Map<string, number[]>()
  out.forEach((p, i) => {
    if (p.mode !== 'new' || !p.name || p.needs.includes('entity')) return
    const key = groupKey(stems[i].tokens) ?? (p.name ? `=${entitySlug(p.name)}` : null)
    if (!key) return
    byKey.set(key, [...(byKey.get(key) ?? []), i])
  })

  for (const members of byKey.values()) {
    if (members.length < 2) continue
    // Ordered by the number in the name when every one of them has one, so
    // staff_01 is V01 whichever order they were dropped in.
    const counters = members.map((i) => stems[i].counter)
    const ordered = counters.every((c) => c !== null)
      ? [...members].sort((a, b) => (stems[a].counter! - stems[b].counter!))
      : members
    const [lead, ...rest] = ordered

    const kinds = ordered.map((i) => out[i].kind).filter(Boolean)
    const kind = kinds.sort((a, b) =>
      kinds.filter((k) => k === b).length - kinds.filter((k) => k === a).length).at(0) ?? ''
    const name = titleCase((groupKey(stems[lead].tokens) ?? out[lead].name).split(' '))
    const weakest: Confidence = ordered.some((i) => out[i].confidence === 'none') ? 'none' : 'low'

    out[lead] = {
      ...out[lead],
      mode: 'new',
      kind,
      name,
      needs: out[lead].needs.filter((n) => n !== 'kind' || !kind),
      confidence: weakest,
      why: `${ordered.length} files look like one new thing - V01 to V${String(ordered.length).padStart(2, '0')}.`,
    }
    rest.forEach((i, n) => {
      const role = inferRole(stems[i].tokens, true, kind)
      out[i] = {
        ...out[i],
        mode: 'variant',
        entity: '',
        groupOf: lead,
        kind: '',
        name: '',
        role,
        needs: out[i].needs.filter((need) => need === 'descriptor'),
        confidence: weakest,
        why: `Another look of ${name} - V${String(n + 2).padStart(2, '0')}.`,
      }
    })
  }
  return out
}

// ---------------------------------------------------------------- checking

/**
 * What is still wrong with one row, in Hamed's words. The same rules
 * lib/uploads.ts enforces on the server and worker/lib/promote.mjs enforces
 * again at filing time -- this copy exists so a mistake shows while the dialog
 * is still open.
 */
export function checkProposal(p: Proposal, catalog: CatalogEntity[], batch: Proposal[], at: number): string[] {
  const problems: string[] = []
  const row = (i: number) => `row ${i + 1}`

  if (p.groupOf >= 0) {
    const lead = batch[p.groupOf]
    if (p.mode !== 'variant' || p.entity) problems.push('A grouped image is another look of the new entity above it.')
    if (p.groupOf >= at) problems.push('It is grouped with an image that is not earlier in this batch.')
    else if (!lead) problems.push('It is grouped with an image that is not in this batch.')
    else if (lead.mode !== 'new') problems.push(`${row(p.groupOf)} is not a new entity.`)
    else if (lead.groupOf >= 0) problems.push('Groups are one level deep.')
  } else if (p.mode === 'variant') {
    if (!p.entity) problems.push('Choose which entity this is a picture of.')
    else if (!catalog.some((e) => e.id === p.entity)) problems.push(`${p.entity} is not in the index.`)
  } else {
    if (!(KINDS as readonly string[]).includes(p.kind)) problems.push('Choose a kind for the new entity.')
    const slug = entitySlug(p.name)
    if (!p.name.trim()) problems.push('Name the new entity.')
    else if (!isAscii(p.name) || !isAscii(p.description)) {
      problems.push('The name and description go into the registry, so they must be English.')
    } else if (!slug) problems.push('The name needs at least one English letter or digit.')
    else {
      const clash = catalog.find((e) => e.slug === slug)
      if (clash) problems.push(`'${slug}' already exists as ${clash.shortId}. Add it as a new look of ${clash.shortId} instead.`)
      const twin = batch.findIndex((o, i) => i !== at && o.mode === 'new' && o.groupOf < 0 && entitySlug(o.name) === slug)
      if (twin >= 0) problems.push(`${row(twin)} proposes the same new entity. Group them if they are one thing.`)
    }
  }

  if (!p.descriptor.trim()) problems.push('Add a short English description; it becomes the filename.')
  else if (!isAscii(p.descriptor)) problems.push('The description becomes the filename, so it must be English.')
  if (p.needs.includes('descriptor')) problems.push('Describe this image in a word or two.')

  return [...new Set(problems)]
}
