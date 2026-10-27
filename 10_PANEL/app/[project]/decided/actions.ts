'use server'

import { gateMode } from '@/lib/actor'
import { regenerateSummary } from '@/lib/approval-summary'
import { doRequestRegenerate } from '@/lib/exec/regen'
import { formToFields } from '@/lib/form-payload'
import { proposeApproval } from '@/lib/propose'

/**
 * Regenerate an accepted take: one append to JOB_REQUESTS.jsonl, plus any
 * images added in the dialog dropped raw into 09_OUTPUT/_uploads/<request id>/
 * for the worker to file (the same exception Review and References use). The
 * dialog may change the prompt, references, model, first render, look, aspect
 * ratio, duration and sound; the worker re-queues the job with those
 * overrides as a new attempt, and the result comes back to Review like any
 * other take. Everything is checked here so a mistake shows in the dialog;
 * the worker checks the references again before it queues anything.
 */
export async function requestRegenerate(formData: FormData): Promise<{ ok: boolean; error?: string; pending?: boolean; message?: string }> {
  const project = String(formData.get('project') ?? '')
  const g = await gateMode(project, 'regen.spend')
  if (!g.ok) return { ok: false, error: g.error }
  if (g.mode === 'propose') {
    // Images added in the dialog cannot be stored with a request, so those are not routable yet.
    const fields = formToFields(formData)
    if (!fields) return { ok: false, error: 'Images added to a regeneration cannot be sent for approval yet. Remove them, or ask Hamed.' }
    const summary = regenerateSummary({ jobId: String(formData.get('jobId') ?? ''), decisionId: String(formData.get('decisionId') ?? '') || undefined })
    return proposeApproval(project, 'regen.spend', summary, { fields }, g.actor)
  }
  return doRequestRegenerate(project, formData, g.actor)
}
