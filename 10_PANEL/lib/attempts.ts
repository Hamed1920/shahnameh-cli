/**
 * Which attempts belong to the take on screen, and what number each one gets. Pure, so the real
 * cases (two shots that share a plan label, a job that never produced a video, a job with three
 * results) are tests rather than things noticed on the Review page. lib/store.ts does the file
 * lookups around it.
 */

export interface AttemptJob {
  jobId: string
  parentJobId?: string | null
  attempt?: number
  target?: string
  label?: string | null
  enqueuedAt?: string
}

/** A decision that stands (one the worker could not apply is left out by the caller). */
export interface AttemptDecision {
  id: string
  jobId: string
  hfJobId?: string
  /** The staging path it was about: one decision per result. */
  candidate: string
  target: string
  ts?: string
}

/** A result that is waiting for review, on its own or beside the one on screen. */
export interface AttemptResult {
  path: string
  jobId: string
  hfJobId: string
  at: string
}

export interface AttemptSubject extends AttemptResult {
  target: string
  label: string | null
  parentJobId: string | null
  attempt: number
}

export interface GatheredAttempt {
  /** One per result: the candidate path, or `<jobId>:failed` for a job that made nothing. */
  key: string
  jobId: string
  hfJobId: string
  /** The decision about this result; '' when it is still waiting. */
  decisionId: string
  /** The staging path of a result still waiting for review; null otherwise. */
  waiting: string | null
  at: string
  /** The worker's own revision counter, for ordering only. */
  attempt: number
  /** 1, 2, 3 among everything that produced something; 0 for a job that failed. */
  number: number
  failed: boolean
  reason: string | null
  /** Made after the take on screen. */
  later: boolean
}

interface Unit {
  key: string
  jobId: string
  hfJobId: string
  decisionId: string
  waiting: string | null
  at: string
  attempt: number
  failed: boolean
  reason: string | null
}

const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Every attempt at the plan the open take belongs to, in the order they were made, numbered.
 *
 * Found by: the chain of parents; every other job for the same shot (read through where footage
 * moved to); and every decision about that shot whose job the queue has lost. A plan label only
 * adds a job that names no shot at all, and only when the label belongs to one shot in that episode:
 * "PLAN 01" on SC001 and on SC013 is two plans, and a job for another existing shot is never pulled in.
 *
 * Numbered: only what produced something, a decision or a result in _staging. A job that failed is
 * listed with no number (`failed`), so it cannot push the real attempts along; a job that is still
 * queued or never made anything is left out until it does.
 *
 * Ordered by when it was queued, then the worker's attempt counter, then job id and result: the
 * same order whichever take is open.
 */
export function gatherAttempts(input: {
  current: AttemptSubject
  queue: AttemptJob[]
  decisions: AttemptDecision[]
  /** Other results waiting for review (the open one excluded). */
  waiting: AttemptResult[]
  /** job id -> why it ended without a take. */
  failed?: Record<string, string>
  /** Old shot id -> the id it has now, from SHOT_MOVES.jsonl. */
  moves?: { shot: Record<string, string> }
  code: string
}): { attempts: GatheredAttempt[]; number: number } {
  const { current, queue, decisions, waiting, code } = input
  const failed = input.failed ?? {}
  const where = (target: string | undefined) => {
    let t = String(target ?? '')
    for (let guard = 0; guard < 10 && input.moves?.shot[t] && input.moves.shot[t] !== t; guard++) t = input.moves.shot[t]
    return t
  }
  const episodeRx = new RegExp(`^${escapeRx(code)}-(EP\\d{3})`)
  const episodeOf = (target: string | undefined) => where(target).match(episodeRx)?.[1] ?? null
  const mine = where(current.target)
  const jobs = new Map(queue.map((j) => [j.jobId, j]))

  // Which jobs are part of this plan.
  const inPlan = new Set<string>([current.jobId])
  let parent = current.parentJobId
  for (let guard = 0; parent && guard < 40 && !inPlan.has(parent); guard++) {
    inPlan.add(parent)
    parent = jobs.get(parent)?.parentJobId ?? null
  }
  const label = current.label ?? jobs.get(current.jobId)?.label ?? null
  const episode = episodeOf(current.target)
  const shotsWithLabel = new Set<string>([mine])
  if (label) {
    for (const j of queue) if (j.label === label && j.target && episodeOf(j.target) === episode) shotsWithLabel.add(where(j.target))
  }
  for (const j of queue) {
    if (inPlan.has(j.jobId)) continue
    if (j.target) {
      if (where(j.target) === mine) inPlan.add(j.jobId)
    } else if (label && j.label === label && shotsWithLabel.size === 1) {
      inPlan.add(j.jobId)
    }
  }

  // One unit per result. A decision is about one result; a job can have several.
  const units: Unit[] = []
  const used = new Set<string>([current.path])
  const lastDecision = new Map<string, AttemptDecision>()
  for (const d of decisions) lastDecision.set(d.candidate, d)
  const orphans = [...lastDecision.values()].filter((d) => !jobs.has(d.jobId) && where(d.target) === mine)
  for (const jobId of [...inPlan, ...new Set(orphans.map((d) => d.jobId))]) {
    const job = jobs.get(jobId)
    const made: Unit[] = []
    for (const d of lastDecision.values()) {
      if (d.jobId !== jobId || used.has(d.candidate)) continue
      used.add(d.candidate)
      made.push({
        key: d.candidate, jobId, hfJobId: d.hfJobId ?? '', decisionId: d.id, waiting: null,
        at: job?.enqueuedAt ?? d.ts ?? '', attempt: job?.attempt ?? 1, failed: false, reason: null,
      })
    }
    for (const w of waiting) {
      if (w.jobId !== jobId || used.has(w.path)) continue
      used.add(w.path)
      made.push({
        key: w.path, jobId, hfJobId: w.hfJobId, decisionId: '', waiting: w.path,
        at: job?.enqueuedAt ?? w.at, attempt: job?.attempt ?? 1, failed: false, reason: null,
      })
    }
    if (made.length === 0 && jobId !== current.jobId && jobId in failed) {
      made.push({
        key: `${jobId}:failed`, jobId, hfJobId: '', decisionId: '', waiting: null,
        at: job?.enqueuedAt ?? '', attempt: job?.attempt ?? 1, failed: true, reason: failed[jobId] || null,
      })
    }
    units.push(...made)
  }

  const here: Unit = {
    key: current.path, jobId: current.jobId, hfJobId: current.hfJobId, decisionId: '', waiting: current.path,
    at: jobs.get(current.jobId)?.enqueuedAt ?? current.at, attempt: current.attempt, failed: false, reason: null,
  }
  const ordered = [...units, here].sort(
    (x, y) => x.at.localeCompare(y.at) || x.attempt - y.attempt || x.jobId.localeCompare(y.jobId) || x.key.localeCompare(y.key),
  )
  const hereAt = ordered.indexOf(here)
  let n = 0
  const numbers = new Map<Unit, number>(ordered.map((u) => [u, u.failed ? 0 : ++n]))
  return {
    attempts: ordered.flatMap((u, i) => (u === here ? [] : [{ ...u, number: numbers.get(u) ?? 0, later: i > hereAt }])),
    number: numbers.get(here) ?? 1,
  }
}
