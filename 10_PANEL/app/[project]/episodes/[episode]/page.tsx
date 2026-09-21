import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { ShowInFolder } from '@/components/show-in-folder'
import { EmptyState, StatTile } from '@/components/ui/card'
import { Reveal } from '@/components/ui/reveal'
import { Badge, PageHeader, SectionHeading } from '@/components/ui/text'
import { EPISODE_RX, episodeLabel, shortEpisode, type EpisodeOption } from '@/lib/episodes'
import { getAcceptedTakes, getEpisodeBoard } from '@/lib/episode-board'
import { requireProject } from '@/lib/projects'
import { getEpisodes, getPendingIndexOps } from '@/lib/store'
import { EpisodePanel } from '../episode-panel'
import { Progress, summarise } from '../progress'
import { SceneCard, credits, shotLabel } from '../scene-card'

export const dynamic = 'force-dynamic'

/**
 * One episode: everything in it, and what can be done to it.
 *
 * The Episodes list is the shape of the film; this is one part of it up close.
 * Both things it offers -- renaming it, putting footage into it -- are requests
 * the worker applies, so the header says when one is still waiting.
 */
export default async function EpisodePage({ params }: PageProps<'/[project]/episodes/[episode]'>) {
  const { project, episode } = await params
  const pr = await requireProject(project)
  const id = String(episode ?? '').toUpperCase()
  if (!EPISODE_RX.test(id)) notFound()

  const [board, episodeList, pending, accepted] = await Promise.all([
    getEpisodeBoard(pr),
    getEpisodes(pr),
    getPendingIndexOps(pr),
    getAcceptedTakes(pr),
  ])
  const ep = board.find((e) => e.id === id)
  if (!ep) notFound()

  const episodes: EpisodeOption[] = episodeList.slice(0, -1).map((e) => ({ id: e.id, title: e.title, shots: e.shots }))
  const next = episodeList[episodeList.length - 1].id
  const { filed } = summarise(ep.counts)
  // Anything the worker still owes this episode, so the page says so rather
  // than looking as though nothing happened.
  const applying = pending.some((op) => String(op.episode ?? '') === id)

  const stats = [
    { label: 'Shots', value: ep.counts.scenes },
    { label: 'Finals filed', value: filed },
    { label: 'In flight', value: ep.counts.working + ep.counts.review },
    { label: 'Credits', value: credits(ep.credits) },
  ]

  return (
    <div className="space-y-14">
      <div>
        <Link
          href={`/${pr.slug}/episodes`}
          className="focus-ring mb-5 inline-flex items-center gap-1.5 rounded text-[12.5px] text-muted transition-colors hover:text-fg"
        >
          <ArrowLeft aria-hidden className="size-3.5" /> All episodes
        </Link>
        <PageHeader
          title={episodeLabel(ep.id, { [ep.id]: ep.title })}
          eyebrow={`Episode · ${pr.code}-${ep.id}`}
          meta={
            <EpisodePanel
              episode={ep.id}
              title={ep.title}
              scenes={ep.scenes.map((s) => ({
                id: s.scene,
                label: s.label ? `${shotLabel(s.scene)} (${s.label})` : shotLabel(s.scene),
              }))}
              accepted={accepted}
              applying={applying}
            />
          }
        >
          {ep.dir ? (
            <>
              Its footage lives in <code className="font-mono text-[13px] text-fg">07_EPISODES/{ep.dir}/shots</code>.
              Right-click a shot to send it elsewhere, copy its id, or open the file.
            </>
          ) : (
            <>
              This episode has no folder yet. The worker makes one the moment something is filed into it —
              an accepted take, or an output added here.
            </>
          )}
        </PageHeader>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s, i) => (
          <Reveal key={s.label} index={i} lift>
            <StatTile label={s.label} value={s.value} />
          </Reveal>
        ))}
      </div>

      <Progress counts={ep.counts} />

      {ep.dir && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="min-w-0 font-mono text-[11px] break-all text-faint">07_EPISODES/{ep.dir}/shots</span>
          <ShowInFolder path={`07_EPISODES/${ep.dir}/shots`} />
        </div>
      )}

      <section>
        <SectionHeading count={ep.scenes.length}>Shots</SectionHeading>
        {ep.scenes.length === 0 ? (
          <EmptyState>
            Nothing here yet. “Add outputs” picks from everything you have accepted and moves it in — or uploads
            footage made anywhere else — and the worker gives each one its number. A prompt approved
            against {shortEpisode(ep.id)} fills it the other way.
          </EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {ep.scenes.map((s, i) => (
              <Reveal key={s.shot} index={i}>
                <SceneCard scene={s} episode={ep.id} project={pr.slug} episodes={episodes} next={next} />
              </Reveal>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeading>Elsewhere</SectionHeading>
        <div className="flex flex-wrap gap-2">
          {[
            { href: `/${pr.slug}/decided?ep=${ep.id}`, label: 'Every decision in this episode' },
            { href: `/${pr.slug}/queue`, label: 'What is queued' },
            { href: `/${pr.slug}/prompts`, label: 'Write prompts for it' },
          ].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="focus-ring inline-flex h-8 items-center rounded-md border border-edge px-3 text-[12.5px] text-muted transition hover:border-edge-strong hover:text-fg"
            >
              {l.label}
            </Link>
          ))}
          {ep.counts.planned > 0 && <Badge tone="muted">{ep.counts.planned} shot(s) targeted but never generated</Badge>}
        </div>
      </section>
    </div>
  )
}
