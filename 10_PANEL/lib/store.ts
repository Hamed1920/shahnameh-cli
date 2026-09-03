import fs from 'node:fs/promises'
import path from 'node:path'
import { P } from './paths'
import { parseCsv } from './csv'
import type {
  AssetRow, Candidate, Entity, Learning, QueueItem, ReviewDecision, StagingSidecar,
} from './types'

/**
 * Read side of the panel. Everything here touches disk on every call and is
 * never cached — the worker mutates these files underneath us, so a cached
 * read would show Hamed a stale queue.
 *
 * The panel NEVER writes CSVs or moves asset files. It only appends JSONL
 * (see actions.ts). The worker is the single writer for everything else.
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
  const decisions = await getDecisions()
  const byCandidate = new Map<string, ReviewDecision>()
  for (const d of decisions) byCandidate.set(d.candidate, d)

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

export async function getWorkerState(): Promise<Record<string, unknown> | null> {
  const t = await readText(P.workerState)
  if (!t.trim()) return null
  try { return JSON.parse(t) } catch { return null }
}
