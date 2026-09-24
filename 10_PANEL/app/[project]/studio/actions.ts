'use server'

import fs from 'node:fs/promises'
import path from 'node:path'
import { checkRefCount, readGenerationForm } from '@/lib/generation-form'
import { KINDS, MAX_UPLOAD_BYTES, UPLOAD_ROLES, entitySlug, isAscii } from '@/lib/indexing'
import { REVIEWER, appendJobRequest, newRequestId } from '@/lib/job-requests'
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

const SESSION_RX = /^ss_[a-z0-9]{4,40}$/
const GEN_RX = /^g[a-z0-9]{3,24}$/
type Result = { ok: boolean; error?: string }

function sessionOf(formData: FormData): string {
  const id = String(formData.get('sessionId') ?? '')
  if (!SESSION_RX.test(id)) throw new Invalid('Bad studio session.')
  return id
}

async function run(fn: () => Promise<void>): Promise<Result> {
  try { await fn(); return { ok: true } } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message }
    throw e
  }
}

/** What a try would cost. The worker answers with `generate cost`; nothing is queued. */
export async function studioPrice(formData: FormData): Promise<Result> {
  const pr = await requireProject(formData.get('project'))
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
      id: newRequestId(), ts: new Date().toISOString(), reviewer: REVIEWER, type: 'studio.price',
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
  const pr = await requireProject(project)
  if (!SESSION_RX.test(sessionId) || !GEN_RX.test(genId)) return { ok: false, error: 'Bad try.' }
  await appendJobRequest(pr, { id: newRequestId(), ts: new Date().toISOString(), reviewer: REVIEWER, type: 'studio.approve', sessionId, genId, expectedTotal })
  revalidateProject(pr.slug)
  return { ok: true }
}

/** File one result: a new look of the entity, or the new entity it was made for. */
export async function studioPick(formData: FormData): Promise<Result> {
  const pr = await requireProject(formData.get('project'))
  return run(async () => {
    const sessionId = sessionOf(formData)
    const hfJobId = String(formData.get('hfJobId') ?? '')
    const take = String(formData.get('take') ?? '')
    if (!/^[A-Za-z0-9_-]{4,80}$/.test(hfJobId) || !/^T\d{2}$/.test(take)) throw new Invalid('Bad result.')
    const role = String(formData.get('role') ?? 'HERO')
    if (!(UPLOAD_ROLES as readonly string[]).includes(role)) throw new Invalid('Choose a role.')
    const descriptor = String(formData.get('descriptor') ?? '').trim()
    if (!descriptor || !isAscii(descriptor)) throw new Invalid('Add a short English description; it becomes the filename.')

    let fileAs: Extract<JobRequest, { type: 'studio.pick' }>['fileAs']
    const entity = String(formData.get('entity') ?? '').trim()
    if (entity) {
      const catalog = await getCatalog(pr)
      const e = catalog.find((x) => x.id === entity || x.shortId === entity)
      if (!e) throw new Invalid(`${entity} is not in the index.`)
      fileAs = { mode: 'variant', entity: e.id }
    } else {
      const kind = String(formData.get('kind') ?? '')
      const name = String(formData.get('name') ?? '').trim()
      const description = String(formData.get('description') ?? '').trim()
      if (!(KINDS as readonly string[]).includes(kind) || !name) throw new Invalid('Say what the new thing is: a kind and a name.')
      if (!isAscii(name) || !isAscii(description)) throw new Invalid('The name and description go into the registry, so they must be English.')
      fileAs = { mode: 'new', kind, name, ...(description && { description }) }
    }
    await appendJobRequest(pr, {
      id: newRequestId(), ts: new Date().toISOString(), reviewer: REVIEWER, type: 'studio.pick',
      sessionId, hfJobId, take, fileAs, role, descriptor,
    })
    revalidateProject(pr.slug)
  })
}

/** Put the unpicked results away (to _rejected) and end the session. */
export async function studioClose(project: string, sessionId: string): Promise<Result> {
  const pr = await requireProject(project)
  if (!SESSION_RX.test(sessionId)) return { ok: false, error: 'Bad session.' }
  await appendJobRequest(pr, { id: newRequestId(), ts: new Date().toISOString(), reviewer: REVIEWER, type: 'studio.close', sessionId })
  revalidateProject(pr.slug)
  return { ok: true }
}

/**
 * Pictures dropped into the studio as references for a try. Written to
 * 09_OUTPUT/_uploads/<session>/uN.<ext> and named `studio:<session>/uN`. They
 * stay inputs: when the session closes they go to _rejected beside the unpicked results.
 */
export async function studioUpload(formData: FormData): Promise<{ ok: boolean; tokens?: string[]; error?: string }> {
  const pr = await requireProject(formData.get('project'))
  let sessionId: string
  try { sessionId = sessionOf(formData) } catch (e) { return { ok: false, error: (e as Error).message } }
  const files = formData.getAll('files').filter((f): f is File => f instanceof File)
  if (files.length === 0 || files.length > 8) return { ok: false, error: '1 to 8 pictures at a time.' }
  const dir = path.join(pr.P.uploads, sessionId)
  await fs.mkdir(dir, { recursive: true })
  const taken = new Set((await fs.readdir(dir)).map((n) => n.split('.')[0]))
  let n = 1
  const tokens: string[] = []
  for (const f of files) {
    if (f.size === 0 || f.size > MAX_UPLOAD_BYTES) return { ok: false, error: `${f.name}: empty or larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` }
    const bytes = Buffer.from(await f.arrayBuffer())
    const ext = sniffImage(bytes)
    if (!ext) return { ok: false, error: `${f.name} is not a PNG, JPG or WEBP image.` }
    while (taken.has(`u${n}`)) n++
    if (n > 999) return { ok: false, error: 'Too many pictures in this session.' }
    taken.add(`u${n}`)
    await fs.writeFile(path.join(dir, `u${n}${ext}`), bytes)
    tokens.push(`studio:${sessionId}/u${n}`)
  }
  return { ok: true, tokens }
}
