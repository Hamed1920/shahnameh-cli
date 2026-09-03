import { getCandidates, getDecisions, getQueue, getWorkerState } from '@/lib/store'

export const dynamic = 'force-dynamic'

export default async function QueuePage() {
  const [queue, decisions, candidates, state] = await Promise.all([
    getQueue(), getDecisions(), getCandidates(), getWorkerState(),
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
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Queue &amp; worker</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] p-4"
          >
            <div className="text-2xl font-semibold">{s.value}</div>
            <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
              {s.label}
            </div>
          </div>
        ))}
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-accent)]">
          Worker
        </h2>
        {state ? (
          <pre className="overflow-x-auto rounded border border-[var(--color-edge)] bg-black/40 p-3 text-xs">
            {JSON.stringify(state, null, 2)}
          </pre>
        ) : (
          <p className="rounded border border-dashed border-[var(--color-edge)] p-6 text-sm text-[var(--color-muted)]">
            The worker has not run yet. Start it from <code className="text-white">10_PANEL</code>:{' '}
            <code className="text-white">npm run worker</code>
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-accent)]">
          Waiting to generate ({waiting.length})
        </h2>
        {waiting.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">Queue is empty.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--color-edge)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-panel)] text-left text-xs uppercase text-[var(--color-muted)]">
                <tr>
                  <th className="px-3 py-2">Job</th>
                  <th className="px-3 py-2">Target</th>
                  <th className="px-3 py-2">Model</th>
                  <th className="px-3 py-2">Attempt</th>
                  <th className="px-3 py-2">Prompt</th>
                </tr>
              </thead>
              <tbody>
                {waiting.map((q) => (
                  <tr key={q.jobId} className="border-t border-[var(--color-edge)] align-top">
                    <td className="px-3 py-2 font-mono text-xs">
                      {q.jobId}
                      {q.parentJobId && (
                        <div className="text-[var(--color-muted)]">from {q.parentJobId}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {q.target} {q.variant}
                    </td>
                    <td className="px-3 py-2 text-xs">{q.model}</td>
                    <td className="px-3 py-2 text-xs">{q.attempt}</td>
                    <td className="max-w-md px-3 py-2 text-xs text-[var(--color-muted)]">
                      {q.prompt.slice(0, 200)}
                      {q.prompt.length > 200 ? '…' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
