import { notFound } from 'next/navigation'
import { requireCan } from '@/lib/actor'
import { authEnabled, Forbidden } from '@/lib/actor-core'
import { requireProject, type Project } from '@/lib/projects'
import { isBlocks } from '@/lib/structure'
import type { Actor } from '@/lib/actor-core'

/**
 * Every Sequence page starts here: only a Sequence / Block project, only with login on, only staff
 * who may edit structure. An episodes project, or anyone else, gets the usual 404.
 */
export async function sequencePage(slug: string): Promise<{ pr: Project; actor: Actor }> {
  const pr = await requireProject(slug)
  if (!isBlocks(pr) || !authEnabled()) notFound()
  try {
    const { actor } = await requireCan(pr.slug, 'block.write')
    return { pr, actor }
  } catch (e) {
    if (e instanceof Forbidden) notFound()
    throw e
  }
}
