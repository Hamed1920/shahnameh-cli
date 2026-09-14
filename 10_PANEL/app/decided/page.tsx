import { DecisionDetails } from '@/components/decision-details'
import { ShowInFolder } from '@/components/show-in-folder'
import { Card, EmptyState } from '@/components/ui/card'
import { Reveal } from '@/components/ui/reveal'
import { Badge, PageHeader, SectionHeading } from '@/components/ui/text'
import { assetUrl, isVideo } from '@/lib/asset'
import { getDecidedEntries, type DecidedEntry, type FollowUp } from '@/lib/decided'

export const dynamic = 'force-dynamic'

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** The take as it is now: the approved draft, the filed final, or the rejected render. */
function Media({ entry }: { entry: DecidedEntry }) {
  if (!entry.file) {
    return (
      <div className="grid aspect-video w-full place-items-center rounded-lg border border-dashed border-edge-strong p-4 text-center text-[13px] text-muted">
        {entry.missing}
      </div>
    )
  }
  const src = assetUrl(entry.file)
  return isVideo(entry.file) ? (
    <video src={src} className="aspect-video w-full rounded-lg border border-edge bg-black object-contain" controls muted loop playsInline preload="metadata" />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={entry.title} className="checker aspect-video w-full rounded-lg border border-edge object-contain" />
  )
}

/** Which shot, which pass, which attempt, and when -- what tells two SC001 cards apart. */
function Heading({ entry }: { entry: DecidedEntry }) {
  const d = entry.decision
  const approvedDraft = d.verdict === 'accepted' && entry.stage === 'draft'
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
      <span className="mr-1 font-display text-2xl leading-none text-fg">{entry.title}</span>
      <span className="font-mono text-xs text-muted">{entry.where}</span>
      {entry.stage && (
        <Badge tone={d.verdict === 'accepted' && !approvedDraft ? 'good' : 'muted'}>
          {approvedDraft ? 'draft approved' : entry.stage}
        </Badge>
      )}
      {entry.attempt > 1 && <Badge tone="muted">attempt {entry.attempt}</Badge>}
      {entry.status === 'waiting' && <Badge tone="accent">waiting for the worker</Badge>}
      {entry.status === 'failed' && <Badge tone="bad">not applied, back on Review</Badge>}
      <span className="ml-auto font-mono text-[11px] text-faint tabular-nums">{when(d.ts)}</span>
    </div>
  )
}

const FOLLOW_UP: Record<FollowUp['state'], { text: string; tone: 'accent' | 'good' | 'bad' | 'muted' }> = {
  queued: { text: 'queued', tone: 'muted' },
  generating: { text: 'generating now', tone: 'accent' },
  'not-generated': { text: 'did not generate, see the worker log', tone: 'bad' },
  'to-review': { text: 'waiting for your review', tone: 'accent' },
  accepted: { text: 'accepted', tone: 'good' },
  denied: { text: 'denied', tone: 'bad' },
}

/** What the decision set off, and where that stands now. */
function FollowUpLine({ entry }: { entry: DecidedEntry }) {
  const d = entry.decision
  const f = entry.followUp
  if (entry.status === 'failed') return null

  if (!f) {
    let text: string | null = null
    if (d.verdict === 'denied') {
      text = !d.requeue
        ? 'Not regenerated.'
        : entry.status === 'waiting'
          ? 'Regenerates once the worker applies this.'
          : 'No regeneration was queued (attempt limit reached?), see the worker log.'
    } else if (entry.stage === 'draft' && entry.status === 'waiting') {
      text = 'The 1080p final is queued once the worker applies this.'
    }
    return text ? <p className="text-xs text-muted">{text}</p> : null
  }

  const s = FOLLOW_UP[f.state]
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <span>{f.stage === 'final' && entry.stage === 'draft' ? '1080p final' : `Attempt ${f.attempt}`}</span>
      <Badge tone={s.tone}>{s.text}</Badge>
      <span className="font-mono text-[11px] text-faint">{f.jobId}</span>
    </p>
  )
}

function Location({ entry }: { entry: DecidedEntry }) {
  if (!entry.file) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="min-w-0 font-mono text-[11px] break-all text-faint">{entry.file}</span>
      <ShowInFolder path={entry.file} />
    </div>
  )
}

export default async function DecidedPage() {
  const entries = await getDecidedEntries()
  const accepted = entries.filter((e) => e.decision.verdict === 'accepted')
  const denied = entries.filter((e) => e.decision.verdict === 'denied')

  return (
    <div className="space-y-16">
      <PageHeader title="Decided" eyebrow="Review log" meta={`${entries.length} decisions, newest first`}>
        Everything you have accepted or denied, and where each take now lives. Nothing is deleted:
        a denied take is kept as the evidence <code className="font-mono text-[13px] text-fg">/learn</code> distils rules
        from.
      </PageHeader>

      <section>
        <SectionHeading tone="good" count={accepted.length}>Accepted</SectionHeading>
        {accepted.length === 0 ? (
          <EmptyState>Nothing accepted yet.</EmptyState>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {accepted.map((e, i) => (
              <Reveal key={e.decision.id} index={i}>
                <Card interactive className="space-y-4 p-5">
                  <Media entry={e} />
                  <Heading entry={e} />
                  {e.notes && (
                    <p className="text-[13px] leading-relaxed text-fg/85" dir="auto">
                      <span className="eyebrow mr-2 text-good">why it worked</span> {e.notes}
                    </p>
                  )}
                  <FollowUpLine entry={e} />
                  <DecisionDetails decision={e.decision} filings={e.filings} failed={e.failedReason ?? undefined} />
                  <Location entry={e} />
                </Card>
              </Reveal>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeading tone="bad" count={denied.length}>Denied</SectionHeading>
        {denied.length === 0 ? (
          <EmptyState>Nothing denied.</EmptyState>
        ) : (
          <div className="space-y-3">
            {denied.map((e, i) => (
              <Reveal key={e.decision.id} index={i}>
                <Card interactive className="flex flex-col gap-6 p-5 sm:flex-row">
                  <div className="shrink-0 sm:w-72">
                    <Media entry={e} />
                  </div>
                  <div className="min-w-0 flex-1 space-y-3.5">
                    <Heading entry={e} />
                    <p className="text-sm leading-relaxed whitespace-pre-line text-fg/90" dir="auto">
                      {e.notes}
                    </p>
                    <FollowUpLine entry={e} />
                    <DecisionDetails decision={e.decision} filings={e.filings} failed={e.failedReason ?? undefined} />
                    <Location entry={e} />
                  </div>
                </Card>
              </Reveal>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
