'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Coins, RotateCcw } from 'lucide-react'
import { requestRegenerate } from '@/app/decided/actions'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, Textarea } from '@/components/ui/field'
import { Badge } from '@/components/ui/text'
import type { RegenerationView } from '@/lib/types'

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * Run an accepted take's job again: same prompt, references and settings,
 * with an optional note and the sound choice. One click is the approval; the
 * price is on the button, like a deny-and-regenerate on Review.
 */
export function RegenerateButton({
  jobId, decisionId, credits, isVideo, regenerations,
}: {
  jobId: string
  decisionId: string
  credits: number | null
  isVideo: boolean
  regenerations: RegenerationView[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [sound, setSound] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    setBusy(true)
    setError(null)
    const fd = new FormData()
    fd.set('jobId', jobId)
    fd.set('decisionId', decisionId)
    fd.set('note', note)
    if (sound) fd.set('sound', 'on')
    const r = await requestRegenerate(fd).catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(false)
    if (!r.ok) { setError(r.error ?? 'Could not send that.'); return }
    setOpen(false)
    setNote('')
    router.refresh()
  }

  return (
    <div className="space-y-2.5">
      {regenerations.length > 0 && (
        <ul className="space-y-1 text-xs text-muted">
          {regenerations.map((r) => (
            <li key={r.reqId} className="flex flex-wrap items-center gap-2">
              <RotateCcw aria-hidden className="size-3 text-faint" />
              <span>Regenerated {when(r.ts)}</span>
              {r.state === 'queued' && <Badge tone="good">queued{r.jobId ? ` · ${r.jobId}` : ''}</Badge>}
              {r.state === 'waiting' && <Badge tone="accent">waiting for the worker</Badge>}
              {r.state === 'rejected' && <Badge tone="bad">not queued: {r.reason}</Badge>}
              {r.note && <span className="text-faint" dir="auto">“{r.note}”</span>}
            </li>
          ))}
        </ul>
      )}
      {!open ? (
        <Button type="button" size="sm" tone="outline" onClick={() => setOpen(true)}>
          <RotateCcw aria-hidden className="size-3.5" /> Regenerate
        </Button>
      ) : (
        <div className="space-y-3 rounded-lg border border-edge bg-sunken p-4">
          <Field label="Anything to change? (optional)">
            <Textarea dir="auto" rows={3} value={note} onChange={(e) => setNote(e.target.value)} className="min-h-20 text-[13px]" placeholder="Leave empty for a straight re-roll. Farsi or English." />
          </Field>
          {isVideo && <Checkbox checked={sound} onChange={(e) => setSound(e.target.checked)} label="Sound" />}
          {error && <p className="text-xs text-bad">{error}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" size="sm" tone="accent" pending={busy} pendingLabel="Sending" onClick={send}>
              <RotateCcw aria-hidden className="size-3.5" /> Regenerate{credits != null ? ` · ≈ ${credits} credits` : ''}
            </Button>
            <Button type="button" size="sm" tone="ghost" onClick={() => { setOpen(false); setError(null) }}>Cancel</Button>
            {credits == null && (
              <span className="flex items-center gap-1.5 text-xs text-faint"><Coins aria-hidden className="size-3.5" /> priced by the worker before it runs</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
