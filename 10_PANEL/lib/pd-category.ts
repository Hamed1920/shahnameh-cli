// The pre-production library, pure parts: which category an asset belongs to, the one-open-review
// rule, and the record the director's approval asks the worker to write. No fs, no database, so
// tests and server code can both load it.

export type Category = 'characters' | 'locations' | 'references' | 'states' | 'other'

export const CATEGORY_ORDER: Category[] = ['characters', 'locations', 'references', 'states', 'other']

export const CATEGORY_LABEL: Record<Category, string> = {
  characters: 'Characters',
  locations: 'Locations',
  references: 'References',
  states: 'States',
  other: 'Other',
}

/**
 * Characters = CHR, Locations = LOC. REF and FX are References, except a slug that starts with
 * STATE- (a character or place in a condition: STATE-WOUNDED), which is a State. No new kind exists
 * for that: the system-wide kinds stay as they are. Anything else (PRP, COS, GRP ...) is Other.
 */
export function categoryOf(kind: string, slug: string): Category {
  const k = kind.toUpperCase()
  if (k === 'CHR') return 'characters'
  if (k === 'LOC') return 'locations'
  if (k === 'REF' || k === 'FX') return slug.toUpperCase().startsWith('STATE-') ? 'states' : 'references'
  return 'other'
}

export function groupByCategory<T extends { kind: string; slug: string }>(items: T[]): Record<Category, T[]> {
  const out: Record<Category, T[]> = { characters: [], locations: [], references: [], states: [], other: [] }
  for (const i of items) out[categoryOf(i.kind, i.slug)].push(i)
  return out
}

// ---- review states

export type ReviewStatus = 'presented' | 'selected' | 'revision_requested' | 'approved'

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  presented: 'Sent to director',
  selected: 'Selected',
  revision_requested: 'Revision requested',
  approved: 'Approved',
}

export function isReviewStatus(s: string): s is ReviewStatus {
  return s === 'presented' || s === 'selected' || s === 'revision_requested' || s === 'approved'
}

/**
 * One open review per version. A version can be sent to the director when it has no review yet, or
 * when every earlier review of it ended in a revision request. Presented, selected and approved
 * block it: the first two are still waiting on the director, the last is done. A revised look is
 * the next _V, never the same one again.
 */
export function canPresent(existing: { status: string }[]): boolean {
  return existing.every((r) => r.status === 'revision_requested')
}

export type Decision = 'select' | 'revise' | 'approve'

/** Where a director's decision can lead from the current state. Revision requested and approved are final. */
export function canDecide(status: string, decision: Decision): boolean {
  if (status !== 'presented' && status !== 'selected') return false
  if (decision === 'select') return status === 'presented'
  return true
}

export function decisionStatus(d: Decision): ReviewStatus {
  return d === 'select' ? 'selected' : d === 'revise' ? 'revision_requested' : 'approved'
}

/** Revision notes are required; the other two may carry a note. Returns an error or null. */
export function decisionProblem(d: Decision, notes: string): string | null {
  if (d === 'revise' && notes.trim().length === 0) return 'Say what should change.'
  if (notes.length > 4000) return 'The note is too long (4000 characters at most).'
  return null
}

// ---- approval -> index ops

export type Who = { reviewer: string; actorId?: string; actorRole?: string }

/**
 * The INDEX_OPS requests an approval asks the worker to apply (worker/lib/index-ops.mjs): a `status`
 * op setting the entity APPROVED, and, when the director chose this version as the look, a
 * `canonical` op for the variant. Same shape the References page writes (requestIndexOp). The
 * worker writes every registry row; the panel only asks.
 */
export function buildApprovalOps(input: {
  entityId: string
  variant: string
  makeCanonical: boolean
  who: Who
  ts: string
  machine: string
  newId: () => string
}): Record<string, unknown>[] {
  const base = () => ({ id: input.newId(), ts: input.ts, ...input.who })
  const ops: Record<string, unknown>[] = [
    { ...base(), type: 'status', entities: [input.entityId], status: 'APPROVED', machine: input.machine },
  ]
  if (input.makeCanonical) {
    ops.push({ ...base(), type: 'canonical', entity: input.entityId, variant: input.variant, machine: input.machine })
  }
  return ops
}
