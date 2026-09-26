'use client'

import { useEffect, useState } from 'react'
import { TriangleAlert, X } from 'lucide-react'
import { useProject } from '@/components/project-context'
import { shortEpisode } from '@/lib/episodes'
import type { ShotMoveFailure } from '@/lib/types'

// Shared with the Gallery before this was its own component; kept so dismissals carry over.
const dismissedKey = (project: string) => `shm-gallery-dismissed:${project}`

/**
 * Recent "move to another episode" requests the worker refused, and why. Shown
 * wherever a move can be asked for (Gallery, Decided), since a refusal is only
 * useful where the person who asked is looking. Dismissed ones stay dismissed.
 */
export function MoveErrors({ errors }: { errors: ShotMoveFailure[] }) {
  const project = useProject()
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(dismissedKey(project.slug))
      if (saved) setDismissed(new Set(JSON.parse(saved) as string[]))
    } catch { /* no storage; the banner is simply shown again */ }
  }, [project.slug])
  const dismiss = (opId: string) => {
    setDismissed((was) => {
      const next = new Set(was).add(opId)
      // Only ones still being reported, so this cannot grow for ever.
      const live = [...next].filter((id) => errors.some((m) => m.opId === id))
      try { window.localStorage.setItem(dismissedKey(project.slug), JSON.stringify(live)) } catch { /* ignore */ }
      return next
    })
  }

  return (
    <>
      {errors.filter((m) => !dismissed.has(m.opId)).map((m) => (
        <div key={m.opId} className="flex items-start gap-2 rounded-md border border-bad/35 bg-bad/8 px-3 py-2 text-xs leading-relaxed text-bad">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <div className="min-w-0 flex-1 space-y-1">
            <p>
              {m.shots.length === 1
                ? `${m.shots[0]} did not move`
                : `${m.shots.length} shots did not move`} to {shortEpisode(m.episode)}: {m.reason}
            </p>
            {/* Fourteen ids is a wall of text in a banner. They are still here
                for anyone who needs them, one click away. */}
            {m.shots.length > 1 && (
              <details>
                <summary className="cursor-pointer text-bad/75 underline-offset-2 hover:underline">which ones</summary>
                <p className="mt-1 font-mono text-[10.5px] break-all text-bad/75">{m.shots.join(', ')}</p>
              </details>
            )}
          </div>
          <button
            type="button"
            onClick={() => dismiss(m.opId)}
            aria-label="Dismiss this message"
            className="focus-ring -m-1 grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-bad/70 transition-colors hover:text-bad"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </div>
      ))}
    </>
  )
}
