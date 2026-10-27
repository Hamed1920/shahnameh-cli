import Link from 'next/link'
import { Library } from 'lucide-react'
import { can } from '@/lib/access/can'
import { reviewPage } from './guard'
import { ReviewHeader } from './header'

export const dynamic = 'force-dynamic'

/**
 * The director's and the script supervisor's place: the sequences, in film order, each with what is
 * waiting. Only what production sent shows anywhere in the review room.
 */
export default async function ReviewRoomPage({ params }: PageProps<'/review-room/[project]'>) {
  const { pr, actor } = await reviewPage((await params).project)
  const { listSequences } = await import('@/lib/pd-store')
  const sequences = await listSequences(pr.slug)

  return (
    <main className="scroll-pane flex-1">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <ReviewHeader project={pr.slug} eyebrow={pr.name} title="Review room" name={actor.name}>
          {can(actor.role, 'asset.review') === 'allow' && (
            <Link href={`/review-room/${pr.slug}/library`} className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg">
              <Library aria-hidden className="size-3.5" /> Library review
            </Link>
          )}
        </ReviewHeader>

        {sequences.length === 0 ? (
          <p className="mt-12 rounded-xl border border-dashed border-edge-strong/70 px-8 py-14 text-center text-sm text-muted">Nothing has been sent to you yet.</p>
        ) : (
          <ul className="mt-10 divide-y divide-edge rounded-xl border border-edge bg-panel">
            {sequences.map((s) => (
              <li key={s.id}>
                <Link href={`/review-room/${pr.slug}/${s.id}`} className="focus-ring flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3.5 hover:bg-white/[0.03]">
                  <span className="font-mono text-[12.5px] text-muted">{s.id}</span>
                  <span className="min-w-0 flex-1 text-[15px] text-fg" dir="auto">{s.title}</span>
                  <span className="text-[12.5px] text-muted tabular-nums">
                    {s.counts.total} block{s.counts.total === 1 ? '' : 's'}
                    {s.counts.ready > 0 && <> · {s.counts.ready} waiting for review</>}
                    {s.counts.revision > 0 && <> · {s.counts.revision} sent back</>}
                    {s.counts.final > 0 && <> · {s.counts.final} final</>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
