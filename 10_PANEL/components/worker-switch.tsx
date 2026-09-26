'use client'

import { useState } from 'react'
import { Play, Square } from 'lucide-react'
import { startAllWorkers, stopAllWorkers } from '@/app/[project]/queue/actions'
import { useProject } from '@/components/project-context'
import { Button } from '@/components/ui/button'

/**
 * Stop every project's worker and keep them stopped, or start them again. Stopping
 * lets each finish the job in hand (never mid-generation); once none is running it
 * is safe to commit and push (CLAUDE.md, Git).
 */
export function WorkerSwitch({ paused, running }: { paused: boolean; running: number }) {
  const project = useProject()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function flip(fn: typeof stopAllWorkers) {
    setBusy(true)
    setError(null)
    const r = await fn(project.slug).catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(false)
    if (!r.ok) setError(r.error ?? 'That did not work.')
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted">
      {paused ? (
        <>
          <span>
            {running > 0
              ? `Stopping: ${running} worker${running === 1 ? '' : 's'} still finishing the job in hand…`
              : 'All workers stopped. It is safe to sync this computer now (commit and push).'}
          </span>
          <Button type="button" size="sm" tone="ghost" pending={busy} pendingLabel="Starting" onClick={() => flip(startAllWorkers)}>
            <Play aria-hidden className="size-3.5" /> Start workers
          </Button>
        </>
      ) : (
        <Button type="button" size="sm" tone="ghost" pending={busy} pendingLabel="Stopping" onClick={() => flip(stopAllWorkers)}>
          <Square aria-hidden className="size-3.5" /> Stop all workers
        </Button>
      )}
      {error && <span className="text-bad">{error}</span>}
    </div>
  )
}
