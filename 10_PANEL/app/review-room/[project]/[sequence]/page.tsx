import Link from 'next/link'
import { notFound } from 'next/navigation'
import { noteBadge } from '@/lib/pd/review-rules'
import { Badge } from '@/components/ui/text'
import { StatusLabel } from '@/app/[project]/sequences/status'
import { reviewPage } from '../guard'
import { ReviewHeader } from '../header'
import { SequencePlayback } from '@/components/sequence-playback'
import { ProjectProvider } from '@/components/project-context'
import { publicInfo } from '@/lib/projects'
import { buildPlaylist } from '@/lib/sequence-playlist'

export const dynamic = 'force-dynamic'

/** The blocks of one sequence in film order: id, title, status, round, and whether anything was sent. */
export default async function ReviewSequencePage({ params }: PageProps<'/review-room/[project]/[sequence]'>) {
  const p = await params
  const { pr, actor } = await reviewPage(p.project)
  const { getSequence, listBlocks } = await import('@/lib/pd-store')
  const seq = await getSequence(pr.slug, String(p.sequence ?? '').toUpperCase())
  if (!seq) notFound()
  const blocks = await listBlocks(seq.id, actor)
  const { playlistBlocks } = await import('@/lib/pd-playlist')
  const stops = buildPlaylist(pr.slug, await playlistBlocks(pr, seq.id, false), 'submitted', (id) => `/review-room/${pr.slug}/${seq.id}/${id}`)

  return (
    <main className="scroll-pane flex-1">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <ReviewHeader project={pr.slug} eyebrow={`${pr.name} · ${seq.id}`} title={seq.title} back={{ href: `/review-room/${pr.slug}`, label: 'Review room' }} name={actor.name} />

        {blocks.length > 0 && (
          <div className="mt-10">
            <ProjectProvider project={publicInfo(pr)}>
              <SequencePlayback scope={`review:${seq.id}`} sources={[{ id: 'submitted', label: 'Submitted', hint: 'What was sent to the director', stops }]} />
            </ProjectProvider>
          </div>
        )}

        {blocks.length === 0 ? (
          <p className="mt-12 rounded-xl border border-dashed border-edge-strong/70 px-8 py-14 text-center text-sm text-muted">This sequence has no blocks yet.</p>
        ) : (
          <ul className="mt-10 divide-y divide-edge rounded-xl border border-edge bg-panel">
            {blocks.map((b) => (
              <li key={b.id}>
                <Link href={`/review-room/${pr.slug}/${seq.id}/${b.id}`} className="focus-ring flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3.5 hover:bg-white/[0.03]" data-block={b.id}>
                  <span className="font-mono text-[12.5px] text-muted">{b.id}</span>
                  <span className="min-w-0 flex-1 text-[15px] text-fg" dir="auto">{b.title}</span>
                  {b.round === null ? (
                    <span className="text-[12.5px] text-faint">Not sent yet</span>
                  ) : (
                    <>
                      <StatusLabel status={b.status} />
                      <span className="font-mono text-[12.5px] whitespace-nowrap text-muted">Round {b.round}</span>
                    </>
                  )}
                  {noteBadge({ unreadDirector: b.unreadDirector, unreadContinuity: b.unreadContinuity, revision: b.status === 'revision_required' }).map((t) => (
                    <Badge key={t} tone="accent">{t}</Badge>
                  ))}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
