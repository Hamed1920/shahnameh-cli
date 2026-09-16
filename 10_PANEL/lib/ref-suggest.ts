import type { CatalogEntity } from './types'

/**
 * Which index entities a prompt talks about, read from its words. Only ever a
 * suggestion: the Prompts page shows these as chips and nothing is attached
 * until Hamed clicks one. Pure, so it runs in the browser as the prompt is
 * edited and in unit tests.
 *
 * Signals, strongest first:
 *   - the entity's full name ("Jamshid", "Hall of Columns")
 *   - a slug word only that entity has ("throne" -> LOC-010), minus words that
 *     are ordinary prose ("stone", "pass") or another entity's name
 *   - a word several entities share ("staff"), or a kind word ("creature")
 *     with nothing of that kind matched: offered as a group to pick one from
 *   - references used in the latest queued jobs, which carry the style board
 *     and the recurring set no prompt names
 *
 * The look attached is the one the latest queued job used for that entity,
 * falling back to the entity's main look: EP001 is shot with CHR-001/V03, not
 * whatever look was made main last.
 */

export interface RefSuggestion {
  entity: CatalogEntity
  /** `@CHR-002/V03`, or `@LOC-009` when that is how a recent job named it. */
  token: string
  /** The words in the prompt that led here, or `recent`. */
  matched: string
}

export interface GroupSuggestion {
  word: string
  options: RefSuggestion[]
}

export interface Suggestions {
  found: RefSuggestion[]
  groups: GroupSuggestion[]
  recent: RefSuggestion[]
}

/** Slug words too common in prose, or too generic, to mean one entity. */
const STOP = new Set([
  'approach', 'audience', 'beaked', 'black', 'bronze', 'ceremonial', 'court', 'cypress', 'domain', 'final', 'gate',
  'hall', 'hide', 'iran', 'iranian', 'longbeak', 'lower', 'marble', 'mount', 'oldwood', 'outer', 'outside', 'pale',
  'palace', 'pass', 'perisan', 'plain', 'platform', 'power', 'relief', 'ritual', 'royal', 'screen', 'stone', 'wood',
])

const KIND_WORDS: Record<string, string[]> = {
  CRT: ['creature', 'beast', 'animal'],
  VEH: ['vehicle', 'chariot', 'cart', 'wagon'],
}

const MAX_RECENT = 6

const words = (s: string) => String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
const singular = (w: string) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)
const idOf = (token: string) => token.replace(/^@/, '').split('/')[0]

/** The look a suggestion attaches when no recent job used the entity. Null when there is no file to send. */
export function suggestedLook(e: CatalogEntity): string | null {
  if (e.variants.length === 0) return null
  if (e.canonical && e.variants.some((v) => v.variant === e.canonical)) return e.canonical
  return e.variants[e.variants.length - 1].variant
}

/**
 * @param recent reference tokens from the latest queued jobs, newest first
 */
export function suggestRefs(
  prompt: string,
  catalog: CatalogEntity[],
  existingRefs: string[] = [],
  recent: string[] = [],
  /** False when looking for what a prompt is about rather than what to attach: an entity with no look yet counts. */
  { requireLook = true } = {},
): Suggestions {
  const text = words(prompt)
  const joined = ` ${text.join(' ')} `
  const present = new Set(text.flatMap((w) => [w, singular(w)]))
  const have = new Set(existingRefs.map(idOf))
  const isHad = (e: CatalogEntity) => have.has(e.shortId) || have.has(e.id)

  const recentToken = new Map<string, string>()
  for (const t of recent) {
    const e = catalog.find((x) => x.shortId === idOf(t) || x.id === idOf(t))
    if (e && !recentToken.has(e.shortId)) recentToken.set(e.shortId, t.startsWith('@') ? t : `@${t}`)
  }
  const tokenFor = (e: CatalogEntity) =>
    recentToken.get(e.shortId) ?? (suggestedLook(e) ? `@${e.shortId}/${suggestedLook(e)}` : requireLook ? null : `@${e.shortId}`)
  const usable = catalog.filter((e) => tokenFor(e) && !isHad(e))
  const suggest = (e: CatalogEntity, matched: string): RefSuggestion => ({ entity: e, token: tokenFor(e)!, matched })

  const names = new Set(catalog.map((e) => words(e.name).join(' ')))
  const df = new Map<string, CatalogEntity[]>()
  for (const e of catalog) for (const w of new Set(words(e.slug))) df.set(w, [...(df.get(w) ?? []), e])
  const telling = (w: string) => w.length >= 4 && !STOP.has(w) && !names.has(w) && present.has(w)

  const found: RefSuggestion[] = []
  for (const e of usable) {
    const name = words(e.name).join(' ')
    const matched = name && joined.includes(` ${name} `)
      ? e.name
      : words(e.slug).find((w) => telling(w) && df.get(w)!.length === 1)
    if (matched) found.push(suggest(e, matched))
  }

  const settled = (e: CatalogEntity) => isHad(e) || found.some((f) => f.entity === e)
  const groups: GroupSuggestion[] = []
  for (const [w, owners] of df) {
    if (owners.length < 2 || !telling(w) || owners.some(settled)) continue
    const options = owners.filter((e) => usable.includes(e)).map((e) => suggest(e, w))
    if (options.length) groups.push({ word: w, options })
  }
  for (const [kind, list] of Object.entries(KIND_WORDS)) {
    const word = list.find((w) => present.has(w))
    if (!word || catalog.some((e) => e.kind === kind && settled(e))) continue
    if (groups.some((g) => g.options.some((o) => o.entity.kind === kind))) continue
    const options = usable.filter((e) => e.kind === kind).map((e) => suggest(e, word))
    if (options.length) groups.push({ word, options })
  }

  const offered = new Set([...found, ...groups.flatMap((g) => g.options)].map((s) => s.entity))
  const recentOut = [...recentToken.keys()]
    .map((id) => usable.find((e) => e.shortId === id))
    .filter((e): e is CatalogEntity => !!e && !offered.has(e))
    .slice(0, MAX_RECENT)
    .map((e) => suggest(e, 'recent'))

  return { found, groups, recent: recentOut }
}

/**
 * The image a token sends, project-relative: the named look, or the main look for a bare `@CHR-001`.
 * The catalog's path is the latest take of each look, the same file the worker resolves.
 */
export function lookPath(token: string, catalog: CatalogEntity[]): string | null {
  const [id, v = ''] = token.replace(/^@/, '').split('/')
  const e = catalog.find((x) => x.shortId === id || x.id === id)
  const want = (v || e?.canonical || '').toUpperCase()
  return e?.variants.find((x) => x.variant === want)?.path ?? null
}

/** Entities a design image could be filed under: those it references, else those it names. */
export function targetCandidates(prompt: string, refs: string[], catalog: CatalogEntity[]): CatalogEntity[] {
  const fromRefs = [...new Set(refs.map(idOf))]
    .map((id) => catalog.find((e) => e.shortId === id || e.id === id))
    .filter((e): e is CatalogEntity => !!e)
  if (fromRefs.length) return fromRefs
  return suggestRefs(prompt, catalog, [], [], { requireLook: false }).found.map((f) => f.entity)
}
