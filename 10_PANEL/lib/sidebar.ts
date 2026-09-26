import { spentInWindow } from '../worker/lib/spend.mjs'
import { parseCsv } from './csv'
import { listProjects, type Project } from './projects'
import {
  getCandidates, getGeneratingJobId, getLearnings, getQueue, getWorkerConfig, getWorkerState, getWorkerStatus, readText,
} from './store'
import type { WorkerStatus } from './types'

/**
 * Everything the sidebar shows, read once per render of the project layout.
 * The reads go through the store's per-render cache, so the page below it
 * asking for the same files costs nothing more.
 */

export interface NavBadge {
  count: number
  /** needs-you: a white pill (something waits on Hamed). info: a quiet count. */
  tone: 'needs-you' | 'info'
  /** Something went wrong in this section: a red dot beside the count. */
  alert?: string
}

export interface SidebarData {
  badges: Partial<Record<string, NavBadge>>
  worker: WorkerStatus
  /** "EP13 · SC001" for the job being generated now, or null. */
  generating: string | null
  /** Queued jobs refused for now: over the credit limit, not signed in, over the per-job cap. */
  held: number
  spend: { spent: number; ceiling: number; hours: number }
}

/** SHM-EP013-SC001-SH0010 -> EP13 · SC001; an entity target -> its short id; a studio try -> "a new reference". */
function jobLabel(target: string | null | undefined): string {
  const t = String(target ?? '')
  if (!t) return 'a new reference'
  const shot = /EP0*(\d+)-(SC\d+)/.exec(t)
  if (shot) return `EP${shot[1]} · ${shot[2]}`
  const entity = /^[A-Z]+-([A-Z]{2,4}-\d{3})/.exec(t)
  return entity ? entity[1] : t
}

/** The rolling spend across every project: they all draw on one Higgsfield account. */
async function accountSpend(hours: number): Promise<number> {
  const projects = await listProjects()
  const each = await Promise.all(projects.map(async (p) => spentInWindow(parseCsv(await readText(p.P.ledger).catch(() => '')), hours)))
  return each.reduce((a, b) => a + b, 0)
}

export async function getSidebarData(pr: Project): Promise<SidebarData> {
  const [candidates, queue, state, worker, learnings, cfg] = await Promise.all([
    getCandidates(pr), getQueue(pr), getWorkerState(pr), getWorkerStatus(pr), getLearnings(pr), getWorkerConfig(),
  ])
  const hours = Number(cfg.costWindowHours) || 24
  const ceiling = Number(cfg.costCeilingCredits) || 0

  const processed = new Set((state?.processedJobs ?? []) as string[])
  const waiting = queue.filter((q) => !processed.has(q.jobId))
  const heldIds = new Set(Object.keys((state?.held ?? {}) as Record<string, unknown>))
  const held = waiting.filter((q) => heldIds.has(q.jobId)).length
  const pending = candidates.filter((c) => !c.decided)
  const bounced = pending.filter((c) => c.failedDecision).length
  const proposed = learnings.filter((l) => l.status === 'proposed').length

  const [generatingId, spent] = await Promise.all([getGeneratingJobId(pr, processed), accountSpend(hours)])
  const generatingJob = generatingId ? queue.find((q) => q.jobId === generatingId) : null

  return {
    badges: {
      '/review': {
        count: pending.length,
        tone: 'needs-you',
        alert: bounced ? `${bounced} decision${bounced === 1 ? '' : 's'} the worker could not apply` : undefined,
      },
      '/queue': {
        count: waiting.length,
        tone: 'info',
        alert: held ? `${held} job${held === 1 ? '' : 's'} on hold` : undefined,
      },
      '/learnings': { count: proposed, tone: 'needs-you' },
    },
    worker,
    generating: generatingId ? jobLabel(generatingJob?.target) : null,
    held,
    spend: { spent, ceiling, hours },
  }
}
