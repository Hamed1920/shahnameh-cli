import { getCandidates, getDecisions, getQueue, getWorkerState } from '@/lib/store'
import { EmptyState, StatTile } from '@/components/ui/card'
import { Reveal } from '@/components/ui/reveal'
import { Table, Td, Th, Thead, Tr } from '@/components/ui/table'
import { Badge, PageHeader, SectionHeading } from '@/components/ui/text'

export const dynamic = 'force-dynamic'

export default async function QueuePage() {
  const [queue, decisions, candidates, state] = await Promise.all([
    getQueue(),
    getDecisions(),
    getCandidates(),
    getWorkerState(),
  ])

  const done = new Set(candidates.map((c) => c.sidecar.jobId))
  const waiting = queue.filter((q) => !done.has(q.jobId))
  const accepted = decisions.filter((d) => d.verdict === 'accepted').length
  const denied = decisions.filter((d) => d.verdict === 'denied').length

  const stats = [
    { label: 'Queued', value: waiting.length },
    { label: 'Generated', value: candidates.length },
    { label: 'Accepted', value: accepted },
    { label: 'Denied', value: denied },
  ]

  return (
    <div className="space-y-10">
      <PageHeader title="Queue & worker" />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s, i) => (
          <Reveal key={s.label} index={i} lift>
            <StatTile label={s.label} value={s.value} />
          </Reveal>
        ))}
      </div>

      <section>
        <SectionHeading>Worker</SectionHeading>
        {state ? (
          <pre className="scroll-pane max-h-80 rounded-xl border border-edge bg-sunken p-4 text-xs leading-relaxed">
            {JSON.stringify(state, null, 2)}
          </pre>
        ) : (
          <EmptyState>
            The worker has not run yet. Start it from <code className="text-fg">10_PANEL</code>:{' '}
            <code className="text-fg">npm run worker</code>
          </EmptyState>
        )}
      </section>

      <section>
        <SectionHeading>Waiting to generate ({waiting.length})</SectionHeading>
        {waiting.length === 0 ? (
          <EmptyState>Queue is empty.</EmptyState>
        ) : (
          <Table>
            <Thead>
              <tr>
                <Th>Job</Th>
                <Th>Target</Th>
                <Th>Model</Th>
                <Th>Attempt</Th>
                <Th>Prompt</Th>
              </tr>
            </Thead>
            <tbody>
              {waiting.map((q) => (
                <Tr key={q.jobId}>
                  <Td className="font-mono text-xs">
                    <span className="text-fg">{q.jobId}</span>
                    {q.parentJobId && (
                      <div className="text-muted">from {q.parentJobId}</div>
                    )}
                  </Td>
                  <Td className="font-mono text-xs text-fg">
                    {q.target} {q.variant}
                  </Td>
                  <Td className="text-xs text-muted">{q.model}</Td>
                  <Td className="text-xs">
                    {q.attempt > 1 ? (
                      <Badge tone="accent">{q.attempt}</Badge>
                    ) : (
                      <span className="text-muted">{q.attempt}</span>
                    )}
                  </Td>
                  <Td className="max-w-md text-xs leading-relaxed text-muted">
                    {q.prompt.slice(0, 200)}
                    {q.prompt.length > 200 ? '…' : ''}
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
