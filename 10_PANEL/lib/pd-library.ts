// The pre-production library (Persimmon Dreams, blocks projects): the assets of a project grouped
// the way the production team and the director think of them, and the asset review between them.
// Server only, login on only: import it dynamically behind authEnabled(), like lib/approvals.ts.
//
// Assets themselves (entities, versions, files, the registry) stay the worker's: uploading and
// filing go through the References page and the studio. This module reads them, and keeps the
// review in the database. The one thing it writes outside the database is an INDEX_OPS request
// when the director approves, exactly as the References page does: the worker writes the registry.
import fs from 'node:fs/promises'
import path from 'node:path'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { MACHINE } from '@/worker/lib/machine.mjs'
import type { Actor } from './actor-core.ts'
import { whoStamp } from './actor.ts'
import { audit } from './audit.ts'
import { getDb } from './db/client.ts'
import { assetReview, block, blockAssetLink, sequence, user } from './db/schema.ts'
import { safeResolve } from './paths.ts'
import type { Project } from './projects.ts'
import { blockDisplayId } from './structure.ts'
import { getAssets, getEntities } from './store.ts'
import type { AssetRow, Entity } from './types.ts'
import {
  buildApprovalOps, canDecide, canPresent, categoryOf, decisionProblem, decisionStatus,
  isReviewStatus, type Category, type Decision, type ReviewStatus,
} from './pd-category.ts'

export type ReviewView = {
  id: string
  entityId: string
  variant: string
  status: ReviewStatus
  presentedBy: string
  presentedAt: string
  directorNotes: string | null
  decidedBy: string | null
  decidedAt: string | null
  indexOpId: string | null
}

export type VersionView = {
  variant: string
  /** Project-relative file of the highest take, for the staff thumbnail routes. */
  path: string
  role: string
  registryStatus: string
  source: string
  added: string
  notes: string
  takes: number
  isMain: boolean
  /** The newest review of this version, or null when it was never sent to the director. */
  review: ReviewView | null
}

export type AssetView = {
  id: string
  shortId: string
  kind: string
  slug: string
  name: string
  description: string
  status: string
  category: Category
  versions: VersionView[]
  /** Display ids of the blocks that use it (PD-S01-B003). */
  usedIn: string[]
}

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
}

export function imageTypeOf(file: string): string | null {
  return IMAGE_TYPES[path.extname(file).toLowerCase()] ?? null
}

/** The highest take of each variant of an entity: the file a version stands for. */
function topTakes(assets: AssetRow[], entityId: string): Map<string, { top: AssetRow; takes: number }> {
  const by = new Map<string, AssetRow[]>()
  for (const a of assets) if (a.entity_id === entityId) by.set(a.variant, [...(by.get(a.variant) ?? []), a])
  const out = new Map<string, { top: AssetRow; takes: number }>()
  for (const [variant, rows] of by) out.set(variant, { top: [...rows].sort((a, b) => b.take.localeCompare(a.take))[0], takes: rows.length })
  return out
}

async function reviewRows(slug: string): Promise<ReviewView[]> {
  const db = getDb()
  const rows = await db.select().from(assetReview).where(eq(assetReview.projectSlug, slug)).orderBy(desc(assetReview.presentedAt))
  const ids = [...new Set(rows.flatMap((r) => [r.presentedBy, r.decidedBy].filter((x): x is string => !!x)))]
  const names = new Map<string, string>()
  if (ids.length) for (const u of await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids))) names.set(u.id, u.name)
  return rows.map((r) => ({
    id: r.id,
    entityId: r.entityId,
    variant: r.variant ?? '',
    status: isReviewStatus(r.status) ? r.status : 'presented',
    presentedBy: names.get(r.presentedBy) ?? 'Unknown',
    presentedAt: r.presentedAt.toISOString(),
    directorNotes: r.directorNotes,
    decidedBy: r.decidedBy ? names.get(r.decidedBy) ?? 'Unknown' : null,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    indexOpId: r.indexOpId,
  }))
}

/** Which blocks use each entity (or one of its versions), as display ids. Keyed `entity|variant`, variant '' for all. */
async function blockUsage(pr: Project): Promise<Map<string, Set<string>>> {
  const rows = await getDb()
    .select({ entityId: blockAssetLink.entityId, variant: blockAssetLink.variant, seq: sequence.number, num: block.number })
    .from(blockAssetLink)
    .innerJoin(block, eq(block.id, blockAssetLink.blockId))
    .innerJoin(sequence, eq(sequence.id, block.sequenceId))
    .where(eq(block.projectSlug, pr.slug))
    .orderBy(asc(sequence.number), asc(block.number))
  const out = new Map<string, Set<string>>()
  for (const r of rows) {
    const key = `${r.entityId}|${r.variant ?? ''}`
    const set = out.get(key) ?? new Set<string>()
    set.add(blockDisplayId(pr.code, r.seq, r.num))
    out.set(key, set)
  }
  return out
}

/** Everything the production library page shows, in registry order. */
export async function getProductionLibrary(pr: Project): Promise<AssetView[]> {
  const [entities, assets, reviews, usage] = await Promise.all([getEntities(pr), getAssets(pr), reviewRows(pr.slug), blockUsage(pr)])
  const out: AssetView[] = []
  for (const e of entities) {
    if (e.status === 'RETIRED') continue
    const takes = topTakes(assets, e.id)
    const versions: VersionView[] = [...takes.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([variant, { top, takes: n }]) => ({
        variant,
        path: `${top.folder}/${top.filename}`,
        role: top.role,
        registryStatus: top.status,
        source: top.source,
        added: top.added,
        notes: top.notes,
        takes: n,
        isMain: e.canonical_variant === variant,
        // Reviews come newest first, so the first match is the current one.
        review: reviews.find((r) => r.entityId === e.id && r.variant === variant) ?? null,
      }))
    const used = new Set<string>([...(usage.get(`${e.id}|`) ?? []), ...versions.flatMap((v) => [...(usage.get(`${e.id}|${v.variant}`) ?? [])])])
    out.push({
      id: e.id, shortId: e.short_id, kind: e.kind, slug: e.slug, name: e.name, description: e.description,
      status: e.status, category: categoryOf(e.kind, e.slug), versions, usedIn: [...used],
    })
  }
  return out
}

export type DirectorItem = {
  review: ReviewView
  asset: { id: string; shortId: string; name: string; description: string; category: Category; isMain: boolean }
}

/** What was sent to the director: only versions that have a review row. No file paths leave this module. */
export async function getDirectorLibrary(pr: Project): Promise<DirectorItem[]> {
  const [entities, reviews] = await Promise.all([getEntities(pr), reviewRows(pr.slug)])
  const byId = new Map(entities.map((e) => [e.id, e]))
  const out: DirectorItem[] = []
  for (const r of reviews) {
    const e = byId.get(r.entityId)
    if (!e) continue
    out.push({
      review: r,
      asset: {
        id: e.id, shortId: e.short_id, name: e.name, description: e.description,
        category: categoryOf(e.kind, e.slug), isMain: e.canonical_variant === r.variant,
      },
    })
  }
  return out
}

export type Result = { ok: true; message?: string } | { ok: false; error: string }

const key = (slug: string, entityId: string, variant: string) => `asset_review:${slug}:${entityId}:${variant}`

/** Send one version to the director. One open review per version; the version must exist in the registry. */
export async function presentVersion(pr: Project, actor: Actor, entityId: string, variant: string): Promise<Result> {
  const [entities, assets] = await Promise.all([getEntities(pr), getAssets(pr)])
  const e: Entity | undefined = entities.find((x) => x.id === entityId)
  if (!e || e.status === 'RETIRED') return { ok: false, error: 'That asset is not in the library.' }
  if (!assets.some((a) => a.entity_id === e.id && a.variant === variant)) return { ok: false, error: `${e.short_id} has no version ${variant}.` }

  const db = getDb()
  return db.transaction(async (tx) => {
    // Two clicks at once must not make two open reviews: serialise on the version.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key(pr.slug, e.id, variant)}))`)
    const existing = await tx.select({ status: assetReview.status }).from(assetReview)
      .where(and(eq(assetReview.projectSlug, pr.slug), eq(assetReview.entityId, e.id), eq(assetReview.variant, variant)))
    if (!canPresent(existing)) return { ok: false as const, error: `${e.short_id} ${variant} is already with the director or decided. A revised look is the next version.` }
    const [row] = await tx.insert(assetReview).values({ projectSlug: pr.slug, entityId: e.id, variant, presentedBy: actor.id }).returning({ id: assetReview.id })
    await audit({ project: pr.slug, actor, action: 'asset.presented', objectType: 'asset_review', objectId: row.id, detail: { entityId: e.id, variant } }, tx)
    return { ok: true as const, message: `${e.short_id} ${variant} sent to the director.` }
  })
}

/** Resolve a review's image on disk from the registry. Never takes a path from the client. */
export async function resolveReviewFile(pr: Project, entityId: string, variant: string): Promise<{ abs: string; type: string } | null> {
  const assets = await getAssets(pr)
  const top = topTakes(assets, entityId).get(variant)?.top
  if (!top) return null
  const abs = safeResolve(pr.root, `${top.folder}/${top.filename}`)
  if (!abs) return null
  const type = imageTypeOf(abs)
  if (!type) return null
  return { abs, type }
}

function newOpId(): string {
  return `op_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/**
 * A director decision. Select and revision change only the review. Approve also asks the worker,
 * through INDEX_OPS, to set the asset APPROVED and, when chosen, make this version the main look.
 * The database change and the request go together: if the request cannot be written, nothing changes.
 */
export async function decideReview(
  pr: Project, actor: Actor, reviewId: string, decision: Decision, notes: string, makeCanonical: boolean,
): Promise<Result> {
  const problem = decisionProblem(decision, notes)
  if (problem) return { ok: false, error: problem }
  if (!/^[0-9a-f-]{36}$/i.test(reviewId)) return { ok: false, error: 'No such review.' }

  const db = getDb()
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(assetReview)
      .where(and(eq(assetReview.id, reviewId), eq(assetReview.projectSlug, pr.slug))).for('update')
    if (!row) return { ok: false as const, error: 'No such review.' }
    if (!canDecide(row.status, decision)) return { ok: false as const, error: 'This one is already decided.' }

    const status = decisionStatus(decision)
    const trimmed = notes.trim()
    let indexOpId: string | null = null
    let ops: Record<string, unknown>[] = []
    if (decision === 'approve') {
      const e = (await getEntities(pr)).find((x) => x.id === row.entityId)
      if (!e || e.status === 'RETIRED') return { ok: false as const, error: 'That asset has been retired.' }
      ops = buildApprovalOps({
        entityId: row.entityId, variant: row.variant ?? '', makeCanonical: makeCanonical && !!row.variant && e.canonical_variant !== row.variant,
        who: whoStamp(actor), ts: new Date().toISOString(), machine: MACHINE, newId: newOpId,
      })
      indexOpId = ops.map((o) => String(o.id)).join(',')
    }

    await tx.update(assetReview).set({
      status, decidedBy: actor.id, decidedAt: new Date(), indexOpId,
      directorNotes: trimmed ? trimmed : row.directorNotes,
    }).where(eq(assetReview.id, row.id))
    await audit({
      project: pr.slug, actor, action: `asset.${status}`, objectType: 'asset_review', objectId: row.id,
      detail: { entityId: row.entityId, variant: row.variant, notes: trimmed || null, indexOps: indexOpId },
    }, tx)

    // Last, so a failed write rolls the rows back. The worker is the only one that touches the registry.
    if (ops.length) {
      await fs.mkdir(path.dirname(pr.P.indexOps), { recursive: true })
      await fs.appendFile(pr.P.indexOps, ops.map((o) => JSON.stringify(o)).join('\n') + '\n', 'utf8')
    }
    return { ok: true as const }
  })
}
