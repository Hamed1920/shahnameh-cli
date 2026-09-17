'use server'

import { checkRow, isVideoModel, shotRx, toJobInput, type DraftRow, type RowConfig } from '@/lib/batch-rules'
import { DOCUMENT_EXT, MAX_DOCUMENTS, MAX_DOCUMENT_BYTES, documentToText } from '@/lib/documents'
import { REVIEWER, appendJobRequest, newBatchId, newRequestId } from '@/lib/job-requests'
import { requireProject } from '@/lib/projects'
import { revalidateProject } from '@/lib/revalidate'
import { getBatches, getCatalog, getQueue, getWorkerConfig, resolveRefToken } from '@/lib/store'
import { Invalid, parseJsonArray } from '@/lib/uploads'
import type { BatchDefaults, BatchJobInput, QueueItem } from '@/lib/types'

/**
 * Write side of the Prompts page: one append to JOB_REQUESTS.jsonl per
 * submit, approve or discard. The worker validates, prices and (after the
 * approve) queues; the panel never touches QUEUE.jsonl or the registries.
 * Rows are checked here so a mistake comes back to its row; the worker checks
 * everything again.
 */

export interface ExtractedDoc { name: string; text: string }

export async function extractDocuments(formData: FormData): Promise<{ ok: boolean; files?: ExtractedDoc[]; error?: string }> {
  const files = formData.getAll('files').filter((f): f is File => f instanceof File)
  if (files.length === 0) return { ok: false, error: 'No files arrived.' }
  if (files.length > MAX_DOCUMENTS) return { ok: false, error: `At most ${MAX_DOCUMENTS} files at once.` }
  const out: ExtractedDoc[] = []
  for (const f of files) {
    const ext = f.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? ''
    if (!(DOCUMENT_EXT as readonly string[]).includes(ext)) return { ok: false, error: `${f.name}: only ${DOCUMENT_EXT.join(', ')} files.` }
    if (f.size > MAX_DOCUMENT_BYTES) return { ok: false, error: `${f.name}: larger than ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB.` }
    try {
      out.push({ name: f.name, text: await documentToText(f.name, new Uint8Array(await f.arrayBuffer())) })
    } catch (e) {
      return { ok: false, error: `${f.name}: ${(e as Error).message}` }
    }
  }
  return { ok: true, files: out }
}

interface SubmitPayload {
  name: string
  defaults: BatchDefaults
  rows: DraftRow[]
  /** Text the page prepends to every prompt (a document's rules preamble), or null. */
  prefix: string | null
  source: { kind: 'paste' | 'files'; files: string[] }
}

export async function submitBatch(formData: FormData): Promise<{ ok: boolean; batchId?: string; error?: string; rowErrors?: Record<string, string[]> }> {
  const pr = await requireProject(formData.get('project'))
  let payload: SubmitPayload
  try {
    payload = JSON.parse(String(formData.get('payload') ?? ''))
    if (!payload || !Array.isArray(payload.rows) || !payload.defaults) throw new Error()
  } catch {
    return { ok: false, error: 'Malformed request.' }
  }
  if (payload.rows.length === 0) return { ok: false, error: 'Nothing to submit.' }
  if (payload.rows.length > 200) return { ok: false, error: 'At most 200 prompts in one batch.' }

  const [catalog, cfg] = await Promise.all([getCatalog(pr), getWorkerConfig()])
  const rowCfg: RowConfig = { code: pr.code, models: (cfg.models as RowConfig['models']) ?? { image: [], video: [] } }
  const rowErrors: Record<string, string[]> = {}
  for (const row of payload.rows) {
    const problems = checkRow(row, catalog, payload.rows, payload.defaults, rowCfg)
    if (problems.length) rowErrors[row.key] = problems
  }
  if (Object.keys(rowErrors).length) return { ok: false, error: 'Some rows need attention.', rowErrors }

  const prefix = String(payload.prefix ?? '').trim()
  const jobs: BatchJobInput[] = payload.rows.map((row) => {
    const job = toJobInput(row, payload.defaults)
    return prefix ? { ...job, prompt: `${prefix}\n\n${job.prompt}` } : job
  })

  const batchId = newBatchId()
  try {
    await appendJobRequest(pr, {
      id: newRequestId(),
      ts: new Date().toISOString(),
      reviewer: REVIEWER,
      type: 'batch.submit',
      batchId,
      name: String(payload.name ?? '').trim().slice(0, 80) || batchId,
      source: payload.source ?? { kind: 'paste', files: [] },
      defaults: payload.defaults,
      jobs,
    })
  } catch (e) {
    return { ok: false, error: `Could not save the batch: ${(e as Error).message}` }
  }
  revalidateProject(pr.slug)
  return { ok: true, batchId }
}

/**
 * Start a prompt from the library again, from scratch: a one-row batch with
 * whatever the dialog changed. Unlike Regenerate it is a new job (attempt 1,
 * no revision notes carried), and like any batch it is priced by the worker
 * and waits for approval before it spends.
 */
export async function generateFromPrompt(formData: FormData): Promise<{ ok: boolean; batchId?: string; error?: string }> {
  const pr = await requireProject(formData.get('project'))
  const jobId = String(formData.get('jobId') ?? '').trim()
  const [queue, catalog, cfg] = await Promise.all([getQueue(pr), getCatalog(pr), getWorkerConfig()])
  const src = queue.find((q) => q.jobId === jobId) as (QueueItem & { label?: string | null }) | undefined
  if (!src) return { ok: false, error: `Job ${jobId || '(none)'} is not in the queue file.` }

  let job: BatchJobInput
  let defaults: BatchDefaults
  try {
    const target = src.target
    if (!shotRx(pr.code).test(target) && !catalog.some((e) => e.id === target)) {
      throw new Invalid(`${target} is not a live entity or a shot any more, so it cannot be generated for.`)
    }

    const prompt = String(formData.get('prompt') ?? '').trim()
    if (!prompt) throw new Invalid('The prompt cannot be empty.')

    const models = (cfg.models as { image?: string[]; video?: string[] } | undefined) ?? {}
    const known = [...(models.image ?? []), ...(models.video ?? [])]
    const model = String(formData.get('model') ?? '').trim()
    if (!model) throw new Invalid('Choose a model.')
    if (known.length && !known.includes(model)) throw new Invalid(`Model ${model} is not in the worker's list.`)

    const variant = String(formData.get('variant') ?? '').trim().toUpperCase()
    if (variant && !/^V\d{2}$/.test(variant)) throw new Invalid('A look is V01, V02, ...')

    const refs = (parseJsonArray(formData, 'refs') ?? []).map((r) => String(r ?? '').trim()).filter(Boolean)
    if (refs.length > 12) throw new Invalid('At most 12 references.')
    for (const token of refs) {
      if (!token.startsWith('@') || !(await resolveRefToken(pr, token))) throw new Invalid(`Reference ${token} does not resolve to a file in the index.`)
    }

    const aspect = String(formData.get('aspect_ratio') ?? '').trim() || '16:9'
    const allowed = (cfg.aspectRatios as string[] | undefined) ?? []
    if (allowed.length && !allowed.includes(aspect)) throw new Invalid(`Aspect ratio ${aspect} is not in the worker's list.`)

    const video = isVideoModel(model)
    const stage = formData.get('stage') === 'final' ? 'final' : 'draft'
    const duration = Number(formData.get('duration') ?? '') || Number(cfg.videoDuration ?? 15)
    const sound = formData.get('sound') === 'on'
    const params: BatchJobInput['params'] = { aspect_ratio: aspect }
    if (video) {
      params.duration = duration
      params.generate_audio = sound
      // Stated outright: a final queued as a batch row would otherwise get the model's own default.
      const resolution = stage === 'final' ? cfg.videoFinalResolution : cfg.videoDraftResolution
      if (resolution) params.resolution = String(resolution)
    }

    job = {
      key: 'r1',
      label: src.label ?? null,
      target,
      variant: variant || null,
      model,
      stage: video ? stage : null,
      refs: [...new Set(refs)],
      params,
      prompt,
    }
    defaults = { model, aspect_ratio: aspect, duration, stage, generate_audio: sound }
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message }
    throw e
  }

  const batchId = newBatchId()
  await appendJobRequest(pr, {
    id: newRequestId(),
    ts: new Date().toISOString(),
    reviewer: REVIEWER,
    type: 'batch.submit',
    batchId,
    name: `${src.label || src.target} · from scratch`.slice(0, 80),
    source: { kind: 'library', files: [src.jobId] },
    defaults,
    jobs: [job],
  })
  revalidateProject(pr.slug)
  return { ok: true, batchId }
}

export async function approveBatch(project: string, batchId: string, expectedTotal: number | null): Promise<{ ok: boolean; error?: string }> {
  const pr = await requireProject(project)
  const batch = (await getBatches(pr)).find((b) => b.batchId === batchId)
  if (!batch) return { ok: false, error: 'Unknown batch.' }
  if (batch.status !== 'priced') return { ok: false, error: `This batch is ${batch.status}, so it cannot be approved now.` }
  await appendJobRequest(pr, {
    id: newRequestId(), ts: new Date().toISOString(), reviewer: REVIEWER, type: 'batch.approve', batchId,
    expectedTotal: expectedTotal == null ? null : Number(expectedTotal),
  })
  revalidateProject(pr.slug)
  return { ok: true }
}

export async function discardBatch(project: string, batchId: string): Promise<{ ok: boolean; error?: string }> {
  const pr = await requireProject(project)
  const batch = (await getBatches(pr)).find((b) => b.batchId === batchId)
  if (!batch) return { ok: false, error: 'Unknown batch.' }
  if (batch.status === 'queued' || batch.status === 'discarded') return { ok: false, error: `This batch is already ${batch.status}.` }
  await appendJobRequest(pr, { id: newRequestId(), ts: new Date().toISOString(), reviewer: REVIEWER, type: 'batch.discard', batchId })
  revalidateProject(pr.slug)
  return { ok: true }
}
