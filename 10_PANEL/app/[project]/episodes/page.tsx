import Link from 'next/link'
import { ArrowRight, FolderOpen } from 'lucide-react'
import { Card, EmptyState, StatTile } from '@/components/ui/card'
import { Reveal } from '@/components/ui/reveal'
import { PageHeader, SectionHeading } from '@/components/ui/text'
import { shortEpisode } from '@/lib/episodes'
import { getEpisodeBoard } from '@/lib/episode-board'
import { requireProject } from '@/lib/projects'
import { getEpisodes } from '@/lib/store'
import type { EpisodeBoard } from '@/lib/types'
import { NewEpisode } from './new-episode'
import { Progress } from './progress'
import { credits } from './scene-card'

export const dynamic = 'force-dynamic'

/**
 * The film, episode by episode: one tile each, and nothing else.
 *
 * Deliberately no thumbnails. This page is for getting to an episode, and a
 * wall of videos is slower to load and much slower to read than a grid of
 * names -- the footage is one click away, on the episode's own page.
 */

/** One episode as a tile: what it is, how far it has got, and how to get in. */
function EpisodeTile({ ep, project }: { ep: EpisodeBoard; project: string }) {
  return (
    <Link href={`/${project}/episodes/${ep.id}`} className="focus-ring block rounded-xl">
      <Card interactive className="group flex h-full flex-col gap-4 p-5">
        {/* The number leads: it is what an episode is called out loud, and what
            every id in it carries. The name is how it is told apart. */}
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[34px] leading-none text-fg transition-colors group-hover:text-accent">
              {shortEpisode(ep.id)}
            </h2>
            <p className="mt-2 truncate text-[13px] text-muted" title={ep.title || undefined}>
              {ep.title || <span className="text-faint">no name yet</span>}
            </p>
          </div>
          <ArrowRight
            aria-hidden
            className="mt-1.5 size-4 shrink-0 text-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-fg"
          />
        </div>

        <Progress counts={ep.counts} compact />

        <dl className="mt-auto grid grid-cols-3 gap-3 border-t border-edge pt-3.5">
          {[
            { label: 'Shots', value: ep.counts.scenes },
            { label: 'In flight', value: ep.counts.working + ep.counts.review },
            { label: 'Credits', value: ep.credits > 0 ? credits(ep.credits) : '—' },
          ].map((s) => (
            <div key={s.label}>
              <dt className="text-[10.5px] tracking-wide text-faint uppercase">{s.label}</dt>
              <dd className="font-mono text-[15px] text-fg tabular-nums">{s.value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex items-center gap-1.5 text-[10.5px] text-faint">
          <FolderOpen aria-hidden className="size-3 shrink-0" />
          <span className="min-w-0 truncate font-mono" title={ep.dir ?? undefined}>
            {ep.dir ?? 'no folder yet'}
          </span>
        </div>
      </Card>
    </Link>
  )
}

export default async function EpisodesPage({ params }: PageProps<'/[project]/episodes'>) {
  const pr = await requireProject((await params).project)
  const [board, episodeList] = await Promise.all([getEpisodeBoard(pr), getEpisodes(pr)])
  const taken = episodeList.slice(0, -1).map((e) => e.id)
  const next = episodeList[episodeList.length - 1].id

  const total = board.reduce(
    (n, e) => ({
      scenes: n.scenes + e.counts.scenes,
      filed: n.filed + e.counts.accepted - e.counts.drafts,
      working: n.working + e.counts.working + e.counts.review,
      credits: n.credits + e.credits,
    }),
    { scenes: 0, filed: 0, working: 0, credits: 0 },
  )

  const stats = [
    { label: 'Episodes', value: board.length },
    { label: 'Shots', value: total.scenes },
    { label: 'Finals filed', value: total.filed },
    { label: 'In flight', value: total.working },
    // Every generation the ledger has ever charged against a shot of an
    // episode. Not the film's lifetime spend: a reference image or a test that
    // never became a shot is not part of any episode.
    { label: 'Credits spent', value: credits(total.credits) },
  ]

  return (
    <div className="space-y-14">
      <PageHeader
        title="Episodes"
        eyebrow="The film"
        meta={<NewEpisode next={next} taken={taken} />}
      >
        The shape of the film: which episodes exist and how far each has got. Open one to see its footage, add
        outputs, or rename it.
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s, i) => (
          <Reveal key={s.label} index={i} lift>
            <StatTile label={s.label} value={s.value} />
          </Reveal>
        ))}
      </div>

      {board.length === 0 ? (
        <EmptyState>
          No episodes yet. Start one above, or approve a prompt against one on the Prompts page.
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {board.map((ep, i) => (
            <Reveal key={ep.id} index={i} lift>
              <EpisodeTile ep={ep} project={pr.slug} />
            </Reveal>
          ))}
        </div>
      )}

      <section>
        <SectionHeading>Next number</SectionHeading>
        <p className="max-w-3xl text-sm leading-relaxed text-muted">
          <span className="font-mono text-fg">{shortEpisode(next)}</span> is the next episode in order, and what
          “Start an episode” offers. You are not held to it: any number can be started, and a gap is fine. What
          never happens is a number being used twice.
        </p>
      </section>
    </div>
  )
}
