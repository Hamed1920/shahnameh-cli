'use server'

import fs from 'node:fs/promises'
import path from 'node:path'
import { revalidatePath } from 'next/cache'
import { gate, whoStamp } from '@/lib/actor'
import { authEnabled } from '@/lib/actor-core'
import { requireProject, type Project } from '@/lib/projects'
import { isBlocks } from '@/lib/structure'
import { MACHINE } from '@/worker/lib/machine.mjs'
import type { Actor } from '@/lib/actor-core'

/**
 * Write side of the Sequences pages. Structure lives in the database (lib/pd-store.ts); each action
 * checks block.write itself, because a Server Action is a public POST endpoint.
 */

export interface SeqResult {
  ok: boolean
  error?: string
  /** The sequence or block acted on. */
  id?: string
}

async function guard(project: string): Promise<{ pr: Project; actor: Actor } | { error: string }> {
  const g = await gate(project, 'block.write')
  if (!g.ok) return { error: g.error }
  const pr = await requireProject(project)
  if (!isBlocks(pr)) return { error: 'This project is not organised in sequences and blocks.' }
  if (!authEnabled()) return { error: 'Sequences and blocks need login (SHM_AUTH=on).' }
  return { pr, actor: g.actor }
}

const fail = (error: string): SeqResult => ({ ok: false, error })
const store = () => import('@/lib/pd-store')

function refresh(pr: Project, sequence?: string) {
  revalidatePath(`/${pr.slug}/sequences`)
  if (sequence) revalidatePath(`/${pr.slug}/sequences/${sequence}`, 'layout')
}

/**
 * Ask the worker for the folder behind a new sequence: 07_EPISODES/<CODE>-EPnnn-<TITLE>. The
 * new-episode op takes an explicit episode, and that is exactly the sequence's internal id. It is a
 * request only: the worker makes the folder, the panel never touches it. If the request cannot be
 * saved the sequence still exists -- the worker makes the folder on first generation anyway.
 */
async function requestFolder(pr: Project, actor: Actor, number: number, title: string): Promise<void> {
  const episode = `EP${String(number).padStart(3, '0')}`
  const record = {
    id: `op_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    ts: new Date().toISOString(),
    ...whoStamp(actor),
    type: 'new-episode',
    episode,
    title: title.slice(0, 60),
    machine: MACHINE,
  }
  try {
    await fs.mkdir(path.dirname(pr.P.indexOps), { recursive: true })
    await fs.appendFile(pr.P.indexOps, JSON.stringify(record) + '\n', 'utf8')
  } catch {
    // Not fatal: see above.
  }
}

export async function addSequence(project: string, title: string, description = ''): Promise<SeqResult> {
  const g = await guard(project)
  if ('error' in g) return fail(g.error)
  const r = await (await store()).createSequence(g.pr.slug, g.pr.code, title, description, g.actor)
  if (!r.ok) return fail(r.error)
  await requestFolder(g.pr, g.actor, r.sequence.number, r.sequence.title)
  refresh(g.pr)
  return { ok: true, id: r.sequence.id }
}

export async function renameSequenceAction(project: string, id: string, title: string): Promise<SeqResult> {
  const g = await guard(project)
  if ('error' in g) return fail(g.error)
  const r = await (await store()).renameSequence(g.pr.slug, id, title, g.actor)
  if (!r.ok) return fail(r.error)
  refresh(g.pr, id)
  return { ok: true, id }
}

export async function reorderSequencesAction(project: string, orderedIds: string[]): Promise<SeqResult> {
  const g = await guard(project)
  if ('error' in g) return fail(g.error)
  if (!Array.isArray(orderedIds) || orderedIds.some((x) => typeof x !== 'string')) return fail('Malformed request.')
  const r = await (await store()).reorderSequences(g.pr.slug, orderedIds, g.actor)
  if (!r.ok) return fail(r.error)
  refresh(g.pr)
  return { ok: true }
}

export async function retireSequenceAction(project: string, id: string): Promise<SeqResult> {
  const g = await guard(project)
  if ('error' in g) return fail(g.error)
  const r = await (await store()).retireSequence(g.pr.slug, id, g.actor)
  if (!r.ok) return fail(r.error)
  refresh(g.pr)
  return { ok: true, id }
}

export async function addBlock(project: string, sequenceId: string, title: string, targetDuration: string): Promise<SeqResult> {
  const g = await guard(project)
  if ('error' in g) return fail(g.error)
  const s = store()
  // The sequence must belong to this project: an id from another project is refused.
  if (!(await (await s).getSequence(g.pr.slug, sequenceId))) return fail('That sequence does not exist.')
  const r = await (await s).createBlock(sequenceId, title, targetDuration, g.actor)
  if (!r.ok) return fail(r.error)
  refresh(g.pr, sequenceId)
  return { ok: true, id: r.block.id }
}

export async function renameBlockAction(project: string, sequenceId: string, id: string, title: string): Promise<SeqResult> {
  const g = await guard(project)
  if ('error' in g) return fail(g.error)
  const r = await (await store()).renameBlock(g.pr.slug, id, title, g.actor)
  if (!r.ok) return fail(r.error)
  refresh(g.pr, sequenceId)
  return { ok: true, id }
}

export async function setDurationAction(project: string, sequenceId: string, id: string, duration: string): Promise<SeqResult> {
  const g = await guard(project)
  if ('error' in g) return fail(g.error)
  const r = await (await store()).setTargetDuration(g.pr.slug, id, duration, g.actor)
  if (!r.ok) return fail(r.error)
  refresh(g.pr, sequenceId)
  return { ok: true, id }
}

export async function reorderBlocksAction(project: string, sequenceId: string, orderedIds: string[]): Promise<SeqResult> {
  const g = await guard(project)
  if ('error' in g) return fail(g.error)
  if (!Array.isArray(orderedIds) || orderedIds.some((x) => typeof x !== 'string')) return fail('Malformed request.')
  const r = await (await store()).reorderBlocks(g.pr.slug, sequenceId, orderedIds, g.actor)
  if (!r.ok) return fail(r.error)
  refresh(g.pr, sequenceId)
  return { ok: true }
}

export async function retireBlockAction(project: string, sequenceId: string, id: string): Promise<SeqResult> {
  const g = await guard(project)
  if ('error' in g) return fail(g.error)
  const r = await (await store()).retireBlock(g.pr.slug, id, g.actor)
  if (!r.ok) return fail(r.error)
  refresh(g.pr, sequenceId)
  return { ok: true, id }
}
