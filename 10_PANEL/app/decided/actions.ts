'use server'

import { revalidatePath } from 'next/cache'
import { REVIEWER, appendJobRequest, newRequestId } from '@/lib/job-requests'
import { getDecisions, getWorkerState } from '@/lib/store'

/**
 * Regenerate an accepted take: one append to JOB_REQUESTS.jsonl. The worker
 * re-queues the same job (prompt, references, parameters, stage) as a new
 * attempt; the result comes back to Review like any other take.
 */
export async function requestRegenerate(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const jobId = String(formData.get('jobId') ?? '').trim()
  const decisionId = String(formData.get('decisionId') ?? '').trim()
  const note = String(formData.get('note') ?? '').trim().slice(0, 2000)
  const sound = formData.get('sound') === 'on'
  if (!jobId || !decisionId) return { ok: false, error: 'Missing job.' }

  const [decisions, state] = await Promise.all([getDecisions(), getWorkerState()])
  const d = decisions.find((x) => x.id === decisionId)
  if (!d || d.jobId !== jobId) return { ok: false, error: 'Unknown decision.' }
  if (d.verdict !== 'accepted') return { ok: false, error: 'Only an accepted take can be regenerated from here.' }
  const failed = (state?.failedDecisions ?? {}) as Record<string, string>
  if (failed[d.id]) return { ok: false, error: 'This decision was not applied; decide it again on Review first.' }

  await appendJobRequest({
    id: newRequestId(), ts: new Date().toISOString(), reviewer: REVIEWER, type: 'regenerate',
    jobId, decisionId, ...(note && { note }), sound,
  })
  revalidatePath('/decided')
  revalidatePath('/queue')
  return { ok: true }
}
