import type { Actor } from '@/lib/actor-core'
import { whoStamp } from '@/lib/actor'
import { appendJobRequest, newRequestId } from '@/lib/job-requests'
import { requireProject } from '@/lib/projects'
import { revalidateProject } from '@/lib/revalidate'
import { getBatches } from '@/lib/store'

/**
 * The body of "approve a priced batch", apart from the guard. Not a Server Action (this file has
 * no 'use server'), so nothing can call it without going through a guarded wrapper:
 * prompts/actions.ts approveBatch for someone who may, the approvals inbox for what was proposed.
 */
export type ApproveBatchPayload = { batchId: string; expectedTotal: number | null }

type Result = { ok: boolean; error?: string }

/** The batch, if it can be approved now; otherwise the reason. */
export async function approvableBatch(project: string, batchId: string) {
  const pr = await requireProject(project)
  const batch = (await getBatches(pr)).find((b) => b.batchId === batchId)
  if (!batch) return { error: 'Unknown batch.' } as const
  if (batch.status !== 'priced') return { error: `This batch is ${batch.status}, so it cannot be approved now.` } as const
  // Nothing spends without a price (the worker refuses it as well).
  if (batch.unpriced > 0) return { error: `${batch.unpriced} row(s) could not be priced. Discard the batch, fix them and submit again.` } as const
  return { pr, batch } as const
}

export async function doApproveBatch(project: string, payload: ApproveBatchPayload, actor: Actor): Promise<Result> {
  const found = await approvableBatch(project, payload.batchId)
  if ('error' in found) return { ok: false, error: found.error }
  const { pr } = found
  await appendJobRequest(pr, {
    id: newRequestId(), ts: new Date().toISOString(), ...whoStamp(actor), type: 'batch.approve', batchId: payload.batchId,
    expectedTotal: payload.expectedTotal == null ? null : Number(payload.expectedTotal),
  })
  revalidateProject(pr.slug)
  return { ok: true }
}
