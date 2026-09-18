import fs from 'node:fs/promises'
import path from 'node:path'
import { idRx } from '../worker/lib/ids.mjs'
import type { Project } from './projects'
import {
  getAssets, getDecisions, getFilings, getGeneratingJobId, getPriceTable, getQueue, getRegenerations, getShotMoves,
  getWorkerState, priceKey, referenceResolver,
} from './store'
import type { Filing, QueueItem, RegenerateSource, RegenerationView, ReviewDecision, StagingSidecar } from './types'

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
  /**
   * Where this take belongs NOW: the decision's own target, read forward
   * through any episode it has been moved to since (SHOT_MOVES.jsonl).
   */
  target: string
  /** EP001, when this is footage. Null for a design image filed under an entity. */
  episode: string | null
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
  /** The accepted job as queued, for the Regenerate dialog. Null when the queue record is gone. */
  source: RegenerateSource | null
}

async function exists(pr: Project, rel: string): Promise<boolean> {
  try { await fs.access(path.join(pr.P.root, rel)); return true } catch { return false }
}

async function readText(file: string): Promise<string> {
  try { return await fs.readFile(file, 'utf8') } catch { return '' }
}

/** candidate -> destination, from the worker's PROMOTED / DRAFT APPROVED / REJECTED lines. */
async function movesFromLog(pr: Project): Promise<Map<string, string>> {
  const moves = new Map<string, string>()
  for (const line of (await readText(pr.P.workerLog)).split('\n')) {
    const m = line.match(/\s(?:PROMOTED|DRAFT APPROVED|REJECTED) (\S+) -> (.+?)\s*$/)
    if (m) moves.set(m[1], m[2].split(path.sep).join('/'))
  }
  return moves
}

async function sidecars(pr: Project): Promise<Map<string, StagingSidecar>> {
  const out = new Map<string, StagingSidecar>()
  let dirs: string[] = []
  try { dirs = await fs.readdir(pr.P.staging) } catch { return out }
  await Promise.all(
    dirs.map(async (d) => {
      try { out.set(d, JSON.parse(await fs.readFile(path.join(pr.P.staging, d, 'job.json'), 'utf8'))) } catch { /* not a batch */ }
    }),
  )
  return out
}

export async function getDecidedEntries(pr: Project): Promise<DecidedEntry[]> {
  const [decisions, filings, state, queue, assets, moves, byBatch, regenerations, prices, resolve, shotMoves] = await Promise.all([
    getDecisions(pr), getFilings(pr), getWorkerState(pr), getQueue(pr), getAssets(pr), movesFromLog(pr), sidecars(pr), getRegenerations(pr), getPriceTable(),
    referenceResolver(pr), getShotMoves(pr),
  ])
  /** A shot id, and a file, as they are now: footage can have changed episode since. */
  const nowShot = (id: string) => shotMoves.shot[id] ?? id
  const nowFile = (rel: string) => shotMoves.file[rel] ?? rel
  const failed = (state?.failedDecisions ?? {}) as Record<string, string>
  const processedDecisions = new Set((state?.processedDecisions ?? []) as string[])
  const processedJobs = new Set((state?.processedJobs ?? []) as string[])
  const generating = await getGeneratingJobId(pr, processedJobs)

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

  /**
   * Decisions whose take could not be named, to be paired up after the pass.
   *
   * Shots are not in ASSET_MANIFEST -- only entity assets are -- so a shot is
   * identified from the worker's PROMOTED lines. queue/worker.log is gitignored
   * and per-machine, so a take filed on another machine has no move recorded
   * here, and two takes of one shot then look alike.
   */
  const claims = new Map<string, { folder: string; stem: string; ext: string }>()

  // Shot files already on disk, for the rare decision with no move logged.
  const shotFiles = new Map<string, string[]>()
  async function filesIn(folder: string) {
    if (!shotFiles.has(folder)) {
      shotFiles.set(folder, await fs.readdir(path.join(pr.P.root, folder)).catch(() => []))
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
        file = nowFile(moves.get(d.candidate)!)
      } else if (d.verdict === 'denied') {
        file = `09_OUTPUT/_rejected/${d.hfJobId}/${base}`
      } else if (stage === 'draft') {
        file = `09_OUTPUT/_drafts/${d.hfJobId}/${base}`
      } else {
        const row = assets.find((a) => a.original_filename === `${d.hfJobId}/${base}`)
        if (row) file = `${row.folder}/${row.filename}`
        else if (s && (s as StagingSidecar & { outputFolder?: string }).outputFolder) {
          const folder = shotMoves.folder[d.target] ?? (s as StagingSidecar & { outputFolder?: string }).outputFolder!
          const stem = `${nowShot(d.target)}_${d.variant || 'V01'}`
          const hits = (await filesIn(folder)).filter((n) => n === stem + path.extname(base) || n.startsWith(stem + '_T'))
          if (hits.length === 1) file = `${folder}/${hits[0]}`
          else if (hits.length) {
            missing = 'Several takes of this shot are filed; the worker log does not say which one this is.'
            claims.set(d.id, { folder, stem, ext: path.extname(base) })
          } else missing = null
        }
      }
      if (file && !(await exists(pr, file))) {
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
      const q = queueById.get(d.jobId) as (QueueItem & { basePrompt?: string; stage?: 'draft' | 'final' | null; revisionNotes?: string[] }) | undefined
      const regenerateCredits = s?.costCredits ?? (q ? prices.get(priceKey(q.model, q.params)) ?? null : null)
      // References to start from. The queue record alone loses two things: what
      // the accept decision changed (the worker gives that only to the follow-up
      // final) and nothing about looks archived since. So: the decision's list,
      // with its uploads as they were filed; else the take's sidecar; else the
      // queue. Every token is then resolved as the worker would resolve it now.
      const startRefs = Array.isArray(d.refs)
        ? d.refs.flatMap((r) => {
            const m = String(r).match(/^upload:(u\d{1,3})$/)
            if (!m) return [String(r)]
            const token = mine.find((f) => f.ok && f.uploadId === m[1])?.token
            return token ? [token] : []
          })
        : (s?.refs ?? q?.refs ?? [])
      const source: RegenerateSource | null = q
        ? {
            prompt: q.basePrompt ?? q.prompt,
            refs: await Promise.all([...new Set(startRefs)].map(resolve)),
            model: q.model,
            stage: q.stage ?? null,
            variant: q.variant || 'V01',
            params: (q.params ?? {}) as RegenerateSource['params'],
            revisionNotes: q.revisionNotes ?? [],
            jobId: q.jobId,
            attempt: q.attempt ?? s?.attempt ?? 1,
            sentPrompt: s?.prompt ?? q.prompt,
          }
        : null

      const target = nowShot(d.target)
      const m = target.match(idRx(pr.code).shotParts)
      const where = m ? [m[1], m[2], m[3]].filter(Boolean).join(' · ') : target
      return {
        decision: d,
        title: labelFor(d.jobId) ?? m?.[2] ?? target,
        where,
        target,
        episode: m?.[1] ?? null,
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
        source,
      }
    }),
  )
  pairUnidentifiedTakes(entries, claims, shotFiles)
  return entries.sort((a, b) => b.decision.ts.localeCompare(a.decision.ts))
}

/** `CODE-...-SH0010_V01.mp4` is take 1, `_T02` take 2, and so on. */
function takeNumber(name: string, stem: string): number {
  const m = name.slice(stem.length).match(/^_T(\d+)/)
  return m ? parseInt(m[1], 10) : 1
}

/**
 * Give each decision that could not name its take one of the files left over in
 * its folder: oldest decision to earliest take.
 *
 * The worker files a second take of a shot as `_T02` and a third as `_T03`, in
 * the order they are decided, so the Nth unclaimed decision is the Nth
 * unclaimed take. Anything the worker log or the manifest already pinned down
 * keeps that answer and is taken out of the pool first, so this only ever
 * decides between takes nothing else could tell apart -- and a decision left
 * without a file still says so rather than borrowing another take's.
 */
function pairUnidentifiedTakes(
  entries: DecidedEntry[],
  claims: Map<string, { folder: string; stem: string; ext: string }>,
  shotFiles: Map<string, string[]>,
): void {
  if (!claims.size) return
  const claimed = new Set(entries.map((e) => e.file).filter((f): f is string => !!f))

  const groups = new Map<string, DecidedEntry[]>()
  for (const e of entries) {
    const c = claims.get(e.decision.id)
    if (!c) continue
    const key = `${c.folder} ${c.stem} ${c.ext}`
    const list = groups.get(key)
    if (list) list.push(e)
    else groups.set(key, [e])
  }

  for (const [key, list] of groups) {
    const [folder, stem, ext] = key.split(' ')
    const free = (shotFiles.get(folder) ?? [])
      .filter((n) => n === stem + ext || n.startsWith(stem + '_T'))
      .filter((n) => !claimed.has(`${folder}/${n}`))
      .sort((a, b) => takeNumber(a, stem) - takeNumber(b, stem))

    ;[...list]
      .sort((a, b) => a.decision.ts.localeCompare(b.decision.ts))
      .forEach((e, i) => {
        const name = free[i]
        if (!name) return
        e.file = `${folder}/${name}`
        e.missing = null
      })
  }
}
