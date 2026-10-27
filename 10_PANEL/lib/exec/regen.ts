import fs from 'node:fs/promises'
import path from 'node:path'
import type { Actor } from '@/lib/actor-core'
import { whoStamp } from '@/lib/actor'
import { freshCatalog } from '@/lib/catalog'
import { checkRefCount, readGenerationForm } from '@/lib/generation-form'
import { appendJobRequest, newRequestId } from '@/lib/job-requests'
import { requireProject } from '@/lib/projects'
import { revalidateProject } from '@/lib/revalidate'
import { getDecisions, getWorkerConfig, getWorkerState, referenceResolver } from '@/lib/store'
import { Invalid, parseJsonArray, readUploads, type PendingUpload } from '@/lib/uploads'
import type { JobRequest } from '@/lib/types'

/**
 * The body of "regenerate an accepted take", apart from the guard (see lib/exec/batch.ts).
 * `form` is the dialog's form; one that waited in the approvals inbox is rebuilt from its stored fields.
 */
export async function doRequestRegenerate(project: string, formData: FormData, actor: Actor): Promise<{ ok: boolean; error?: string }> {
  const pr = await requireProject(project)
  freshCatalog()
  const jobId = String(formData.get('jobId') ?? '').trim()
  const decisionId = String(formData.get('decisionId') ?? '').trim()
  // From Review's history, any attempt can be continued from, whatever became of it: it need not be an accepted take.
  const fromHistory = formData.get('from') === 'history'
  if (!jobId || (!decisionId && !fromHistory)) return { ok: false, error: 'Missing job.' }

  const [decisions, state, cfg] = await Promise.all([getDecisions(pr), getWorkerState(pr), getWorkerConfig()])
  const d = decisions.find((x) => x.id === decisionId)
  if (fromHistory) {
    if (decisionId && d && d.jobId !== jobId) return { ok: false, error: 'Unknown decision.' }
  } else {
    if (!d || d.jobId !== jobId) return { ok: false, error: 'Unknown decision.' }
    if (d.verdict !== 'accepted') return { ok: false, error: 'Only an accepted take can be regenerated from here.' }
    const failed = (state?.failedDecisions ?? {}) as Record<string, string>
    if (failed[d.id]) return { ok: false, error: 'This decision was not applied; decide it again on Review first.' }
  }

  const req: Extract<JobRequest, { type: 'regenerate' }> = {
    id: newRequestId(), ts: new Date().toISOString(), ...whoStamp(actor), type: 'regenerate', jobId, decisionId,
  }
  let uploads: PendingUpload[] = []
  try {
    const note = String(formData.get('note') ?? '').trim().slice(0, 2000)
    if (note) req.note = note

    const prompt = String(formData.get('prompt') ?? '').trim()
    if (!prompt) throw new Invalid('The prompt cannot be empty.')
    req.prompt = prompt

    uploads = await readUploads(pr, formData, req.id)
    const uploadIds = new Set(uploads.map((u) => u.meta.id))
    if (uploads.length) req.uploads = uploads.map((u) => u.meta)

    const refs = (parseJsonArray(formData, 'refs') ?? []).map((r) => String(r ?? '').trim()).filter(Boolean)
    const form = readGenerationForm(formData, cfg)
    checkRefCount(form.model, new Set(refs).size)
    const resolve = await referenceResolver(pr)
    for (const token of refs) {
      if (token.startsWith('upload:')) {
        if (!uploadIds.has(token.slice(7))) throw new Invalid(`Reference ${token} has no matching upload.`)
        continue
      }
      if (!token.startsWith('@')) throw new Invalid(`Reference ${token} is not an @-token.`)
      const r = await resolve(token)
      if (!r.path) throw new Invalid(`Reference ${token}: ${r.stale ?? 'does not resolve to a file in the index'}.`)
    }
    req.refs = [...new Set(refs)]

    // "@upload:u2" in the prompt or note has to be an image this request carries.
    for (const m of `${prompt}\n${note}`.matchAll(/@upload:(u\d{1,3})(?![\w/-])/g)) {
      if (!uploadIds.has(m[1])) throw new Invalid(`${m[0]} is not one of the images added here.`)
    }

    req.model = form.model

    const variant = String(formData.get('variant') ?? '').trim().toUpperCase()
    if (variant && !/^V\d{2}$/.test(variant)) throw new Invalid('A look is V01, V02, ...')
    if (variant) req.variant = variant

    if (form.stage) req.stage = form.stage
    if (form.sound !== null) req.sound = form.sound
    if (Object.keys(form.params).length) req.params = form.params
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message }
    throw e
  }

  // Files first, request second: the worker must never see a request whose upload is not on disk.
  const dir = path.join(pr.P.uploads, req.id)
  try {
    if (uploads.length) {
      await fs.mkdir(dir, { recursive: true })
      for (const u of uploads) await fs.writeFile(path.join(pr.root, u.meta.file), u.bytes)
    }
    await appendJobRequest(pr, req)
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true })
    return { ok: false, error: `Could not save the request: ${(e as Error).message}` }
  }
  revalidateProject(pr.slug)
  return { ok: true }
}
