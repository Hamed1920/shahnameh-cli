'use client'

import Link from 'next/link'
import { useState } from 'react'
import { PlayThroughButton } from '@/components/play-through'
import { cn } from '@/lib/cn'
import type { PlayStop } from '@/lib/play-through'
import { playlistCounts, type PlaylistMode } from '@/lib/sequence-playlist'

export interface PlaybackSource { id: PlaylistMode; label: string; hint: string; stops: PlayStop[] }

/**
 * Sequence Playback (PRD 9.1): the blocks of a sequence in film order, played one after another by
 * the same player the episodes use. A block with nothing to play stays in the list and in the run
 * as a gap card. Nothing is cut or changed; this only chooses what to watch.
 */
export function SequencePlayback({ sources, scope }: { sources: PlaybackSource[]; scope: string }) {
  const [mode, setMode] = useState<PlaylistMode>(sources[0].id)
  const source = sources.find((s) => s.id === mode) ?? sources[0]
  const { playable, gaps } = playlistCounts(source.stops)
  return (
    <section aria-label="Playback" data-playback={source.id} className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <PlayThroughButton stops={source.stops} scope={`${scope}:${source.id}`} label="Play sequence" size="md" reorder={false} />
        {sources.length > 1 && (
          <div role="group" aria-label="What to play" className="flex items-center gap-1.5">
            {sources.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={s.id === source.id}
                title={s.hint}
                onClick={() => setMode(s.id)}
                className={cn(
                  'focus-ring h-7 cursor-pointer rounded-full border px-3 text-[12px] transition',
                  s.id === source.id ? 'border-accent bg-accent/8 text-fg' : 'border-edge text-muted hover:border-edge-strong',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
        <span className="text-[12.5px] text-muted">
          {playable} to play{gaps > 0 ? `, ${gaps} gap${gaps === 1 ? '' : 's'}` : ''}
        </span>
      </div>
      <ol className="grid gap-2 sm:grid-cols-2">
        {source.stops.map((s, i) => (
          <li
            key={s.id}
            data-stop={s.id}
            data-gap={s.gap ? 'true' : undefined}
            className={cn('flex items-center gap-3 rounded-lg border px-3 py-2.5', s.gap ? 'border-dashed border-edge-strong text-muted' : 'border-edge')}
          >
            <span className="w-5 shrink-0 text-right font-mono text-[11px] text-faint tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[12.5px] text-fg">{s.title}</span>
              <span className="block truncate text-[12px] text-muted" dir="auto">{s.gap ? `${s.subtitle} · shown for a few seconds` : s.subtitle}</span>
            </span>
            {s.href && <Link href={s.href} className="focus-ring text-[12px] text-accent hover:underline">Open</Link>}
          </li>
        ))}
      </ol>
    </section>
  )
}
