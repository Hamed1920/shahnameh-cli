'use server'

import { revalidatePath } from 'next/cache'
import { authEnabled } from '@/lib/actor-core'
import { gate } from '@/lib/actor'

const MAX_COMMENT = 2000

/** A client's note on a released item, with an optional approve / reject. */
export async function addClientComment(
  project: string, releaseId: string, body: string, verdict: 'approve' | 'reject' | null,
): Promise<{ ok: boolean; error?: string }> {
  const g = await gate(project, 'comment.client')
  if (!g.ok) return { ok: false, error: g.error }
  if (!authEnabled()) return { ok: false, error: 'Comments need login to be on.' }
  const text = String(body ?? '').trim()
  if (verdict !== null && verdict !== 'approve' && verdict !== 'reject') return { ok: false, error: 'Bad verdict.' }
  if (!text && verdict === null) return { ok: false, error: 'Write a comment, or approve or reject.' }
  if (text.length > MAX_COMMENT) return { ok: false, error: `Keep it under ${MAX_COMMENT} characters.` }
  const releases = await import('@/lib/releases')
  const row = await releases.getRelease(releaseId)
  if (!row || row.projectSlug !== project || row.revokedAt) return { ok: false, error: 'This is no longer shared.' }
  await releases.addComment(releaseId, g.actor, text, verdict)
  revalidatePath(`/client/${project}/${releaseId}`)
  return { ok: true }
}
