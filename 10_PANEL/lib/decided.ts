import fs from 'node:fs/promises'
import path from 'node:path'
import { P } from './paths'
import {
  getAssets, getDecisions, getFilings, getGeneratingJobId, getPriceTable, getQueue, getRegenerations, getWorkerState, priceKey,
} from './store'
import type { Filing, QueueItem, RegenerationView, ReviewDecision, StagingSidecar } from './types'

/**
 * Everything the Decided page shows about each decision, worked out from what
 * the worker actually did rather than guessed from names.
 *
 * The old page searched 07_EPISODES for any file starting with the shot ID
 * before looking anywhere else, so an approved draft showed its shot's final
 * (the same video twice) and a final filed into an entity folder was never
 * found. The worker logs every move it makes; that is the record used here.
 */

export interface FollowUp {
  jobId: string
  attempt: number
  stage: 'draft' | 'final' | null
  state: 'queued' | 'generating' | 'not-generated' | 'to-review' | 'accepted' | 'denied'
}

export interface DecidedEntry {
  decision: ReviewDecision
  /** Block label (P05) or shot, as on the Review page. */
  title: string
  /** "EP001 · SC004 · SH0010", or the target for an entity. */
  where: string
  stage: 'draft' | 'final' | null
  attempt: number
  /** waiting: the worker has not picked it up yet; failed: back on Review. */
  status: 'waiting' | 'applied' | 'failed'
  failedReason: string | null
  /** Project-relative path of the take as it is now, if it is on disk. */
  file: string | null
  /** Why there is no file, when there is none. */
  missing: string | null
  /** The note, with upload placeholders swapped for what they were filed as. */
  notes: string
  /** The job this decision queued: the regeneration or the 1080p final. */
  followUp: FollowUp | null
  filings: Filing[]
  /** Regenerate requests made from this card, newest last. */
  regenerations: RegenerationView[]
  /** What one more take of this job costs, from the ledger, if known. */
  regenerateCredits: number | null
  isVideo: boolean
}

async function exists(rel: string): Promise<boolean> {
  try { await fs.access(path.join(P.root, rel)); return true } catch { return false }
}

async function readText(file: string): Promise<string> {
  try { return await fs.readFile(file, 'utf8') } catch { return '' }
}

/** candidate -> destination, from the worker's PROMOTED / DRAFT APPROVED / REJECTED lines. */
async function movesFromLog(): Promise<Map<string, string>> {
  const moves = new Map<string, string>()
  for (const line of (await readText(P.workerLog)).split('\n')) {
    const m = line.match(/\s(?:PROMOTED|DRAFT APPROVED|REJECTED) (\S+) -> (.+?)\s*$/)
    if (m) moves.set(m[1], m[2].split(path.sep).join('/'))
  }
  return moves
}

async function sidecars(): Promise<Map<string, StagingSidecar>> {
  const out = new Map<string, StagingSidecar>()
  let dirs: string[] = []
  try { dirs = await fs.readdir(P.staging) } catch { return out }
  await Promise.all(
    dirs.map(async (d) => {
      try { out.set(d, JSON.parse(await fs.readFile(path.join(P.staging, d, 'job.json'), 'utf8'))) } catch { /* not a batch */ }
    }),
  )
  return out
}

export async function getDecidedEntries(): Promise<DecidedEntry[]> {
  const [decisions, filings, state, queue, assets, moves, byBatch, regenerations, prices] = await Promise.all([
    getDecisions(), getFilings(), getWorkerState(), getQueue(), getAssets(), movesFromLog(), sidecars(), getRegenerations(), getPriceTable(),
  ])
  const failed = (state?.failedDecisions ?? {}) as Record<string, string>
  const processedDecisions = new Set((state?.processedDecisions ?? []) as string[])
  const processedJobs = new Set((state?.processedJobs ?? []) as string[])
  const generating = await getGeneratingJobId(processedJobs)

  const sidecarByJob = new Map([...byBatch.values()].map((s) => [s.jobId, s]))
  const queueById = new Map((queue as (QueueItem & { label?: string | null })[]).map((q) => [q.jobId, q]))
  /** Revisions queued before labels were carried have none; the first attempt does. */
  const labelFor = (jobId: string) => {
    for (let id: string | null = jobId, guard = 0; id && guard < 12; guard++) {
      const s = sidecarByJob.get(id)
      const q = queueById.get(id)
      if (s?.label ?? q?.label) return (s?.label ?? q?.label)!
      id = s?.parentJobId ?? q?.parentJobId ?? null
    }
    return null
  }
  const verdictByJob = new Map<string, ReviewDecision>()
  for (const d of decisions) if (!failed[d.id]) verdictByJob.set(d.jobId, d)

  // Shot files already on disk, for the rare decision with no move logged.
  const shotFiles = new Map<string, string[]>()
  async function filesIn(folder: string) {
    if (!shotFiles.has(folder)) {
      shotFiles.set(folder, await fs.readdir(path.join(P.root, folder)).catch(() => []))
    }
    return shotFiles.get(folder)!
  }

  const entries = await Promise.all(
    decisions.map(async (d): Promise<DecidedEntry> => {
      const batch = path.basename(path.dirname(d.candidate))
      const s = byBatch.get(batch) ?? sidecarByJob.get(d.jobId) ?? null
      const stage = s?.stage ?? null
      const status = failed[d.id] ? 'failed' : processedDecisions.has(d.id) ? 'applied' : 'waiting'
      const base = path.basename(d.candidate)

      let file: string | null = null
      let missing: string | null = null
      if (status !== 'applied') {
        // Not moved (yet, or ever): the take is still where it was reviewed.
        file = d.candidate
      } else if (moves.has(d.candidate)) {
        file = moves.get(d.candidate)!
      } else if (d.verdict === 'denied') {
        file = `09_OUTPUT/_rejected/${d.hfJobId}/${base}`
      } else if (stage === 'draft') {
        file = `09_OUTPUT/_drafts/${d.hfJobId}/${base}`
      } else {
        const row = assets.find((a) => a.original_filename === `${d.hfJobId}/${base}`)
        if (row) file = `${row.folder}/${row.filename}`
        else if (s && (s as StagingSidecar & { outputFolder?: string }).outputFolder) {
          const folder = (s as StagingSidecar & { outputFolder?: string }).outputFolder!
          const stem = `${d.target}_${d.variant || 'V01'}`
          const hits = (await filesIn(folder)).filter((n) => n === stem + path.extname(base) || n.startsWith(stem + '_T'))
          if (hits.length === 1) file = `${folder}/${hits[0]}`
          else missing = hits.length ? 'Several takes of this shot are filed; the worker log does not say which one this is.' : null
        }
      }
      if (file && !(await exists(file))) {
        missing = status === 'waiting' ? 'Not on disk.' : `Not found at ${file}.`
        file = null
      }
      if (!file && !missing) missing = 'The worker did not record where this went.'

      // What this decision set off: a revision (deny + regenerate) or the final (accepted draft).
      const child = (queue as (QueueItem & { stage?: FollowUp['stage'] })[])
        .filter((q) => q.parentJobId === d.jobId)
        .sort((a, b) => String(a.enqueuedAt ?? '').localeCompare(String(b.enqueuedAt ?? '')))
        .at(-1)
      let followUp: FollowUp | null = null
      if (child) {
        const cs = sidecarByJob.get(child.jobId)
        const v = verdictByJob.get(child.jobId)
        followUp = {
          jobId: child.jobId,
          attempt: child.attempt ?? cs?.attempt ?? 1,
          stage: child.stage ?? null,
          state: !processedJobs.has(child.jobId)
            ? child.jobId === generating ? 'generating' : 'queued'
            : !cs ? 'not-generated'
            : v ? v.verdict : 'to-review',
        }
      }

      const mine = filings.filter((f) => f.decisionId === d.id)
      const notes = (d.notes ?? '').replace(/@?upload:(u\d{1,3})(?![\w/-])/g, (m, id: string) => {
        return mine.find((f) => f.ok && f.uploadId === id)?.token ?? m
      })
      // The queue record is what a regeneration re-runs; its params give the price key.
      const q = queueById.get(d.jobId)
      const regenerateCredits = s?.costCredits ?? (q ? prices.get(priceKey(q.model, q.params)) ?? null : null)

      const m = d.target.match(/^SHM-(EP\d{3})(?:-(SC\d{3}))?(?:-(SH\d{4}))?/)
      const where = m ? [m[1], m[2], m[3]].filter(Boolean).join(' · ') : d.target
      return {
        decision: d,
        title: labelFor(d.jobId) ?? m?.[2] ?? d.target,
        where,
        stage,
        attempt: s?.attempt ?? 1,
        status,
        failedReason: failed[d.id] ?? null,
        file,
        missing,
        notes,
        followUp,
        filings: mine,
        regenerations: regenerations.get(d.jobId) ?? [],
        regenerateCredits,
        isVideo: /^(seedance|kling|veo|wan|hailuo|grok_video)/.test(d.model ?? ''),
      }
    }),
  )
  return entries.sort((a, b) => b.decision.ts.localeCompare(a.decision.ts))
}
