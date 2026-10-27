'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, MessageSquareWarning, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { addNoteAction, decideAction, markReadAction } from './actions'

const Err = ({ text }: { text: string | null }) =>
  text ? <p role="alert" className="text-[12px] text-bad" dir="auto">{text}</p> : null

const field = 'mt-1 block w-full rounded-md border border-edge bg-ink px-2.5 py-1.5 text-[13px] text-fg'

/** Add a note to the active round. `categories` is one value for the director and the supervisor, both for the owner. */
export function NoteForm({ project, submissionId, categories }: { project: string; submissionId: string; categories: ('director' | 'continuity')[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [body, setBody] = useState('')
  const [time, setTime] = useState('')
  const [cat, setCat] = useState<string>(categories[0])
  const [error, setError] = useState<string | null>(null)

  const send = () =>
    start(async () => {
      const r = await addNoteAction(project, submissionId, cat, body, time).catch((e: Error) => ({ ok: false, error: e.message }))
      setError(r.ok ? null : r.error ?? 'Could not save.')
      if (r.ok) { setBody(''); setTime(''); router.refresh() }
    })

  return (
    <form className="mt-4 space-y-2" onSubmit={(e) => { e.preventDefault(); send() }}>
      <label className="block text-[12px] text-faint">
        {categories.length === 1 ? (categories[0] === 'director' ? 'Add a director note' : 'Add a continuity note') : 'Add a note'}
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} dir="auto" maxLength={4000} className={`${field} resize-y`} />
      </label>
      <div className="flex flex-wrap items-end gap-3">
        {categories.length > 1 && (
          <label className="text-[12px] text-faint">
            Kind
            <select value={cat} onChange={(e) => setCat(e.target.value)} className={`${field} w-auto`}>
              <option value="director">Director note</option>
              <option value="continuity">Continuity note</option>
            </select>
          </label>
        )}
        <label className="text-[12px] text-faint">
          At second (optional)
          <input value={time} onChange={(e) => setTime(e.target.value)} inputMode="decimal" placeholder="e.g. 4.5" className={`${field} w-28`} />
        </label>
        <Button type="submit" size="sm" disabled={pending || !body.trim()}>
          <Send aria-hidden className="size-3.5" /> Add note
        </Button>
      </div>
      <Err text={error} />
    </form>
  )
}

/** Approve or request a revision on the active round. A revision needs a note. */
export function DecisionButtons({ project, submissionId }: { project: string; submissionId: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const go = (decision: 'approved' | 'revision_requested') => {
    if (decision === 'revision_requested' && !note.trim()) { setError('A revision request needs a note saying what to change.'); return }
    start(async () => {
      const r = await decideAction(project, submissionId, decision, note).catch((e: Error) => ({ ok: false, error: e.message }))
      setError(r.ok ? null : r.error ?? 'Could not save.')
      if (r.ok) { setNote(''); router.refresh() }
    })
  }

  return (
    <div className="space-y-2.5">
      <label className="block text-[12px] text-faint">
        Note (required to request a revision)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} dir="auto" maxLength={4000} className={`${field} resize-y`} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={() => go('revision_requested')}>
          <MessageSquareWarning aria-hidden className="size-3.5" /> Request revision
        </Button>
        <Button type="button" size="sm" tone="accent" disabled={pending} onClick={() => go('approved')}>
          <Check aria-hidden className="size-3.5" /> Approve
        </Button>
      </div>
      <Err text={error} />
    </div>
  )
}

/** Marks the notes shown as read once the page is on screen. Renders nothing. */
export function MarkRead({ project, ids }: { project: string; ids: string[] }) {
  const key = ids.join(',')
  useEffect(() => {
    if (!key) return
    void markReadAction(project, key.split(',')).catch(() => {})
  }, [project, key])
  return null
}
