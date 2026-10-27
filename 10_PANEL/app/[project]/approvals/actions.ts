'use server'

import { revalidatePath } from 'next/cache'
import { authEnabled } from '@/lib/actor-core'
import { gate } from '@/lib/actor'
import { executeApproval } from '@/lib/approval-exec'

/**
 * The owner's decisions on what agents asked for. Approve runs the stored request as the owner
 * and records what happened on the row; Reject just closes it. Nothing here appends anything
 * of its own: the work is the matching doX in lib/exec/*, exactly as if the owner had clicked.
 */
type Result = { ok: boolean; error?: string }

export async function approveRequest(project: string, id: string): Promise<Result> {
  const g = await gate(project, 'approval.decide')
  if (!g.ok) return { ok: false, error: g.error }
  if (!authEnabled()) return { ok: false, error: 'Approvals need login to be on.' }
  const approvals = await import('@/lib/approvals')
  const row = await approvals.getApproval(id)
  if (!row || row.projectSlug !== project) return { ok: false, error: 'No such request.' }
  const decided = await approvals.decideApproval(id, g.actor, 'approved')
  if (!decided) return { ok: false, error: 'This request was already decided.' }

  const res = await executeApproval(row.capability, row.projectSlug, row.payload, g.actor)
  if (res.ok) await approvals.markExecuted(id, { ok: true, approvalId: id })
  else await approvals.markFailed(id, res.error ?? 'It failed.')
  revalidatePath(`/${project}/approvals`)
  return res.ok ? { ok: true } : { ok: false, error: res.error }
}

export async function rejectRequest(project: string, id: string): Promise<Result> {
  const g = await gate(project, 'approval.decide')
  if (!g.ok) return { ok: false, error: g.error }
  if (!authEnabled()) return { ok: false, error: 'Approvals need login to be on.' }
  const approvals = await import('@/lib/approvals')
  const row = await approvals.getApproval(id)
  if (!row || row.projectSlug !== project) return { ok: false, error: 'No such request.' }
  const decided = await approvals.decideApproval(id, g.actor, 'rejected')
  if (!decided) return { ok: false, error: 'This request was already decided.' }
  revalidatePath(`/${project}/approvals`)
  return { ok: true }
}
