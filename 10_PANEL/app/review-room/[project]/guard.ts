import { notFound, redirect } from 'next/navigation'
import { requireCan } from '@/lib/actor'
import { authEnabled, Forbidden, type Actor } from '@/lib/actor-core'
import { getProject, type Project } from '@/lib/projects'
import { isBlocks } from '@/lib/structure'

/**
 * Every review-room page starts here: login on, a Sequence / Block project, signed in, a member,
 * and allowed to review (the director, the script supervisor, the owner). Production and anyone
 * else gets the usual 404, so the area does not announce itself.
 */
export async function reviewPage(slug: string): Promise<{ pr: Project; actor: Actor }> {
  if (!authEnabled()) notFound()
  const pr = await getProject(slug)
  if (!pr || !isBlocks(pr)) notFound()
  const { sessionActor } = await import('@/lib/auth/session')
  const actor = await sessionActor()
  if (!actor) redirect('/login')
  try {
    await requireCan(pr.slug, 'review.view')
  } catch (e) {
    if (e instanceof Forbidden) notFound()
    throw e
  }
  return { pr, actor }
}
