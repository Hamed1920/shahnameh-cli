'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { plainReason } from '@/lib/plain'
import type { WorkerStatus } from '@/lib/types'
import { NOT_STARTING_MS, TONE_DOT, describeWorker } from '@/lib/worker-words'

const at = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

/**
 * The generation worker's state, in the same words as the sidebar's dot
 * (lib/worker-words.ts). The panel's server keeps the worker running and
 * restarts it on new code (lib/worker-supervisor.ts); "Stop all workers" on the
 * Queue page (components/worker-switch.tsx) is the one way to hold it down.
 */
export function WorkerControls({ status, generating, compact = false }: { status: WorkerStatus; generating: string | null; compact?: boolean }) {
  const settling = !status.running && !status.autostartOff && !status.paused && !status.stopRequested

  // A worker coming up rewrites worker.lock, which LiveRefresh watches, so the page
  // follows it without polling. After a minute still settling, say it is not starting.
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!settling) { setSlow(false); return }
    const t = setTimeout(() => setSlow(true), NOT_STARTING_MS)
    return () => clearTimeout(t)
  }, [settling])

  const w = describeWorker(status, { generating, slow })
  const detail = w.tone === 'ready' && status.startedAt ? `running since ${at(status.startedAt)}` : w.detail

  return (
    <span className={cn('inline-flex flex-col items-end gap-1 text-muted', compact ? 'text-xs' : 'text-[13px]')}>
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <span aria-hidden className={cn('size-1.5 rounded-full', TONE_DOT[w.tone], w.tone === 'busy' && 'animate-pulse')} />
        <span className="text-fg/90">{w.headline}</span>
        <span suppressHydrationWarning className={cn(w.tone === 'busy' ? 'font-mono text-[11px] text-faint' : 'text-faint')}>{detail}</span>
      </span>
      {/* Why no worker runs here, when that is a setting of this computer. */}
      {!status.running && status.autostartOff && (
        <span className="max-w-md text-right font-sans text-[11.5px] leading-relaxed text-faint">{plainReason(status.autostartOff)}</span>
      )}
      {/* What its console last said, for whoever looks into why it will not start. */}
      {slow && status.lastOutput && (
        <span className="max-w-md text-right font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-bad">{status.lastOutput}</span>
      )}
    </span>
  )
}
