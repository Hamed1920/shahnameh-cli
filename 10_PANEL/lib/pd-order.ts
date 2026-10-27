/**
 * Pure rules for Sequence / Block editing: ordering and input checks.
 * No imports, so tests and server code can both load it.
 */

export const MAX_TITLE = 120
export const MIN_DURATION = 1
export const MAX_DURATION = 600

/**
 * The ids after moving `id` one place up (earlier) or down (later). The same list when the move
 * is not possible (first going up, last going down, id not in the list). Never mutates.
 */
export function orderAfterMove(ids: readonly string[], id: string, dir: 'up' | 'down'): string[] {
  const out = [...ids]
  const i = out.indexOf(id)
  if (i < 0) return out
  const j = dir === 'up' ? i - 1 : i + 1
  if (j < 0 || j >= out.length) return out
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

/** The trimmed title, or the reason it is not acceptable. */
export function checkTitle(raw: unknown): { ok: true; title: string } | { ok: false; error: string } {
  const title = String(raw ?? '').trim().replace(/\s+/g, ' ')
  if (!title) return { ok: false, error: 'Give it a title.' }
  if (title.length > MAX_TITLE) return { ok: false, error: `The title can be at most ${MAX_TITLE} characters.` }
  return { ok: true, title }
}

/** Target duration in whole seconds, 1..600. Empty means "not set" (null). */
export function checkDuration(raw: unknown): { ok: true; seconds: number | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || String(raw).trim() === '') return { ok: true, seconds: null }
  const n = Number(raw)
  if (!Number.isInteger(n) || n < MIN_DURATION || n > MAX_DURATION) {
    return { ok: false, error: `The target duration is a whole number of seconds, ${MIN_DURATION} to ${MAX_DURATION}.` }
  }
  return { ok: true, seconds: n }
}

/** Both lists hold the same ids, each once. */
export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const s = new Set(a)
  return s.size === a.length && b.every((x) => s.has(x)) && new Set(b).size === b.length
}
