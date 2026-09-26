import Link from 'next/link'
import { DecisionDetails } from '@/components/decision-details'
import { ItemMenu, type ItemAction } from '@/components/item-menu'
import { MoveErrors } from '@/components/move-errors'
import { RegenerateButton } from '@/components/regenerate-button'
import { ShowInFolder } from '@/components/show-in-folder'
import { Card, EmptyState } from '@/components/ui/card'
import { Reveal } from '@/components/ui/reveal'
import { Badge, PageHeader, SectionHeading } from '@/components/ui/text'
import { TakeMedia } from '@/components/take-media'
import { assetUrl, isFiledShot } from '@/lib/asset'
import { getDecidedEntries, type DecidedEntry, type FollowUp } from '@/lib/decided'
import { requireProject } from '@/lib/projects'
import { cn } from '@/lib/cn'
import { episodeLabel, episodesIn, shortEpisode, NO_EPISODE_LABEL, type EpisodeOption } from '@/lib/episodes'
import { getCatalog, getEpisodes, getPriceTable, getShotMoveRequests, getWorkerConfig } from '@/lib/store'
import type { RegenerateConfig } from '@/components/regenerate-button'

export const dynamic = 'force-dynamic'

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** The take as it is now: the approved draft, the filed final, or the rejected render. */
function Media({ entry, project }: { entry: DecidedEntry; project: string }) {
  if (!entry.file) {
    return (
      <div className="grid aspect-video w-full place-items-center rounded-lg border border-dashed border-edge-strong p-4 text-center text-[13px] text-muted">
        {entry.missing}
      </div>
    )
  }
  return <TakeMedia file={entry.file} alt={entry.title} />
}

/** Which shot, which pass, which attempt, and when -- what tells two SC001 cards apart. */
function Heading({ entry, movingTo }: { entry: DecidedEntry; movingTo?: string | null }) {
  const d = entry.decision
  const approvedDraft = d.verdict === 'accepted' && entry.stage === 'draft'
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
      <span className="mr-1 font-display text-2xl leading-none text-fg">{entry.title}</span>
      <span className="font-mono text-xs text-muted">{entry.where}</span>
      {movingTo && <Badge tone="accent">moving to {shortEpisode(movingTo)}</Badge>}
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

/**
 * Which episode is being read, as links rather than client state: the URL then
 * says which one, so it survives a reload and can be sent to someone.
 */
function EpisodeFilter({ project, episodes, titles, loose, current, countOf }: {
  project: string
  episodes: string[]
  titles: Record<string, string>
  loose: boolean
  current: string
  countOf: (episode: string) => number
}) {
  if (episodes.length < 2 && !(episodes.length === 1 && loose)) return null
  const chips = [
    { id: '', label: 'All' },
    ...episodes.map((e) => ({ id: e, label: episodeLabel(e, titles) })),
    ...(loose ? [{ id: 'none', label: NO_EPISODE_LABEL }] : []),
  ]
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[11.5px] text-faint">Episode</span>
      {chips.map((c) => (
        <Link
          key={c.id || 'all'}
          href={c.id ? `/${project}/decided?ep=${c.id}` : `/${project}/decided`}
          aria-current={current === c.id ? 'true' : undefined}
          className={cn(
            'focus-ring inline-flex h-6 items-center rounded-full border px-2.5 text-[11.5px] transition',
            current === c.id ? 'border-accent bg-accent/8 text-fg' : 'border-edge text-muted hover:border-edge-strong',
          )}
        >
          {c.label}
          <span className="ml-1.5 font-mono text-faint tabular-nums">{c.id ? countOf(c.id) : countOf('')}</span>
        </Link>
      ))}
    </div>
  )
}

/** What a right-click on one decided take offers: its episode, its ids, its file. */
function menuFor(
  entry: DecidedEntry,
  project: string,
  current: string,
  episodes: EpisodeOption[],
  nextEpisode: string,
  titles: Record<string, string>,
  pendingMoves: Record<string, string>,
): ItemAction[] {
  const out: ItemAction[] = [{ kind: 'heading', text: `${entry.title} · ${entry.where}` }]
  if (entry.episode) {
    out.push({
      kind: 'link',
      label: `Only ${shortEpisode(entry.episode)}`,
      href: `/${project}/decided?ep=${entry.episode}`,
      icon: 'episode',
      active: current === entry.episode,
    })
  }
  if (current) out.push({ kind: 'link', label: 'All episodes', href: `/${project}/decided`, icon: 'filter' })
  // Only footage has an episode to move between, and only once it is filed in the
  // episode: an approved draft is kept in _drafts, and there is nothing yet to move.
  if (entry.episode && entry.file && isFiledShot(entry.file)) {
    out.push({
      kind: 'assign',
      shots: [entry.target],
      episodes,
      next: nextEpisode,
      exclude: [entry.episode],
      pendingTo: pendingMoves[entry.target] ?? null,
    })
  }
  out.push({ kind: 'divider' })
  out.push({ kind: 'copy', label: 'Copy the shot id', text: entry.target })
  out.push({ kind: 'copy', label: 'Copy the job id', text: entry.decision.jobId })
  if (entry.file) {
    out.push({ kind: 'reveal', label: 'Show in folder', path: entry.file })
    out.push({ kind: 'open', label: 'Open the file', href: assetUrl(project, entry.file) })
  }
  return out
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

export default async function DecidedPage({ params, searchParams }: PageProps<'/[project]/decided'>) {
  const pr = await requireProject((await params).project)
  const [all, catalog, cfg, priceTable, episodeList, moves] = await Promise.all([
    getDecidedEntries(pr), getCatalog(pr), getWorkerConfig(), getPriceTable(), getEpisodes(pr), getShotMoveRequests(pr),
  ])
  const titles = Object.fromEntries(episodeList.filter((e) => e.title).map((e) => [e.id, e.title]))
  // getEpisodes ends with the next free number, which is not an episode yet.
  const allEpisodes: EpisodeOption[] = episodeList.slice(0, -1).map((e) => ({ id: e.id, title: e.title, shots: e.shots }))
  const nextEpisode = episodeList[episodeList.length - 1].id
  // The filter only offers what has something decided in it; a filter on an
  // empty episode is a dead end. Moving to one is a different question.
  const episodes = episodesIn([], all.map((e) => e.episode))
  const loose = all.some((e) => e.episode === null)
  const wanted = String((await searchParams).ep ?? '')
  // An episode with nothing decided in it is not a filter, it is a stale link.
  const ep = wanted === 'none' ? (loose ? 'none' : '') : episodes.includes(wanted) ? wanted : ''
  const matches = (e: DecidedEntry) => (ep === 'none' ? e.episode === null : !ep || e.episode === ep)
  const entries = all.filter(matches)
  const regenCfg: RegenerateConfig = {
    pinned: (cfg.pinnedModels as string[] | undefined) ?? [],
    aspectRatios: (cfg.aspectRatios as string[]) ?? ['16:9', '9:16', '1:1'],
    videoDurations: (cfg.videoDurations as number[]) ?? [5, 10, 15],
    videoDraftResolution: String(cfg.videoDraftResolution ?? '480p'),
    videoFinalResolution: String(cfg.videoFinalResolution ?? '1080p'),
  }
  // Plain object: a Map does not survive the server -> client boundary.
  const prices = Object.fromEntries(priceTable)
  const accepted = entries.filter((e) => e.decision.verdict === 'accepted')
  const denied = entries.filter((e) => e.decision.verdict === 'denied')

  return (
    <div className="space-y-16">
      <PageHeader
        title="Decided"
        eyebrow={ep ? `Review log · ${ep === 'none' ? NO_EPISODE_LABEL : episodeLabel(ep, titles)}` : 'Review log'}
        meta={`${entries.length} decision${entries.length === 1 ? '' : 's'}, newest first`}
      >
        Everything you have accepted or denied, and where each take now lives. Nothing is deleted:
        a denied take is kept as the evidence <code className="font-mono text-[13px] text-fg">/learn</code> distils rules
        from.
      </PageHeader>

      {moves.failed.length > 0 && (
        <div className="space-y-2">
          <MoveErrors errors={moves.failed} />
        </div>
      )}

      <EpisodeFilter
        project={pr.slug}
        episodes={episodes}
        titles={titles}
        loose={loose}
        current={ep}
        countOf={(episode) => (episode ? all.filter((e) => (episode === 'none' ? e.episode === null : e.episode === episode)).length : all.length)}
      />

      <section>
        <SectionHeading tone="good" count={accepted.length}>Accepted</SectionHeading>
        {accepted.length === 0 ? (
          <EmptyState>Nothing accepted yet.</EmptyState>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {accepted.map((e, i) => (
              <Reveal key={e.decision.id} index={i}>
                <ItemMenu actions={menuFor(e, pr.slug, ep, allEpisodes, nextEpisode, titles, moves.pending)}>
                <Card interactive className="space-y-4 p-5">
                  <Media entry={e} project={pr.slug} />
                  <Heading entry={e} movingTo={moves.pending[e.target]} />
                  {e.notes && (
                    <p className="text-[13px] leading-relaxed text-fg/85" dir="auto">
                      <span className="eyebrow mr-2 text-good">why it worked</span> {e.notes}
                    </p>
                  )}
                  <FollowUpLine entry={e} />
                  <DecisionDetails decision={e.decision} filings={e.filings} failed={e.failedReason ?? undefined} />
                  <Location entry={e} />
                  {e.status === 'applied' && (
                    <RegenerateButton
                      jobId={e.decision.jobId}
                      decisionId={e.decision.id}
                      credits={e.regenerateCredits}
                      source={e.source}
                      catalog={catalog}
                      cfg={regenCfg}
                      regenerations={e.regenerations}
                      prices={prices}
                    />
                  )}
                </Card>
                </ItemMenu>
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
                <ItemMenu actions={menuFor(e, pr.slug, ep, allEpisodes, nextEpisode, titles, moves.pending)}>
                <Card interactive className="flex flex-col gap-6 p-5 sm:flex-row">
                  <div className="shrink-0 sm:w-72">
                    <Media entry={e} project={pr.slug} />
                  </div>
                  <div className="min-w-0 flex-1 space-y-3.5">
                    <Heading entry={e} movingTo={moves.pending[e.target]} />
                    <p className="text-sm leading-relaxed whitespace-pre-line text-fg/90" dir="auto">
                      {e.notes}
                    </p>
                    <FollowUpLine entry={e} />
                    <DecisionDetails decision={e.decision} filings={e.filings} failed={e.failedReason ?? undefined} />
                    <Location entry={e} />
                  </div>
                </Card>
                </ItemMenu>
              </Reveal>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
