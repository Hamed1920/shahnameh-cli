import { notFound } from 'next/navigation'
import { EmptyState } from '@/components/ui/card'
import { Table, Td, Th, Thead, Tr } from '@/components/ui/table'
import { Badge, PageHeader, SectionHeading } from '@/components/ui/text'
import { authEnabled, Forbidden } from '@/lib/actor-core'
import { requireCan } from '@/lib/actor'
import { requireProject } from '@/lib/projects'
import { ApprovalButtons } from './approval-buttons'

export const dynamic = 'force-dynamic'

const when = (d: Date) => d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const TONE = { pending: 'accent', approved: 'muted', executed: 'good', failed: 'bad', rejected: 'muted' } as const

/**
 * The owner's inbox: what agents asked for and are waiting on. Owner only, and only with login
 * on (otherwise there is nobody to ask). Approving runs the request as the owner; the row keeps
 * what happened.
 */
export default async function ApprovalsPage({ params }: PageProps<'/[project]/approvals'>) {
  if (!authEnabled()) notFound()
  const pr = await requireProject((await params).project)
  try {
    await requireCan(pr.slug, 'approval.decide')
  } catch (e) {
    if (e instanceof Forbidden) notFound()
    throw e
  }
  const { listApprovals } = await import('@/lib/approvals')
  const [pending, decided] = await Promise.all([listApprovals(pr.slug, 'pending'), listApprovals(pr.slug, 'decided', 30)])

  return (
    <div className="space-y-14">
      <PageHeader title="Approvals" eyebrow={`Inbox · ${pr.code}`}>
        Things your agents asked to do that spend credits or change the film. Nothing runs until you approve it.
      </PageHeader>

      <section>
        <SectionHeading count={pending.length}>Waiting</SectionHeading>
        {pending.length === 0 ? (
          <EmptyState>Nothing is waiting for you.</EmptyState>
        ) : (
          <Table>
            <Thead>
              <tr><Th>Who</Th><Th>When</Th><Th>What</Th><Th>Request</Th><Th><span className="sr-only">Decide</span></Th></tr>
            </Thead>
            <tbody>
              {pending.map(({ a, requester }) => (
                <Tr key={a.id}>
                  <Td className="whitespace-nowrap text-fg">{requester}</Td>
                  <Td className="font-mono text-[11.5px] whitespace-nowrap text-muted">{when(a.createdAt)}</Td>
                  <Td className="font-mono text-[11.5px] text-muted">{a.capability}</Td>
                  <Td className="text-fg/90" dir="auto">{a.summary}</Td>
                  <Td className="text-right"><ApprovalButtons id={a.id} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section>
        <SectionHeading tone="muted" count={decided.length}>Recent</SectionHeading>
        {decided.length === 0 ? (
          <p className="text-sm text-muted">Nothing decided yet.</p>
        ) : (
          <Table>
            <Thead>
              <tr><Th>Who</Th><Th>When</Th><Th>What</Th><Th>Request</Th><Th>Outcome</Th></tr>
            </Thead>
            <tbody>
              {decided.map(({ a, requester }) => (
                <Tr key={a.id}>
                  <Td className="whitespace-nowrap text-fg">{requester}</Td>
                  <Td className="font-mono text-[11.5px] whitespace-nowrap text-muted">{when(a.createdAt)}</Td>
                  <Td className="font-mono text-[11.5px] text-muted">{a.capability}</Td>
                  <Td className="text-fg/90" dir="auto">{a.summary}</Td>
                  <Td>
                    <Badge tone={TONE[a.status as keyof typeof TONE] ?? 'muted'}>{a.status}</Badge>
                    {a.error && <span className="mt-1 block max-w-xs text-xs text-bad">{a.error}</span>}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  )
}
