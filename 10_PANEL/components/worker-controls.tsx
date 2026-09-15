'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Play, RotateCw, Square, TriangleAlert } from 'lucide-react'
import { restartWorker, startWorker, stopWorker } from '@/app/worker-control-action'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { cn } from '@/lib/cn'
import type { WorkerStatus } from '@/lib/types'

const at = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

/**
 * Start / Stop / Restart for the generation worker, with its state. Stop is
 * graceful (after the current job); the force stop sits behind a confirm that
 * says what it costs.
 */
export function WorkerControls({ status, generating, compact = false }: { status: WorkerStatus; generating: string | null; compact?: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState<null | 'start' | 'stop' | 'restart' | 'force'>(null)
  const [note, setNote] = useState<string | null>(null)
  const [confirmForce, setConfirmForce] = useState(false)
  // A graceful stop can outlast the action's wait; keep refreshing until the lock goes.
  const [stopping, setStopping] = useState(false)

  useEffect(() => {
    if (!stopping) return
    if (!status.running) { setStopping(false); return }
    const t = setInterval(() => router.refresh(), 2000)
    return () => clearInterval(t)
  }, [stopping, status.running, router])

  const run = useCallback(async (kind: NonNullable<typeof busy>, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(kind)
    setNote(null)
    const r = await fn().catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(null)
    if (r.error) setNote(r.error)
    if (kind === 'stop' && r.ok) setStopping(true)
    router.refresh()
  }, [router])

  const text = !status.running
    ? 'Worker stopped'
    : status.outdated
      ? 'Worker running old code'
      : `Worker running${status.startedAt ? ` since ${at(status.startedAt)}` : ''}`

  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2', compact ? 'text-xs' : 'text-[13px]')}>
      <span className="inline-flex items-center gap-2 text-muted">
        <span
          aria-hidden
          className={cn('size-1.5 rounded-full', !status.running ? 'bg-bad' : status.outdated ? 'bg-fg/60' : 'bg-good', status.running && !status.outdated && 'animate-pulse')}
        />
        {text}
        {status.running && generating && <span className="font-mono text-[11px] text-faint">generating {generating}</span>}
      </span>

      {!status.running ? (
        <Button type="button" size="sm" tone="accent" pending={busy === 'start'} pendingLabel="Starting" onClick={() => run('start', startWorker)}>
          <Play aria-hidden className="size-3.5" /> Start worker
        </Button>
      ) : (
        <>
          {status.outdated && (
            <Button type="button" size="sm" tone="accent" pending={busy === 'restart'} pendingLabel="Restarting" onClick={() => run('restart', restartWorker)}>
              <RotateCw aria-hidden className="size-3.5" /> Restart to load new code
            </Button>
          )}
          <Button type="button" size="sm" tone="outline" pending={busy === 'stop' || stopping} pendingLabel={generating ? 'Stopping after this job' : 'Stopping'} onClick={() => run('stop', () => stopWorker('graceful'))}>
            <Square aria-hidden className="size-3.5" /> Stop{generating ? ' after this job' : ''}
          </Button>
          {generating && (
            <Button type="button" size="sm" tone="ghost" onClick={() => setConfirmForce(true)}>
              Force stop
            </Button>
          )}
        </>
      )}
      {note && <span className="text-xs text-bad" role="status">{note}</span>}

      <Modal
        open={confirmForce}
        title="Force-stop the worker?"
        onClose={() => setConfirmForce(false)}
        footer={
          <>
            <Button type="button" tone="ghost" onClick={() => setConfirmForce(false)}>Keep it running</Button>
            <Button type="button" tone="bad" pending={busy === 'force'} pendingLabel="Stopping" onClick={async () => { await run('force', () => stopWorker('force')); setConfirmForce(false) }}>
              Force stop
            </Button>
          </>
        }
      >
        <div className="flex gap-3 text-sm leading-relaxed text-muted">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-bad" />
          <p>
            {generating ? <><span className="font-mono text-fg">{generating}</span> is generating now. </> : null}
            Killing the worker does not cancel the Higgsfield job: it keeps running server-side and its credits are spent,
            but nothing is downloaded and the job stays unprocessed, so the next worker generates it again. Prefer
            &ldquo;Stop after this job&rdquo;.
          </p>
        </div>
      </Modal>
    </div>
  )
}
