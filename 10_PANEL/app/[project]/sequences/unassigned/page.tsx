import { Breadcrumb } from '@/components/breadcrumb'
import { TakeMedia } from '@/components/take-media'
import { Card, EmptyState } from '@/components/ui/card'
import { PageHeader, SectionHeading } from '@/components/ui/text'
import { sequencePage } from '../guard'
import { Assigner } from './assigner'

export const dynamic = 'force-dynamic'

/**
 * Footage in this project that targets no block of it (a typed shot id, footage that was moved).
 * Nothing is guessed from file names: someone picks the block, and only the link is recorded.
 */
export default async function UnassignedPage({ params }: { params: Promise<{ project: string }> }) {
  const { pr } = await sequencePage((await params).project)
  const gens = await import('@/lib/pd-generations')
  const { listSequences, listBlocks } = await import('@/lib/pd-store')
  const outputs = await gens.unassignedOutputs(pr)
  const states = await gens.resolveGenerationFiles(pr, outputs.map((o) => ({ hfJobId: o.hfJobId, candidate: o.candidate })))
  const options = (await Promise.all((await listSequences(pr.slug)).map(async (s) => (await listBlocks(s.id, null)).map((b) => ({ id: b.id, label: `${b.id} ${b.title}` }))))).flat()

  return (
    <div className="space-y-12">
      <div>
        <Breadcrumb items={[{ label: pr.name, href: `/${pr.slug}/sequences` }, { label: 'Unassigned' }]} />
        <PageHeader title="Unassigned" eyebrow={`Production · ${pr.code}`}>
          Generated footage that belongs to no block yet. Pick the block it is for; the file itself stays where it is.
        </PageHeader>
      </div>
      <section>
        <SectionHeading count={outputs.length}>Needs mapping</SectionHeading>
        {outputs.length === 0 ? (
          <EmptyState>Everything generated is on a block.</EmptyState>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {outputs.map((o) => {
              const file = states.get(o.key)?.file
              return (
                <Card key={o.key} className="space-y-3 p-4">
                  {file ? <TakeMedia file={file} alt={`Output ${o.key}`} /> : <div className="grid aspect-video place-items-center rounded-lg border border-dashed border-edge text-xs text-muted">File not found</div>}
                  <div className="space-y-0.5 text-[12.5px]">
                    <div className="font-mono text-fg" dir="ltr">{o.target}</div>
                    <div className="text-muted">{[o.stage, o.resolution, o.model].filter(Boolean).join(' · ')}</div>
                  </div>
                  <Assigner project={pr.slug} outputKey={o.key} options={options} />
                </Card>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
