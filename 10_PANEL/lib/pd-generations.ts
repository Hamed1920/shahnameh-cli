// Generations of a block (database + files). Server only, behind authEnabled(): import dynamically.
//
// The worker's files are the truth about what was made; the database holds the numbering. Each
// output (one take of one Higgsfield job) becomes one generation row, keyed (block, hf_job_id,
// candidate), with a G number frozen when the row is first written. File paths are never stored:
// files move between _staging, _drafts, 07_EPISODES and _rejected, so the current place is
// re-read every time (resolveGenerationFiles).
import fs from 'node:fs/promises'
import path from 'node:path'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Actor } from './actor-core.ts'
import { audit } from './audit.ts'
import { getDb } from './db/client.ts'
import { block, generation, promptVersion, user } from './db/schema.ts'
import { getDecidedEntries } from './decided'
import {
  isSystemName, mapOutputs, matchPromptVersion, numberNewOutputs, outputKey, splitByBlock,
  type MappedOutput, type RawDecision, type RawJob, type RawRequest, type RawSidecar,
} from './pd-gen-map.ts'
import type { Project } from './projects'
import { getDecisions, getJobRequests, getQueue, getShotMoves, getWorkerState, readText } from './store'
import { displayOf } from './pd/keys.ts'

export type GenerationRow = typeof generation.$inferSelect
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

/** Every output the project's files describe right now. */
export async function readOutputs(pr: Project): Promise<MappedOutput[]> {
  const [queue, decisions, state, moves, requests] = await Promise.all([getQueue(pr), getDecisions(pr), getWorkerState(pr), getShotMoves(pr), getJobRequests(pr)])
  let dirs: string[] = []
  try { dirs = (await fs.readdir(pr.P.staging, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name) } catch { /* no staging yet */ }
  const sidecars: RawSidecar[] = []
  await Promise.all(dirs.map(async (d) => {
    try { sidecars.push(JSON.parse(await readText(path.join(pr.P.staging, d, 'job.json')))) } catch { /* not a batch */ }
  }))
  const failed = new Set(Object.keys((state?.failedDecisions ?? {}) as Record<string, string>))
  const outs = mapOutputs(queue as unknown as RawJob[], sidecars, decisions as unknown as RawDecision[], failed, requests as unknown as RawRequest[])
  // Read forward through any move of the footage to another shot.
  return outs.map((o) => ({ ...o, target: moves.shot[o.target] ?? o.target }))
}

const lastSync = new Map<string, { at: number; run: Promise<void> }>()
const THROTTLE_MS = 5000

/** Idempotent. Cheap enough for page loads; calls within ~5 s share one run. */
export function syncGenerations(pr: Project, force = false): Promise<void> {
  const prev = lastSync.get(pr.slug)
  if (!force && prev && Date.now() - prev.at < THROTTLE_MS) return prev.run
  const run = doSync(pr).catch((e) => { lastSync.delete(pr.slug); throw e })
  lastSync.set(pr.slug, { at: Date.now(), run })
  return run
}

async function doSync(pr: Project): Promise<void> {
  const db = getDb()
  const blocks = await db.select().from(block).where(eq(block.projectSlug, pr.slug))
  if (blocks.length === 0) return
  const outputs = await readOutputs(pr)
  if (outputs.length === 0) return
  const rows = await db.select().from(generation).where(eq(generation.projectSlug, pr.slug))
  // Outputs that already have a row in any block (hand-assigned ones stay where they were put).
  const assigned = new Set(rows.map((r) => outputKey(r.hfJobId ?? '', r.candidate ?? '')))
  const live = new Map(blocks.filter((b) => !b.retiredAt && b.internalId).map((b) => [b.internalId!, b.id]))
  const { byBlock } = splitByBlock(outputs, live, assigned)
  for (const [blockId, outs] of byBlock) await writeNew(pr.slug, blockId, outs, null)
  await linkVersions(pr.slug, outputs)
  await namePeople(pr.slug, rows, outputs)
}

/** Account ids to display names, for the people the records name. */
async function namesOf(db: Pick<ReturnType<typeof getDb>, 'select'>, ids: (string | null)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))]
  if (want.length === 0) return new Map()
  return new Map((await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, want))).map((u) => [u.id, u.name]))
}

/**
 * Rows made before a person could be told from the records hold the system name the job was queued
 * under (panel:batch, worker:final ...). Once one can be resolved, the row holds the person instead.
 * Only created_by changes: a G number never does.
 */
async function namePeople(project: string, rows: GenerationRow[], outputs: MappedOutput[]): Promise<void> {
  const stale = rows.filter((r) => r.createdBy && isSystemName(r.createdBy))
  if (stale.length === 0) return
  const db = getDb()
  const byKey = new Map(outputs.map((o) => [o.key, o]))
  const outOf = (r: GenerationRow) => byKey.get(outputKey(r.hfJobId ?? '', r.candidate ?? ''))
  const names = await namesOf(db, stale.map((r) => outOf(r)?.createdById ?? null))
  for (const r of stale) {
    const o = outOf(r)
    const who = (o?.createdById ? names.get(o.createdById) : undefined) ?? o?.createdBy
    if (who && !isSystemName(who) && who !== r.createdBy) await db.update(generation).set({ createdBy: who }).where(and(eq(generation.id, r.id), eq(generation.projectSlug, project)))
  }
}

async function writeNew(project: string, blockId: string, outs: MappedOutput[], actor: Actor | null): Promise<GenerationRow[]> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'pd-gen:' + blockId}))`)
    const existing = await tx.select({ h: generation.hfJobId, c: generation.candidate, g: generation.gNumber }).from(generation).where(eq(generation.blockId, blockId))
    const fresh = numberNewOutputs(existing.map((e) => ({ key: outputKey(e.h ?? '', e.c ?? ''), g: e.g })), outs)
    if (fresh.length === 0) return []
    const versions = await tx.select({ id: promptVersion.id, versionNumber: promptVersion.versionNumber, promptHash: promptVersion.promptHash }).from(promptVersion).where(eq(promptVersion.blockId, blockId))
    const inserted: GenerationRow[] = []
    const names = await namesOf(tx, fresh.map((f) => f.createdById))
    for (const o of fresh) {
      const pv = matchPromptVersion(o.promptHash, o.label, displayOf(blockId), versions)
      const [row] = await tx.insert(generation).values({
        projectSlug: project, blockId, gNumber: o.g, hfJobId: o.hfJobId, jobId: o.jobId, candidate: o.candidate, parentJobId: o.parentJobId,
        stage: o.stage, model: o.model, resolution: o.resolution,
        durationSeconds: o.durationSeconds === null ? null : String(o.durationSeconds),
        costCredits: o.costCredits === null ? null : String(o.costCredits),
        operationType: o.operationType, promptVersionId: pv?.id ?? null, createdBy: (o.createdById ? names.get(o.createdById) : undefined) ?? o.createdBy,
        createdAt: new Date(o.createdAt || Date.now()),
      }).onConflictDoNothing().returning()
      if (row) inserted.push(row)
    }
    if (actor && inserted.length) {
      await audit({ project, actor, action: 'generation.assign', objectType: 'block', objectId: displayOf(blockId), detail: { keys: fresh.map((f) => f.key) } }, tx)
    }
    return inserted
  })
}

/** A prompt version saved after its generation was synced can still be linked to it. */
async function linkVersions(project: string, outputs: MappedOutput[]): Promise<void> {
  const db = getDb()
  const open = await db.select().from(generation).where(and(eq(generation.projectSlug, project), isNull(generation.promptVersionId)))
  if (open.length === 0) return
  const byKey = new Map(outputs.map((o) => [o.key, o]))
  const versionsByBlock = new Map<string, { id: string; versionNumber: number; promptHash: string }[]>()
  for (const g of open) {
    const o = byKey.get(outputKey(g.hfJobId ?? '', g.candidate ?? ''))
    if (!o) continue
    if (!versionsByBlock.has(g.blockId)) {
      versionsByBlock.set(g.blockId, await db.select({ id: promptVersion.id, versionNumber: promptVersion.versionNumber, promptHash: promptVersion.promptHash }).from(promptVersion).where(eq(promptVersion.blockId, g.blockId)))
    }
    const pv = matchPromptVersion(o.promptHash, o.label, displayOf(g.blockId), versionsByBlock.get(g.blockId)!)
    if (pv) await db.update(generation).set({ promptVersionId: pv.id }).where(eq(generation.id, g.id))
  }
}

export async function listGenerations(blockId: string): Promise<GenerationRow[]> {
  return getDb().select().from(generation).where(eq(generation.blockId, blockId)).orderBy(asc(generation.gNumber))
}

export interface GenerationState {
  /** accepted | denied | discarded | pending (waiting for review). */
  decision: 'accepted' | 'denied' | 'discarded' | 'pending'
  /** Project-relative path of the file as it is now, or null. */
  file: string | null
}

/**
 * Where each generation's file is now, and what became of it, by re-reading the files. Keyed
 * `hf|candidate`. A decided take is where the worker put it (Decided entries); an undecided one is
 * still in _staging.
 */
export async function resolveGenerationFiles(
  pr: Project, gens: { hfJobId: string | null; candidate: string | null }[],
): Promise<Map<string, GenerationState>> {
  const out = new Map<string, GenerationState>()
  if (gens.length === 0) return out
  const [outputs, decided] = await Promise.all([readOutputs(pr), getDecidedEntries(pr)])
  const byKey = new Map(outputs.map((o) => [o.key, o]))
  const decidedByKey = new Map<string, (typeof decided)[number]>()
  for (const e of decided) {
    const k = outputKey(e.decision.hfJobId, e.decision.take)
    if (!decidedByKey.has(k)) decidedByKey.set(k, e) // newest first
  }
  for (const g of gens) {
    const key = outputKey(g.hfJobId ?? '', g.candidate ?? '')
    const d = decidedByKey.get(key)
    let file: string | null = d && d.status !== 'failed' ? d.file : null
    if (!file) {
      for (const ext of ['.mp4', '.mov', '.webm', '.png', '.jpg']) {
        const rel = `09_OUTPUT/_staging/${g.hfJobId}/${g.candidate}${ext}`
        try { await fs.access(path.join(pr.P.root, rel)); file = rel; break } catch { /* next */ }
      }
    }
    out.set(key, { decision: byKey.get(key)?.verdict ?? 'pending', file })
  }
  return out
}

/** The current project-relative path of one generation's file, or null. */
export async function resolveGenerationFile(pr: Project, g: { hfJobId: string | null; candidate: string | null }): Promise<string | null> {
  return (await resolveGenerationFiles(pr, [g])).get(outputKey(g.hfJobId ?? '', g.candidate ?? ''))?.file ?? null
}

/** Outputs of this project whose target is not a live block and that nobody assigned yet. */
export async function unassignedOutputs(pr: Project): Promise<MappedOutput[]> {
  const db = getDb()
  const [blocks, rows, outputs] = await Promise.all([
    db.select().from(block).where(eq(block.projectSlug, pr.slug)),
    db.select({ h: generation.hfJobId, c: generation.candidate }).from(generation).where(eq(generation.projectSlug, pr.slug)),
    readOutputs(pr),
  ])
  const live = new Map(blocks.filter((b) => !b.retiredAt && b.internalId).map((b) => [b.internalId!, b.id]))
  const assigned = new Set(rows.map((r) => outputKey(r.h ?? '', r.c ?? '')))
  return splitByBlock(outputs, live, assigned).unassigned
}

/** Record the link of one output to a block as a generation row. Files stay where they are. */
export async function assignOutput(pr: Project, key: string, blockId: string, actor: Actor): Promise<Result<{ g: number }>> {
  const [b] = await getDb().select().from(block).where(and(eq(block.projectSlug, pr.slug), eq(block.id, blockId), isNull(block.retiredAt)))
  if (!b) return { ok: false, error: 'That block does not exist.' }
  const un = (await unassignedOutputs(pr)).find((o) => o.key === key)
  if (!un) return { ok: false, error: 'That output is already assigned, or no longer exists.' }
  const made = await writeNew(pr.slug, blockId, [un], actor)
  if (made.length === 0) return { ok: false, error: 'That output is already assigned.' }
  return { ok: true, g: made[0].gNumber }
}
