import { whoStamp } from './actor'
import type { Actor } from './actor-core'
import { checkRefCount, readGenerationForm } from './generation-form'
import { appendJobRequest, newBatchId, newRequestId } from './job-requests'
import { stageResolutionFor } from './models'
import type { Project } from './projects'
import { resolveRefToken } from './store'
import { Invalid, parseJsonArray } from './uploads'
import type { BatchDefaults, BatchJobInput } from './types'

/**
 * The one-row batch behind "Generate from scratch" (Prompts page) and a block's Generate button:
 * the generation form (model, aspect, stage, duration, sound, model settings) turned into a job,
 * and the job sent as a batch.submit request. Shared, not 'use server': each caller is its own
 * Server Action and has already checked its capability. Throws Invalid with a sentence for the form.
 */
export function buildGenerateRow(
  pr: Project,
  formData: FormData,
  cfg: Record<string, unknown>,
  row: {
    target: string
    label: string | null
    prompt: string
    /** Absent: read from the form's `refs` field (a JSON list of @tokens). */
    refs?: string[]
  },
): Promise<{ job: BatchJobInput; defaults: BatchDefaults }> {
  return (async () => {
    const form = readGenerationForm(formData, cfg)
    const model = form.model

    const variant = String(formData.get('variant') ?? '').trim().toUpperCase()
    if (variant && !/^V\d{2}$/.test(variant)) throw new Invalid('A look is V01, V02, ...')

    const refs = (row.refs ?? parseJsonArray(formData, 'refs') ?? []).map((r) => String(r ?? '').trim()).filter(Boolean)
    checkRefCount(model, new Set(refs).size)
    for (const token of refs) {
      if (!token.startsWith('@') || !(await resolveRefToken(pr, token))) throw new Invalid(`Reference ${token} does not resolve to a file in the index.`)
    }

    const video = form.video
    const aspect = String(form.params.aspect_ratio ?? '16:9')
    const stage = form.stage ?? 'draft'
    const duration = Number(form.params.duration ?? '') || Number(cfg.videoDuration ?? 15)
    const sound = form.sound ?? false
    const params: BatchJobInput['params'] = { ...form.params, aspect_ratio: aspect }
    if (video) {
      if (form.sound !== null) params.generate_audio = sound
      // Stated outright: a final queued as a batch row would otherwise get the model's own default.
      const resolution = form.stage ? stageResolutionFor(model, stage, {
        videoDraftResolution: String(cfg.videoDraftResolution), videoFinalResolution: String(cfg.videoFinalResolution),
      }) : null
      if (resolution) params.resolution = resolution
    }

    const job: BatchJobInput = {
      key: 'r1',
      label: row.label,
      target: row.target,
      variant: variant || null,
      model,
      stage: form.stage,
      refs: [...new Set(refs)],
      params,
      prompt: row.prompt,
    }
    return { job, defaults: { model, aspect_ratio: aspect, duration, stage, generate_audio: sound } }
  })()
}

/** Append the one-row batch.submit request. The worker validates and prices it; nothing spends until it is approved. */
export async function submitOneRowBatch(
  pr: Project,
  actor: Actor,
  batch: { name: string; source: { kind: 'paste' | 'files' | 'library'; files: string[] }; defaults: BatchDefaults; job: BatchJobInput },
): Promise<string> {
  const batchId = newBatchId()
  await appendJobRequest(pr, {
    id: newRequestId(),
    ts: new Date().toISOString(),
    ...whoStamp(actor),
    type: 'batch.submit',
    batchId,
    name: batch.name.slice(0, 80),
    source: batch.source,
    defaults: batch.defaults,
    jobs: [batch.job],
  })
  return batchId
}
