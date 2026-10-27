// Review-flow rules (PRD 4, 8, 9, 10, 14). Pure: no database, no files, so tests can read it.

export type Role = 'owner' | 'production' | 'director' | 'supervisor'
export type SubStatus = 'pending' | 'approved' | 'revision_requested'
export type FeedbackCategory = 'director' | 'continuity'
export type Resolution = 'open' | 'in_progress' | 'resolved'

export const MAX_NOTE = 4000
export const MAX_TIMECODE = 24 * 3600

/**
 * Which category a role writes. The director writes director notes, the supervisor continuity
 * notes, the owner either (they must say which). Production writes none: the reviewers' words are
 * theirs alone (PRD 14.4). Null = not allowed / not chosen.
 */
export function categoryFor(role: Role, requested?: string | null): FeedbackCategory | null {
  const want = requested === 'director' || requested === 'continuity' ? requested : null
  if (requested && !want) return null
  switch (role) {
    case 'director': return want === null || want === 'director' ? 'director' : null
    case 'supervisor': return want === null || want === 'continuity' ? 'continuity' : null
    case 'owner': return want
    default: return null
  }
}

export type Checked<T> = ({ ok: true } & T) | { ok: false; error: string }

export function checkNote(body: unknown): Checked<{ body: string }> {
  const s = String(body ?? '').trim()
  if (!s) return { ok: false, error: 'A note cannot be empty.' }
  if (s.length > MAX_NOTE) return { ok: false, error: `A note can be at most ${MAX_NOTE} characters.` }
  return { ok: true, body: s }
}

/** Optional timecode in seconds; blank means none. */
export function checkTimecode(v: unknown): Checked<{ seconds: number | null }> {
  if (v === null || v === undefined || String(v).trim() === '') return { ok: true, seconds: null }
  const n = Number(String(v).trim())
  if (!Number.isFinite(n) || n < 0 || n > MAX_TIMECODE) return { ok: false, error: 'The timecode must be a number of seconds, 0 or more.' }
  return { ok: true, seconds: Math.round(n * 100) / 100 }
}

export type Decision = 'approved' | 'revision_requested'

/**
 * The director decides only the active submission and only while it is pending: a decided round
 * stays as it is, and production sends a new round for the next look. A revision needs a note.
 */
export function checkDecision(
  s: { status: SubStatus; isActive: boolean }, decision: string, note: string,
): Checked<{ decision: Decision }> {
  if (decision !== 'approved' && decision !== 'revision_requested') return { ok: false, error: 'Unknown decision.' }
  if (!s.isActive) return { ok: false, error: 'That round was replaced by a newer one.' }
  if (s.status !== 'pending') return { ok: false, error: s.status === 'approved' ? 'That round is already approved.' : 'That round already has a revision request.' }
  if (decision === 'revision_requested' && !note.trim()) return { ok: false, error: 'A revision request needs a note saying what to change.' }
  return { ok: true, decision }
}

/** Reviewers add notes only to the round that is open for them: the active one. */
export function canAddNote(s: { isActive: boolean }): boolean {
  return s.isActive
}

/** Production handles notes (open / in progress / resolved). The reviewers only read the status. */
export function canSetResolution(role: Role): boolean {
  return role === 'owner' || role === 'production'
}

export const RESOLUTIONS: readonly Resolution[] = ['open', 'in_progress', 'resolved']
export function isResolution(v: unknown): v is Resolution {
  return typeof v === 'string' && (RESOLUTIONS as readonly string[]).includes(v)
}

export interface SubLike { id: string; isActive: boolean; roundNumber?: number; round?: number }
const rank = (s: SubLike) => s.roundNumber ?? s.round ?? 0

/**
 * The submission the director sees. It is the one marked active, full stop: a newer generation
 * (G08 after G07 was sent) never replaces it, only an explicit submit does (PRD 8). `generations`
 * is accepted so callers and tests show the rule: its contents change nothing.
 */
export function pickActiveSubmission<S extends SubLike>(submissions: S[], generations: { id: string }[] = []): S | null {
  void generations
  let pick: S | null = null
  for (const s of submissions) if (s.isActive && (!pick || rank(s) > rank(pick))) pick = s
  return pick
}

/** Sending the generation that is already the active round again changes nothing. */
export function alreadyActive(active: { generationId: string } | null, generationId: string): boolean {
  return !!active && active.generationId === generationId
}

/** Key of the in-memory file-hash cache: the same path, modified time and size is the same bytes. */
export function shaCacheKey(abs: string, mtimeMs: number, size: number): string {
  return `${abs}|${Math.trunc(mtimeMs)}|${size}`
}

/** A file may be served for a submission only while its bytes still match what was sent. */
export function fileMatches(stored: string | null, actual: string): boolean {
  return stored === null || stored === actual
}

/** The short badge a block row shows for unread notes. */
export function noteBadge(i: { unreadDirector: number; unreadContinuity: number; revision: boolean }): string[] {
  const out: string[] = []
  if (i.unreadDirector > 0) out.push(i.revision ? 'Director revision' : 'Director note')
  if (i.unreadContinuity > 0) out.push('Continuity note')
  return out
}
