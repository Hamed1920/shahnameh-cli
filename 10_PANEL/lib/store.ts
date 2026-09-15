import fs from 'node:fs/promises'
import path from 'node:path'
import { P } from './paths'
import { parseCsv } from './csv'
import type {
  ArchivedLook, AssetRow, AttemptEntry, Candidate, CatalogEntity, Entity, Filing, IndexOp,
  IndexOpResult, Learning, LibraryData, LibraryEntity, QueueItem, ReviewContext, ReviewDecision,
  LookUse, StagingSidecar, WorkerStatus,
} from './types'

/**
 * Read side of the panel. Everything here touches disk on every call and is
 * never cached — the worker mutates these files underneath us, so a cached
 * read would show Hamed a stale queue.
 *
 * The panel NEVER writes CSVs or moves asset files. It appends JSONL and drops
 * raw uploads into 09_OUTPUT/_uploads (see actions.ts). The worker is the single
 * writer for everything else, including filing those uploads.
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

export async function getEntities(): Promise<Entity[]> {
  return parseCsv(await readText(P.entities)) as unknown as Entity[]
}

export async function getAssets(): Promise<AssetRow[]> {
  return parseCsv(await readText(P.manifest)) as unknown as AssetRow[]
}

export async function getDecisions(): Promise<ReviewDecision[]> {
  return readJsonl<ReviewDecision>(P.reviewLog)
}

export async function getFilings(): Promise<Filing[]> {
  return readJsonl<Filing>(P.filings)
}

/**
 * Every live entity with the files behind each of its variants, for the
 * reference picker. Highest take wins per variant, as in resolveRefToken.
 */
export async function getCatalog(): Promise<CatalogEntity[]> {
  const [entities, assets] = await Promise.all([getEntities(), getAssets()])
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

export async function getQueue(): Promise<QueueItem[]> {
  return readJsonl<QueueItem>(P.queue)
}

/** Last write wins: a learning can be re-decided, so fold by id. */
export async function getLearnings(): Promise<Learning[]> {
  const all = await readJsonl<Learning>(P.learnings)
  const byId = new Map<string, Learning>()
  for (const l of all) byId.set(l.id, l)
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * Every downloaded candidate in _staging, with its decision if it has one.
 * A batch without a sidecar is skipped rather than guessed at — an unlabelled
 * image has no target entity and cannot be promoted safely.
 */
export async function getCandidates(): Promise<Candidate[]> {
  const [decisions, state] = await Promise.all([getDecisions(), getWorkerState()])
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
    batches = (await fs.readdir(P.staging, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch { return [] }

  const out: Candidate[] = []
  for (const batch of batches) {
    const dir = path.join(P.staging, batch)
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

export async function getPending(): Promise<Candidate[]> {
  return (await getCandidates()).filter((c) => !c.decided)
}

/**
 * Resolve an @-token to a project-relative path. Mirrors resolveRef in the
 * worker and Resolve-ShmRef in PowerShell.
 */
export async function resolveRefToken(token: string): Promise<string | null> {
  const t = String(token ?? '').trim().replace(/^@/, '')
  if (!t) return null
  const [ref, variantIn, takeIn] = t.split('/')
  const [entities, assets] = await Promise.all([getEntities(), getAssets()])
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
 * The image the reviewer should compare against.
 *
 * For an entity target that is its canonical plate. For a SHOT target there is
 * no entity, so fall back to the first reference the shot was generated from —
 * which is what the reviewer actually needs to check continuity against.
 */
export async function getReferenceFor(
  entityId: string,
  variant?: string,
  fallbackRefs?: string[],
): Promise<string | null> {
  const [entities, assets] = await Promise.all([getEntities(), getAssets()])
  const ent = entities.find((e) => e.id === entityId || e.short_id === entityId)
  if (ent) {
    const want = variant || ent.canonical_variant
    const rows = assets.filter((a) => a.entity_id === ent.id)
    const hit = rows.find((a) => a.variant === want) ?? rows[0]
    if (hit) return `${hit.folder}/${hit.filename}`
  }
  for (const token of fallbackRefs ?? []) {
    const p = await resolveRefToken(token)
    if (p) return p
  }
  return null
}

/**
 * The job the worker is generating right now, if any: the most recent GENERATE
 * line in worker.log for a job the worker has not yet recorded as processed.
 */
export async function getGeneratingJobId(processed: Set<string>): Promise<string | null> {
  const lines = (await readText(P.workerLog)).trimEnd().split('\n').slice(-200)
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/\sGENERATE (\S+)/)
    if (m) return processed.has(m[1]) ? null : m[1]
    if (/\sworker started /.test(lines[i])) return null // restarted since: nothing in flight
  }
  return null
}

export async function getWorkerState(): Promise<Record<string, unknown> | null> {
  const t = await readText(P.workerState)
  if (!t.trim()) return null
  try { return JSON.parse(t) } catch { return null }
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

async function exists(rel: string): Promise<boolean> {
  try { await fs.access(path.join(P.root, rel)); return true } catch { return false }
}

/** Where the worker put a decided candidate's file. */
async function locateDecided(d: ReviewDecision, stage: string | null | undefined): Promise<string | null> {
  const base = path.basename(d.candidate)
  const guesses =
    d.verdict === 'denied'
      ? [`09_OUTPUT/_rejected/${d.hfJobId}/${base}`]
      : stage === 'draft'
        ? [`09_OUTPUT/_drafts/${d.hfJobId}/${base}`]
        : []
  for (const g of [...guesses, d.candidate]) if (await exists(g)) return g
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
export async function getReviewContexts(candidates: Candidate[]): Promise<Map<string, ReviewContext>> {
  const [queue, decisions, state, ledgerText, cfgText] = await Promise.all([
    readJsonl<QueueJob>(P.queue),
    getDecisions(),
    getWorkerState(),
    readText(P.ledger),
    readText(path.join(process.cwd(), 'worker', 'config.json')),
  ])
  const failed = (state?.failedDecisions ?? {}) as Record<string, string>
  const jobs = new Map(queue.map((j) => [j.jobId, j]))
  const decisionFor = new Map<string, ReviewDecision>()
  for (const d of decisions) if (!failed[d.id]) decisionFor.set(d.jobId, d)

  let cfg: Record<string, unknown> = {}
  try { cfg = JSON.parse(cfgText) } catch { /* estimates just go missing */ }

  // Last real price per model + resolution + duration, from generated jobs.
  const priceKey = (model: unknown, p: Record<string, unknown> | undefined) =>
    `${model}|${p?.resolution ?? ''}|${p?.duration ?? ''}`
  const prices = new Map<string, number>()
  for (const row of parseCsv(ledgerText) as unknown as Record<string, string>[]) {
    const cost = parseFloat(row.cost)
    const job = jobs.get(row.job_id)
    if (row.state === 'GENERATED' && Number.isFinite(cost) && job) prices.set(priceKey(job.model, job.params), cost)
  }

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
        video: d ? await locateDecided(d, job?.stage) : null,
        refs: job?.refs ?? [],
      })
      parent = job?.parentJobId ?? null
    }

    const m = s.target.match(/^SHM-(EP\d{3})(?:-(SC\d{3}))?(?:-(SH\d{4}))?/)
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


// ---------------------------------------------------------------- references library

/** Everything the References page manages, plus what the worker has and has not applied yet. */
export async function getLibrary(): Promise<LibraryData> {
  const [entities, assets, ops, results, state, archiveLog, worker, candidates] = await Promise.all([
    getEntities(),
    getAssets(),
    readJsonl<IndexOp>(P.indexOps),
    readJsonl<IndexOpResult>(P.indexOpResults),
    getWorkerState(),
    readJsonl<Record<string, unknown>>(path.join(P.archive, 'index.jsonl')),
    getWorkerStatus(),
    getCandidates(),
  ])
  const usage = await getLookUsage(entities, state, candidates)

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
    try { await fs.access(path.join(P.root, String(x.file))) } catch { continue }
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
  entities: Entity[],
  state: Record<string, unknown> | null,
  candidates: Candidate[],
): Promise<Map<string, LookUse[]>> {
  const processed = new Set((state?.processedJobs ?? []) as string[])
  const [queue, generating] = await Promise.all([readJsonl<QueueJob>(P.queue), getGeneratingJobId(processed)])
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
export async function getWorkerStatus(): Promise<WorkerStatus> {
  let pid: number
  let startedMs: number
  try {
    const [text, stat] = await Promise.all([fs.readFile(P.workerLock, 'utf8'), fs.stat(P.workerLock)])
    pid = parseInt(text.trim(), 10)
    startedMs = stat.mtimeMs
  } catch {
    return { running: false, outdated: false }
  }
  let alive = false
  if (Number.isFinite(pid) && pid > 0) {
    try { process.kill(pid, 0); alive = true } catch (e) { alive = (e as NodeJS.ErrnoException).code === 'EPERM' }
  }
  if (!alive) return { running: false, outdated: false }

  const dir = path.join(process.cwd(), 'worker')
  const libs = await fs.readdir(path.join(dir, 'lib')).catch(() => [] as string[])
  const files = ['worker.mjs', 'config.json', ...libs.map((f) => path.join('lib', f))]
  const times = await Promise.all(files.map((f) => fs.stat(path.join(dir, f)).then((s) => s.mtimeMs, () => 0)))
  // A second of slack: an editor can touch a file in the same moment the worker starts.
  return { running: true, outdated: Math.max(...times) > startedMs + 1000, startedAt: new Date(startedMs).toISOString() }
}
