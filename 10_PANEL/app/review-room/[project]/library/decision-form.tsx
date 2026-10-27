'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, MessageSquareWarning, MousePointerClick } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Decision } from '@/lib/pd-category'
import { decideAsset } from './actions'

export function DecisionForm({
  project, reviewId, status, canMakeMain,
}: { project: string; reviewId: string; status: 'presented' | 'selected'; canMakeMain: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [notes, setNotes] = useState('')
  const [main, setMain] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const go = (d: Decision) =>
    start(async () => {
      const r = await decideAsset(project, reviewId, d, notes, main)
      setError(r.ok ? null : r.error ?? 'Could not save.')
      if (r.ok) router.refresh()
    })

  return (
    <div className="mt-3 space-y-2.5">
      <label className="block text-[12px] text-faint">
        Note (required to request a revision)
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          dir="auto"
          maxLength={4000}
          className="mt-1 block w-full resize-y rounded-md border border-edge bg-ink px-2.5 py-1.5 text-[13px] text-fg"
        />
      </label>
      {canMakeMain ? (
        <label className="flex items-center gap-2 text-[12px] text-muted">
          <input type="checkbox" checked={main} onChange={(e) => setMain(e.target.checked)} />
          On approval, make this the main look
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {status === 'presented' ? (
          <Button type="button" size="sm" disabled={pending} onClick={() => go('select')}>
            <MousePointerClick aria-hidden className="size-3.5" /> Select
          </Button>
        ) : null}
        <Button type="button" size="sm" disabled={pending} onClick={() => go('revise')}>
          <MessageSquareWarning aria-hidden className="size-3.5" /> Request revision
        </Button>
        <Button type="button" size="sm" tone="accent" disabled={pending} onClick={() => go('approve')}>
          <Check aria-hidden className="size-3.5" /> Approve
        </Button>
      </div>
      {error ? <p role="alert" className="text-[12px] text-bad">{error}</p> : null}
    </div>
  )
}
