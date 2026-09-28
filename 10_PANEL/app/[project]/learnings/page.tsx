import { Globe, Layers, Shapes } from 'lucide-react'
import { requireProject } from '@/lib/projects'
import { thumbUrl } from '@/lib/asset'
import { KIND_LABEL, type Kind } from '@/lib/indexing'
import { getLearningsView } from '@/lib/learnings-view'
import { getCatalog } from '@/lib/store'
import type { LearningView, ScopeView } from '@/lib/types'
import type { MentionOption } from '@/components/mention-textarea'
import { RefTiles } from '@/components/ref-tiles'
import { RuleText } from '@/components/rule-text'
import { Card, EmptyState } from '@/components/ui/card'
import { Disclosure } from '@/components/ui/disclosure'
import { Reveal } from '@/components/ui/reveal'
import { Badge, PageHeader, SectionHeading } from '@/components/ui/text'
import { cn } from '@/lib/cn'
import { EvidenceStrip, EvidenceThumbs } from './evidence-strip'
import { LearningForm } from './learning-form'

export const dynamic = 'force-dynamic'

const LEVEL_ORDER: ScopeView['level'][] = ['entity', 'family', 'kind', 'global']

function when(iso: string | null) {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Who the rule is for: the entity's current look, or what the rule covers in words. */
function Scope({ scope, project, size = 'md' }: { scope: ScopeView; project: string; size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'size-16' : 'size-12'
  const Icon = scope.level === 'global' ? Globe : scope.level === 'kind' ? Shapes : Layers
  return (
    <div className="flex min-w-0 items-center gap-3.5">
      {scope.path ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbUrl(project, scope.path, 240)} alt="" loading="lazy" className={cn(box, 'checker shrink-0 rounded-lg border border-edge object-cover')} />
      ) : (
        <span className={cn(box, 'grid shrink-0 place-items-center rounded-lg border border-edge bg-sunken text-muted')}>
          <Icon aria-hidden strokeWidth={1.5} className="size-5" />
        </span>
      )}
      <div className="min-w-0">
        <p className="eyebrow text-faint">Applies to</p>
        <p className={cn('truncate text-fg', size === 'lg' ? 'font-display text-2xl leading-tight' : 'text-[15px]')}>{scope.label}</p>
        {scope.sublabel && <p className="truncate font-mono text-[11px] text-faint">{scope.sublabel}</p>}
      </div>
    </div>
  )
}

function Proposed({ l, project, options, index }: { l: LearningView; project: string; options: MentionOption[]; index: number }) {
  return (
    <Reveal index={index}>
      <Card className="p-6 sm:p-7">
        <LearningForm
          project={project}
          id={l.id}
          text={l.rule}
          options={options}
          head={
            <div className="flex flex-wrap items-start justify-between gap-4">
              <Scope scope={l.scope} project={project} size="lg" />
              <span className="font-mono text-[11px] text-faint">{l.id} · proposed {when(l.created)}</span>
            </div>
          }
          rule={<RuleText segments={l.segments} className="font-display text-[26px] leading-[1.3] text-fg" />}
        >
          {l.refs.length > 0 && (
            <div className="mt-7">
              <p className="eyebrow mb-3 text-muted">Looks this rule sends with the prompt</p>
              <RefTiles refs={l.refs} />
            </div>
          )}
          <div className="mt-7">
            <p className="eyebrow mb-3 text-muted">
              Learned from {l.evidence.length} take{l.evidence.length === 1 ? '' : 's'}
            </p>
            {l.evidence.length > 0 ? <EvidenceStrip evidence={l.evidence} /> : <EmptyState>No evidence recorded.</EmptyState>}
          </div>
        </LearningForm>
      </Card>
    </Reveal>
  )
}

function InForce({ l, index }: { l: LearningView; index: number }) {
  return (
    <Reveal index={index}>
      <Card className="space-y-4 p-5">
        <RuleText segments={l.segments} className="text-[15px] leading-[1.75] text-fg/90" />
        {l.refs.some((r) => !r.path) && (
          <p className="text-xs leading-relaxed text-bad">
            A look it names is not in the index any more, so that picture is not sent; the prompt only names the entity.
          </p>
        )}
        <div className="flex flex-wrap items-end justify-between gap-3">
          {l.evidence.length > 0 && <EvidenceThumbs evidence={l.evidence} />}
          <span className="ml-auto font-mono text-[11px] text-faint">
            {l.id}{l.decidedAt && ` · approved ${when(l.decidedAt)}`}
          </span>
        </div>
      </Card>
    </Reveal>
  )
}

export default async function LearningsPage({ params }: PageProps<'/[project]/learnings'>) {
  const pr = await requireProject((await params).project)
  const [views, catalog] = await Promise.all([getLearningsView(pr), getCatalog(pr)])
  const proposed = views.filter((l) => l.status === 'proposed')
  const approved = views.filter((l) => l.status === 'approved')
  const rejected = views.filter((l) => l.status === 'rejected')

  // Every look in the index, for "@" while editing a rule's wording.
  const options: MentionOption[] = catalog.flatMap((e) =>
    e.variants.map((v) => ({
      token: `@${e.shortId}/${v.variant}`,
      position: 0,
      title: e.name,
      subtitle: `${v.variant} · ${KIND_LABEL[e.kind as Kind] ?? e.kind}`,
      thumb: thumbUrl(pr.slug, v.path, 96),
      keywords: `${e.id} ${e.kind}${v.variant === e.canonical ? ' canonical' : ''}`,
    })),
  )

  // In force, grouped by who it applies to: one entity at a time, then the broad rules.
  const groups = new Map<string, { scope: ScopeView; rules: LearningView[] }>()
  for (const l of [...approved].sort((a, b) => LEVEL_ORDER.indexOf(a.scope.level) - LEVEL_ORDER.indexOf(b.scope.level) || a.scope.label.localeCompare(b.scope.label))) {
    const g = groups.get(l.scope.key) ?? { scope: l.scope, rules: [] }
    g.rules.push(l)
    groups.set(l.scope.key, g)
  }

  let n = 0
  return (
    <div className="space-y-16">
      <PageHeader
        title="Learnings"
        eyebrow="Prompt rules"
        meta={`${approved.length} in force · ${proposed.length} awaiting you`}
      >
        Rules <code className="font-mono text-[13px] text-fg">/learn</code> distils from your review notes. Only the ones
        you <span className="text-good">approve</span> reach a prompt, with the looks they name attached.
      </PageHeader>

      <section>
        <SectionHeading count={proposed.length}>Awaiting your decision</SectionHeading>
        {proposed.length === 0 ? (
          <EmptyState>
            Nothing proposed. Run <code className="font-mono text-[13px] text-fg">/learn</code> after some reviews.
          </EmptyState>
        ) : (
          <div className="space-y-6">
            {proposed.map((l, i) => <Proposed key={l.id} l={l} project={pr.slug} options={options} index={i} />)}
          </div>
        )}
      </section>

      <section>
        <SectionHeading tone="good" count={approved.length}>In force</SectionHeading>
        {approved.length === 0 ? (
          <EmptyState>None yet.</EmptyState>
        ) : (
          <div className="space-y-10">
            {[...groups.values()].map((g) => (
              <div key={g.scope.key} className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-8">
                <div className="lg:sticky lg:top-[calc(var(--sticky-h,6rem)+1rem)] lg:self-start">
                  <Scope scope={g.scope} project={pr.slug} />
                  <p className="mt-2 font-mono text-[11px] text-faint">
                    {g.rules.length} rule{g.rules.length === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="space-y-3">
                  {g.rules.map((l) => <InForce key={l.id} l={l} index={n++} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {rejected.length > 0 && (
        <section>
          <Disclosure summary={`Rejected (${rejected.length})`}>
            <ul className="space-y-2 pt-2">
              {rejected.map((l) => (
                <li key={l.id} className="flex flex-wrap items-start gap-3 rounded-lg border border-edge px-4 py-3">
                  <Badge tone="muted" className="mt-0.5 shrink-0">{l.scope.label}</Badge>
                  <RuleText segments={l.segments} className="min-w-0 flex-1 text-sm text-faint line-through decoration-edge-strong" />
                </li>
              ))}
            </ul>
          </Disclosure>
        </section>
      )}
    </div>
  )
}
