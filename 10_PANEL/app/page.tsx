import { getPending, getReferenceFor } from '@/lib/store'
import { ReviewCard } from './ReviewCard'

export const dynamic = 'force-dynamic'

export default async function ReviewQueue() {
  const pending = await getPending()

  const withRefs = await Promise.all(
    pending.map(async (c) => ({
      candidate: c,
      referencePath: await getReferenceFor(c.sidecar.target, c.sidecar.variant),
    })),
  )

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Review queue</h1>
        <span className="text-sm text-[var(--color-muted)]">
          {pending.length} awaiting review
        </span>
      </div>

      {pending.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--color-edge)] p-12 text-center">
          <p className="text-[var(--color-muted)]">Nothing to review.</p>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            Generations land in <code className="text-white">09_OUTPUT/_staging</code> once the
            worker runs. Queue one with{' '}
            <code className="text-white">node worker/enqueue.mjs</code>.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {withRefs.map(({ candidate, referencePath }) => (
            <ReviewCard
              key={candidate.path}
              candidate={candidate}
              referencePath={referencePath}
            />
          ))}
        </div>
      )}
    </div>
  )
}
