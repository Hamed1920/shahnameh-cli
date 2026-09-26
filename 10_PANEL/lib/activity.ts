import type { Project } from './projects'
import { getCandidates, getDecisions, getFilings, getQueue, getWorkerState, readJsonl } from './store'
import type { IndexOp, IndexOpResult, IndexOpType, JobRequestEvent } from './types'

/**
 * What the worker has done lately, as one list, newest first: the requests it
 * applied or refused, batches it priced, jobs it held or could not generate,
 * decisions it could not apply, new takes waiting for review.
 *
 * Built from the files the worker already writes -- nothing new is recorded.
 * The sidebar raises a toast for each new item on whatever page is open, so an
 * outcome no longer depends on being on the page that asked for it.
 */

export type ActivityTone = 'good' | 'bad' | 'info' | 'new'

export interface ActivityItem {
  /** Stable, so a browser can remember it has shown this one. */
  id: string
  ts: string
  tone: ActivityTone
  title: string
  detail?: string
  /** Section of the project to open, relative to /<project>. */
  href?: string
}

/** SHM-EP013-SC001-SH0010 -> EP13 · SC001; an entity target -> its short id; a studio try -> "a new reference". */
export function jobLabel(target: string | null | undefined): string {
  const t = String(target ?? '')
  if (!t) return 'a new reference'
  const shot = /EP0*(\d+)-(SC\d+)/.exec(t)
  if (shot) return `EP${shot[1]} · ${shot[2]}`
  const entity = /^[A-Z]+-([A-Z]{2,4}-\d{3})/.exec(t)
  return entity ? entity[1] : t
}

const OP_WORDS: Record<IndexOpType, string> = {
  add: 'Adding a reference', retire: 'Retiring', restore: 'Restoring', status: 'Changing a status',
  canonical: 'Changing the main look', role: 'Changing a role', rename: 'Renaming', archive: 'Archiving a look',
  unarchive: 'Restoring a look', move: 'Moving a look', 'move-shot': 'Moving footage', 'new-episode': 'Starting an episode',
  'rename-episode': 'Renaming an episode', 'add-shot': 'Adding footage', 'archive-shot': 'Taking a shot out',
  'restore-shot': 'Putting a shot back', 'remove-episode': 'Removing an episode',
}

const OP_HREF = (type: IndexOpType | undefined): string =>
  type && /shot|episode/.test(type) ? '/episodes' : '/references'

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

export async function getActivity(pr: Project, limit = 50): Promise<ActivityItem[]> {
  const [ops, opResults, jobEvents, queue, state, decisions, candidates, filings] = await Promise.all([
    readJsonl<IndexOp>(pr.P.indexOps),
    readJsonl<IndexOpResult>(pr.P.indexOpResults),
    readJsonl<JobRequestEvent>(pr.P.jobRequestResults),
    getQueue(pr),
    getWorkerState(pr),
    getDecisions(pr),
    getCandidates(pr),
    getFilings(pr),
  ])
  const out: ActivityItem[] = []
  const typeOf = new Map(ops.map((o) => [o.id, o.type]))
  const jobs = new Map(queue.map((q) => [q.jobId, q]))
  const label = (jobId: string) => jobLabel(jobs.get(jobId)?.target)

  for (const r of opResults) {
    const type = typeOf.get(r.opId)
    out.push(r.ok
      ? { id: `op-${r.opId}`, ts: r.ts, tone: 'good', title: 'Done', detail: r.summary, href: OP_HREF(type) }
      : { id: `op-${r.opId}`, ts: r.ts, tone: 'bad', title: `${type ? OP_WORDS[type] : 'A change'} was not done`, detail: r.reason, href: OP_HREF(type) })
  }

  jobEvents.forEach((e, i) => {
    const id = `jr-${e.reqId ?? e.batchId ?? 'x'}-${e.event}-${i}`
    switch (e.event) {
      case 'rejected':
        out.push({ id, ts: e.ts, tone: 'bad', title: e.batchId ? 'A batch was refused' : 'A request was refused', detail: e.reason, href: '/prompts' })
        break
      case 'error':
        if (!e.sessionId) out.push({ id, ts: e.ts, tone: 'bad', title: 'The worker could not finish a request', detail: e.reason, href: '/prompts' })
        break
      case 'priced':
        out.push({
          id, ts: e.ts, tone: 'info',
          title: `Batch priced: ${e.total.toLocaleString('en-GB')} credits`,
          detail: e.unpriced ? `${plural(e.unpriced, 'row')} could not be priced` : 'Approve it on the Prompts page to start',
          href: '/prompts',
        })
        break
      case 'queued': {
        const n = Object.keys(e.jobIds).length
        out.push({ id, ts: e.ts, tone: 'good', title: e.batchId ? `${plural(n, 'job')} queued` : 'Regenerate queued', detail: e.ceilingNote, href: '/queue' })
        break
      }
      case 'models':
        out.push({ id, ts: e.ts, tone: 'info', title: 'Model list refreshed', detail: `${e.usable} of ${e.count} models usable from a prompt`, href: '/prompts' })
        break
      case 'studio.error':
        out.push({ id, ts: e.ts, tone: 'bad', title: 'A reference try did not run', detail: e.reason, href: '/references' })
        break
    }
  })

  const processed = new Set((state?.processedJobs ?? []) as string[])
  const held = (state?.held ?? {}) as Record<string, { reason: string; since?: string }>
  for (const [jobId, h] of Object.entries(held)) {
    if (processed.has(jobId) || !h.since) continue
    out.push({ id: `held-${jobId}-${h.since}`, ts: h.since, tone: 'bad', title: `On hold: ${label(jobId)}`, detail: h.reason, href: '/queue' })
  }
  const failedJobs = (state?.failedJobs ?? {}) as Record<string, { reason: string; at?: string }>
  for (const [jobId, f] of Object.entries(failedJobs)) {
    if (!f.at) continue
    out.push({ id: `fail-${jobId}`, ts: f.at, tone: 'bad', title: `Did not generate: ${label(jobId)}`, detail: f.reason, href: '/queue' })
  }
  const failedDecisions = (state?.failedDecisions ?? {}) as Record<string, string>
  for (const d of decisions) {
    const reason = failedDecisions[d.id]
    if (reason) out.push({ id: `dec-${d.id}`, ts: d.ts, tone: 'bad', title: `Your decision on ${jobLabel(d.target)} was not applied`, detail: reason, href: '/review' })
  }
  for (const f of filings) {
    if (!f.ok) out.push({ id: `file-${f.uploadId ?? f.ts}`, ts: f.ts, tone: 'bad', title: 'An upload was not filed', detail: f.reason, href: '/references' })
  }
  for (const c of candidates) {
    if (c.decided || c.failedDecision) continue
    const s = c.sidecar
    out.push({
      id: `new-${c.path}`, ts: s.createdAt, tone: 'new',
      title: `New to review: ${jobLabel(s.target)}`,
      detail: [s.stage, s.attempt > 1 ? `attempt ${s.attempt}` : null].filter(Boolean).join(' · ') || undefined,
      href: '/review',
    })
  }

  return out.filter((i) => i.ts).sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, limit)
}
