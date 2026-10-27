'use server'

import { revalidatePath } from 'next/cache'
import { authEnabled } from '@/lib/actor-core'
import { gate } from '@/lib/actor'
import type { Decision } from '@/lib/pd-category'
import { getProject } from '@/lib/projects'
import { isBlocks } from '@/lib/structure'

/**
 * The director's decision on one asset version: select, request a revision (a note is required) or
 * approve. Approve also asks the worker, through INDEX_OPS, to mark the asset Approved and, when
 * asked, make this version the main look. The director and the owner only.
 */
export async function decideAsset(
  project: string, reviewId: string, decision: Decision, notes: string, makeCanonical: boolean,
): Promise<{ ok: boolean; error?: string }> {
  if (!authEnabled()) return { ok: false, error: 'Needs login.' }
  if (decision !== 'select' && decision !== 'revise' && decision !== 'approve') return { ok: false, error: 'Unknown decision.' }
  const g = await gate(project, 'asset.review')
  if (!g.ok) return { ok: false, error: g.error }
  const pr = await getProject(project)
  if (!pr || !isBlocks(pr)) return { ok: false, error: 'No such project.' }
  const { decideReview } = await import('@/lib/pd-library')
  const r = await decideReview(pr, g.actor, String(reviewId), decision, String(notes ?? ''), Boolean(makeCanonical))
  if (r.ok) {
    revalidatePath(`/review-room/${project}/library`)
    revalidatePath(`/${project}/library`)
  }
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}
