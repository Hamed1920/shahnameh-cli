import fs from 'node:fs/promises'
import path from 'node:path'
import { idRx } from '../worker/lib/ids.mjs'
import { listProjects, type Project } from './projects'
import { parseCsv } from './csv'
import { autostartBlockedReason } from './worker-guard'
import { priceKey } from './batch-rules'
import { episodeOf, nextEpisodeId, parseEpisodeDir, type EpisodeInfo } from './episodes'
import type {
  ArchivedLook, AssetRow, AttemptEntry, BatchStatus, BatchView, Candidate, CatalogEntity, Entity, Filing, IndexOp,
  IndexOpResult, JobRequest, JobRequestEvent, Learning, LibraryData, LibraryEntity, PromptLibraryItem, QueueItem, RegenerationView,
  ResolvedReference, ReviewContext, ReviewDecision, LookUse, ShotMove, ShotMoves, StagingSidecar, WorkerStatus,
} from './types'

/**
 * Read side of the panel. Everything here touches disk on every call and is
 * never cached — the worker mutates these files underneath us, so a cached
 * read would show Hamed a stale queue.
 *
 * The panel NEVER writes CSVs or moves asset files. It appends JSONL and drops
 * raw uploads into 09_OUTPUT/_uploads (see actions.ts). The worker is the single
 * writer for everything else, including filing those uploads.
 *
 * Every read is of one project (lib/projects.ts), passed in as `pr`.
 */

async function readText(file: string): Promise<string> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw err
  }
}

async function readJsonl<T>(file: string): Promise<T[]> {
  const text = await readText(file)
  const out: T[] = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try { out.push(JSON.parse(t) as T) } catch { /* skip a torn final line */ }
  }
  return out
}

export async function getEntities(pr: Project): Promise<Entity[]> {
  return parseCsv(await readText(pr.P.entities)) as unknown as Entity[]
}

export async function getAssets(pr: Project): Promise<AssetRow[]> {
  return parseCsv(await readText(pr.P.manifest)) as unknown as AssetRow[]
}

export async function getDecisions(pr: Project): Promise<ReviewDecision[]> {
  return readJsonl<ReviewDecision>(pr.P.reviewLog)
}

export async function getFilings(pr: Project): Promise<Filing[]> {
  return readJsonl<Filing>(pr.P.filings)
}

/**
 * Every live entity with the files behind each of its variants, for the
 * reference picker. Highest take wins per variant, as in resolveRefToken.
 */
export async function getCatalog(pr: Project): Promise<CatalogEntity[]> {
  const [entities, assets] = await Promise.all([getEntities(pr), getAssets(pr)])
  return entities
    .filter((e) => e.status !== 'RETIRED')
    .map((e) => {
      const best = new Map<string, AssetRow>()
      for (const a of assets) {
        if (a.entity_id !== e.id) continue
        const prev = best.get(a.variant)
        if (!prev || a.take > prev.take) best.set(a.variant, a)
      }
      return {
        id: e.id,
        shortId: e.short_id,
        kind: e.kind,
        slug: e.slug,
        name: e.name,
        canonical: e.canonical_variant,
        variants: [...best.values()]
          .sort((a, b) => a.variant.localeCompare(b.variant))
          .map((a) => ({ variant: a.variant, path: `${a.folder}/${a.filename}` })),
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

export async function getQueue(pr: Project): Promise<QueueItem[]> {
  return readJsonl<QueueItem>(pr.P.queue)
}

/** Last write wins: a learning can be re-decided, so fold by id. */
export async function getLearnings(pr: Project): Promise<Learning[]> {
  const all = await readJsonl<Learning>(pr.P.learnings)
  const byId = new Map<string, Learning>()
  for (const l of all) byId.set(l.id, l)
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * Every downloaded candidate in _staging, with its decision if it has one.
 * A batch without a sidecar is skipped rather than guessed at — an unlabelled
 * image has no target entity and cannot be promoted safely.
 */
export async function getCandidates(pr: Project): Promise<Candidate[]> {
  const [decisions, state] = await Promise.all([getDecisions(pr), getWorkerState(pr)])
  // A decision the worker could not apply (a bad upload, say) hands the
  // candidate back for review rather than stranding it in _staging.
  const failed = (state?.failedDecisions ?? {}) as Record<string, string>
  const byCandidate = new Map<string, ReviewDecision>()
  const failedFor = new Map<string, { id: string; reason: string }>()
  for (const d of decisions) {
    if (failed[d.id]) {
      byCandidate.delete(d.candidate)
      failedFor.set(d.candidate, { id: d.id, reason: failed[d.id] })
    } else {
      byCandidate.set(d.candidate, d)
      failedFor.delete(d.candidate)
    }
  }

  let batches: string[]
  try {
    batches = (await fs.readdir(pr.P.staging, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch { return [] }

  const out: Candidate[] = []
  for (const batch of batches) {
    const dir = path.join(pr.P.staging, batch)
    let sidecar: StagingSidecar
    try {
      sidecar = JSON.parse(await fs.readFile(path.join(dir, 'job.json'), 'utf8'))
    } catch { continue }

    for (const c of sidecar.candidates ?? []) {
      const rel = `09_OUTPUT/_staging/${batch}/${c.file}`
      try { await fs.access(path.join(dir, c.file)) } catch { continue }
      out.push({
        hfJobId: sidecar.hfJobId,
        take: c.take,
        path: rel,
        resultUrl: c.resultUrl,
        sidecar,
        decided: byCandidate.get(rel) ?? null,
        failedDecision: failedFor.get(rel) ?? null,
      })
    }
  }
  out.sort((a, b) => (a.sidecar.createdAt < b.sidecar.createdAt ? 1 : -1))
  return out
}

export async function getPending(pr: Project): Promise<Candidate[]> {
  return (await getCandidates(pr)).filter((c) => !c.decided)
}

/**
 * Resolve an @-token to a project-relative path. Mirrors resolveRef in the
 * worker and Resolve-ShmRef in PowerShell.
 */
export async function resolveRefToken(pr: Project, token: string): Promise<string | null> {
  const t = String(token ?? '').trim().replace(/^@/, '')
  if (!t) return null
  const [ref, variantIn, takeIn] = t.split('/')
  const [entities, assets] = await Promise.all([getEntities(pr), getAssets(pr)])
  const ent = entities.find((e) => e.id === ref || e.short_id === ref)
  if (!ent) return null
  const variant = (variantIn || ent.canonical_variant || '').toUpperCase()
  if (!variant) return null
  let rows = assets.filter((a) => a.entity_id === ent.id && a.variant === variant)
  if (takeIn) rows = rows.filter((a) => a.take === takeIn.toUpperCase())
  if (rows.length === 0) return null
  const row = [...rows].sort((a, b) => b.take.localeCompare(a.take))[0]
  return `${row.folder}/${row.filename}`
}

/**
 * Resolve many tokens against one read of the registries, the way the worker
 * will when it runs them: the file has to be on disk, not just in the manifest.
 * A token that fails says why, and when its entity still has a current look
 * that one is offered, so a reference to an archived look can be put right in
 * one click instead of silently refusing the whole request.
 */
export async function referenceResolver(pr: Project): Promise<(token: string) => Promise<ResolvedReference>> {
  const [entities, assets] = await Promise.all([getEntities(pr), getAssets(pr)])
  const onDisk = async (rel: string) => {
    try { await fs.access(path.join(pr.P.root, rel)); return true } catch { return false }
  }
  const lookup = (ent: Entity, variant: string, take?: string) => {
    let rows = assets.filter((a) => a.entity_id === ent.id && a.variant === variant)
    if (take) rows = rows.filter((a) => a.take === take)
    const row = [...rows].sort((a, b) => b.take.localeCompare(a.take))[0]
    return row ? `${row.folder}/${row.filename}` : null
  }
  return async (raw: string) => {
    const token = String(raw ?? '').trim()
    const [ref, variantIn, takeIn] = token.replace(/^@/, '').split('/')
    const ent = entities.find((e) => e.id === ref || e.short_id === ref)
    if (!ent) return { token, path: null, stale: 'not in the index' }
    const variant = (variantIn || ent.canonical_variant || '').toUpperCase()
    const found = variant ? lookup(ent, variant, takeIn?.toUpperCase()) : null
    if (found && (await onDisk(found))) return { token, path: found }

    const stale = !variant
      ? `${ent.short_id} has no current look`
      : found
        ? 'the file is missing on disk'
        : `${ent.short_id} ${variant}${takeIn ? `/${takeIn.toUpperCase()}` : ''} is no longer in the index (archived or moved)`
    const canon = (ent.canonical_variant || '').toUpperCase()
    const canonPath = canon ? lookup(ent, canon) : null
    const suggest = canonPath && canon !== variant && ent.status !== 'RETIRED' && (await onDisk(canonPath))
      ? { token: `@${ent.short_id}/${canon}`, path: canonPath }
      : undefined
    return { token, path: null, stale, ...(suggest && { suggest }) }
  }
}

/**
 * The image the reviewer should compare against.
 *
 * For an entity target that is its canonical plate. For a SHOT target there is
 * no entity, so fall back to the first reference the shot was generated from —
 * which is what the reviewer actually needs to check continuity against.
 */
export async function getReferenceFor(
  pr: Project,
  entityId: string,
  variant?: string,
  fallbackRefs?: string[],
): Promise<string | null> {
  const [entities, assets] = await Promise.all([getEntities(pr), getAssets(pr)])
  const ent = entities.find((e) => e.id === entityId || e.short_id === entityId)
  if (ent) {
    const want = variant || ent.canonical_variant
    const rows = assets.filter((a) => a.entity_id === ent.id)
    const hit = rows.find((a) => a.variant === want) ?? rows[0]
    if (hit) return `${hit.folder}/${hit.filename}`
  }
  for (const token of fallbackRefs ?? []) {
    const p = await resolveRefToken(pr, token)
    if (p) return p
  }
  return null
}

/**
 * The job the worker is generating right now, if any: the most recent GENERATE
 * line in worker.log for a job the worker has not yet recorded as processed.
 */
export async function getGeneratingJobId(pr: Project, processed: Set<string>): Promise<string | null> {
  const lines = (await readText(pr.P.workerLog)).trimEnd().split('\n').slice(-200)
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/\sGENERATE (\S+)/)
    if (m) return processed.has(m[1]) ? null : m[1]
    if (/\sworker started /.test(lines[i])) return null // restarted since: nothing in flight
  }
  return null
}

export async function getWorkerState(pr: Project): Promise<Record<string, unknown> | null> {
  const t = await readText(pr.P.workerState)
  if (!t.trim()) return null
  try { return JSON.parse(t) } catch { return null }
}

/** Queued jobs the worker has not finished. Its processedJobs is the truth, not what sits in _staging. */
export async function getWaitingJobs(pr: Project): Promise<QueueItem[]> {
  const [queue, state] = await Promise.all([getQueue(pr), getWorkerState(pr)])
  const processed = new Set((state?.processedJobs ?? []) as string[])
  return queue.filter((q) => !processed.has(q.jobId))
}

// ---------------------------------------------------------------- review context

interface QueueJob {
  jobId: string
  parentJobId?: string | null
  attempt?: number
  stage?: 'draft' | 'final' | null
  label?: string | null
  model?: string
  params?: Record<string, unknown>
  refs?: string[]
}

async function exists(pr: Project, rel: string): Promise<boolean> {
  try { await fs.access(path.join(pr.P.root, rel)); return true } catch { return false }
}

/** Where the worker put a decided candidate's file. */
async function locateDecided(pr: Project, d: ReviewDecision, stage: string | null | undefined): Promise<string | null> {
  const base = path.basename(d.candidate)
  const guesses =
    d.verdict === 'denied'
      ? [`09_OUTPUT/_rejected/${d.hfJobId}/${base}`]
      : stage === 'draft'
        ? [`09_OUTPUT/_drafts/${d.hfJobId}/${base}`]
        : []
  for (const g of [...guesses, d.candidate]) if (await exists(pr, g)) return g
  return null
}

const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|[\s\-/])([\p{L}])/gu, (_, a: string, b: string) => a + b.toUpperCase())

/** "SHOT 1 — CONVERGENCE — 0:00–0:07" headings, as readable beats. */
function beatsOf(prompt: string): string[] {
  return [...String(prompt ?? '').matchAll(/SHOT \d+ — ([^—\n]+?) —/g)].map((m) => titleCase(m[1].trim()))
}

/**
 * Title, shot beats, earlier attempts and credit estimates for each candidate.
 * Everything is derived from files the worker already writes: the queue links
 * each revision to its parent, the review log says what happened to it, and
 * the ledger records what each generation cost.
 */
/** worker/config.json, as the worker reads it. Empty when it cannot be read; estimates just go missing. */
export async function getWorkerConfig(): Promise<Record<string, unknown>> {
  try { return JSON.parse(await readText(path.join(process.cwd(), 'worker', 'config.json'))) } catch { return {} }
}

/** Defined in batch-rules so the browser can price a quality without reading the disk. */
export { priceKey }

/**
 * Last real price per priceKey, from the generated jobs in every project's
 * ledger. Prices belong to the Higgsfield account, not to a project, so a new
 * project shows estimates from its first batch.
 */
export async function getPriceTable(): Promise<Map<string, number>> {
  const prices = new Map<string, number>()
  const rows: { at: string; key: string; cost: number }[] = []
  for (const project of await listProjects()) {
    const [queue, ledgerText] = await Promise.all([readJsonl<QueueJob>(project.P.queue), readText(project.P.ledger)])
    const jobs = new Map(queue.map((j) => [j.jobId, j]))
    for (const row of parseCsv(ledgerText) as unknown as Record<string, string>[]) {
      const cost = parseFloat(row.cost)
      const job = jobs.get(row.job_id)
      if (row.state === 'GENERATED' && Number.isFinite(cost) && job) {
        rows.push({ at: String(row.ingested ?? ''), key: priceKey(job.model, job.params), cost })
      }
    }
  }
  // Oldest first, so the latest price for a key wins whichever project paid it.
  for (const r of rows.sort((a, b) => a.at.localeCompare(b.at))) prices.set(r.key, r.cost)
  return prices
}

export async function getReviewContexts(pr: Project, candidates: Candidate[]): Promise<Map<string, ReviewContext>> {
  const [queue, decisions, state, prices, cfg] = await Promise.all([
    readJsonl<QueueJob>(pr.P.queue),
    getDecisions(pr),
    getWorkerState(pr),
    getPriceTable(),
    getWorkerConfig(),
  ])
  const failed = (state?.failedDecisions ?? {}) as Record<string, string>
  const jobs = new Map(queue.map((j) => [j.jobId, j]))
  const decisionFor = new Map<string, ReviewDecision>()
  for (const d of decisions) if (!failed[d.id]) decisionFor.set(d.jobId, d)

  const out = new Map<string, ReviewContext>()
  for (const c of candidates) {
    const s = c.sidecar
    const history: AttemptEntry[] = []
    let label = s.label ?? null
    let parent = s.parentJobId
    for (let guard = 0; parent && guard < 12; guard++) {
      const job = jobs.get(parent)
      const d = decisionFor.get(parent)
      label ??= job?.label ?? null
      history.unshift({
        jobId: parent,
        attempt: job?.attempt ?? 1,
        stage: job?.stage ?? null,
        verdict: d?.verdict ?? null,
        notes: d ? (d.notesEn || d.notes || '') : '',
        tags: d?.tags ?? [],
        decidedAt: d?.ts ?? null,
        video: d ? await locateDecided(pr, d, job?.stage) : null,
        refs: job?.refs ?? [],
      })
      parent = job?.parentJobId ?? null
    }

    const m = s.target.match(idRx(pr.code).shotParts)
    const finalParams = { ...s.params, resolution: cfg.videoFinalResolution }
    out.set(c.path, {
      label,
      episode: m?.[1] ?? null,
      scene: m?.[2] ?? null,
      shot: m?.[3] ?? null,
      beats: beatsOf((s as StagingSidecar & { basePrompt?: string }).basePrompt ?? s.prompt),
      history,
      cost: {
        regenerate: s.costCredits ?? prices.get(priceKey(s.model, s.params)) ?? null,
        final: s.stage === 'draft' ? (prices.get(priceKey(s.model, finalParams)) ?? null) : null,
      },
    })
  }
  return out
}


// ---------------------------------------------------------------- prompts page

/** Distinct shot ids that have been generation targets, for the Shot picker's suggestions. */
/** Every shot id in use: queued targets and shot files on disk, the two things the worker counts when it numbers a scene. */
export async function getKnownShots(pr: Project): Promise<string[]> {
  const rx = idRx(pr.code)
  const queue = await readJsonl<QueueItem>(pr.P.queue)
  const ids = queue.map((q) => q.target)
  const root = path.join(pr.P.root, '07_EPISODES')
  const eps = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  for (const ep of eps.filter((e) => e.isDirectory())) {
    const files = await fs.readdir(path.join(root, ep.name, 'shots')).catch(() => [] as string[])
    ids.push(...files.map((f) => f.match(rx.shotFileStart)?.[0] ?? ''))
  }
  return [...new Set(ids.filter((t) => rx.episodePrefix.test(t)))].sort()
}

/**
 * Footage that changed episode, folded into lookups.
 *
 * QUEUE.jsonl and REVIEW_LOG.jsonl are append-only history and keep the shot id
 * a job was made under, which is right -- that is what happened. This is how a
 * page reads that id forward to where the take is now. A shot moved twice is
 * chased to the end, so the oldest id still resolves.
 */
export async function getShotMoves(pr: Project): Promise<ShotMoves> {
  const records = await readJsonl<ShotMove>(pr.P.shotMoves)
  const shot: Record<string, string> = {}
  const file: Record<string, string> = {}
  const folder: Record<string, string> = {}
  /** Point `from` at `to`, and bring anything already pointing at `from` along with it. */
  const follow = (map: Record<string, string>, from: string, to: string) => {
    for (const [k, v] of Object.entries(map)) if (v === from) map[k] = to
    map[from] = to
  }
  const dirOf = new Map<string, string>()
  for (const r of records) {
    if (!r?.from || !r?.to) continue
    follow(shot, r.from, r.to)
    for (const f of r.files ?? []) if (f?.from && f?.to) follow(file, f.from, f.to)
    const landed = r.files?.[0]?.to
    if (landed?.includes('/')) dirOf.set(r.to, landed.slice(0, landed.lastIndexOf('/')))
  }
  for (const [from, to] of Object.entries(shot)) {
    const dir = dirOf.get(to)
    if (dir) folder[from] = dir
  }
  return { shot, file, folder }
}

/**
 * The project's episodes, in order, with how much footage each already holds.
 *
 * Two sources, because an episode exists before its folder does: every folder
 * under 07_EPISODES (the worker makes one when it files that episode's first
 * accepted take, matching it by its CODE-EPnnn prefix), plus every episode a
 * queued job already targets. The last entry is always the next free number,
 * so the Prompts page can start an episode without anything being written
 * anywhere -- the number only becomes real when a job is approved against it.
 */
export async function getEpisodes(pr: Project): Promise<EpisodeInfo[]> {
  const shots = await getKnownShots(pr)
  const found = new Map<string, EpisodeInfo>()
  const dirs = await fs.readdir(path.join(pr.P.root, '07_EPISODES'), { withFileTypes: true }).catch(() => [])
  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const parsed = parseEpisodeDir(d.name, pr.code)
    if (parsed) found.set(parsed.id, { id: parsed.id, dir: d.name, title: parsed.title, shots: 0 })
  }
  for (const shot of shots) {
    const id = episodeOf(shot, pr.code)
    if (id && !found.has(id)) found.set(id, { id, dir: null, title: '', shots: 0 })
  }
  for (const ep of found.values()) {
    ep.shots = new Set(shots.filter((s) => episodeOf(s, pr.code) === ep.id)).size
  }
  const list = [...found.values()].sort((a, b) => a.id.localeCompare(b.id))
  const next = nextEpisodeId(list.map((e) => e.id))
  return [...list, { id: next, dir: null, title: '', shots: 0 }]
}

/** Reference tokens of the latest queued jobs, newest first. The Prompts page offers them as "recent". */
export async function getRecentRefs(pr: Project, jobs = 12): Promise<string[]> {
  const queue = await readJsonl<QueueItem>(pr.P.queue)
  return queue.slice(-jobs).reverse().flatMap((q) => q.refs ?? [])
}

/**
 * Every submitted batch as the Prompts page shows it: requests folded with the
 * worker's events, newest first. Mirrors foldBatch in worker/lib/job-requests.mjs.
 */
export async function getBatches(pr: Project): Promise<BatchView[]> {
  const [requests, events, state] = await Promise.all([
    readJsonl<JobRequest>(pr.P.jobRequests),
    readJsonl<JobRequestEvent>(pr.P.jobRequestResults),
    getWorkerState(pr),
  ])
  const processed = new Set((state?.processedRequests ?? []) as string[])
  const out: BatchView[] = []

  for (const req of requests) {
    if (req.type !== 'batch.submit') continue
    const mine = events.filter((e) => e.batchId === req.batchId)
    let status: BatchStatus = 'received'
    let message: string | null = null
    let ceilingNote: string | null = null
    let total: number | null = null
    let unpriced = 0
    const prices = new Map<string, number | null>()
    const verdicts = new Map<string, { ok: boolean; reason?: string; target: string; jobId: string }>()
    const assigned = new Map<string, string>()
    // Per row as well: every NEXT/EP001 row of a batch shares the proposal but gets its own scene.
    const assignedByKey = new Map<string, string>()
    let validatedNew: { key: string; kind: string; slug: string }[] = []

    for (const e of mine) {
      switch (e.event) {
        case 'validated':
          status = 'validated'
          for (const j of e.jobs) verdicts.set(j.key, j)
          validatedNew = e.newEntities
          break
        case 'price':
          prices.set(e.key, e.credits)
          if (status === 'validated') status = 'pricing'
          break
        case 'priced':
          status = 'priced'; total = e.total; unpriced = e.unpriced
          break
        case 'queued':
          status = 'queued'; total = e.total ?? total; ceilingNote = e.ceilingNote ?? null
          for (const a of e.assigned) {
            assigned.set(a.proposal, a.id)
            if (a.key) assignedByKey.set(a.key, a.id)
          }
          break
        case 'discarded': status = 'discarded'; break
        case 'rejected':
          message = e.reason
          if ((e as { scope?: string }).scope === 'batch') status = 'rejected'
          break
        case 'error': message = e.reason; break
      }
    }
    const pending = requests
      .filter((r) => (r.type === 'batch.approve' || r.type === 'batch.discard') && r.batchId === req.batchId && !processed.has(r.id))
      .map((r) => r.id)
    if (!processed.has(req.id)) pending.unshift(req.id)
    if (status === 'priced' && requests.some((r) => r.type === 'batch.approve' && r.batchId === req.batchId && !processed.has(r.id))) status = 'approving'

    out.push({
      batchId: req.batchId,
      name: req.name,
      submittedAt: req.ts,
      status,
      total,
      unpriced,
      message,
      ceilingNote,
      pending,
      newEntities: validatedNew.map((n) => ({ ...n, assigned: assigned.get(`NEW/${n.kind}/${n.slug}`) ?? null })),
      jobs: req.jobs.map((j) => {
        const v = verdicts.get(j.key)
        const model = j.model || String(req.defaults?.model ?? '')
        return {
          key: j.key,
          label: j.label,
          target: j.target,
          assignedId: assignedByKey.get(j.key) ?? assigned.get(j.target) ?? null,
          jobId: v?.jobId || null,
          model,
          stage: j.stage ?? (/^(seedance|kling|veo|wan|hailuo|grok_video)/.test(model) ? req.defaults?.stage ?? 'draft' : null),
          ok: v ? v.ok : true,
          reason: v?.reason ?? null,
          credits: prices.get(j.key) ?? null,
          prompt: j.prompt,
        }
      }),
    })
  }
  return out.reverse()
}

/** Regenerate requests and what became of them, keyed by the accepted job they re-run. */
export async function getRegenerations(pr: Project): Promise<Map<string, RegenerationView[]>> {
  const [requests, events, state] = await Promise.all([
    readJsonl<JobRequest>(pr.P.jobRequests),
    readJsonl<JobRequestEvent>(pr.P.jobRequestResults),
    getWorkerState(pr),
  ])
  const processed = new Set((state?.processedRequests ?? []) as string[])
  const out = new Map<string, RegenerationView[]>()
  for (const r of requests) {
    if (r.type !== 'regenerate') continue
    const ev = events.filter((e) => e.reqId === r.id)
    const queued = ev.find((e) => e.event === 'queued')
    const rejected = ev.find((e) => e.event === 'rejected')
    const view: RegenerationView = {
      reqId: r.id,
      ts: r.ts,
      note: r.note ?? '',
      sound: typeof r.sound === 'boolean' ? r.sound : null,
      state: queued ? 'queued' : rejected && processed.has(r.id) ? 'rejected' : 'waiting',
      jobId: queued && queued.event === 'queued' ? queued.jobIds[r.jobId] ?? null : null,
      reason: rejected && rejected.event === 'rejected' ? rejected.reason : null,
    }
    out.set(r.jobId, [...(out.get(r.jobId) ?? []), view])
  }
  return out
}

/**
 * Every prompt ever queued, for the library on the Prompts page. A revision or
 * a 1080p final is the same prompt tried again, so each chain (a job and
 * everything queued after it via parentJobId) is one entry, shown as its
 * latest attempt. Newest first.
 */
export async function getPromptLibrary(pr: Project): Promise<PromptLibraryItem[]> {
  type Row = QueueItem & {
    basePrompt?: string; stage?: 'draft' | 'final' | null; label?: string | null; revisionNotes?: string[]
  }
  const [queue, decisions, state, ledgerText] = await Promise.all([
    readJsonl<Row>(pr.P.queue), getDecisions(pr), getWorkerState(pr), readText(pr.P.ledger),
  ])
  const processed = new Set((state?.processedJobs ?? []) as string[])
  const failedDecisions = (state?.failedDecisions ?? {}) as Record<string, string>
  const generating = await getGeneratingJobId(pr, processed)
  const ledger = new Map<string, string>()
  for (const row of parseCsv(ledgerText) as unknown as Record<string, string>[]) ledger.set(row.job_id, row.state)
  const verdict = new Map<string, ReviewDecision['verdict']>()
  for (const d of decisions) if (!failedDecisions[d.id]) verdict.set(d.jobId, d.verdict)

  const byId = new Map(queue.map((q) => [q.jobId, q]))
  const rootOf = (q: Row) => {
    let cur = q
    for (let guard = 0; cur.parentJobId && byId.has(cur.parentJobId) && guard < 50; guard++) cur = byId.get(cur.parentJobId)!
    return cur.jobId
  }
  const chains = new Map<string, Row[]>()
  for (const q of queue) {
    if (!q?.jobId) continue
    const root = rootOf(q)
    chains.set(root, [...(chains.get(root) ?? []), q])
  }

  const out: PromptLibraryItem[] = []
  for (const [rootJobId, jobs] of chains) {
    const sorted = [...jobs].sort((a, b) => String(a.enqueuedAt ?? '').localeCompare(String(b.enqueuedAt ?? '')))
    const last = sorted.at(-1)!
    const v = verdict.get(last.jobId)
    out.push({
      rootJobId,
      jobId: last.jobId,
      label: [...sorted].reverse().find((j) => j.label)?.label ?? null,
      target: last.target,
      attempts: sorted.length,
      enqueuedAt: last.enqueuedAt,
      prompt: last.basePrompt ?? last.prompt,
      refs: last.refs ?? [],
      model: last.model,
      stage: last.stage ?? null,
      variant: last.variant || 'V01',
      params: (last.params ?? {}) as PromptLibraryItem['params'],
      revisionNotes: last.revisionNotes ?? [],
      state: !processed.has(last.jobId)
        ? last.jobId === generating ? 'generating' : 'queued'
        : v ?? (ledger.get(last.jobId) === 'GENERATED' ? 'to-review' : 'failed'),
    })
  }
  return out.sort((a, b) => String(b.enqueuedAt).localeCompare(String(a.enqueuedAt)))
}

// ---------------------------------------------------------------- references library

/** Everything the References page manages, plus what the worker has and has not applied yet. */
export async function getLibrary(pr: Project): Promise<LibraryData> {
  const [entities, assets, ops, results, state, archiveLog, worker, candidates] = await Promise.all([
    getEntities(pr),
    getAssets(pr),
    readJsonl<IndexOp>(pr.P.indexOps),
    readJsonl<IndexOpResult>(pr.P.indexOpResults),
    getWorkerState(pr),
    readJsonl<Record<string, unknown>>(path.join(pr.P.archive, 'index.jsonl')),
    getWorkerStatus(pr),
    getCandidates(pr),
  ])
  const usage = await getLookUsage(pr, entities, state, candidates)

  const library: LibraryEntity[] = entities.map((e) => {
    const byVariant = new Map<string, AssetRow[]>()
    for (const a of assets) {
      if (a.entity_id !== e.id) continue
      byVariant.set(a.variant, [...(byVariant.get(a.variant) ?? []), a])
    }
    const looks = [...byVariant.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([variant, rows]) => {
        const top = [...rows].sort((a, b) => b.take.localeCompare(a.take))[0]
        return {
          variant, takes: rows.length, role: top.role, status: top.status,
          path: `${top.folder}/${top.filename}`, filename: top.filename, source: top.source, added: top.added,
          usedBy: usage.get(`${e.id}|${variant}`) ?? [],
        }
      })
    return {
      id: e.id, shortId: e.short_id, kind: e.kind, number: e.number, slug: e.slug, name: e.name,
      family: e.family, status: e.status, canonical: e.canonical_variant, description: e.description,
      flags: (e.flags || '').split(';').map((f) => f.trim()).filter(Boolean), looks,
    }
  })

  const restored = new Set(archiveLog.filter((x) => x.restored).map((x) => String(x.archiveId)))
  const archived: ArchivedLook[] = []
  for (const x of archiveLog) {
    if (x.restored || restored.has(String(x.archiveId))) continue
    const row = (x.row ?? {}) as Record<string, string>
    try { await fs.access(path.join(pr.P.root, String(x.file))) } catch { continue }
    archived.push({
      archiveId: String(x.archiveId), shortId: String(x.short_id), entityId: String(x.entity_id),
      variant: row.variant ?? '', take: row.take ?? '', role: row.role ?? '', file: String(x.file),
      by: String(x.by ?? ''), ts: String(x.ts ?? ''),
    })
  }

  const processed = new Set((state?.processedOps ?? []) as string[])
  const typeOf = new Map(ops.map((o) => [o.id, o.type]))
  return {
    entities: library,
    archived: archived.reverse(),
    pending: ops.filter((o) => !processed.has(o.id)),
    results: results.slice(-30).reverse().map((r) => ({ ...r, type: typeOf.get(r.opId) })),
    worker,
  }
}

/**
 * Which queued or generating jobs, and which videos waiting for review, use each
 * look, keyed `<entity id>|<variant>`. Mirrors the worker's in-use check
 * (worker/lib/index-ops.mjs), so the page can say so before anyone clicks.
 */
async function getLookUsage(
  pr: Project,
  entities: Entity[],
  state: Record<string, unknown> | null,
  candidates: Candidate[],
): Promise<Map<string, LookUse[]>> {
  const processed = new Set((state?.processedJobs ?? []) as string[])
  const [queue, generating] = await Promise.all([readJsonl<QueueJob>(pr.P.queue), getGeneratingJobId(pr, processed)])
  const out = new Map<string, LookUse[]>()
  const add = (token: string, use: LookUse) => {
    const [ref, variantIn] = String(token).replace(/^@/, '').split('/')
    const ent = entities.find((x) => x.id === ref || x.short_id === ref)
    const variant = (variantIn || ent?.canonical_variant || '').toUpperCase()
    if (!ent || !variant) return
    const key = `${ent.id}|${variant}`
    const list = out.get(key) ?? []
    if (!list.some((u) => u.label === use.label)) list.push(use)
    out.set(key, list)
  }
  for (const j of queue) {
    if (processed.has(j.jobId)) continue
    for (const t of j.refs ?? []) add(t, { label: j.label ?? j.jobId, state: j.jobId === generating ? 'generating' : 'queued' })
  }
  for (const c of candidates) {
    for (const t of c.sidecar.refs ?? []) add(t, { label: c.sidecar.label ?? c.sidecar.jobId, state: 'review' })
  }
  return out
}

/**
 * Is the worker running, and is it running the current code?
 *
 * The worker loads its code once, at start. A worker started before an update
 * keeps running without it, which looks exactly like "the button does nothing".
 * Its lock file holds the pid and was written as it started, so compare that
 * time with the newest file in worker/.
 */
export async function getWorkerStatus(pr: Project): Promise<WorkerStatus> {
  const autostartOff = autostartBlockedReason()
  let pid: number
  let startedMs: number
  try {
    const [text, stat] = await Promise.all([fs.readFile(pr.P.workerLock, 'utf8'), fs.stat(pr.P.workerLock)])
    pid = parseInt(text.trim(), 10)
    startedMs = stat.mtimeMs
  } catch {
    return { running: false, outdated: false, autostartOff }
  }
  let alive = false
  if (Number.isFinite(pid) && pid > 0) {
    try { process.kill(pid, 0); alive = true } catch (e) { alive = (e as NodeJS.ErrnoException).code === 'EPERM' }
  }
  if (!alive) return { running: false, outdated: false, autostartOff }

  const dir = path.join(process.cwd(), 'worker')
  const libs = await fs.readdir(path.join(dir, 'lib')).catch(() => [] as string[])
  const files = ['worker.mjs', 'config.json', ...libs.map((f) => path.join('lib', f))]
  const times = await Promise.all(files.map((f) => fs.stat(path.join(dir, f)).then((s) => s.mtimeMs, () => 0)))
  // A second of slack: an editor can touch a file in the same moment the worker starts.
  return { running: true, outdated: Math.max(...times) > startedMs + 1000, startedAt: new Date(startedMs).toISOString(), autostartOff }
}
