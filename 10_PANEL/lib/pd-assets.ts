// Asset links of a block (database): which entity (and which look) a block uses. Server only.
// A link is not history, so it can be removed; both add and remove are audited.
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { Actor } from './actor-core.ts'
import { audit } from './audit.ts'
import { getDb } from './db/client.ts'
import { block, blockAssetLink } from './db/schema.ts'
import type { Result } from './pd-prompts.ts'

export type AssetLinkRow = typeof blockAssetLink.$inferSelect
export const LINK_ROLES = ['character', 'location', 'prop', 'reference', 'state', 'voice'] as const

export async function listAssetLinks(blockId: string): Promise<AssetLinkRow[]> {
  return getDb().select().from(blockAssetLink).where(eq(blockAssetLink.blockId, blockId)).orderBy(asc(blockAssetLink.createdAt))
}

/** `entity` must be a live entity of the project (checked by the caller against the catalogue). */
export async function addAssetLink(
  project: string, blockId: string, entityId: string, variant: string | null, role: string | null, actor: Actor,
): Promise<Result<{ link: AssetLinkRow }>> {
  const v = variant ? String(variant).trim().toUpperCase() : null
  if (v && !/^V\d{2}$/.test(v)) return { ok: false, error: 'A look is V01, V02, ...' }
  const r = role ? String(role).trim().slice(0, 40) : null
  return getDb().transaction(async (tx) => {
    const [b] = await tx.select({ id: block.id }).from(block).where(and(eq(block.projectSlug, project), eq(block.id, blockId), isNull(block.retiredAt)))
    if (!b) return { ok: false as const, error: 'That block does not exist.' }
    const dup = await tx.select({ id: blockAssetLink.id }).from(blockAssetLink)
      .where(and(eq(blockAssetLink.blockId, blockId), eq(blockAssetLink.entityId, entityId), sql`coalesce(${blockAssetLink.variant}, '') = ${v ?? ''}`))
    if (dup.length) return { ok: false as const, error: 'That asset is already linked.' }
    const [link] = await tx.insert(blockAssetLink).values({ blockId, entityId, variant: v, role: r, createdBy: actor.id === 'local' ? null : actor.id }).returning()
    await audit({ project, actor, action: 'asset.link', objectType: 'block', objectId: blockId, detail: { entityId, variant: v, role: r } }, tx)
    return { ok: true as const, link }
  })
}

export async function removeAssetLink(project: string, blockId: string, linkId: string, actor: Actor): Promise<Result> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select({ l: blockAssetLink }).from(blockAssetLink).innerJoin(block, eq(block.id, blockAssetLink.blockId))
      .where(and(eq(blockAssetLink.id, linkId), eq(blockAssetLink.blockId, blockId), eq(block.projectSlug, project)))
    if (!row) return { ok: false as const, error: 'That link does not exist.' }
    await tx.delete(blockAssetLink).where(eq(blockAssetLink.id, linkId))
    await audit({ project, actor, action: 'asset.unlink', objectType: 'block', objectId: blockId, detail: { entityId: row.l.entityId, variant: row.l.variant, role: row.l.role } }, tx)
    return { ok: true as const }
  })
}

/** The reference token the worker takes for a link: @CHR-007/V02, or @CHR-007 for the main look. */
export function linkToken(shortId: string, variant: string | null): string {
  return variant ? `@${shortId}/${variant}` : `@${shortId}`
}
