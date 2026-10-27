import { getDecidedEntries } from '@/lib/decided'
import { requireProject } from '@/lib/projects'
import { allTags } from '@/lib/gallery'
import { getGalleryState } from '@/lib/gallery-log'
import { getCatalog, getEpisodes, getPriceTable, getShotMoveRequests, getWorkerConfig } from '@/lib/store'
import type { RegenerateConfig } from '@/components/regenerate-button'
import { GalleryView, type GalleryTake } from './gallery/gallery-view'

export const dynamic = 'force-dynamic'

/**
 * The Gallery: everything accepted, arranged the way Hamed wants to see it.
 *
 * The first page on purpose -- it is the body of work, where Review is the
 * inbox. Approved 480p drafts sit here alongside filed 1080p finals, badged
 * apart, so a shot that was approved but whose final has not rendered yet is
 * never silently missing.
 *
 * Everything is resolved server-side; the view only arranges and holds the
 * unsaved input, in the same shape as the Review page.
 */
export default async function GalleryPage({ params }: PageProps<'/[project]'>) {
  const pr = await requireProject((await params).project)
  const [entries, gallery, catalog, cfg, priceTable, episodes, moves] = await Promise.all([
    getDecidedEntries(pr), getGalleryState(pr), getCatalog(pr), getWorkerConfig(), getPriceTable(), getEpisodes(pr),
    getShotMoveRequests(pr),
  ])
  // getEpisodes ends with the next free number, which is not an episode yet.
  // Only it may be offered as "new": a number is never picked in the browser.
  const allEpisodes = episodes.slice(0, -1).map((e) => ({ id: e.id, title: e.title, shots: e.shots }))
  const nextEpisode = episodes[episodes.length - 1].id

  const regenCfg: RegenerateConfig = {
    pinned: (cfg.pinnedModels as string[] | undefined) ?? [],
    aspectRatios: (cfg.aspectRatios as string[]) ?? ['16:9', '9:16', '1:1'],
    videoDurations: (cfg.videoDurations as number[]) ?? [5, 10, 15],
    videoDraftResolution: String(cfg.videoDraftResolution ?? '480p'),
    videoFinalResolution: String(cfg.videoFinalResolution ?? '1080p'),
  }

  const takes: GalleryTake[] = entries
    .filter((e) => e.decision.verdict === 'accepted')
    .map((e) => ({
      decisionId: e.decision.id,
      jobId: e.decision.jobId,
      title: e.title,
      where: e.where,
      episode: e.episode,
      target: e.target,
      ts: e.decision.ts,
      stage: e.stage,
      attempt: e.attempt,
      status: e.status,
      file: e.file,
      missing: e.missing,
      notes: e.notes,
      isVideo: e.isVideo,
      canRegenerate: e.status === 'applied',
      credits: e.regenerateCredits,
      source: e.source,
      regenerations: e.regenerations,
    }))

  return (
    <GalleryView
      takes={takes}
      state={gallery}
      tags={allTags(gallery)}
      catalog={catalog}
      cfg={regenCfg}
      allEpisodes={allEpisodes}
      nextEpisode={nextEpisode}
      pendingMoves={moves.pending}
      moveErrors={moves.failed}
      // Plain object: a Map does not survive the server -> client boundary.
      prices={Object.fromEntries(priceTable)}
    />
  )
}
