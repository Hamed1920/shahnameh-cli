'use server'

import { isVideoModel } from '@/lib/batch-rules'
import { REVIEWER, appendJobRequest, newRequestId } from '@/lib/job-requests'
import { requireProject } from '@/lib/projects'
import { revalidateProject } from '@/lib/revalidate'
import { getDecisions, getWorkerConfig, getWorkerState, resolveRefToken } from '@/lib/store'
import { Invalid, parseJsonArray } from '@/lib/uploads'
import type { JobRequest } from '@/lib/types'

/**
 * Regenerate an accepted take: one append to JOB_REQUESTS.jsonl. The dialog
 * may change the prompt, references, model, first render, look, aspect
 * ratio, duration and sound; the worker re-queues the job with those
 * overrides as a new attempt, and the result comes back to Review like any
 * other take. Everything is checked here so a mistake shows in the dialog;
 * the worker checks the references again before it queues anything.
 */
export async function requestRegenerate(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const pr = await requireProject(formData.get('project'))
  const jobId = String(formData.get('jobId') ?? '').trim()
  const decisionId = String(formData.get('decisionId') ?? '').trim()
  if (!jobId || !decisionId) return { ok: false, error: 'Missing job.' }

  const [decisions, state, cfg] = await Promise.all([getDecisions(pr), getWorkerState(pr), getWorkerConfig()])
  const d = decisions.find((x) => x.id === decisionId)
  if (!d || d.jobId !== jobId) return { ok: false, error: 'Unknown decision.' }
  if (d.verdict !== 'accepted') return { ok: false, error: 'Only an accepted take can be regenerated from here.' }
  const failed = (state?.failedDecisions ?? {}) as Record<string, string>
  if (failed[d.id]) return { ok: false, error: 'This decision was not applied; decide it again on Review first.' }

  const req: Extract<JobRequest, { type: 'regenerate' }> = {
    id: newRequestId(), ts: new Date().toISOString(), reviewer: REVIEWER, type: 'regenerate', jobId, decisionId,
  }
  try {
    const note = String(formData.get('note') ?? '').trim().slice(0, 2000)
    if (note) req.note = note

    const prompt = String(formData.get('prompt') ?? '').trim()
    if (!prompt) throw new Invalid('The prompt cannot be empty.')
    req.prompt = prompt

    const refs = (parseJsonArray(formData, 'refs') ?? []).map((r) => String(r ?? '').trim()).filter(Boolean)
    if (refs.length > 12) throw new Invalid('At most 12 references.')
    for (const token of refs) {
      if (!token.startsWith('@') || !(await resolveRefToken(pr, token))) throw new Invalid(`Reference ${token} does not resolve to a file in the index.`)
    }
    req.refs = [...new Set(refs)]

    const models = (cfg.models as { image?: string[]; video?: string[] } | undefined) ?? {}
    const known = [...(models.image ?? []), ...(models.video ?? [])]
    const model = String(formData.get('model') ?? '').trim()
    if (!model) throw new Invalid('Choose a model.')
    if (known.length && !known.includes(model)) throw new Invalid(`Model ${model} is not in the worker's list.`)
    req.model = model

    const variant = String(formData.get('variant') ?? '').trim().toUpperCase()
    if (variant && !/^V\d{2}$/.test(variant)) throw new Invalid('A look is V01, V02, ...')
    if (variant) req.variant = variant

    const params: Record<string, string | number | boolean> = {}
    const aspect = String(formData.get('aspect_ratio') ?? '').trim()
    if (aspect) {
      const allowed = (cfg.aspectRatios as string[] | undefined) ?? []
      if (allowed.length && !allowed.includes(aspect)) throw new Invalid(`Aspect ratio ${aspect} is not in the worker's list.`)
      params.aspect_ratio = aspect
    }
    if (isVideoModel(model)) {
      const stage = String(formData.get('stage') ?? '')
      if (stage === 'draft' || stage === 'final') req.stage = stage
      const duration = Number(formData.get('duration') ?? '')
      if (Number.isFinite(duration) && duration > 0) params.duration = duration
      req.sound = formData.get('sound') === 'on'
    }
    if (Object.keys(params).length) req.params = params
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message }
    throw e
  }

  await appendJobRequest(pr, req)
  revalidateProject(pr.slug)
  return { ok: true }
}
