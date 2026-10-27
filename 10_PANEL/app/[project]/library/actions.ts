'use server'

import { revalidatePath } from 'next/cache'
import { authEnabled } from '@/lib/actor-core'
import { gate } from '@/lib/actor'
import { getProject } from '@/lib/projects'
import { isBlocks } from '@/lib/structure'

/** Send one version of an asset to the director. Production and the owner only. */
export async function presentToDirector(project: string, entityId: string, variant: string): Promise<{ ok: boolean; error?: string; message?: string }> {
  if (!authEnabled()) return { ok: false, error: 'Needs login.' }
  const g = await gate(project, 'asset.present')
  if (!g.ok) return { ok: false, error: g.error }
  const pr = await getProject(project)
  if (!pr || !isBlocks(pr)) return { ok: false, error: 'No such project.' }
  const { presentVersion } = await import('@/lib/pd-library')
  const r = await presentVersion(pr, g.actor, String(entityId), String(variant))
  if (r.ok) revalidatePath(`/${project}/library`)
  return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error }
}
