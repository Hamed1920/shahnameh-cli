import { getDecisions, getLearnings } from '@/lib/store'
import { decideLearning } from '../actions'
import { Button } from '@/components/ui/button'
import { Card, EmptyState } from '@/components/ui/card'
import { Disclosure } from '@/components/ui/disclosure'
import { Textarea } from '@/components/ui/field'
import { Reveal } from '@/components/ui/reveal'
import { Badge, PageHeader, SectionHeading } from '@/components/ui/text'

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
    <div className="space-y-10">
      <PageHeader title="Learnings">
        Rules distilled from your accept and deny notes by <code className="text-fg">/learn</code>.
        Only <span className="text-good">approved</span> rules are ever injected into prompts or
        shipped to Claude Chat and Cowork — nothing here influences a generation until you say so.
      </PageHeader>

      <section>
        <SectionHeading>Awaiting your decision ({proposed.length})</SectionHeading>
        {proposed.length === 0 ? (
          <EmptyState>
            Nothing proposed. Run <code className="text-fg">/learn</code> after some reviews.
          </EmptyState>
        ) : (
          <div className="space-y-4">
            {proposed.map((l, i) => (
              <Reveal key={l.id} index={i}>
                <Card className="p-5 transition-colors duration-200 hover:border-edge-strong">
                  <form action={decideLearning}>
                    <input type="hidden" name="id" value={l.id} />
                    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span className="font-mono">{l.id}</span>
                      <Badge>{scopeLabel(l.scope)}</Badge>
                    </div>

                    <Textarea name="rule" rows={2} defaultValue={l.rule} />

                    <Disclosure summary={`Evidence (${l.evidence.length})`} className="mt-4">
                      <ul className="space-y-1 text-xs leading-relaxed text-muted">
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
                    </Disclosure>

                    <div className="mt-5 flex gap-2.5">
                      <Button type="submit" name="status" value="approved" tone="good" size="sm">
                        Approve
                      </Button>
                      <Button type="submit" name="status" value="rejected" size="sm">
                        Reject
                      </Button>
                    </div>
                  </form>
                </Card>
              </Reveal>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeading tone="good">In force ({approved.length})</SectionHeading>
        {approved.length === 0 ? (
          <EmptyState>None yet.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {approved.map((l, i) => (
              <li key={l.id}>
                <Reveal index={i}>
                  <Card interactive className="px-4 py-3.5 text-sm leading-relaxed">
                    <Badge className="mr-2 align-middle">{scopeLabel(l.scope)}</Badge>
                    {l.rule}
                  </Card>
                </Reveal>
              </li>
            ))}
          </ul>
        )}
      </section>

      {rejected.length > 0 && (
        <section>
          <SectionHeading tone="muted">Rejected ({rejected.length})</SectionHeading>
          <ul className="space-y-1 text-sm text-muted/70 line-through">
            {rejected.map((l) => (
              <li key={l.id}>{l.rule}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
