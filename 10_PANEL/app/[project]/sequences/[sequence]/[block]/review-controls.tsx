'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { BadgeCheck, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { finalAction, markReadAction, resolutionAction, submitAction } from './review-actions'

const Err = ({ text }: { text: string | null }) =>
  text ? <p role="alert" className="text-[12px] text-bad" dir="auto">{text}</p> : null

export interface GenReview {
  generationId: string
  gLabel: string
  /** Rounds this generation has been sent as, e.g. [2]. */
  rounds: number[]
  /** It is the active round now. */
  active: boolean
  /** The round the director would see it as if sent now. */
  nextRound: number
  /** A round of it is approved, so it can be Final. */
  approved: boolean
  isFinal: boolean
  /** It has a file that can be sent. */
  hasFile: boolean
  /** The active round is a different generation (sending replaces it). */
  replacesRound: number | null
}

type Out = { ok: boolean; error?: string; message?: string; warning?: string | null }
const failed = (e: Error): Out => ({ ok: false, error: e.message })

/** Send to Director Review / Mark as Final on one generation card. */
export function GenerationReviewControls({ project, blockId, g }: { project: string; blockId: string; g: GenReview }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const send = () => {
    const replaces = g.replacesRound !== null ? ` It replaces Round ${g.replacesRound} as the one the director sees; Round ${g.replacesRound} stays in the history.` : ''
    if (!window.confirm(`Send ${g.gLabel} to the director as Round ${g.nextRound}?${replaces}`)) return
    start(async () => {
      const r: Out = await submitAction(project, blockId, g.generationId).catch(failed)
      setError(r.ok ? null : r.error ?? 'Could not send.')
      setNote(r.ok ? r.message ?? null : null)
      if (r.ok) router.refresh()
    })
  }
  const fin = () => {
    if (!window.confirm(`Mark ${g.gLabel} as the Final of this block?`)) return
    start(async () => {
      const r: Out = await finalAction(project, blockId, g.generationId).catch(failed)
      setError(r.ok ? null : r.error ?? 'Could not set the Final.')
      setNote(r.ok ? [r.message, r.warning ? `Warning: ${r.warning}` : null].filter(Boolean).join(' ') : null)
      if (r.ok) router.refresh()
    })
  }

  return (
    <div className="space-y-2" data-review-controls={g.gLabel}>
      {g.rounds.length > 0 && (
        <p className="text-[12.5px] text-muted">
          Sent as {g.rounds.map((r) => `Round ${r}`).join(', ')}{g.active ? ' (current)' : ''}{g.isFinal ? ' · Final' : ''}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {g.hasFile && !g.active && (
          <Button type="button" size="sm" tone="outline" disabled={pending} onClick={send}>
            <Send aria-hidden className="size-3.5" /> Send to Director Review
          </Button>
        )}
        {g.approved && !g.isFinal && (
          <Button type="button" size="sm" tone="accent" disabled={pending} onClick={fin}>
            <BadgeCheck aria-hidden className="size-3.5" /> Mark as Final
          </Button>
        )}
      </div>
      {note && <p role="status" className="text-[12.5px] text-muted">{note}</p>}
      <Err text={error} />
    </div>
  )
}

/** open / in progress / resolved for one note. The note's text is never touched. */
export function ResolutionSelect({ project, feedbackId, value }: { project: string; feedbackId: string; value: 'open' | 'in_progress' | 'resolved' }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <label className="text-[12px] text-faint" htmlFor={`res-${feedbackId}`}>Handling</label>
      <select
        id={`res-${feedbackId}`} value={value} disabled={pending}
        onChange={(e) => start(async () => {
          const r: Out = await resolutionAction(project, feedbackId, e.target.value).catch(failed)
          setError(r.ok ? null : r.error ?? 'Could not save.')
          if (r.ok) router.refresh()
        })}
        className="rounded-md border border-edge bg-ink px-2 py-1 text-[12.5px] text-fg"
      >
        <option value="open">Open</option>
        <option value="in_progress">In progress</option>
        <option value="resolved">Resolved</option>
      </select>
      <Err text={error} />
    </div>
  )
}

/** Marks the notes on screen as read once shown. Renders nothing. */
export function MarkRead({ project, ids }: { project: string; ids: string[] }) {
  const key = ids.join(',')
  useEffect(() => {
    if (!key) return
    void markReadAction(project, key.split(',')).catch(() => {})
  }, [project, key])
  return null
}
