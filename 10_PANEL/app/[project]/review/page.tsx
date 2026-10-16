import { getDecidedEntries } from '@/lib/decided'
import { compareReviewOrder } from '@/lib/play-through'
import { requireProject } from '@/lib/projects'
import { getCatalog, getEpisodes, getPending, getPriceTable, getReferenceFor, getReviewContexts, getWorkerConfig, referenceResolver } from '@/lib/store'
import type { RegenerateConfig } from '@/components/regenerate-button'
import type { ReviewItem } from '@/lib/types'
import { ReviewWorkspace } from './review-workspace'

export const dynamic = 'force-dynamic'

/**
 * Review, one candidate at a time. Everything is resolved here on the server;
 * the workspace only arranges it and holds the reviewer's unsaved input.
 */
export default async function ReviewPage({ params }: PageProps<'/[project]/review'>) {
  const pr = await requireProject((await params).project)
  const [pending, catalog, resolve, episodes] = await Promise.all([
    getPending(pr), getCatalog(pr), referenceResolver(pr), getEpisodes(pr),
  ])
  // Where each decided take is now, so the history keeps the footage of takes that were filed.
  const decided = await getDecidedEntries(pr)
  const contexts = await getReviewContexts(pr, pending, new Map(decided.map((e) => [e.decision.id, e.file])), resolve)

  // What the "Continue from here" panel needs: the models and settings it offers, and what each costs.
  const [workerCfg, priceTable] = await Promise.all([getWorkerConfig(), getPriceTable()])
  const regenCfg: RegenerateConfig = {
    pinned: (workerCfg.pinnedModels as string[] | undefined) ?? [],
    aspectRatios: (workerCfg.aspectRatios as string[]) ?? ['16:9', '9:16', '1:1'],
    videoDurations: (workerCfg.videoDurations as number[]) ?? [5, 10, 15],
    videoDraftResolution: String(workerCfg.videoDraftResolution ?? '480p'),
    videoFinalResolution: String(workerCfg.videoFinalResolution ?? '1080p'),
  }

  const items: ReviewItem[] = await Promise.all(
    pending.map(async (candidate) => {
      const tokens = candidate.sidecar.refs ?? []
      // Resolved as the worker will resolve them, so a reference to an archived look shows as one.
      const editable = await Promise.all(tokens.map(resolve))
      // An entity target's canonical plate is the thing to judge likeness
      // against, and is not necessarily one of the refs the job was given.
      const canonical = await getReferenceFor(pr, candidate.sidecar.target, candidate.sidecar.variant, tokens)
      const plate =
        canonical && !editable.some((r) => r.path === canonical)
          ? { token: [candidate.sidecar.target, candidate.sidecar.variant].filter(Boolean).join(' '), path: canonical }
          : null
      return { candidate, editable, plate, context: contexts.get(candidate.path)! }
    }),
  )

  // The order the prompts were numbered in, so a sequence is reviewed the way it
  // will be watched. Not scene or generation order: a prompt that failed and was
  // retried is made late and numbered late, and would otherwise land after the last.
  const keyOf = (i: ReviewItem) => ({
    episode: i.context.episode,
    label: i.context.label,
    target: i.candidate.sidecar.target,
    createdAt: i.candidate.sidecar.createdAt,
  })
  items.sort((a, b) => compareReviewOrder(keyOf(a), keyOf(b)))

  return (
    <ReviewWorkspace
      items={items}
      catalog={catalog}
      regenCfg={regenCfg}
      prices={Object.fromEntries(priceTable)}
      episodeTitles={Object.fromEntries(episodes.filter((e) => e.title).map((e) => [e.id, e.title]))}
    />
  )
}
