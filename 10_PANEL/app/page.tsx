import { getPending, getReferenceFor, resolveRefToken } from '@/lib/store'
import type { Candidate, ResolvedReference } from '@/lib/types'
import { ReviewCard } from './ReviewCard'
import { EmptyState } from '@/components/ui/card'
import { Reveal } from '@/components/ui/reveal'
import { PageHeader } from '@/components/ui/text'

export const dynamic = 'force-dynamic'

/**
 * Every reference behind one candidate, resolved to a file the reviewer can
 * actually look at.
 *
 * The job's own `refs` are the images the model was given. For an entity
 * target there is additionally a canonical plate, which is the thing to judge
 * likeness against and is not necessarily one of those refs -- so it goes
 * first when it is not already in the list.
 */
async function referencesFor(c: Candidate): Promise<ResolvedReference[]> {
  const tokens = c.sidecar.refs ?? []
  const fromPrompt = await Promise.all(
    tokens.map(async (token) => ({ token, path: await resolveRefToken(token) })),
  )

  const canonical = await getReferenceFor(c.sidecar.target, c.sidecar.variant, tokens)
  if (canonical && !fromPrompt.some((r) => r.path === canonical)) {
    const label = [c.sidecar.target, c.sidecar.variant].filter(Boolean).join(' ')
    return [{ token: label, path: canonical }, ...fromPrompt]
  }
  return fromPrompt
}

export default async function ReviewQueue() {
  const pending = await getPending()

  const withRefs = await Promise.all(
    pending.map(async (candidate) => ({
      candidate,
      references: await referencesFor(candidate),
    })),
  )

  return (
    <div className="space-y-8">
      <PageHeader title="Review queue" meta={pending.length + ' awaiting review'} />

      {pending.length === 0 ? (
        <EmptyState className="py-20">
          <p className="text-base text-fg">Nothing to review.</p>
          <p className="mx-auto mt-3 max-w-md">
            Generations land in <code className="text-fg">09_OUTPUT/_staging</code> once the worker
            runs. Queue one with <code className="text-fg">node worker/enqueue.mjs</code>.
          </p>
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {withRefs.map(({ candidate, references }, i) => (
            <Reveal key={candidate.path} index={i}>
              <ReviewCard candidate={candidate} references={references} />
            </Reveal>
          ))}
        </div>
      )}
    </div>
  )
}
