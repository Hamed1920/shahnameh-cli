import { notFound, redirect } from 'next/navigation'
import { authEnabled, Forbidden } from './actor-core'
import { requireCan } from './actor'

/**
 * Who is looking at the client portal. Off: there is no portal (404). Not signed in: the login
 * page. Not on this project, or not allowed: 404. Called by every portal page, because a layout
 * does not run again when a person moves between its pages.
 */
export async function portalActor(slug: string) {
  if (!authEnabled()) notFound()
  try {
    return (await requireCan(slug, 'view.released')).actor
  } catch (e) {
    if (e instanceof Forbidden) {
      if (e.capability === 'login') redirect(`/login?next=${encodeURIComponent(`/client/${slug}`)}`)
      notFound()
    }
    throw e
  }
}
