'use server'

import { revalidatePath } from 'next/cache'
import { checkRow, toJobInput, type DraftRow, type RowConfig } from '@/lib/batch-rules'
import { DOCUMENT_EXT, MAX_DOCUMENTS, MAX_DOCUMENT_BYTES, documentToText } from '@/lib/documents'
import { REVIEWER, appendJobRequest, newBatchId, newRequestId } from '@/lib/job-requests'
import { getBatches, getCatalog, getWorkerConfig } from '@/lib/store'
import type { BatchDefaults, BatchJobInput } from '@/lib/types'

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
  let payload: SubmitPayload
  try {
    payload = JSON.parse(String(formData.get('payload') ?? ''))
    if (!payload || !Array.isArray(payload.rows) || !payload.defaults) throw new Error()
  } catch {
    return { ok: false, error: 'Malformed request.' }
  }
  if (payload.rows.length === 0) return { ok: false, error: 'Nothing to submit.' }
  if (payload.rows.length > 200) return { ok: false, error: 'At most 200 prompts in one batch.' }

  const [catalog, cfg] = await Promise.all([getCatalog(), getWorkerConfig()])
  const rowCfg: RowConfig = { models: (cfg.models as RowConfig['models']) ?? { image: [], video: [] } }
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
    await appendJobRequest({
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
  revalidatePath('/prompts')
  return { ok: true, batchId }
}

export async function approveBatch(batchId: string, expectedTotal: number | null): Promise<{ ok: boolean; error?: string }> {
  const batch = (await getBatches()).find((b) => b.batchId === batchId)
  if (!batch) return { ok: false, error: 'Unknown batch.' }
  if (batch.status !== 'priced') return { ok: false, error: `This batch is ${batch.status}, so it cannot be approved now.` }
  await appendJobRequest({
    id: newRequestId(), ts: new Date().toISOString(), reviewer: REVIEWER, type: 'batch.approve', batchId,
    expectedTotal: expectedTotal == null ? null : Number(expectedTotal),
  })
  revalidatePath('/prompts')
  return { ok: true }
}

export async function discardBatch(batchId: string): Promise<{ ok: boolean; error?: string }> {
  const batch = (await getBatches()).find((b) => b.batchId === batchId)
  if (!batch) return { ok: false, error: 'Unknown batch.' }
  if (batch.status === 'queued' || batch.status === 'discarded') return { ok: false, error: `This batch is already ${batch.status}.` }
  await appendJobRequest({ id: newRequestId(), ts: new Date().toISOString(), reviewer: REVIEWER, type: 'batch.discard', batchId })
  revalidatePath('/prompts')
  return { ok: true }
}
