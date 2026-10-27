import { authEnabled, Forbidden } from './actor-core'
import { requireCan } from './actor'

/** What is released now, as `kind:ref` -> release id. */
export type ReleaseMap = Record<string, string>

/**
 * For the pages that show a Release toggle. Null (so no toggle) when login is off or the person
 * may not manage releases. With login off nothing here touches the database.
 */
export async function releaseControls(project: string): Promise<ReleaseMap | null> {
  if (!authEnabled()) return null
  try {
    const { mode } = await requireCan(project, 'release.manage')
    if (mode !== 'allow') return null
  } catch (e) {
    if (e instanceof Forbidden) return null
    throw e
  }
  const { listReleases } = await import('./releases')
  const live = await listReleases(project, { activeOnly: true })
  return Object.fromEntries(live.map((r) => [`${r.kind}:${r.ref}`, r.id]))
}
