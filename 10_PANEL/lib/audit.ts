// The Activity Log (database). Server only, and only loaded with SHM_AUTH=on:
// import it dynamically behind authEnabled(), like lib/approvals.ts.
import { desc, eq } from 'drizzle-orm'
import type { Actor } from './actor-core.ts'
import { getDb } from './db/client.ts'
import { auditLog } from './db/schema.ts'

export type AuditRow = typeof auditLog.$inferSelect

/**
 * Record one important action: who, what, on which object, and what changed. Append only:
 * nothing updates or deletes a row. `tx` lets a caller log inside its own transaction, so the
 * action and its log line land together or not at all.
 */
export async function audit(
  entry: {
    project: string | null
    actor: Actor
    action: string
    objectType: string
    objectId: string
    detail?: unknown
  },
  tx: Pick<ReturnType<typeof getDb>, 'insert'> = getDb(),
): Promise<void> {
  await tx.insert(auditLog).values({
    projectSlug: entry.project,
    actorId: entry.actor.id,
    actorName: entry.actor.name,
    action: entry.action,
    objectType: entry.objectType,
    objectId: entry.objectId,
    detail: entry.detail ?? null,
  })
}

/** Newest first. */
export async function listAudit(project: string, limit = 200): Promise<AuditRow[]> {
  return getDb().select().from(auditLog).where(eq(auditLog.projectSlug, project)).orderBy(desc(auditLog.createdAt)).limit(limit)
}
