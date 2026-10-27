import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { StatusLabel } from '@/app/[project]/sequences/status'
import { NoteItem } from '@/components/review-notes'
import { can } from '@/lib/access/can'
import type { NoteView, SubmissionView } from '@/lib/pd-review'
import { reviewPage } from '../../guard'
import { ReviewHeader } from '../../header'
import { DecisionButtons, MarkRead, NoteForm } from './forms'

export const dynamic = 'force-dynamic'

const when = (d: Date) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const ROUND_STATUS = { pending: 'Waiting for review', approved: 'Approved', revision_requested: 'Revision requested' } as const

function Notes({ title, notes, empty }: { title: string; notes: NoteView[]; empty: string }) {
  return (
    <div>
      <h3 className="eyebrow text-fg/85">{title} <span className="ml-1 font-mono text-faint">{notes.length}</span></h3>
      {notes.length === 0 ? (
        <p className="mt-2 text-[13px] text-faint">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2.5">{notes.map((n) => <NoteItem key={n.id} note={n} />)}</ul>
      )}
    </div>
  )
}

/**
 * One block as the reviewer sees it: the round that was sent, its video, notes in two kinds, and
 * the rounds before. The video comes from the review-media route by submission id; this page has
 * no file path and no generation that was not sent.
 */
export default async function ReviewBlockPage({ params }: PageProps<'/review-room/[project]/[sequence]/[block]'>) {
  const p = await params
  const { pr, actor } = await reviewPage(p.project)
  const { reviewBlock } = await import('@/lib/pd-review')
  const view = await reviewBlock(pr.slug, String(p.block ?? '').toUpperCase(), actor.id)
  if (!view || view.block.sequenceId !== String(p.sequence ?? '').toUpperCase()) notFound()
  const { block, active, history } = view
  const media = (s: SubmissionView) => `/${pr.slug}/api/review-media/${s.id}`
  const director = (n: NoteView) => n.category === 'director'
  const canDecide = can(actor.role, 'review.decide.director') === 'allow'
  const categories: ('director' | 'continuity')[] =
    actor.role === 'director' ? ['director'] : actor.role === 'supervisor' ? ['continuity'] : ['director', 'continuity']
  const unreadIds = [...(active?.notes ?? []), ...history.flatMap((h) => h.notes)].filter((n) => !n.read).map((n) => n.id)

  return (
    <main className="scroll-pane flex-1">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <ReviewHeader
          project={pr.slug} eyebrow={`${pr.name} · ${block.sequenceId} ${block.sequenceTitle} · ${block.id}`} title={block.title} name={actor.name}
          back={{ href: `/review-room/${pr.slug}/${block.sequenceId}`, label: block.sequenceId }}
        />
        <MarkRead project={pr.slug} ids={unreadIds} />

        <nav aria-label="Blocks in film order" className="mt-5 flex items-center justify-between gap-3 text-[13px]">
          {view.prev ? (
            <Link href={`/review-room/${pr.slug}/${view.prev.sequenceId}/${view.prev.id}`} className="inline-flex items-center gap-1 text-muted hover:text-fg" rel="prev">
              <ChevronLeft aria-hidden className="size-4" /> {view.prev.id}
            </Link>
          ) : <span />}
          {view.next ? (
            <Link href={`/review-room/${pr.slug}/${view.next.sequenceId}/${view.next.id}`} className="inline-flex items-center gap-1 text-muted hover:text-fg" rel="next">
              {view.next.id} <ChevronRight aria-hidden className="size-4" />
            </Link>
          ) : <span />}
        </nav>

        {!active ? (
          <p className="mt-8 rounded-xl border border-dashed border-edge-strong/70 px-8 py-14 text-center text-sm text-muted">
            Nothing has been sent for this block yet.
          </p>
        ) : (
          <>
            <section className="mt-6" data-round={active.round}>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px]">
                <span className="font-mono text-[14px] text-fg">Round {active.round} · {active.gLabel}</span>
                <StatusLabel status={view.status} />
                <span className="text-muted">Sent by {active.submittedByName}, {when(active.submittedAt)}</span>
                <span className="text-muted">{block.targetDurationSeconds ? `Target ${block.targetDurationSeconds} s` : 'No target duration'}</span>
                <span className="text-muted">Position {block.displayOrder}</span>
              </div>
              <video src={media(active)} controls preload="metadata" className="mt-4 aspect-video w-full rounded-lg bg-sunken" data-submission={active.id}>
                Your browser cannot play this video.
              </video>
              {active.decidedByName && active.decidedAt && (
                <p className="mt-2 text-[12.5px] text-muted">
                  {ROUND_STATUS[active.status]} by {active.decidedByName}, {when(active.decidedAt)}.
                </p>
              )}
            </section>

            {canDecide && active.status === 'pending' && (
              <section className="mt-8 rounded-xl border border-edge bg-panel p-4">
                <h2 className="eyebrow text-fg/85">Your decision</h2>
                <div className="mt-3"><DecisionButtons project={pr.slug} submissionId={active.id} /></div>
              </section>
            )}

            <section className="mt-10 space-y-8">
              <Notes title="Director notes" notes={active.notes.filter(director)} empty="No director notes on this round." />
              <Notes title="Continuity notes" notes={active.notes.filter((n) => !director(n))} empty="No continuity notes on this round." />
              <NoteForm project={pr.slug} submissionId={active.id} categories={categories} />
            </section>
          </>
        )}

        <section className="mt-12" id="history">
          <h2 className="eyebrow text-fg/85">Review history <span className="ml-1 font-mono text-faint">{history.length}</span></h2>
          {history.length === 0 ? (
            <p className="mt-2 text-[13px] text-faint">No earlier rounds.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {history.map((h) => (
                <li key={h.id}>
                  <details className="rounded-lg border border-edge bg-panel px-3.5 py-2.5" data-round={h.round}>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                      <span className="font-mono text-fg">Round {h.round} · {h.gLabel}</span>
                      <span className="text-muted">{ROUND_STATUS[h.status]}</span>
                      <span className="text-faint">{when(h.submittedAt)}</span>
                      <span className="text-faint">{h.notes.length} note{h.notes.length === 1 ? '' : 's'}</span>
                    </summary>
                    <video src={media(h)} controls preload="none" className="mt-3 aspect-video w-full rounded-lg bg-sunken" />
                    {h.notes.length > 0 && (
                      <ul className="mt-3 space-y-2.5">
                        {h.notes.map((n) => <NoteItem key={n.id} note={n} />)}
                      </ul>
                    )}
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}
