import { authEnabled } from './actor-core'
import { gateRoute } from './actor'

/**
 * The gate for api/asset and api/thumb. Login off, and everyone on staff, need 'view.drafts', as
 * before. The director and the script supervisor never get a file path from these two routes:
 * what was sent to them is streamed by the review-media route, which resolves the file itself.
 */
export async function gateMedia(slug: string, rel: string) {
  void rel
  if (!authEnabled()) return gateRoute(slug, 'view.drafts')
  const { sessionActor } = await import('./auth/session')
  const actor = await sessionActor()
  if (actor?.role === 'director' || actor?.role === 'supervisor') {
    return { ok: false as const, response: new Response('forbidden', { status: 403 }) }
  }
  return gateRoute(slug, 'view.drafts')
}
