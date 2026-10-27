'use server'

import { revalidatePath } from 'next/cache'
import { gate } from '@/lib/actor'
import { authEnabled } from '@/lib/actor-core'
import { getProject } from '@/lib/projects'
import { isBlocks } from '@/lib/structure'

/**
 * Write side of the review room. Every action checks its own capability (a Server Action is a
 * public POST endpoint); the rules (which category a role may write, what may be decided from
 * which status) are enforced again inside lib/pd-review.
 */
export interface ReviewResult { ok: boolean; error?: string }

async function prep(project: string, cap: 'review.view' | 'review.decide.director') {
  if (!authEnabled()) return { error: 'Needs login.' } as const
  const g = await gate(project, cap)
  if (!g.ok) return { error: g.error } as const
  const pr = await getProject(project)
  if (!pr || !isBlocks(pr)) return { error: 'No such project.' } as const
  return { pr, actor: g.actor } as const
}

const refresh = (project: string) => {
  revalidatePath(`/review-room/${project}`, 'layout')
  revalidatePath(`/${project}/sequences`, 'layout')
}

/** Add a note. The category follows the role; the owner says which. */
export async function addNoteAction(project: string, submissionId: string, category: string, body: string, timecode: string): Promise<ReviewResult> {
  const g = await prep(project, 'review.view')
  if ('error' in g) return { ok: false, error: g.error }
  const { addFeedback } = await import('@/lib/pd-review')
  const r = await addFeedback(g.pr.slug, submissionId, category || null, body, timecode, g.actor)
  if (!r.ok) return { ok: false, error: r.error }
  refresh(g.pr.slug)
  return { ok: true }
}

/** Approve the active round, or ask for a revision (the note is required). */
export async function decideAction(project: string, submissionId: string, decision: string, note: string): Promise<ReviewResult> {
  const g = await prep(project, 'review.decide.director')
  if ('error' in g) return { ok: false, error: g.error }
  const { directorDecide } = await import('@/lib/pd-review')
  const r = await directorDecide(g.pr.slug, submissionId, decision, note, g.actor)
  if (!r.ok) return { ok: false, error: r.error }
  refresh(g.pr.slug)
  return { ok: true }
}

/** Mark the notes on screen as read by this person. */
export async function markReadAction(project: string, ids: string[]): Promise<ReviewResult> {
  const g = await prep(project, 'review.view')
  if ('error' in g) return { ok: false, error: g.error }
  const { markRead } = await import('@/lib/pd-review')
  await markRead(g.pr.slug, Array.isArray(ids) ? ids.map(String) : [], g.actor.id)
  return { ok: true }
}
