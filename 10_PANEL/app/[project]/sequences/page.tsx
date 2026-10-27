import Link from 'next/link'
import { Search } from 'lucide-react'
import { Breadcrumb } from '@/components/breadcrumb'
import { buttonClasses } from '@/components/ui/button-styles'
import { EmptyState } from '@/components/ui/card'
import { Input } from '@/components/ui/field'
import { Table, Td, Th, Thead, Tr } from '@/components/ui/table'
import { PageHeader, SectionHeading } from '@/components/ui/text'
import { BLOCK_STATUS_LABEL } from '@/lib/pd/status'
import { NewSequence, SequenceTools } from './controls'
import { sequencePage } from './guard'
import { StatusLabel } from './status'

export const dynamic = 'force-dynamic'

const num = (n: number) => <span className="font-mono tabular-nums">{n}</span>

/**
 * The Production Dashboard: the film's sequences in order, and how far each has got. Search finds a
 * block by its id, title or status across all of them.
 */
export default async function SequencesPage({ params, searchParams }: PageProps<'/[project]/sequences'>) {
  const { pr, actor } = await sequencePage((await params).project)
  const q = String(((await searchParams).q as string | undefined) ?? '').trim().toLowerCase()
  const { listBlocks, listSequences } = await import('@/lib/pd-store')
  const gens = await import('@/lib/pd-generations')
  await gens.syncGenerations(pr)
  const unassigned = (await gens.unassignedOutputs(pr)).length
  const sequences = await listSequences(pr.slug)
  const ids = sequences.map((s) => s.id)

  const hits = q
    ? (await Promise.all(sequences.map(async (s) => (await listBlocks(s.key, actor)).map((b) => ({ s, b })))))
        .flat()
        .filter(({ b }) => [b.id, b.title, b.status, BLOCK_STATUS_LABEL[b.status]].some((t) => t.toLowerCase().includes(q)))
    : []

  const total = sequences.reduce(
    (n, s) => ({ total: n.total + s.counts.total, ready: n.ready + s.counts.ready, revision: n.revision + s.counts.revision, final: n.final + s.counts.final }),
    { total: 0, ready: 0, revision: 0, final: 0 },
  )

  return (
    <div className="space-y-12">
      <div>
        <Breadcrumb items={[{ label: pr.name }, { label: 'Sequences' }]} />
        <PageHeader title="Sequences" eyebrow={`Production · ${pr.code}`} meta={<NewSequence project={pr.slug} />}>
          The film in order. Open a sequence to work on its blocks. The order here is only the order you want to see;
          a sequence keeps its number whatever its place.
        </PageHeader>
      </div>

      <form action="" method="get" role="search" className="flex items-center gap-2">
        <Search aria-hidden className="size-4 text-faint" />
        <Input name="q" defaultValue={q} placeholder="Find a block by id, title or status" aria-label="Search blocks" className="max-w-md" />
        <button type="submit" className={buttonClasses({ tone: 'outline', size: 'sm' })}>Search</button>
        {q && <Link href={`/${pr.slug}/sequences`} className={buttonClasses({ tone: 'ghost', size: 'sm' })}>Clear</Link>}
      </form>

      {unassigned > 0 && (
        <p className="text-sm text-muted">
          <Link href={`/${pr.slug}/sequences/unassigned`} className="focus-ring rounded text-fg underline">{unassigned} generated output{unassigned === 1 ? '' : 's'} belong to no block</Link>
          {' '}and need mapping.
        </p>
      )}

      {q && (
        <section>
          <SectionHeading count={hits.length}>Blocks matching &ldquo;{q}&rdquo;</SectionHeading>
          {hits.length === 0 ? (
            <EmptyState>No block matches.</EmptyState>
          ) : (
            <Table>
              <Thead><tr><Th>Block</Th><Th>Title</Th><Th>Sequence</Th><Th>Status</Th></tr></Thead>
              <tbody>
                {hits.map(({ s, b }) => (
                  <Tr key={b.id}>
                    <Td className="font-mono text-[12.5px] whitespace-nowrap">
                      <Link href={`/${pr.slug}/sequences/${s.id}/${b.id}`} className="focus-ring rounded text-fg hover:underline">{b.id}</Link>
                    </Td>
                    <Td className="text-fg/90" dir="auto">{b.title}</Td>
                    <Td className="whitespace-nowrap text-muted"><Link href={`/${pr.slug}/sequences/${s.id}`} className="hover:text-fg">{s.id}</Link></Td>
                    <Td><StatusLabel status={b.status} /></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </section>
      )}

      <section>
        <SectionHeading count={sequences.length}>In film order</SectionHeading>
        {sequences.length === 0 ? (
          <EmptyState>No sequences yet. Name the first one above.</EmptyState>
        ) : (
          <Table>
            <Thead>
              <tr>
                <Th>Sequence</Th><Th>Title</Th><Th className="text-right">Blocks</Th><Th className="text-right">Ready for review</Th>
                <Th className="text-right">Revision required</Th><Th className="text-right">Final</Th><Th><span className="sr-only">Tools</span></Th>
              </tr>
            </Thead>
            <tbody>
              {sequences.map((s) => (
                <Tr key={s.id}>
                  <Td className="font-mono text-[12.5px] whitespace-nowrap">
                    <Link href={`/${pr.slug}/sequences/${s.id}`} className="focus-ring rounded text-fg hover:underline">{s.id}</Link>
                  </Td>
                  <Td className="text-fg/90" dir="auto">{s.title}</Td>
                  <Td className="text-right">{num(s.counts.total)}</Td>
                  <Td className="text-right">{num(s.counts.ready)}</Td>
                  <Td className="text-right">{num(s.counts.revision)}</Td>
                  <Td className="text-right">{num(s.counts.final)}</Td>
                  <Td className="text-right"><SequenceTools project={pr.slug} ids={ids} id={s.id} title={s.title} /></Td>
                </Tr>
              ))}
              <Tr>
                <Td className="eyebrow text-faint" colSpan={2}>Whole film</Td>
                <Td className="text-right">{num(total.total)}</Td>
                <Td className="text-right">{num(total.ready)}</Td>
                <Td className="text-right">{num(total.revision)}</Td>
                <Td className="text-right">{num(total.final)}</Td>
                <Td />
              </Tr>
            </tbody>
          </Table>
        )}
      </section>
    </div>
  )
}
