import type { Actor } from '@/lib/actor-core'
import { doApproveBatch, type ApproveBatchPayload } from '@/lib/exec/batch'
import { doRequestRegenerate } from '@/lib/exec/regen'
import { doStudioApprove, doStudioPick, type StudioApprovePayload } from '@/lib/exec/studio'
import { fieldsToForm, type FormFields } from '@/lib/form-payload'

/**
 * What the owner's Approve runs: one executor per capability that can wait in the inbox, handed
 * the stored payload and the OWNER as actor (so the records the worker sees carry his name).
 * A capability with no executor is not routable yet and fails the request. To make another
 * action approvable: split it into doX, add an executor here, and propose from its wrapper.
 */
export type ExecResult = { ok: boolean; error?: string }
export type Executor = (project: string, payload: unknown, actor: Actor) => Promise<ExecResult>

const EXECUTORS: Record<string, Executor> = {
  'batch.approve': (project, p, actor) => doApproveBatch(project, p as ApproveBatchPayload, actor),
  'studio.spend': (project, p, actor) => {
    const x = p as { op?: string; fields?: FormFields } & Partial<StudioApprovePayload>
    if (x.op === 'approve') {
      return doStudioApprove(project, { sessionId: String(x.sessionId), genId: String(x.genId), expectedTotal: x.expectedTotal ?? null }, actor)
    }
    if (x.op === 'pick' && x.fields) return doStudioPick(project, fieldsToForm(x.fields), actor)
    return Promise.resolve({ ok: false, error: 'Unknown studio request.' })
  },
  'regen.spend': (project, p, actor) => {
    const fields = (p as { fields?: FormFields } | null)?.fields
    if (!fields) return Promise.resolve({ ok: false, error: 'The request has no form.' })
    return doRequestRegenerate(project, fieldsToForm(fields), actor)
  },
}

/** Run an approved request. Never throws: a failure comes back as { ok: false, error }. */
export async function executeApproval(capability: string, project: string, payload: unknown, owner: Actor): Promise<ExecResult> {
  const run = EXECUTORS[capability]
  if (!run) return { ok: false, error: `Nothing is wired to run "${capability}" yet.` }
  try {
    return await run(project, payload, owner)
  } catch (e) {
    return { ok: false, error: (e as Error).message || 'It failed.' }
  }
}
