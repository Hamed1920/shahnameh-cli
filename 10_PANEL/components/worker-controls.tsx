'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/cn'
import type { WorkerStatus } from '@/lib/types'

const at = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

/**
 * The generation worker's state. There is nothing to press: the panel's server
 * keeps the worker running and restarts it on new code (lib/worker-supervisor.ts).
 */
export function WorkerControls({ status, generating, compact = false }: { status: WorkerStatus; generating: string | null; compact?: boolean }) {
  const router = useRouter()
  const settling = !status.running && !status.autostartOff || status.outdated

  // While it starts or restarts, refresh until it is up.
  useEffect(() => {
    if (!settling) return
    const t = setInterval(() => router.refresh(), 3000)
    return () => clearInterval(t)
  }, [settling, router])

  const text = status.running
    ? status.outdated
      ? 'Worker restarting on new code once idle'
      : `Worker running${status.startedAt ? ` since ${at(status.startedAt)}` : ''}`
    : status.autostartOff
      ? `Worker off: ${status.autostartOff}`
      : 'Worker starting…'

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-muted', compact ? 'text-xs' : 'text-[13px]')}>
      <span
        aria-hidden
        className={cn('size-1.5 rounded-full', status.running ? (status.outdated ? 'bg-fg/60' : 'bg-good animate-pulse') : status.autostartOff ? 'bg-bad' : 'bg-fg/60')}
      />
      {text}
      {status.running && generating && <span className="font-mono text-[11px] text-faint">generating {generating}</span>}
    </span>
  )
}
