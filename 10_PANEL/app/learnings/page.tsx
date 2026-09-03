import { getDecisions, getLearnings } from '@/lib/store'
import { decideLearning } from '../actions'

export const dynamic = 'force-dynamic'

function scopeLabel(s: { kind: string | null; entity: string | null; family: string | null }) {
  if (s.entity) return s.entity
  if (s.family) return `family ${s.family}`
  if (s.kind) return `all ${s.kind}`
  return 'global'
}

export default async function LearningsPage() {
  const [learnings, decisions] = await Promise.all([getLearnings(), getDecisions()])
  const byId = new Map(decisions.map((d) => [d.id, d]))
  const proposed = learnings.filter((l) => l.status === 'proposed')
  const approved = learnings.filter((l) => l.status === 'approved')
  const rejected = learnings.filter((l) => l.status === 'rejected')

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold">Learnings</h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--color-muted)]">
          Rules distilled from your accept and deny notes by <code className="text-white">/learn</code>.
          Only <span className="text-[var(--color-good)]">approved</span> rules are ever injected
          into prompts or shipped to Claude Chat and Cowork — nothing here influences a generation
          until you say so.
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-accent)]">
          Awaiting your decision ({proposed.length})
        </h2>
        {proposed.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--color-edge)] p-6 text-sm text-[var(--color-muted)]">
            Nothing proposed. Run <code className="text-white">/learn</code> after some reviews.
          </p>
        ) : (
          <div className="space-y-4">
            {proposed.map((l) => (
              <form
                key={l.id}
                action={decideLearning}
                className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] p-4"
              >
                <input type="hidden" name="id" value={l.id} />
                <div className="mb-2 flex gap-3 text-xs text-[var(--color-muted)]">
                  <span className="font-mono">{l.id}</span>
                  <span className="rounded bg-black/40 px-2">{scopeLabel(l.scope)}</span>
                </div>
                <textarea
                  name="rule"
                  rows={2}
                  defaultValue={l.rule}
                  className="w-full rounded border border-[var(--color-edge)] bg-black/40 p-2 text-sm"
                />
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-[var(--color-muted)]">
                    Evidence ({l.evidence.length})
                  </summary>
                  <ul className="mt-2 space-y-1 text-xs text-[var(--color-muted)]">
                    {l.evidence.map((id) => {
                      const d = byId.get(id)
                      return (
                        <li key={id}>
                          <span className="font-mono">{id}</span>
                          {d ? ` — ${d.verdict}: ${d.notes}` : ' — (decision not found)'}
                        </li>
                      )
                    })}
                  </ul>
                </details>
                <div className="mt-3 flex gap-2">
                  <button
                    name="status"
                    value="approved"
                    className="rounded bg-[var(--color-good)] px-4 py-1.5 text-sm text-white"
                  >
                    Approve
                  </button>
                  <button
                    name="status"
                    value="rejected"
                    className="rounded border border-[var(--color-edge)] px-4 py-1.5 text-sm text-[var(--color-muted)]"
                  >
                    Reject
                  </button>
                </div>
              </form>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-good)]">
          In force ({approved.length})
        </h2>
        <ul className="space-y-2">
          {approved.map((l) => (
            <li
              key={l.id}
              className="rounded border border-[var(--color-edge)] bg-[var(--color-panel)] p-3 text-sm"
            >
              <span className="mr-2 rounded bg-black/40 px-2 text-xs text-[var(--color-muted)]">
                {scopeLabel(l.scope)}
              </span>
              {l.rule}
            </li>
          ))}
          {approved.length === 0 && (
            <li className="text-sm text-[var(--color-muted)]">None yet.</li>
          )}
        </ul>
      </section>

      {rejected.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Rejected ({rejected.length})
          </h2>
          <ul className="space-y-1 text-sm text-[var(--color-muted)] line-through">
            {rejected.map((l) => <li key={l.id}>{l.rule}</li>)}
          </ul>
        </section>
      )}
    </div>
  )
}
