import { WorkerControls } from '@/components/worker-controls'
import { PageHeader } from '@/components/ui/text'
import {
  getBatches, getCatalog, getGeneratingJobId, getKnownShots, getPromptLibrary, getRecentRefs, getWorkerConfig, getWorkerState, getWorkerStatus,
} from '@/lib/store'
import type { BatchDefaults } from '@/lib/types'
import { Batches } from './batches'
import { PromptIntake, type IntakeConfig } from './prompt-intake'
import { PromptLibrary } from './prompt-library'

export const dynamic = 'force-dynamic'

/**
 * Prompts in, priced batches out. The page parses in the browser, the worker
 * checks and prices, and nothing spends until the batch is approved here.
 * Below the batches, every prompt already queued, ready to start again.
 */
export default async function PromptsPage() {
  const [catalog, batches, worker, cfg, knownShots, state, library, recentRefs] = await Promise.all([
    getCatalog(), getBatches(), getWorkerStatus(), getWorkerConfig(), getKnownShots(), getWorkerState(), getPromptLibrary(), getRecentRefs(),
  ])
  const generating = await getGeneratingJobId(new Set((state?.processedJobs ?? []) as string[]))

  const models = (cfg.models as IntakeConfig['models']) ?? { image: [], video: [] }
  const defaults: BatchDefaults = {
    model: String(cfg.defaultVideoModel ?? models.video[0] ?? cfg.defaultImageModel ?? ''),
    aspect_ratio: '16:9',
    duration: Number(cfg.videoDuration ?? 15),
    stage: 'draft',
    generate_audio: cfg.videoSound !== false,
  }
  const intakeCfg: IntakeConfig = {
    models,
    aspectRatios: (cfg.aspectRatios as string[]) ?? ['16:9', '9:16', '1:1'],
    videoDurations: (cfg.videoDurations as number[]) ?? [5, 10, 15],
    videoDraftResolution: String(cfg.videoDraftResolution ?? '480p'),
    videoFinalResolution: String(cfg.videoFinalResolution ?? '1080p'),
    defaults,
  }

  return (
    <div className="space-y-16">
      <PageHeader title="Prompts" eyebrow="Generation" meta={<WorkerControls status={worker} generating={generating} compact />}>
        Paste prompts or drop a document, check where each result is filed and what it references, and send the
        batch. The worker checks every row and prices it; you approve the total before anything generates. New
        scenes and new entities get their number when you approve.
      </PageHeader>

      <PromptIntake catalog={catalog} cfg={intakeCfg} knownShots={knownShots} recentRefs={recentRefs} />
      <Batches batches={batches} worker={worker} />
      <PromptLibrary items={library} catalog={catalog} cfg={intakeCfg} batches={batches} />
    </div>
  )
}
