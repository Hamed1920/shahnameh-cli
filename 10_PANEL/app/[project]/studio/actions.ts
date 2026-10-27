'use server'

import fs from 'node:fs/promises'
import path from 'node:path'
import { checkRefCount, readGenerationForm } from '@/lib/generation-form'
import { KINDS, MAX_UPLOAD_BYTES, entitySlug, isAscii } from '@/lib/indexing'
import { appendJobRequest, newRequestId } from '@/lib/job-requests'
import { gate, gateMode, whoStamp } from '@/lib/actor'
import { studioApproveSummary, studioPickSummary } from '@/lib/approval-summary'
import { GEN_RX, SESSION_RX, doStudioApprove, doStudioPick, run, sessionOf, type Result, type StudioApprovePayload } from '@/lib/exec/studio'
import { formToFields } from '@/lib/form-payload'
import { proposeApproval } from '@/lib/propose'
import { freshCatalog } from '@/lib/catalog'
import { modelKindOf } from '@/lib/models'
import { requireProject } from '@/lib/projects'
import { revalidateProject } from '@/lib/revalidate'
import { getCatalog, getWorkerConfig, resolveRefToken } from '@/lib/store'
import { Invalid, parseJsonArray, sniffImage } from '@/lib/uploads'
import type { JobRequest } from '@/lib/types'

/**
 * Write side of the reference studio. Every action is one append to
 * JOB_REQUESTS.jsonl, which the worker acts on (worker/lib/studio.mjs), except
 * a picture dropped into the studio: that is written raw into
 * 09_OUTPUT/_uploads/<session>/, the working space the panel may write, and is
 * only ever an input to a try. It is never filed into the index from here.
 */

/** What a try would cost. The worker answers with `generate cost`; nothing is queued. */
export async function studioPrice(formData: FormData): Promise<Result> {
  const g = await gate(String(formData.get('project') ?? ''), 'studio.price')
  if (!g.ok) return { ok: false, error: g.error }
  const { actor } = g
  const pr = await requireProject(formData.get('project'))
  freshCatalog()
  return run(async () => {
    const sessionId = sessionOf(formData)
    const genId = String(formData.get('genId') ?? '')
    if (!GEN_RX.test(genId)) throw new Invalid('Bad try id.')
    const cfg = await getWorkerConfig()
    const form = readGenerationForm(formData, cfg)
    if (modelKindOf(form.model) !== 'image') throw new Invalid(`${form.model} does not make images.`)
    const prompt = String(formData.get('prompt') ?? '').trim()
    if (!prompt) throw new Invalid('Describe the picture.')
    const count = Number(formData.get('count') ?? 1)
    if (!Number.isInteger(count) || count < 1 || count > 4) throw new Invalid('1 to 4 results per try.')

    const refs = [...new Set((parseJsonArray(formData, 'refs') ?? []).map((r) => String(r ?? '').trim()).filter(Boolean))]
    checkRefCount(form.model, refs.length)
    for (const t of refs) {
      if (t.startsWith('studio:')) { if (!t.startsWith(`studio:${sessionId}/`)) throw new Invalid(`${t} belongs to another session.`); continue }
      if (t.startsWith('staged:')) continue
      if (!t.startsWith('@') || !(await resolveRefToken(pr, t))) throw new Invalid(`Reference ${t} does not resolve to a file in the index.`)
    }

    const req: Extract<JobRequest, { type: 'studio.price' }> = {
      id: newRequestId(), ts: new Date().toISOString(), ...whoStamp(actor), type: 'studio.price',
      sessionId, genId, model: form.model, prompt, refs, params: form.params, count,
    }
    const entity = String(formData.get('entity') ?? '').trim()
    if (entity) {
      const catalog = await getCatalog(pr)
      const e = catalog.find((x) => x.id === entity || x.shortId === entity)
      if (!e) throw new Invalid(`${entity} is not in the index.`)
      req.target = { entity: e.id }
    } else {
      const kind = String(formData.get('kind') ?? '')
      const name = String(formData.get('name') ?? '').trim()
      const description = String(formData.get('description') ?? '').trim()
      if (!(KINDS as readonly string[]).includes(kind)) throw new Invalid('Say what kind of thing this is.')
      if (!name) throw new Invalid('Name the new thing.')
      if (!isAscii(name) || !isAscii(description)) throw new Invalid('The name and description go into the registry, so they must be English.')
      if (!entitySlug(name)) throw new Invalid('The name needs at least one English letter or digit.')
      req.proposal = { kind, name, ...(description && { description }) }
    }
    await appendJobRequest(pr, req)
  })
}

/** The priced Generate button, clicked: this is the approval. The worker refuses if the price moved. */
export async function studioApprove(project: string, sessionId: string, genId: string, expectedTotal: number | null): Promise<Result> {
  const g = await gateMode(project, 'studio.spend')
  if (!g.ok) return { ok: false, error: g.error }
  const payload: StudioApprovePayload = { sessionId, genId, expectedTotal }
  if (g.mode === 'propose') {
    if (!SESSION_RX.test(sessionId) || !GEN_RX.test(genId)) return { ok: false, error: 'Bad try.' }
    return proposeApproval(project, 'studio.spend', studioApproveSummary(payload), { op: 'approve', ...payload }, g.actor)
  }
  return doStudioApprove(project, payload, g.actor)
}

/** File one result: a new look of the entity, or the new entity it was made for. */
export async function studioPick(formData: FormData): Promise<Result> {
  const project = String(formData.get('project') ?? '')
  const g = await gateMode(project, 'studio.spend')
  if (!g.ok) return { ok: false, error: g.error }
  if (g.mode === 'propose') {
    const fields = formToFields(formData)
    if (!fields) return { ok: false, error: 'This cannot be sent for approval.' }
    const summary = studioPickSummary({
      hfJobId: String(formData.get('hfJobId') ?? ''), take: String(formData.get('take') ?? ''),
      entity: String(formData.get('entity') ?? '') || undefined, name: String(formData.get('name') ?? '') || undefined,
    })
    return proposeApproval(project, 'studio.spend', summary, { op: 'pick', fields }, g.actor)
  }
  return doStudioPick(project, formData, g.actor)
}

/** Put the unpicked results away (to _rejected) and end the session. */
export async function studioClose(project: string, sessionId: string): Promise<Result> {
  const g = await gate(project, 'studio.close')
  if (!g.ok) return { ok: false, error: g.error }
  const { actor } = g
  const pr = await requireProject(project)
  if (!SESSION_RX.test(sessionId)) return { ok: false, error: 'Bad session.' }
  await appendJobRequest(pr, { id: newRequestId(), ts: new Date().toISOString(), ...whoStamp(actor), type: 'studio.close', sessionId })
  revalidateProject(pr.slug)
  return { ok: true }
}

/**
 * Pictures dropped into the studio as references for a try. Written to
 * 09_OUTPUT/_uploads/<session>/uN.<ext> and named `studio:<session>/uN`. They
 * stay inputs: when the session closes they go to _rejected beside the unpicked results.
 */
export async function studioUpload(formData: FormData): Promise<{ ok: boolean; tokens?: string[]; error?: string }> {
  const g = await gate(String(formData.get('project') ?? ''), 'studio.close')
  if (!g.ok) return { ok: false, error: g.error }
  const { actor } = g
  const pr = await requireProject(formData.get('project'))
  let sessionId: string
  try { sessionId = sessionOf(formData) } catch (e) { return { ok: false, error: (e as Error).message } }
  const files = formData.getAll('files').filter((f): f is File => f instanceof File)
  if (files.length === 0 || files.length > 8) return { ok: false, error: '1 to 8 pictures at a time.' }
  // Every picture is checked before any is written, so a bad one in the middle
  // does not leave the ones before it behind in the session folder.
  const checked: { bytes: Buffer; ext: string }[] = []
  for (const f of files) {
    if (f.size === 0 || f.size > MAX_UPLOAD_BYTES) return { ok: false, error: `${f.name}: empty or larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` }
    const bytes = Buffer.from(await f.arrayBuffer())
    const ext = sniffImage(bytes)
    if (!ext) return { ok: false, error: `${f.name} is not a PNG, JPG or WEBP image.` }
    checked.push({ bytes, ext })
  }
  const dir = path.join(pr.P.uploads, sessionId)
  await fs.mkdir(dir, { recursive: true })
  const taken = new Set((await fs.readdir(dir)).map((n) => n.split('.')[0]))
  const names: string[] = []
  let n = 1
  for (const c of checked) {
    while (taken.has(`u${n}`)) n++
    if (n > 999) return { ok: false, error: 'Too many pictures in this session.' }
    taken.add(`u${n}`)
    names.push(`u${n}${c.ext}`)
  }
  const written: string[] = []
  try {
    for (const [i, c] of checked.entries()) {
      await fs.writeFile(path.join(dir, names[i]), c.bytes)
      written.push(names[i])
    }
  } catch (e) {
    for (const w of written) await fs.rm(path.join(dir, w), { force: true })
    return { ok: false, error: `Could not save the pictures: ${(e as Error).message}` }
  }
  return { ok: true, tokens: names.map((f) => `studio:${sessionId}/${f.split('.')[0]}`) }
}
