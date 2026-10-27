import type { Actor } from '@/lib/actor-core'
import { whoStamp } from '@/lib/actor'
import { KINDS, UPLOAD_ROLES, isAscii } from '@/lib/indexing'
import { appendJobRequest, newRequestId } from '@/lib/job-requests'
import { requireProject } from '@/lib/projects'
import { revalidateProject } from '@/lib/revalidate'
import { getCatalog } from '@/lib/store'
import { Invalid } from '@/lib/uploads'
import type { JobRequest } from '@/lib/types'

/**
 * The bodies of the reference studio's two spending actions, apart from the guard
 * (see lib/exec/batch.ts), plus the small helpers studio/actions.ts shares with them.
 */

export const SESSION_RX = /^ss_[a-z0-9]{4,40}$/
export const GEN_RX = /^g[a-z0-9]{3,24}$/
export type Result = { ok: boolean; error?: string; pending?: boolean; message?: string }

export function sessionOf(formData: FormData): string {
  const id = String(formData.get('sessionId') ?? '')
  if (!SESSION_RX.test(id)) throw new Invalid('Bad studio session.')
  return id
}

export async function run(fn: () => Promise<void>): Promise<Result> {
  try { await fn(); return { ok: true } } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message }
    throw e
  }
}

export type StudioApprovePayload = { sessionId: string; genId: string; expectedTotal: number | null }

/** The priced Generate button, clicked: this is the approval. The worker refuses if the price moved. */
export async function doStudioApprove(project: string, p: StudioApprovePayload, actor: Actor): Promise<Result> {
  const pr = await requireProject(project)
  if (!SESSION_RX.test(p.sessionId) || !GEN_RX.test(p.genId)) return { ok: false, error: 'Bad try.' }
  await appendJobRequest(pr, {
    id: newRequestId(), ts: new Date().toISOString(), ...whoStamp(actor), type: 'studio.approve',
    sessionId: p.sessionId, genId: p.genId, expectedTotal: p.expectedTotal,
  })
  revalidateProject(pr.slug)
  return { ok: true }
}

/** File one result: a new look of the entity, or the new entity it was made for. `formData` is the pick dialog's form. */
export async function doStudioPick(project: string, formData: FormData, actor: Actor): Promise<Result> {
  const pr = await requireProject(project)
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
      id: newRequestId(), ts: new Date().toISOString(), ...whoStamp(actor), type: 'studio.pick',
      sessionId, hfJobId, take, fileAs, role, descriptor,
    })
    revalidateProject(pr.slug)
  })
}
