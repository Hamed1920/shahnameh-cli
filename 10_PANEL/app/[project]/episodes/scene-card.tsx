import { ItemMenu, type ItemAction } from '@/components/item-menu'
import { ShowInFolder } from '@/components/show-in-folder'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/text'
import { TakesDialog } from './takes-dialog'
import { TakeMedia } from '@/components/take-media'
import { assetUrl } from '@/lib/asset'
import { cn } from '@/lib/cn'
import { shortEpisode, type EpisodeOption } from '@/lib/episodes'
import type { EpisodeScene } from '@/lib/types'

/**
 * One scene of an episode, as both Episodes pages draw it. A server component:
 * the only thing it needs the browser for is the right-click menu, and ItemMenu
 * is that boundary.
 */

const STATE: Record<EpisodeScene['state'], { label: string; dot: string }> = {
  accepted: { label: 'accepted', dot: 'bg-good' },
  review: { label: 'waiting for review', dot: 'bg-accent' },
  generating: { label: 'generating now', dot: 'bg-accent animate-pulse' },
  queued: { label: 'queued', dot: 'bg-muted' },
  denied: { label: 'denied, nothing filed', dot: 'bg-bad' },
  planned: { label: 'nothing generated yet', dot: 'bg-edge-strong' },
}

/** An approved 480p draft is accepted but not finished; it reads apart from a final. */
export const stateOf = (scene: EpisodeScene) =>
  scene.state === 'accepted' && scene.stage === 'draft'
    ? { label: 'draft approved, no final filed', dot: 'bg-fg/40' }
    : STATE[scene.state]

export const credits = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(1))

/**
 * SC014 as it is said out loud: "Shot 14".
 *
 * The id grammar has both a scene and a shot (docs/INDEXING.md section 7) but
 * every id ever made here is SC<n>-SH0010 -- one shot per scene, the shot
 * number never varies -- so the number that identifies a piece of footage is
 * the SC one, and calling it a scene in the panel only confused things. The
 * ids on disk and in the append-only history are untouched; this is wording.
 */
export const shotLabel = (scene: string | null) => {
  const m = /^SC0*(\d+)$/.exec(String(scene ?? ''))
  return m ? `Shot ${m[1]}` : String(scene ?? '')
}

/** What a right-click on one scene offers: where it goes, its id, its file. */
function menuFor(
  scene: EpisodeScene,
  episode: string,
  project: string,
  episodes: EpisodeOption[],
  next: string,
): ItemAction[] {
  const out: ItemAction[] = [{ kind: 'heading', text: scene.label ? `${scene.label} · ${scene.shot}` : scene.shot }]
  // Only footage that is filed can move: the worker needs files to carry.
  if (scene.file) {
    out.push({ kind: 'assign', shots: [scene.shot], episodes, next, exclude: [episode], pendingTo: scene.movingTo })
  }
  out.push({ kind: 'link', label: 'See it in Decided', href: `/${project}/decided?ep=${episode}`, icon: 'episode' })
  out.push({ kind: 'divider' })
  out.push({ kind: 'copy', label: 'Copy the shot id', text: scene.shot })
  if (scene.file) {
    out.push({ kind: 'reveal', label: 'Show in folder', path: scene.file })
    out.push({ kind: 'open', label: 'Open the file', href: assetUrl(project, scene.file) })
    out.push({ kind: 'divider' })
    out.push({
      kind: 'archive',
      label: 'Take it out of the episode…',
      shots: [scene.shot],
      confirm: `Its ${scene.takes} take${scene.takes === 1 ? '' : 's'} move to 09_OUTPUT/_archive and leave ${shortEpisode(episode)}. `
        + 'Nothing is deleted — it can be put back from the episode page. Its number stays spent either way, '
        + 'so a gap where it was is the correct record of it having been there.',
    })
  }
  return out
}

export function SceneCard({
  scene, episode, project, episodes, next,
}: {
  scene: EpisodeScene
  episode: string
  project: string
  episodes: EpisodeOption[]
  next: string
}) {
  const s = stateOf(scene)
  return (
    <ItemMenu actions={menuFor(scene, episode, project, episodes, next)}>
      <Card interactive className="flex flex-col gap-2.5 p-3">
        {scene.file ? (
          <TakeMedia file={scene.file} alt={scene.shot} className="rounded-md border border-edge" />
        ) : (
          <div className="grid aspect-video w-full place-items-center rounded-md border border-dashed border-edge-strong px-3 text-center text-[12px] text-faint">
            {s.label}
          </div>
        )}

        <div className="flex items-baseline gap-2">
          <span className="text-[13px] text-fg" title={scene.shot}>{shotLabel(scene.scene)}</span>
          {scene.label && <span className="min-w-0 truncate text-[12.5px] text-muted">{scene.label}</span>}
          {scene.credits > 0 && (
            <span className="ml-auto font-mono text-[10.5px] text-faint tabular-nums" title="Credits spent on this shot">
              {credits(scene.credits)}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span aria-hidden className={cn('size-1.5 rounded-full', s.dot)} />
          <span className="text-[11.5px] text-muted">{s.label}</span>
          {/* The count opens the shot's history: every output, playable. */}
          <TakesDialog shot={scene.shot} label={shotLabel(scene.scene)} outputs={scene.outputs} />
          {scene.movingTo && <Badge tone="accent">moving to {shortEpisode(scene.movingTo)}</Badge>}
        </div>

        {scene.file && <ShowInFolder path={scene.file} />}
      </Card>
    </ItemMenu>
  )
}
