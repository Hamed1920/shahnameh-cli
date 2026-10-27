import { authEnabled } from './actor-core'
import { gateRoute } from './actor'
import { assetToRef } from './asset-ref'

/**
 * The gate for api/asset and api/thumb. Staff (and login off) need 'view.drafts', as before.
 * A client may fetch only what an active release covers: view.released, the path mapped to a
 * ref (any working-space path or `..` maps to none), and a live release over that ref.
 */
export async function gateMedia(slug: string, rel: string) {
  if (!authEnabled()) return gateRoute(slug, 'view.drafts')
  const { sessionActor } = await import('./auth/session')
  const actor = await sessionActor()
  if (actor?.role !== 'client') return gateRoute(slug, 'view.drafts')

  const g = await gateRoute(slug, 'view.released')
  if (!g.ok) return g
  const no = { ok: false as const, response: new Response('forbidden', { status: 403 }) }
  const ref = assetToRef(rel)
  if (!ref) return no
  const { releaseCovers } = await import('./releases')
  if (!(await releaseCovers(slug, ref))) return no
  return g
}
