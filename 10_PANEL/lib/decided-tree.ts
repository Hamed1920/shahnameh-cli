// Decided, for a Sequence / Block project (PRD 11): Project -> Sequence -> Block, with three views
// of the same generations inside a block. Pure: the server loads the records (lib/pd-decided.ts),
// this groups, filters and counts them, so a test covers it.
import type { BlockStatus } from './pd/status.ts'

export type Verdict = 'accepted' | 'denied' | 'discarded' | 'pending'

export interface TreeGeneration {
  id: string
  gNumber: number
  gLabel: string
  createdAt: string
  createdBy: string | null
  verdict: Verdict
  /** Every round this generation was sent in, oldest first. */
  rounds: { round: number; status: 'pending' | 'approved' | 'revision_requested' }[]
  isFinal: boolean
}

export interface TreeBlock {
  id: string
  /** The database key, for loading the block's review. */
  key: string
  sequenceId: string
  title: string
  number: number
  displayOrder: number
  status: BlockStatus
  generations: TreeGeneration[]
}

export interface TreeSequence {
  id: string
  title: string
  number: number
  displayOrder: number
}

export interface TreeFilters {
  /** Block id or title, any case. */
  q?: string
  /** A block status; only blocks in it. */
  status?: string
  /** ISO dates (YYYY-MM-DD), inclusive, on the generation's creation. */
  from?: string
  to?: string
  /** Who made the generation. */
  creator?: string
}

export type View = 'all' | 'submitted' | 'final'
export const VIEWS: { id: View; label: string }[] = [
  { id: 'all', label: 'All Generations' },
  { id: 'submitted', label: 'Submitted for Review' },
  { id: 'final', label: 'Approved / Final' },
]
export const viewOf = (v: unknown): View => (v === 'submitted' || v === 'final' ? v : 'all')

export interface Counts { total: number; ready: number; revision: number; final: number }

export interface SequenceNode {
  seq: TreeSequence
  blocks: TreeBlock[]
  counts: Counts
}

const dayOf = (iso: string) => iso.slice(0, 10)

export function generationMatches(g: TreeGeneration, f: TreeFilters): boolean {
  if (f.from && dayOf(g.createdAt) < f.from) return false
  if (f.to && dayOf(g.createdAt) > f.to) return false
  if (f.creator && g.createdBy !== f.creator) return false
  return true
}

/** True when a filter looks inside generations, so a block with none left in range is hidden. */
const filtersGenerations = (f: TreeFilters) => !!(f.from || f.to || f.creator)

const inOrder = <T extends { displayOrder: number; number: number }>(xs: T[]) =>
  xs.slice().sort((a, b) => a.displayOrder - b.displayOrder || a.number - b.number)

/** Filter the blocks, keep film order, drop empty sequences only when a filter is on, and count. */
export function buildTree(sequences: TreeSequence[], blocks: TreeBlock[], f: TreeFilters = {}): SequenceNode[] {
  const q = (f.q ?? '').trim().toLowerCase()
  const filtering = !!(q || f.status || filtersGenerations(f))
  const kept = blocks
    .filter((b) => !q || b.id.toLowerCase().includes(q) || b.title.toLowerCase().includes(q))
    .filter((b) => !f.status || b.status === f.status)
    .map((b) => ({ ...b, generations: b.generations.filter((g) => generationMatches(g, f)) }))
    .filter((b) => !filtersGenerations(f) || b.generations.length > 0)
  const out: SequenceNode[] = []
  for (const seq of inOrder(sequences)) {
    const mine = inOrder(kept.filter((b) => b.sequenceId === seq.id))
    if (filtering && mine.length === 0) continue
    const counts: Counts = { total: mine.length, ready: 0, revision: 0, final: 0 }
    for (const b of mine) {
      if (b.status === 'ready_for_review') counts.ready++
      else if (b.status === 'revision_required') counts.revision++
      else if (b.status === 'final_ready') counts.final++
    }
    out.push({ seq, blocks: mine, counts })
  }
  return out
}

/** The same generations seen three ways -- filters over one list, not copies. */
export function viewGenerations(gens: TreeGeneration[], view: View): TreeGeneration[] {
  if (view === 'submitted') return gens.filter((g) => g.rounds.length > 0)
  if (view === 'final') return gens.filter((g) => g.isFinal || g.rounds.some((r) => r.status === 'approved'))
  return gens
}

/** Totals for the project row. */
export function projectCounts(nodes: SequenceNode[]): Counts {
  return nodes.reduce<Counts>(
    (a, n) => ({ total: a.total + n.counts.total, ready: a.ready + n.counts.ready, revision: a.revision + n.counts.revision, final: a.final + n.counts.final }),
    { total: 0, ready: 0, revision: 0, final: 0 },
  )
}

/** The people who made generations, for the creator filter. */
export function creatorsOf(blocks: TreeBlock[]): string[] {
  return [...new Set(blocks.flatMap((b) => b.generations.map((g) => g.createdBy)).filter((x): x is string => !!x))].sort()
}
