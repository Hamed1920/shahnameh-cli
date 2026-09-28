'use client'

import { useState, useTransition } from 'react'
import { RotateCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { actOnFailedJob } from './actions'

/**
 * Retry or Remove for one generation that failed. Retry runs it again as
 * queued, on this machine, priced by the worker before it spends; Remove only
 * takes it off this list. While a retry is on its way the buttons give way to
 * a line saying so.
 */
export function FailedActions({
  project, jobId, credits, sent,
}: {
  project: string
  jobId: string
  /** What one more run of this job cost last time, when known. */
  credits: number | null
  /** A retry was sent and the worker has not queued or refused it yet. */
  sent: boolean
}) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const act = (action: 'retry' | 'dismiss') => start(async () => {
    setError(null)
    const r = await actOnFailedJob(project, jobId, action)
    if (!r.ok) setError(r.error ?? 'Could not send it.')
  })

  if (sent) return <span className="text-xs whitespace-nowrap text-muted">Retry sent, waiting for the worker…</span>

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" tone="outline" disabled={pending} onClick={() => act('retry')}
          title={credits != null ? `Generates it again on this machine, about ${credits} credits` : 'Generates it again on this machine; the worker prices it first'}>
          <RotateCw aria-hidden className="size-3.5" /> Retry{credits != null && <span className="font-mono text-[11px] text-muted">≈ {credits}</span>}
        </Button>
        <Button type="button" size="sm" tone="ghost" disabled={pending} onClick={() => act('dismiss')} title="Take it off this list. Nothing is generated.">
          <Trash2 aria-hidden className="size-3.5" /> Remove
        </Button>
      </div>
      {error && <span role="alert" className="text-[11px] text-bad">{error}</span>}
    </div>
  )
}
