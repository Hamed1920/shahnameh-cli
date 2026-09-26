import { requireProject } from '@/lib/projects'
import { parseMentions } from '@/lib/mentions'
import { getDecisions, getLearnings, resolveRefToken } from '@/lib/store'
import { LearningForm } from './learning-form'
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

export default async function LearningsPage({ params }: PageProps<'/[project]/learnings'>) {
  const pr = await requireProject((await params).project)
  const [learnings, decisions] = await Promise.all([getLearnings(pr), getDecisions(pr)])
  const byId = new Map(decisions.map((d) => [d.id, d]))
  const proposed = learnings.filter((l) => l.status === 'proposed')
  const approved = learnings.filter((l) => l.status === 'approved')
  const rejected = learnings.filter((l) => l.status === 'rejected')

  // A rule that names a look is sent with that picture attached (worker/lib/plan.mjs).
  // A look that has since been archived or never existed cannot be, so say which.
  const broken = new Map<string, string[]>()
  for (const l of [...proposed, ...approved]) {
    const bad: string[] = []
    for (const token of parseMentions(l.rule)) if (!(await resolveRefToken(pr, token))) bad.push(token)
    if (bad.length) broken.set(l.id, bad)
  }
  const brokenNote = (id: string) => broken.has(id) && (
    <p className="mt-2 text-xs leading-relaxed text-bad">
      Names {broken.get(id)!.join(', ')}, which is not in the index any more (archived or never filed), so no picture
      is sent with it; the prompt only names the entity. Point it at a look that exists.
    </p>
  )

  return (
    <div className="space-y-16">
      <PageHeader
        title="Learnings"
        eyebrow="Prompt rules"
        meta={`${approved.length} in force · ${proposed.length} proposed`}
      >
        Rules distilled from your accept and deny notes by <code className="font-mono text-[13px] text-fg">/learn</code>.
        Only <span className="text-good">approved</span> rules are ever injected into prompts or
        shipped to Claude Chat and Cowork — nothing here influences a generation until you say so.
      </PageHeader>

      <section>
        <SectionHeading count={proposed.length}>Awaiting your decision</SectionHeading>
        {proposed.length === 0 ? (
          <EmptyState>
            Nothing proposed. Run <code className="font-mono text-[13px] text-fg">/learn</code> after some reviews.
          </EmptyState>
        ) : (
          <div className="space-y-4">
            {proposed.map((l, i) => (
              <Reveal key={l.id} index={i}>
                <Card className="p-6 transition-colors duration-200 hover:border-edge-strong">
                  <LearningForm project={pr.slug} id={l.id}>
                    <div className="mb-4 flex flex-wrap items-center gap-2.5 text-xs text-muted">
                      <span className="font-mono text-faint">{l.id}</span>
                      <Badge>{scopeLabel(l.scope)}</Badge>
                    </div>

                    <Textarea name="rule" rows={2} defaultValue={l.rule} className="text-[15px]" />
                    {brokenNote(l.id)}

                    <Disclosure summary={`Evidence (${l.evidence.length})`} className="mt-5">
                      <ul className="space-y-2 border-l border-edge pl-4 text-[13px] leading-relaxed text-muted">
                        {l.evidence.map((id) => {
                          const d = byId.get(id)
                          return (
                            <li key={id}>
                              <span className="font-mono text-xs text-faint">{id}</span>
                              {d ? ` — ${d.verdict}: ${d.notes}` : ' — (decision not found)'}
                            </li>
                          )
                        })}
                      </ul>
                    </Disclosure>
                  </LearningForm>
                </Card>
              </Reveal>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeading tone="good" count={approved.length}>In force</SectionHeading>
        {approved.length === 0 ? (
          <EmptyState>None yet.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {approved.map((l, i) => (
              <li key={l.id}>
                <Reveal index={i}>
                  <Card interactive className="flex items-start gap-4 px-6 py-5 text-[15px] leading-relaxed">
                    <Badge className="mt-0.5 shrink-0">{scopeLabel(l.scope)}</Badge>
                    <span className="text-fg/90">
                      {l.rule}
                      {brokenNote(l.id)}
                    </span>
                  </Card>
                </Reveal>
              </li>
            ))}
          </ul>
        )}
      </section>

      {rejected.length > 0 && (
        <section>
          <SectionHeading tone="muted" count={rejected.length}>Rejected</SectionHeading>
          <ul className="space-y-2 text-sm text-faint line-through decoration-edge-strong">
            {rejected.map((l) => (
              <li key={l.id}>{l.rule}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
