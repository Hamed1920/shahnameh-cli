import { getDecidedEntries } from './decided'
import { shapeLearnings } from './learnings-shape'
import type { Project } from './projects'
import { getCatalog, getLearnings, referenceResolver } from './store'
import type { LearningView } from './types'

/**
 * Everything the Learnings page draws, resolved on the server: each rule split
 * into text and the pictures it names, who it applies to, and the takes it was
 * learned from (lib/learnings-shape.ts). The page itself only renders.
 *
 * A rule that names a look is sent with that picture attached (worker/lib/plan.mjs),
 * so a reference that no longer resolves is shown as broken -- the prompt would
 * only name the entity.
 */
export async function getLearningsView(pr: Project): Promise<LearningView[]> {
  const [learnings, catalog, resolver, decided] = await Promise.all([
    getLearnings(pr), getCatalog(pr), referenceResolver(pr), getDecidedEntries(pr),
  ])
  return shapeLearnings({ learnings, catalog, resolver, decided: new Map(decided.map((e) => [e.decision.id, e])) })
}
