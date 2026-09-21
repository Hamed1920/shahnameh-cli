import type { EpisodeBoard } from '@/lib/types'

/**
 * How far an episode has got, said the same way on the list and on its own page.
 *
 * "Filed" means a final is on disk. An approved 480p draft is progress, not a
 * finished scene -- its 1080p final may still be queued, or have been denied --
 * so it is counted apart rather than folded in, and an episode of approved
 * drafts does not read as done.
 */
export function summarise(c: EpisodeBoard['counts']) {
  const filed = c.accepted - c.drafts
  return {
    filed,
    done: c.scenes ? Math.round((filed / c.scenes) * 100) : 0,
    // What is left, not what is done: the headline already says how much is done.
    rest: [
      c.drafts && `${c.drafts} draft${c.drafts === 1 ? '' : 's'} approved, final not filed`,
      c.review && `${c.review} waiting for review`,
      c.working && `${c.working} with the worker`,
      c.denied && `${c.denied} denied`,
      c.planned && `${c.planned} not generated yet`,
    ].filter(Boolean) as string[],
  }
}

export function Progress({ counts, compact = false }: { counts: EpisodeBoard['counts']; compact?: boolean }) {
  const { done, rest } = summarise(counts)
  if (counts.scenes === 0) {
    return <p className="text-[12px] text-faint">Nothing in it yet.</p>
  }
  return (
    <div className="space-y-2">
      <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full bg-good transition-[width] duration-500" style={{ width: `${done}%` }} />
      </div>
      <p className="text-[12px] leading-relaxed text-muted">
        <span className="text-fg">{done}%</span> of {counts.scenes} shot{counts.scenes === 1 ? '' : 's'} filed
        {rest.length > 0 && (compact ? <> · {rest[0]}{rest.length > 1 ? ` · +${rest.length - 1} more` : ''}</> : <> · {rest.join(' · ')}</>)}
      </p>
    </div>
  )
}
