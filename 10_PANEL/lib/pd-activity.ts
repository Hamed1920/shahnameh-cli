// The Activity Log read for the owner's page. Server only, database (SHM_AUTH=on).
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import { getDb } from './db/client.ts'
import { auditLog } from './db/schema.ts'

export type ActivityQuery = { project: string; action?: string; actor?: string; object?: string; limit: number; offset: number }

const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

/** Newest first. `action` matches the exact action or its prefix ("user" matches "user.role"). */
export async function queryAudit(q: ActivityQuery) {
  const where = and(
    // Account changes belong to no project; the owner sees them in every project's log.
    or(eq(auditLog.projectSlug, q.project), isNull(auditLog.projectSlug)),
    q.action ? sql`(${auditLog.action} = ${q.action} or ${auditLog.action} like ${like(q.action).slice(1, -1) + '.%'})` : undefined,
    q.actor ? ilike(auditLog.actorName, like(q.actor)) : undefined,
    q.object ? ilike(auditLog.objectId, like(q.object)) : undefined,
  )
  // One extra row says whether there is a next page.
  const rows = await getDb().select().from(auditLog).where(where).orderBy(desc(auditLog.createdAt)).limit(q.limit + 1).offset(q.offset)
  return { rows: rows.slice(0, q.limit), more: rows.length > q.limit }
}

/** The distinct actions this project has logged, for the filter. */
export async function auditActions(project: string): Promise<string[]> {
  const r = await getDb().selectDistinct({ a: auditLog.action }).from(auditLog).where(or(eq(auditLog.projectSlug, project), isNull(auditLog.projectSlug))).orderBy(auditLog.action)
  return r.map((x) => x.a)
}
