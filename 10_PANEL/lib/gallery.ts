/**
 * The Gallery's shape and rules, with no disk in them, so the browser can use
 * the same tag handling and the same fold the server does. The reading and
 * appending live in gallery-log.ts, which this file knows nothing about.
 */

export type GalleryEvent =
  | { id: string; ts: string; reviewer: string; type: 'like'; decisionId: string; on: boolean }
  | { id: string; ts: string; reviewer: string; type: 'tag'; decisionId: string; tag: string; on: boolean }
  | { id: string; ts: string; reviewer: string; type: 'order'; order: string[] }

/** What the page renders from. Plain arrays: this crosses to the client. */
export interface GalleryState {
  liked: string[]
  /** decisionId -> its tags, in the order they were added. */
  tags: Record<string, string[]>
  /** decisionIds in the arrangement Hamed dragged them into. */
  order: string[]
}

export const MAX_TAG_LENGTH = 40

/**
 * Tags are compared case- and space-insensitively so "Hero Shots" and
 * "hero shots" are one collection, but stored as typed so the page shows the
 * wording chosen.
 */
export const tagKey = (tag: string) => tag.trim().replace(/\s+/g, ' ').toLowerCase()

export function cleanTag(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH)
}

export function newGalleryId(): string {
  return `gl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Fold the events into the current arrangement.
 *
 * Applied in file order rather than by timestamp: appends are what actually
 * happened, and two machines merged by git can carry equal timestamps. The
 * later line wins, which is also what a single reviewer expects.
 */
export function foldGallery(events: GalleryEvent[]): GalleryState {
  const liked = new Set<string>()
  const tags = new Map<string, Map<string, string>>()
  let order: string[] = []

  for (const e of events) {
    if (e.type === 'like') {
      if (e.on) liked.add(e.decisionId)
      else liked.delete(e.decisionId)
    } else if (e.type === 'tag') {
      const key = tagKey(e.tag)
      if (!key) continue
      const mine = tags.get(e.decisionId) ?? new Map<string, string>()
      if (e.on) mine.set(key, cleanTag(e.tag))
      else mine.delete(key)
      tags.set(e.decisionId, mine)
    } else if (e.type === 'order') {
      order = e.order
    }
  }

  return {
    liked: [...liked],
    tags: Object.fromEntries([...tags].map(([id, m]) => [id, [...m.values()]]).filter(([, t]) => t.length)),
    order,
  }
}

/**
 * Move `fromId` to sit where `toId` is, within the full arrangement.
 *
 * Always resolved against the full list rather than against what is on screen,
 * so a drag made while a filter is on does not throw away the position of every
 * take the filter is hiding.
 */
export function moveWithin(full: string[], fromId: string, toId: string): string[] {
  if (fromId === toId) return full
  const out = full.filter((id) => id !== fromId)
  const at = out.indexOf(toId)
  out.splice(at < 0 ? out.length : at, 0, fromId)
  return out
}

/** Every tag in use, by display wording, for the filter bar and suggestions. */
export function allTags(state: GalleryState): string[] {
  const seen = new Map<string, string>()
  for (const list of Object.values(state.tags)) {
    for (const t of list) if (!seen.has(tagKey(t))) seen.set(tagKey(t), t)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}
