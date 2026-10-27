// The approvals inbox (database). Server only, and only loaded with SHM_AUTH=on:
// import it dynamically behind authEnabled() / mode === 'propose'.
import { and, desc, eq, ne, sql } from 'drizzle-orm'
import type { Actor } from './actor-core.ts'
import { getDb } from './db/client.ts'
import { approvalRequest, user } from './db/schema.ts'

export type ApprovalRow = typeof approvalRequest.$inferSelect
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed'

/** Ask the owner. Nothing runs and nothing is written to the project's files. */
export async function createApproval(
  project: string, cap: string, summary: string, payload: unknown, actor: Actor,
): Promise<ApprovalRow> {
  const [row] = await getDb().insert(approvalRequest).values({
    projectSlug: project, capability: cap, summary: summary.slice(0, 300), payload: payload ?? null, requestedBy: actor.id,
  }).returning()
  return row
}

export async function getApproval(id: string): Promise<ApprovalRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const [row] = await getDb().select().from(approvalRequest).where(eq(approvalRequest.id, id)).limit(1)
  return row ?? null
}

/** Newest first, with the requester's name. `status` narrows; 'decided' is everything but pending. */
export async function listApprovals(project: string, status?: ApprovalStatus | 'decided', limit = 100) {
  const base = eq(approvalRequest.projectSlug, project)
  const where = !status ? base
    : status === 'decided' ? and(base, ne(approvalRequest.status, 'pending'))
    : and(base, eq(approvalRequest.status, status))
  return getDb()
    .select({ a: approvalRequest, requester: user.name })
    .from(approvalRequest)
    .innerJoin(user, eq(user.id, approvalRequest.requestedBy))
    .where(where)
    .orderBy(desc(approvalRequest.createdAt))
    .limit(limit)
}

export async function countPending(project: string): Promise<number> {
  const [r] = await getDb().select({ n: sql<number>`count(*)::int` }).from(approvalRequest)
    .where(and(eq(approvalRequest.projectSlug, project), eq(approvalRequest.status, 'pending')))
  return r?.n ?? 0
}

/** Decide a pending request. Null when it was not pending (decided already, by someone else). */
export async function decideApproval(id: string, owner: Actor, decision: 'approved' | 'rejected'): Promise<ApprovalRow | null> {
  const [row] = await getDb().update(approvalRequest)
    .set({ status: decision, decidedBy: owner.id, decidedAt: new Date() })
    .where(and(eq(approvalRequest.id, id), eq(approvalRequest.status, 'pending')))
    .returning()
  return row ?? null
}

export async function markExecuted(id: string, result: unknown): Promise<void> {
  await getDb().update(approvalRequest).set({ status: 'executed', result: result ?? null, error: null }).where(eq(approvalRequest.id, id))
}

export async function markFailed(id: string, error: string): Promise<void> {
  await getDb().update(approvalRequest).set({ status: 'failed', error: error.slice(0, 1000) }).where(eq(approvalRequest.id, id))
}
