import {
  getCandidates, getDecisions, getEpisodes, getFilings, getGeneratingJobId, getQueue, getWorkerState, getWorkerStatus,
} from '@/lib/store'
import { listProjects, requireProject } from '@/lib/projects'
import { workersPaused } from '@/lib/worker-guard'
import { episodeLabel, episodeOf, groupByEpisode, shortEpisode, NO_EPISODE_LABEL } from '@/lib/episodes'
import { WorkerControls } from '@/components/worker-controls'
import { WorkerSwitch } from '@/components/worker-switch'
import { Disclosure } from '@/components/ui/disclosure'
import { EmptyState, StatTile } from '@/components/ui/card'
import { Reveal } from '@/components/ui/reveal'
import { ItemMenu, type ItemAction } from '@/components/item-menu'
import { Table, TR_CLASS, Td, Th, Thead, Tr } from '@/components/ui/table'
import { Badge, PageHeader, SectionHeading } from '@/components/ui/text'
import type { QueueItem } from '@/lib/types'

export const dynamic = 'force-dynamic'

/** What a right-click on a queued job offers: its ids, its prompt, and where its episode is reviewed. */
function menuFor(q: QueueItem, project: string, code: string): ItemAction[] {
  const episode = episodeOf(q.target, code)
  const out: ItemAction[] = [{ kind: 'heading', text: q.jobId }]
  if (episode) {
    out.push({ kind: 'link', label: `See ${shortEpisode(episode)} in Decided`, href: `/${project}/decided?ep=${episode}`, icon: 'episode' })
    out.push({ kind: 'divider' })
  }
  out.push({ kind: 'copy', label: 'Copy the job id', text: q.jobId })
  // A reference-studio try has no target: it makes a picture, filed when it is picked.
  if (q.target) out.push({ kind: 'copy', label: 'Copy the target', text: q.target })
  out.push({ kind: 'copy', label: 'Copy the prompt', text: q.prompt })
  return out
}

export default async function QueuePage({ params }: PageProps<'/[project]/queue'>) {
  const pr = await requireProject((await params).project)
  const [queue, decisions, candidates, state, filings, worker, episodeList] = await Promise.all([
    getQueue(pr),
    getDecisions(pr),
    getCandidates(pr),
    getWorkerState(pr),
    getFilings(pr),
    getWorkerStatus(pr),
    getEpisodes(pr),
  ])
  const failedIds = Object.keys((state?.failedDecisions ?? {}) as Record<string, string>)
  const failures = filings.filter((f) => !f.ok && !!f.decisionId && failedIds.includes(f.decisionId)).reverse()
  // Generations that ended without a take, and why (worker.mjs recordFailure). The ten newest.
  const failedJobs = Object.entries((state?.failedJobs ?? {}) as Record<string, { reason: string; at: string }>)
    .sort(([, a], [, b]) => b.at.localeCompare(a.at))
    .slice(0, 10)
  // Stop/Start covers every project's worker, so it needs all of them.
  const everyWorker = await Promise.all((await listProjects()).map((p) => getWorkerStatus(p)))
  const runningWorkers = everyWorker.filter((w) => w.running).length

  // The worker's own record is the truth. "Has a file in _staging" is not: a
  // candidate leaves _staging once it is decided, which made finished jobs
  // reappear here as if they were still waiting.
  const processed = new Set((state?.processedJobs ?? []) as string[])
  const waiting = queue.filter((q) => !processed.has(q.jobId))
  const generating = await getGeneratingJobId(pr, processed)
  // Jobs the worker will not start yet, and why (a spend ceiling, not logged in).
  const held = (state?.held ?? {}) as Record<string, { reason: string; credits: number | null; since: string }>
  const accepted = decisions.filter((d) => d.verdict === 'accepted').length
  const denied = decisions.filter((d) => d.verdict === 'denied').length

  // What is still owed, episode by episode: the queue is spending, and spending
  // is planned one episode at a time.
  const titles = Object.fromEntries(episodeList.filter((e) => e.title).map((e) => [e.id, e.title]))
  const byEpisode = groupByEpisode(waiting, (q) => episodeOf(q.target, pr.code))

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

      <WorkerSwitch paused={workersPaused()} running={runningWorkers} />

      {failedJobs.length > 0 && (
        <section>
          <SectionHeading tone="bad" count={failedJobs.length}>Generations that failed</SectionHeading>
          <Table>
            <Thead>
              <tr>
                <Th>Job</Th>
                <Th>Reason</Th>
                <Th>When</Th>
              </tr>
            </Thead>
            <tbody>
              {failedJobs.map(([jobId, f]) => (
                <Tr key={jobId}>
                  <Td className="font-mono text-xs text-fg">{jobId}</Td>
                  <Td className="text-xs text-bad" dir="auto">{f.reason}</Td>
                  <Td className="font-mono text-xs whitespace-nowrap text-muted">{f.at.slice(0, 16).replace('T', ' ')}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}

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
          <div className="space-y-8">
            {byEpisode.map((group) => (
              <div key={group.episode ?? 'none'}>
                {byEpisode.length > 1 && (
                  <h3 className="mb-3 flex items-center gap-2.5 text-[12.5px]">
                    <span className="text-fg">
                      {group.episode ? episodeLabel(group.episode, titles) : NO_EPISODE_LABEL}
                    </span>
                    <span className="font-mono text-[11px] text-faint tabular-nums">
                      {group.items.length} job{group.items.length === 1 ? '' : 's'}
                    </span>
                  </h3>
                )}
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
                    {group.items.map((q) => (
                      <ItemMenu key={q.jobId} as="tr" className={TR_CLASS} actions={menuFor(q, pr.slug, pr.code)}>
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
                          {q.target ? `${q.target} ${q.variant ?? ''}` : <span className="font-sans text-muted">reference studio</span>}
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
                      </ItemMenu>
                    ))}
                  </tbody>
                </Table>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* The worker's raw record: rarely needed, so last and closed until asked for. */}
      <section>
        <SectionHeading>Worker</SectionHeading>
        {state ? (
          <Disclosure summary="Show the worker’s state (state.json)">
            <pre className="scroll-pane max-h-96 rounded-xl border border-edge bg-sunken p-6 font-mono text-xs leading-[1.7] text-fg/80">
              {JSON.stringify(state, null, 2)}
            </pre>
          </Disclosure>
        ) : (
          <EmptyState>The worker has not run yet. The panel starts it on its own.</EmptyState>
        )}
      </section>
    </div>
  )
}
