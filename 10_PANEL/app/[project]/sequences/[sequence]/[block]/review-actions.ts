'use server'

import { revalidatePath } from 'next/cache'
import { gate } from '@/lib/actor'
import { authEnabled } from '@/lib/actor-core'
import { requireProject } from '@/lib/projects'
import { isBlocks } from '@/lib/structure'

/**
 * Write side of the block's review section: send a generation to the director, mark how a note is
 * being handled, pick the Final. Each action checks its own capability; lib/pd-review checks the
 * rules again.
 */
export interface ReviewActionResult { ok: boolean; error?: string; warning?: string | null; message?: string }

async function prep(project: string, cap: 'submission.create' | 'final.set' | 'block.write') {
  if (!authEnabled()) return { error: 'Needs login.' } as const
  const g = await gate(project, cap)
  if (!g.ok) return { error: g.error } as const
  const pr = await requireProject(project)
  if (!isBlocks(pr)) return { error: 'This project is not organised in sequences and blocks.' } as const
  return { pr, actor: g.actor } as const
}

const refresh = (project: string) => {
  revalidatePath(`/${project}/sequences`, 'layout')
  revalidatePath(`/review-room/${project}`, 'layout')
}

export async function submitAction(project: string, blockId: string, generationId: string): Promise<ReviewActionResult> {
  const g = await prep(project, 'submission.create')
  if ('error' in g) return { ok: false, error: g.error }
  const { submit } = await import('@/lib/pd-review')
  const r = await submit(g.pr, blockId, generationId, g.actor)
  if (!r.ok) return { ok: false, error: r.error }
  refresh(project)
  return { ok: true, message: `${r.gLabel} sent as Round ${r.round}.` }
}

export async function resolutionAction(project: string, feedbackId: string, status: string): Promise<ReviewActionResult> {
  const g = await prep(project, 'block.write')
  if ('error' in g) return { ok: false, error: g.error }
  const { setResolution } = await import('@/lib/pd-review')
  const r = await setResolution(g.pr.slug, feedbackId, status, g.actor)
  if (!r.ok) return { ok: false, error: r.error }
  refresh(project)
  return { ok: true }
}

export async function finalAction(project: string, blockId: string, generationId: string): Promise<ReviewActionResult> {
  const g = await prep(project, 'final.set')
  if ('error' in g) return { ok: false, error: g.error }
  const { setFinal } = await import('@/lib/pd-review')
  const r = await setFinal(g.pr.slug, blockId, generationId, g.actor)
  if (!r.ok) return { ok: false, error: r.error }
  refresh(project)
  return { ok: true, warning: r.warning, message: `${r.gLabel} is now the Final.` }
}

export async function markReadAction(project: string, ids: string[]): Promise<ReviewActionResult> {
  const g = await prep(project, 'block.write')
  if ('error' in g) return { ok: false, error: g.error }
  const { markRead } = await import('@/lib/pd-review')
  await markRead(g.pr.slug, Array.isArray(ids) ? ids.map(String) : [], g.actor.id)
  return { ok: true }
}
