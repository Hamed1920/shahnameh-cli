import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Breadcrumb } from '@/components/breadcrumb'
import { EmptyState } from '@/components/ui/card'
import { Table, Td, Th, Thead, Tr } from '@/components/ui/table'
import { noteBadge } from '@/lib/pd/review-rules'
import { Badge, PageHeader, SectionHeading } from '@/components/ui/text'
import { BlockTools, DurationEdit, NewBlock } from '../controls'
import { sequencePage } from '../guard'
import { StatusLabel } from '../status'
import { SequencePlayback } from '@/components/sequence-playback'
import { buildPlaylist } from '@/lib/sequence-playlist'

export const dynamic = 'force-dynamic'

/**
 * One sequence: its blocks in film order. A block is one generated video; its id (PD-S01-B003)
 * never changes, only its place in the order does.
 */
export default async function SequencePage({ params }: PageProps<'/[project]/sequences/[sequence]'>) {
  const p = await params
  const { pr, actor } = await sequencePage(p.project)
  const { getSequence, listBlocks } = await import('@/lib/pd-store')
  const seq = await getSequence(pr.slug, String(p.sequence ?? '').toUpperCase())
  if (!seq) notFound()
  await (await import('@/lib/pd-generations')).syncGenerations(pr)
  const blocks = await listBlocks(seq.id, actor)
  const ids = blocks.map((b) => b.id)
  const { playlistBlocks } = await import('@/lib/pd-playlist')
  const pl = await playlistBlocks(pr, seq.id, true)
  const hrefFor = (id: string) => `/${pr.slug}/sequences/${seq.id}/${id}`

  return (
    <div className="space-y-12">
      <div>
        <Breadcrumb items={[{ label: pr.name, href: `/${pr.slug}/sequences` }, { label: `${seq.id} ${seq.title}` }]} />
        <PageHeader title={seq.title} eyebrow={seq.id} meta={<NewBlock project={pr.slug} sequence={seq.id} />}>
          {seq.description || 'The blocks of this sequence, in the order they play.'}
        </PageHeader>
      </div>

      {blocks.length > 0 && (
        <section>
          <SectionHeading count={blocks.length}>Playback</SectionHeading>
          <SequencePlayback
            scope={`production:${seq.id}`}
            sources={[
              { id: 'submitted', label: 'Submitted', hint: 'Active submissions, as the director sees them', stops: buildPlaylist(pr.slug, pl, 'submitted', hrefFor) },
              { id: 'best', label: 'Best available', hint: 'Final if set, else the active submission, else the latest accepted generation', stops: buildPlaylist(pr.slug, pl, 'best', hrefFor) },
            ]}
          />
        </section>
      )}

      <section>
        <SectionHeading count={blocks.length}>Blocks</SectionHeading>
        {blocks.length === 0 ? (
          <EmptyState>No blocks yet. Add the first one above.</EmptyState>
        ) : (
          <Table>
            <Thead>
              <tr>
                <Th>Block</Th><Th>Title</Th><Th>Target</Th><Th>Status</Th><Th>Round</Th><Th>Notes</Th><Th><span className="sr-only">Tools</span></Th>
              </tr>
            </Thead>
            <tbody>
              {blocks.map((b) => (
                <Tr key={b.id}>
                  <Td className="font-mono text-[12.5px] whitespace-nowrap">
                    <Link href={`/${pr.slug}/sequences/${seq.id}/${b.id}`} className="focus-ring rounded text-fg hover:underline">{b.id}</Link>
                  </Td>
                  <Td className="text-fg/90" dir="auto">{b.title}</Td>
                  <Td><DurationEdit project={pr.slug} sequence={seq.id} id={b.id} seconds={b.targetDurationSeconds} /></Td>
                  <Td><StatusLabel status={b.status} /></Td>
                  <Td className="font-mono text-[12.5px] whitespace-nowrap text-muted">{b.round === null ? '—' : `Round ${b.round}`}</Td>
                  <Td>
                    <span className="flex flex-wrap gap-1.5">
                      {b.open > 0 && <Badge tone="muted">{b.open} open</Badge>}
                      {noteBadge({ unreadDirector: b.unreadDirector, unreadContinuity: b.unreadContinuity, revision: b.status === 'revision_required' }).map((t) => (
                        <Badge key={t} tone="accent">{t}</Badge>
                      ))}
                      {b.open === 0 && b.unread === 0 && <span className="text-faint">—</span>}
                    </span>
                  </Td>
                  <Td className="text-right"><BlockTools project={pr.slug} sequence={seq.id} ids={ids} id={b.id} title={b.title} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  )
}
