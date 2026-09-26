'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import type { WorkerStatus } from '@/lib/types'

const at = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

/**
 * The generation worker's state. The panel's server keeps the worker running and
 * restarts it on new code (lib/worker-supervisor.ts); "Stop all workers" on the
 * Queue page (components/worker-switch.tsx) is the one way to hold it down.
 */
export function WorkerControls({ status, generating, compact = false }: { status: WorkerStatus; generating: string | null; compact?: boolean }) {
  const held = status.paused || status.stopRequested
  const settling = (!status.running && !status.autostartOff && !held) || status.outdated

  // A worker coming up rewrites worker.lock, which LiveRefresh watches, so the page
  // follows it without polling. After a minute still settling, say it is not starting.
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!settling) { setSlow(false); return }
    const t = setTimeout(() => setSlow(true), 60_000)
    return () => clearTimeout(t)
  }, [settling])

  const text = status.running
    ? status.stopRequested
      ? 'Worker stopping after the job in hand'
      : status.outdated
        ? 'Worker restarting on new code once idle'
        : `Worker running${status.startedAt ? ` since ${at(status.startedAt)}` : ''}`
    : status.paused
      ? 'Workers stopped from the Queue page'
      : status.stopRequested
        ? 'Worker stopped (queue/worker.stop)'
        : status.autostartOff
          ? `Worker off: ${status.autostartOff}`
          : slow ? 'Worker not starting' : 'Worker starting…'

  return (
    <span className={cn('inline-flex flex-col items-end gap-1 text-muted', compact ? 'text-xs' : 'text-[13px]')}>
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          aria-hidden
          className={cn('size-1.5 rounded-full', status.running ? (status.outdated || status.stopRequested ? 'bg-fg/60' : 'bg-good animate-pulse') : status.autostartOff || held || slow ? 'bg-bad' : 'bg-fg/60')}
        />
        <span suppressHydrationWarning>{text}</span>
        {status.running && generating && <span className="font-mono text-[11px] text-faint">generating {generating}</span>}
      </span>
      {slow && status.lastOutput && (
        <span className="max-w-md text-right font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-bad">{status.lastOutput}</span>
      )}
    </span>
  )
}
