'use server'

import { checkRow, shotRx, toJobInput, type DraftRow, type RowConfig } from '@/lib/batch-rules'
import { checkRefCount, readGenerationForm } from '@/lib/generation-form'
import { freshCatalog } from '@/lib/catalog'
import { stageResolutionFor } from '@/lib/models'
import { DOCUMENT_EXT, MAX_DOCUMENTS, MAX_DOCUMENT_BYTES, documentToText } from '@/lib/documents'
import { REVIEWER, appendJobRequest, newBatchId, newRequestId } from '@/lib/job-requests'
import { requireProject } from '@/lib/projects'
import { revalidateProject } from '@/lib/revalidate'
import { getBatches, getCatalog, getQueue, getShotMoves, getWorkerConfig, readJsonl, resolveRefToken } from '@/lib/store'
import fs from 'node:fs/promises'
import path from 'node:path'
import { MAX_ADD_TOTAL_BYTES, MAX_ADD_UPLOADS } from '@/lib/indexing'
import { Invalid, parseJsonArray, readUploads, type PendingUpload } from '@/lib/uploads'
import type { BatchDefaults, BatchJobInput, JobRequestEvent, QueueItem } from '@/lib/types'

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

/** Ask the worker to fetch the Higgsfield model list again. Free: it only reads `model list` / `model get`. */
export async function refreshModels(project: string): Promise<{ ok: boolean; reqId?: string; error?: string }> {
  const pr = await requireProject(project)
  const reqId = newRequestId()
  await appendJobRequest(pr, { id: reqId, ts: new Date().toISOString(), reviewer: REVIEWER, type: 'models.refresh' })
  revalidateProject(pr.slug)
  return { ok: true, reqId }
}

/**
 * What became of a "Refresh models" request: done (with the count), refused (the
 * CLI could not list models, say, with no workspace selected), still trying
 * (with the latest reason), or not picked up yet.
 */
export async function modelRefreshResult(project: string, reqId: string): Promise<
  { state: 'done'; count: number; usable: number } | { state: 'failed' | 'retrying'; reason: string } | { state: 'waiting' }
> {
  const pr = await requireProject(project)
  const events = (await readJsonl<JobRequestEvent>(pr.P.jobRequestResults)).filter((e) => e.reqId === reqId)
  const done = events.find((e) => e.event === 'models')
  if (done && done.event === 'models') return { state: 'done', count: done.count, usable: done.usable }
  const refused = events.find((e) => e.event === 'rejected')
  if (refused && refused.event === 'rejected') return { state: 'failed', reason: refused.reason }
  const trying = [...events].reverse().find((e) => e.event === 'error')
  if (trying && trying.event === 'error') return { state: 'retrying', reason: trying.reason }
  return { state: 'waiting' }
}

interface SubmitPayload {
  name: string
  defaults: BatchDefaults
  rows: DraftRow[]
  /** Text prepended to every prompt, or null. Older pages; `prefixes` wins when given. */
  prefix: string | null
  /** Per row: the rules preamble of the document that row came from, prepended to that row only. */
  prefixes?: Record<string, string>

  source: { kind: 'paste' | 'files'; files: string[] }
}

export async function submitBatch(formData: FormData): Promise<{ ok: boolean; batchId?: string; error?: string; rowErrors?: Record<string, string[]> }> {
  const pr = await requireProject(formData.get('project'))
  freshCatalog()
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
  const rowCfg: RowConfig = { code: pr.code, pinned: (cfg.pinnedModels as string[] | undefined) ?? [] }
  const rowErrors: Record<string, string[]> = {}
  for (const row of payload.rows) {
    const problems = checkRow(row, catalog, payload.rows, payload.defaults, rowCfg)
    if (problems.length) rowErrors[row.key] = problems
  }
  if (Object.keys(rowErrors).length) return { ok: false, error: 'Some rows need attention.', rowErrors }

  const shared = String(payload.prefix ?? '').trim()
  const jobs: BatchJobInput[] = payload.rows.map((row) => {
    const job = toJobInput(row, payload.defaults)
    const prefix = payload.prefixes ? String(payload.prefixes[row.key] ?? '').trim() : shared
    return prefix ? { ...job, prompt: `${prefix}\n\n${job.prompt}` } : job
  })

  // Files added to rows: checked like any upload, and every one a row names must have arrived.
  const requestId = newRequestId()
  let uploads: PendingUpload[] = []
  try {
    uploads = await readUploads(pr, formData, requestId, { max: MAX_ADD_UPLOADS, maxTotalBytes: MAX_ADD_TOTAL_BYTES })
    const ids = new Set(uploads.map((u) => u.meta.id))
    for (const job of jobs) {
      for (const t of job.refs) {
        if (t.startsWith('upload:') && !ids.has(t.slice(7))) throw new Invalid(`${job.label || job.key}: the file ${t} did not arrive. Add it again.`)
      }
    }
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message }
    throw e
  }

  const batchId = newBatchId()
  // Files first, request second: the worker must never see a request whose upload is not on disk.
  const dir = path.join(pr.P.uploads, requestId)
  try {
    if (uploads.length) {
      await fs.mkdir(dir, { recursive: true })
      for (const u of uploads) await fs.writeFile(path.join(pr.root, u.meta.file), u.bytes)
    }
    await appendJobRequest(pr, {
      id: requestId,
      ...(uploads.length && { uploads: uploads.map((u) => u.meta) }),
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
    await fs.rm(dir, { recursive: true, force: true })
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
  freshCatalog()
  const jobId = String(formData.get('jobId') ?? '').trim()
  const [queue, catalog, cfg, moves] = await Promise.all([getQueue(pr), getCatalog(pr), getWorkerConfig(), getShotMoves(pr)])
  const src = queue.find((q) => q.jobId === jobId) as (QueueItem & { label?: string | null }) | undefined
  if (!src) return { ok: false, error: `Job ${jobId || '(none)'} is not in the queue file.` }

  let job: BatchJobInput
  let defaults: BatchDefaults
  try {
    // Where the footage is now: a shot moved to another episode is generated there, not at its old id.
    const target = moves.shot[src.target] ?? src.target
    if (!shotRx(pr.code).test(target) && !catalog.some((e) => e.id === target)) {
      throw new Invalid(`${target} is not a live entity or a shot any more, so it cannot be generated for.`)
    }

    const prompt = String(formData.get('prompt') ?? '').trim()
    if (!prompt) throw new Invalid('The prompt cannot be empty.')

    const form = readGenerationForm(formData, cfg)
    const model = form.model

    const variant = String(formData.get('variant') ?? '').trim().toUpperCase()
    if (variant && !/^V\d{2}$/.test(variant)) throw new Invalid('A look is V01, V02, ...')

    const refs = (parseJsonArray(formData, 'refs') ?? []).map((r) => String(r ?? '').trim()).filter(Boolean)
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

    job = {
      key: 'r1',
      label: src.label ?? null,
      target,
      variant: variant || null,
      model,
      stage: form.stage,
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
  // Nothing spends without a price (the worker refuses it as well).
  if (batch.unpriced > 0) return { ok: false, error: `${batch.unpriced} row(s) could not be priced. Discard the batch, fix them and submit again.` }
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
