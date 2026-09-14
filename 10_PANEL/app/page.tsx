import { getCatalog, getPending, getReferenceFor, getReviewContexts, resolveRefToken } from '@/lib/store'
import type { ReviewItem } from '@/lib/types'
import { ReviewWorkspace } from './review/review-workspace'

export const dynamic = 'force-dynamic'

/**
 * Review, one candidate at a time. Everything is resolved here on the server;
 * the workspace only arranges it and holds the reviewer's unsaved input.
 */
export default async function ReviewPage() {
  const [pending, catalog] = await Promise.all([getPending(), getCatalog()])
  const contexts = await getReviewContexts(pending)

  const items: ReviewItem[] = await Promise.all(
    pending.map(async (candidate) => {
      const tokens = candidate.sidecar.refs ?? []
      const editable = await Promise.all(
        tokens.map(async (token) => ({ token, path: await resolveRefToken(token) })),
      )
      // An entity target's canonical plate is the thing to judge likeness
      // against, and is not necessarily one of the refs the job was given.
      const canonical = await getReferenceFor(candidate.sidecar.target, candidate.sidecar.variant, tokens)
      const plate =
        canonical && !editable.some((r) => r.path === canonical)
          ? { token: [candidate.sidecar.target, candidate.sidecar.variant].filter(Boolean).join(' '), path: canonical }
          : null
      return { candidate, editable, plate, context: contexts.get(candidate.path)! }
    }),
  )

  // Scene order, so a sequence is reviewed the way it will be watched.
  items.sort(
    (a, b) =>
      a.candidate.sidecar.target.localeCompare(b.candidate.sidecar.target) ||
      a.candidate.sidecar.createdAt.localeCompare(b.candidate.sidecar.createdAt),
  )

  return <ReviewWorkspace items={items} catalog={catalog} />
}
