'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X } from 'lucide-react'
import { addClientComment } from '../actions'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/field'

const MAX = 2000

export function CommentForm({ project, releaseId }: { project: string; releaseId: string }) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState<'comment' | 'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function send(verdict: 'approve' | 'reject' | null) {
    setBusy(verdict ?? 'comment')
    setError(null)
    const r = await addClientComment(project, releaseId, body, verdict).catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(null)
    if (!r.ok) { setError(r.error ?? 'Could not send that.'); return }
    setBody('')
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <Textarea value={body} maxLength={MAX} onChange={(e) => setBody(e.target.value)} placeholder="Your comment" aria-label="Your comment" dir="auto" />
      {error && <p role="alert" className="text-[12.5px] text-bad">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" tone="accent" pending={busy === 'comment'} pendingLabel="Sending" disabled={!body.trim() || busy !== null} onClick={() => send(null)}>Comment</Button>
        <Button type="button" size="sm" tone="outline" pending={busy === 'approve'} pendingLabel="Sending" disabled={busy !== null} onClick={() => send('approve')}>
          <Check aria-hidden className="size-3.5" /> Approve
        </Button>
        <Button type="button" size="sm" tone="outline" pending={busy === 'reject'} pendingLabel="Sending" disabled={busy !== null} onClick={() => send('reject')}>
          <X aria-hidden className="size-3.5" /> Reject
        </Button>
        <span className="ml-auto font-mono text-[11px] text-faint tabular-nums">{body.length}/{MAX}</span>
      </div>
    </div>
  )
}
