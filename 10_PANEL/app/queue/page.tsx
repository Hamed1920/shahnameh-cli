import {
  getCandidates, getDecisions, getFilings, getGeneratingJobId, getQueue, getWorkerState, getWorkerStatus,
} from '@/lib/store'
import { WorkerControls } from '@/components/worker-controls'
import { EmptyState, StatTile } from '@/components/ui/card'
import { Reveal } from '@/components/ui/reveal'
import { Table, Td, Th, Thead, Tr } from '@/components/ui/table'
import { Badge, PageHeader, SectionHeading } from '@/components/ui/text'

export const dynamic = 'force-dynamic'

export default async function QueuePage() {
  const [queue, decisions, candidates, state, filings, worker] = await Promise.all([
    getQueue(),
    getDecisions(),
    getCandidates(),
    getWorkerState(),
    getFilings(),
    getWorkerStatus(),
  ])
  const failedIds = Object.keys((state?.failedDecisions ?? {}) as Record<string, string>)
  const failures = filings.filter((f) => !f.ok && failedIds.includes(f.decisionId)).reverse()

  // The worker's own record is the truth. "Has a file in _staging" is not: a
  // candidate leaves _staging once it is decided, which made finished jobs
  // reappear here as if they were still waiting.
  const processed = new Set((state?.processedJobs ?? []) as string[])
  const waiting = queue.filter((q) => !processed.has(q.jobId))
  const generating = await getGeneratingJobId(processed)
  // Jobs the worker will not start yet, and why (a spend ceiling, not logged in).
  const held = (state?.held ?? {}) as Record<string, { reason: string; credits: number | null; since: string }>
  const accepted = decisions.filter((d) => d.verdict === 'accepted').length
  const denied = decisions.filter((d) => d.verdict === 'denied').length

  const stats = [
    { label: 'Queued', value: waiting.length },
    { label: 'Generated', value: candidates.length },
    { label: 'Accepted', value: accepted },
    { label: 'Denied', value: denied },
  ]

  return (
    <div className="space-y-16">
      <PageHeader title="Queue & worker" eyebrow="Generation" meta={<WorkerControls status={worker} generating={generating} />} />

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
          <pre className="scroll-pane max-h-96 rounded-xl border border-edge bg-sunken p-6 font-mono text-xs leading-[1.7] text-fg/80">
            {JSON.stringify(state, null, 2)}
          </pre>
        ) : (
          <EmptyState>The worker has not run yet. The panel starts it on its own.</EmptyState>
        )}
      </section>

      {failures.length > 0 && (
        <section>
          <SectionHeading tone="bad" count={failures.length}>Decisions the worker could not apply</SectionHeading>
          <p className="mb-5 max-w-3xl text-sm leading-relaxed text-muted">
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
                  <Td className="font-mono text-xs whitespace-nowrap text-muted">{f.ts.slice(0, 16).replace('T', ' ')}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}

      <section>
        <SectionHeading count={waiting.length}>Waiting to generate</SectionHeading>
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
                    <span className="font-medium text-fg">{q.jobId}</span>
                    {q.jobId === generating && (
                      <Badge tone="accent" className="ml-2">
                        generating now
                      </Badge>
                    )}
                    {q.jobId !== generating && held[q.jobId] && (
                      <Badge tone="bad" className="ml-2">
                        held
                      </Badge>
                    )}
                    {q.jobId !== generating && held[q.jobId] && (
                      <div className="mt-1 max-w-xs font-sans text-bad">{held[q.jobId].reason}</div>
                    )}
                    {q.parentJobId && (
                      <div className="mt-1 text-faint">from {q.parentJobId}</div>
                    )}
                  </Td>
                  <Td className="font-mono text-xs text-fg">
                    {q.target} {q.variant}
                  </Td>
                  <Td className="font-mono text-xs text-muted">{q.model}</Td>
                  <Td className="text-xs">
                    {q.attempt > 1 ? (
                      <Badge tone="accent">{q.attempt}</Badge>
                    ) : (
                      <span className="font-mono text-muted">{q.attempt}</span>
                    )}
                  </Td>
                  <Td className="max-w-md text-[13px] leading-relaxed text-muted">
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
