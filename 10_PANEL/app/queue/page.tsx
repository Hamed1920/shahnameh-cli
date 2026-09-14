import {
  getCandidates, getDecisions, getFilings, getGeneratingJobId, getQueue, getWorkerState,
} from '@/lib/store'
import { EmptyState, StatTile } from '@/components/ui/card'
import { Reveal } from '@/components/ui/reveal'
import { Table, Td, Th, Thead, Tr } from '@/components/ui/table'
import { Badge, PageHeader, SectionHeading } from '@/components/ui/text'

export const dynamic = 'force-dynamic'

export default async function QueuePage() {
  const [queue, decisions, candidates, state, filings] = await Promise.all([
    getQueue(),
    getDecisions(),
    getCandidates(),
    getWorkerState(),
    getFilings(),
  ])
  const failedIds = Object.keys((state?.failedDecisions ?? {}) as Record<string, string>)
  const failures = filings.filter((f) => !f.ok && failedIds.includes(f.decisionId)).reverse()

  // The worker's own record is the truth. "Has a file in _staging" is not: a
  // candidate leaves _staging once it is decided, which made finished jobs
  // reappear here as if they were still waiting.
  const processed = new Set((state?.processedJobs ?? []) as string[])
  const waiting = queue.filter((q) => !processed.has(q.jobId))
  const generating = await getGeneratingJobId(processed)
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

      {failures.length > 0 && (
        <section>
          <SectionHeading tone="bad">Decisions the worker could not apply ({failures.length})</SectionHeading>
          <p className="mb-3 max-w-3xl text-sm text-muted">
            Usually a problem with an uploaded reference. Nothing was moved or generated, and each
            candidate is back on the Review page to decide again.
          </p>
          <Table>
            <Thead>
              <tr>
                <Th>Decision</Th>
                <Th>Reason</Th>
                <Th>When</Th>
              </tr>
            </Thead>
            <tbody>
              {failures.map((f) => (
                <Tr key={f.decisionId + f.ts}>
                  <Td className="font-mono text-xs text-fg">{f.decisionId}</Td>
                  <Td className="text-xs text-bad">{f.reason}</Td>
                  <Td className="text-xs text-muted">{f.ts.slice(0, 16).replace('T', ' ')}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}

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
                    {q.jobId === generating && (
                      <Badge tone="accent" className="ml-2">
                        generating now
                      </Badge>
                    )}
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
