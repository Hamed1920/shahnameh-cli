import Link from 'next/link'
import { EmptyState, StatTile } from '@/components/ui/card'
import { Badge, PageHeader, SectionHeading } from '@/components/ui/text'
import { getEpisodeBoard } from '@/lib/episode-board'
import { portalActor } from '@/lib/portal'
import { requireProject } from '@/lib/projects'

export const dynamic = 'force-dynamic'

const when = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * What the client sees: what has been released to them, and how far the film is. Counts only:
 * no prompts, costs, drafts or rejected takes are read into this page.
 */
export default async function ClientHome({ params }: PageProps<'/client/[project]'>) {
  const slug = (await params).project
  await portalActor(slug)
  const pr = await requireProject(slug)
  const { listReleases } = await import('@/lib/releases')
  const [releases, board] = await Promise.all([listReleases(pr.slug, { activeOnly: true }), getEpisodeBoard(pr)])

  const shots = board.reduce((n, e) => n + e.counts.scenes, 0)
  const finals = board.reduce((n, e) => n + (e.counts.accepted - e.counts.drafts), 0)

  return (
    <div className="space-y-12">
      <PageHeader title="Shared with you" eyebrow={pr.name}>
        What we have released for you to see. Open an item to watch it and tell us what you think.
      </PageHeader>

      <div className="grid grid-cols-3 gap-4">
        <StatTile label="Episodes" value={board.length} />
        <StatTile label="Shots" value={shots} />
        <StatTile label="Finished" value={finals} />
      </div>

      <section>
        <SectionHeading count={releases.length}>Released</SectionHeading>
        {releases.length === 0 ? (
          <EmptyState>Nothing has been released yet. It will appear here when it is ready.</EmptyState>
        ) : (
          <ul className="divide-y divide-edge rounded-xl border border-edge bg-panel">
            {releases.map((r) => (
              <li key={r.id}>
                <Link href={`/client/${pr.slug}/${r.id}`} className="focus-ring flex items-center gap-3 px-5 py-4 transition-colors hover:bg-white/[0.03]">
                  <span className="min-w-0 flex-1 truncate text-[14px] text-fg">{r.label || r.ref}</span>
                  <Badge>{r.kind}</Badge>
                  <span className="font-mono text-[11px] text-faint tabular-nums">{when(r.releasedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
