'use server'

import { revalidatePath } from 'next/cache'
import { authEnabled } from '@/lib/actor-core'
import { gate } from '@/lib/actor'
import { validRef, type ReleaseKind } from '@/lib/release-match'

/**
 * Release a take, a shot or an episode to clients, or take it back. Login on only: with it off
 * there are no clients and no database, so these refuse before anything is loaded.
 */
type Result = { ok: boolean; error?: string }

export async function releaseItem(project: string, kind: ReleaseKind, ref: string, label: string | null): Promise<Result> {
  const g = await gate(project, 'release.manage')
  if (!g.ok) return { ok: false, error: g.error }
  if (!authEnabled()) return { ok: false, error: 'Releasing needs login to be on.' }
  if (!validRef(kind, ref)) return { ok: false, error: 'That cannot be released.' }
  const { createRelease } = await import('@/lib/releases')
  await createRelease(project, kind, ref, label, g.actor)
  revalidatePath(`/${project}`, 'layout')
  revalidatePath(`/client/${project}`, 'layout')
  return { ok: true }
}

export async function revokeRelease(project: string, releaseId: string): Promise<Result> {
  const g = await gate(project, 'release.manage')
  if (!g.ok) return { ok: false, error: g.error }
  if (!authEnabled()) return { ok: false, error: 'Releasing needs login to be on.' }
  const releases = await import('@/lib/releases')
  const row = await releases.getRelease(releaseId)
  if (!row || row.projectSlug !== project) return { ok: false, error: 'No such release.' }
  await releases.revokeRelease(releaseId, g.actor)
  revalidatePath(`/${project}`, 'layout')
  revalidatePath(`/client/${project}`, 'layout')
  return { ok: true }
}
