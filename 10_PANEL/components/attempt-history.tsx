'use client'

import { Columns2, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/text'
import { assetUrl } from '@/lib/asset'
import { cn } from '@/lib/cn'
import type { AttemptEntry } from '@/lib/types'

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null

/**
 * Every earlier attempt at this shot, oldest first: the video, what was
 * decided, and the note that sent it back. A revision makes no sense without
 * knowing what it was meant to fix.
 */
export function AttemptHistory({
  history,
  comparing,
  onCompare,
}: {
  history: AttemptEntry[]
  comparing: string | null
  onCompare: (entry: AttemptEntry | null) => void
}) {
  if (history.length === 0) return null

  return (
    <section>
      <div className="mb-5 flex items-center gap-3">
        <History aria-hidden strokeWidth={1.75} className="size-3.5 text-fg/85" />
        <span className="eyebrow text-fg/85">Earlier attempts</span>
        <span className="font-mono text-[11px] leading-none text-faint">{history.length}</span>
        <span aria-hidden className="h-px flex-1 bg-edge" />
      </div>

      <ol className="space-y-3">
        {history.map((h) => {
          const on = comparing === h.jobId
          return (
            <li
              key={h.jobId}
              className={cn(
                'lit flex flex-col gap-5 rounded-xl border bg-panel p-4 transition-colors duration-200 sm:flex-row',
                on ? 'border-fg/60' : 'border-edge',
              )}
            >
              {h.video ? (
                <button
                  type="button"
                  onClick={() => onCompare(on ? null : h)}
                  aria-label={`Compare attempt ${h.attempt} with the current video`}
                  className="focus-ring shrink-0 cursor-pointer overflow-hidden rounded-lg border border-edge transition-colors duration-150 hover:border-edge-strong sm:w-48"
                >
                  <video src={`${assetUrl(h.video)}#t=1`} muted playsInline preload="metadata" className="aspect-video w-full bg-black object-cover" />
                </button>
              ) : (
                <div className="grid aspect-video shrink-0 place-items-center rounded-lg border border-dashed border-edge-strong text-[11px] text-faint sm:w-48">
                  video not on disk
                </div>
              )}

              <div className="min-w-0 flex-1 space-y-2.5">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-display text-xl leading-none text-fg">Attempt {h.attempt}</span>
                  {h.stage && <span className="ml-1 font-mono text-[11px] text-muted">{h.stage}</span>}
                  {h.verdict === 'denied' && <Badge tone="bad">denied</Badge>}
                  {h.verdict === 'accepted' && <Badge tone="good">{h.stage === 'draft' ? 'draft approved' : 'accepted'}</Badge>}
                  {!h.verdict && <Badge tone="muted">not reviewed</Badge>}
                  {when(h.decidedAt) && <span className="font-mono text-[11px] text-faint">{when(h.decidedAt)}</span>}
                  {h.video && (
                    <Button type="button" size="sm" tone={on ? 'accent' : 'outline'} onClick={() => onCompare(on ? null : h)} className="ml-auto h-7">
                      <Columns2 aria-hidden className="size-3.5" />
                      {on ? 'Comparing' : 'Compare'}
                    </Button>
                  )}
                </div>
                {h.notes ? (
                  <p dir="auto" className="text-start text-sm leading-relaxed whitespace-pre-line text-fg/90">
                    {h.notes}
                  </p>
                ) : (
                  <p className="text-xs text-faint">No note.</p>
                )}
                {(h.tags.length > 0 || h.refs.length > 0) && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {h.tags.map((t) => (
                      <Badge key={`t-${t}`} tone="muted">{t}</Badge>
                    ))}
                    {h.refs.map((r) => (
                      <span key={`r-${r}`} className="inline-flex h-5 items-center rounded-[5px] bg-white/[0.06] px-1.5 font-mono text-[10.5px] text-muted">
                        {r}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
