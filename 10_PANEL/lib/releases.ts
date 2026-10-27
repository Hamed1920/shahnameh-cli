// Releases and client comments (database). Server only, and only loaded with SHM_AUTH=on:
// import it dynamically behind authEnabled(). Relative imports so a script can run it too.
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import type { Actor } from './actor-core.ts'
import type { AssetRef } from './asset-ref.ts'
import { getDb } from './db/client.ts'
import { clientComment, release, user } from './db/schema.ts'
import { refCovers, validRef, type ReleaseKind } from './release-match.ts'

export type ReleaseRow = typeof release.$inferSelect
export type Verdict = 'approve' | 'reject'

export async function listReleases(project: string, opts: { activeOnly?: boolean } = {}): Promise<ReleaseRow[]> {
  const where = opts.activeOnly
    ? and(eq(release.projectSlug, project), isNull(release.revokedAt))
    : eq(release.projectSlug, project)
  return getDb().select().from(release).where(where).orderBy(desc(release.releasedAt))
}

export async function getRelease(id: string): Promise<ReleaseRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const [row] = await getDb().select().from(release).where(eq(release.id, id)).limit(1)
  return row ?? null
}

/** Release something to clients. Releasing what is already live returns the live row. */
export async function createRelease(
  project: string, kind: ReleaseKind, ref: string, label: string | null, actor: Actor,
): Promise<ReleaseRow> {
  if (!validRef(kind, ref)) throw new Error(`Not a valid ${kind} reference: ${ref}`)
  const db = getDb()
  const [live] = await db.select().from(release).where(
    and(eq(release.projectSlug, project), eq(release.kind, kind), eq(release.ref, ref), isNull(release.revokedAt)),
  ).limit(1)
  if (live) return live
  const [row] = await db.insert(release).values({
    projectSlug: project, kind, ref, label: label?.trim().slice(0, 120) || null, releasedBy: actor.id,
  }).returning()
  return row
}

/** Take it back. Rows are kept; only revoked_at is set. */
export async function revokeRelease(id: string, _actor: Actor): Promise<boolean> {
  const rows = await getDb().update(release).set({ revokedAt: new Date() })
    .where(and(eq(release.id, id), isNull(release.revokedAt))).returning({ id: release.id })
  return rows.length > 0
}

/** Is this file covered by a live release in this project? */
export async function releaseCovers(project: string, assetRef: AssetRef): Promise<boolean> {
  const live = await listReleases(project, { activeOnly: true })
  return refCovers(live.map((r) => ({ kind: r.kind as ReleaseKind, ref: r.ref })), assetRef)
}

export async function listComments(releaseId: string) {
  return getDb()
    .select({
      id: clientComment.id, body: clientComment.body, verdict: clientComment.verdict,
      createdAt: clientComment.createdAt, userId: clientComment.userId, author: user.name,
    })
    .from(clientComment)
    .innerJoin(user, eq(user.id, clientComment.userId))
    .where(eq(clientComment.releaseId, releaseId))
    .orderBy(asc(clientComment.createdAt))
}

export async function addComment(releaseId: string, actor: Actor, body: string, verdict: Verdict | null) {
  const [row] = await getDb().insert(clientComment).values({ releaseId, userId: actor.id, body, verdict }).returning()
  return row
}
