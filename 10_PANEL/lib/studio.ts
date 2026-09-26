import type { StudioProposal } from './types.ts'

/**
 * A reference-studio session as the page shows it, rebuilt from what the panel
 * appended (JOB_REQUESTS.jsonl), what the worker answered
 * (JOB_REQUEST_RESULTS.jsonl, QUEUE.jsonl, state.json, FILINGS.jsonl) and what
 * landed in _staging. Nothing about a session is stored anywhere else.
 *
 * foldStudio is pure, so the tests run it on plain arrays; getStudioSession in
 * lib/store.ts reads the files.
 */

export type TryStatus = 'pricing' | 'priced' | 'error' | 'replaced' | 'queued' | 'generating' | 'done' | 'failed'

export interface StudioResult {
  hfJobId: string
  take: string
  /** Project-relative, while the result sits in _staging. */
  path: string | null
  /** The token it was filed as, once picked. */
  picked: string | null
}

export interface StudioTry {
  genId: string
  reqId: string
  ts: string
  model: string
  prompt: string
  refs: string[]
  params: Record<string, string | number | boolean>
  count: number
  status: TryStatus
  credits: number | null
  total: number | null
  reason: string | null
  jobIds: string[]
  /** Why a queued try has not started: the worker's hold reason. */
  held: string | null
  results: StudioResult[]
}

export interface StudioSession {
  sessionId: string
  /** Full entity id of the thing this session makes looks of, or null for a new thing. */
  entity: string | null
  proposal: StudioProposal | null
  tries: StudioTry[]
  picks: { hfJobId: string; take: string; token: string; entity: string }[]
  closed: boolean
  /** The worker refused something (a pick, a close): the latest reason, for the dialog. */
  refused: string | null
  startedAt: string | null
  /** Pictures dropped into the session: `studio:<session>/uN` -> project-relative path. Filled by the store. */
  inputs?: Record<string, string>
}

interface Req { id: string; ts: string; type: string; sessionId?: string; genId?: string; [k: string]: unknown }
interface Ev { event: string; reqId?: string; sessionId?: string; genId?: string; [k: string]: unknown }
interface Job { jobId: string; studio?: { sessionId: string; genId: string } }
interface Sidecar { jobId: string; hfJobId: string; studio?: { sessionId: string; genId: string }; candidates?: { file: string; take: string }[] }

export function foldStudio(
  sessionId: string,
  input: {
    requests: Req[]
    events: Ev[]
    queue: Job[]
    processedJobs: string[]
    held: Record<string, { reason: string }>
    /** Sidecars in _staging with the files still present, keyed by hfJobId. */
    staged: { sidecar: Sidecar; present: string[] }[]
    /** The job id Higgsfield is working on right now, if any. */
    generating: string | null
    /** hfJobId per job id, from the ledger, for tries whose staging folder is gone. */
    ledgerHf?: Record<string, { hfJobId: string; state: string }>
    /** Why a job ended without a take (state.failedJobs, worker.mjs recordFailure). */
    failedJobs?: Record<string, { reason: string }>
  },
): StudioSession {
  const mine = input.requests.filter((r) => r.sessionId === sessionId)
  const evs = input.events.filter((e) => e.sessionId === sessionId)
  const byReq = new Map<string, Ev[]>()
  for (const e of evs) if (e.reqId) byReq.set(e.reqId, [...(byReq.get(e.reqId) ?? []), e])
  const done = new Set(input.processedJobs)

  const prices = mine.filter((r) => r.type === 'studio.price')
  const latest = prices[prices.length - 1]
  const picks = evs.filter((e) => e.event === 'studio.picked').map((e) => ({
    hfJobId: String(e.hfJobId), take: String(e.take), token: String(e.token), entity: String(e.entity),
  }))
  const pickedAs = new Map(picks.map((p) => [`${p.hfJobId}/${p.take}`, p.token]))

  const tries: StudioTry[] = prices.map((r) => {
    const own = byReq.get(r.id) ?? []
    const priced = own.find((e) => e.event === 'studio.priced')
    // Refused outright (a bad model, an empty prompt): the refusal carries only the request id.
    const error = own.find((e) => e.event === 'studio.error')
      ?? input.events.find((e) => e.event === 'rejected' && e.reqId === r.id)
    const queued = evs.find((e) => e.event === 'studio.queued' && e.genId === r.genId)
    const jobIds = (queued?.jobIds as string[] | undefined) ?? input.queue.filter((q) => q.studio?.genId === r.genId).map((q) => q.jobId)
    const results: StudioResult[] = []
    for (const s of input.staged) {
      if (s.sidecar.studio?.genId !== r.genId) continue
      for (const c of s.sidecar.candidates ?? []) {
        const here = s.present.includes(c.file)
        const picked = pickedAs.get(`${s.sidecar.hfJobId}/${c.take}`) ?? null
        if (!here && !picked) continue
        results.push({ hfJobId: s.sidecar.hfJobId, take: c.take, path: here ? `09_OUTPUT/_staging/${s.sidecar.hfJobId}/${c.file}` : null, picked })
      }
    }
    // A picked result's staging folder may be gone entirely; it still shows, as filed.
    for (const p of picks) {
      if (results.some((x) => x.hfJobId === p.hfJobId && x.take === p.take)) continue
      const job = Object.entries(input.ledgerHf ?? {}).find(([, v]) => v.hfJobId === p.hfJobId)?.[0]
      if (job && jobIds.includes(job)) results.push({ hfJobId: p.hfJobId, take: p.take, path: null, picked: p.token })
    }

    let status: TryStatus = 'pricing'
    // Ended without a take: the CLI refused it, or Higgsfield returned nothing or timed out.
    const ENDED_EMPTY = new Set(['FAILED', 'NO_RESULT', 'TIMED_OUT'])
    const failed = jobIds.filter((j) => ENDED_EMPTY.has(input.ledgerHf?.[j]?.state ?? '') || input.failedJobs?.[j])
    if (queued || jobIds.length) {
      const finished = jobIds.filter((j) => done.has(j))
      status = finished.length === jobIds.length
        ? (failed.length === jobIds.length ? 'failed' : 'done')
        : jobIds.includes(input.generating ?? '') ? 'generating' : 'queued'
    } else if (error) status = error.reason === 'replaced by a later edit' ? 'replaced' : 'error'
    else if (priced) status = 'priced'

    // Why, when there is something to say: a refusal; a price that came back unknown;
    // a failed generation; or, while still pricing, the worker's retryable error
    // (the CLI not signed in, say), which does not end the try.
    const waiting = [...own].reverse().find((e) => e.event === 'error')
    const reason = (error?.reason as string | undefined)
      ?? (priced && priced.total == null ? (priced.reason as string | undefined) : undefined)
      ?? (status === 'failed' ? failed.map((j) => input.failedJobs?.[j]?.reason).find(Boolean) : undefined)
      ?? (status === 'pricing' ? (waiting?.reason as string | undefined) : undefined)
      ?? null

    const held = jobIds.map((j) => input.held[j]?.reason).find(Boolean) ?? null
    return {
      genId: String(r.genId), reqId: r.id, ts: r.ts,
      model: String(r.model ?? ''), prompt: String(r.prompt ?? ''), refs: (r.refs as string[]) ?? [],
      params: (r.params as StudioTry['params']) ?? {}, count: Number(r.count ?? 1),
      status,
      credits: (priced?.credits as number | null | undefined) ?? null,
      total: (priced?.total as number | null | undefined) ?? null,
      reason,
      jobIds, held, results,
    }
  })

  // A refusal carries no session id, only its request's. Shown while it is the latest word on the
  // session's latest pick, approve or close; the next request of those kinds clears it.
  const acts = mine.filter((r) => r.type !== 'studio.price')
  const lastAct = acts[acts.length - 1]
  const lastRefusal = lastAct ? input.events.find((e) => e.event === 'rejected' && e.reqId === lastAct.id) : undefined
  return {
    sessionId,
    entity: (latest?.target as { entity?: string } | undefined)?.entity ?? null,
    proposal: (latest?.proposal as StudioProposal | undefined) ?? null,
    tries,
    picks,
    closed: evs.some((e) => e.event === 'studio.closed'),
    refused: lastRefusal ? String(lastRefusal.reason ?? 'refused') : null,
    startedAt: mine[0]?.ts ?? null,
  }
}

/** Sessions with requests and no close, newest first. */
export function openSessionIds(requests: Req[], events: Ev[]): string[] {
  const closed = new Set(events.filter((e) => e.event === 'studio.closed').map((e) => e.sessionId))
  const seen: string[] = []
  for (const r of [...requests].reverse()) {
    if (!r.type?.startsWith('studio.') || !r.sessionId || closed.has(r.sessionId) || seen.includes(r.sessionId)) continue
    seen.push(r.sessionId)
  }
  return seen
}

export const newSessionId = () => `ss_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
export const newTryId = () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
