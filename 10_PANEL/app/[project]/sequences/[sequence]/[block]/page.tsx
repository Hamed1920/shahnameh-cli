import { notFound } from 'next/navigation'
import { Breadcrumb } from '@/components/breadcrumb'
import { PageHeader } from '@/components/ui/text'
import { sequencePage } from '../../guard'

export const dynamic = 'force-dynamic'

/** Placeholder: the block workspace (prompts, generations, review) is built in the next phase. */
export default async function BlockPage({ params }: PageProps<'/[project]/sequences/[sequence]/[block]'>) {
  const p = await params
  const { pr } = await sequencePage(p.project)
  const { getBlock, getSequence } = await import('@/lib/pd-store')
  const seq = await getSequence(pr.slug, String(p.sequence ?? '').toUpperCase())
  const block = await getBlock(pr.slug, String(p.block ?? '').toUpperCase())
  if (!seq || !block || block.sequenceId !== seq.id) notFound()

  return (
    <div className="space-y-12">
      <div>
        <Breadcrumb
          items={[
            { label: pr.name, href: `/${pr.slug}/sequences` },
            { label: `${seq.id} ${seq.title}`, href: `/${pr.slug}/sequences/${seq.id}` },
            { label: block.id },
          ]}
        />
        <PageHeader title={block.title} eyebrow={block.id}>Block workspace coming next.</PageHeader>
      </div>
    </div>
  )
}
