'use client'

import { useState, useTransition } from 'react'
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import { orderAfterMove } from '@/lib/pd-order'
import {
  addBlock, addSequence, renameBlockAction, renameSequenceAction, reorderBlocksAction, reorderSequencesAction,
  retireBlockAction, retireSequenceAction, setDurationAction, type SeqResult,
} from './actions'

/** Runs an action, keeps its error to show, and says when it is busy. */
function useRun() {
  const [error, setError] = useState<string | null>(null)
  const [busy, start] = useTransition()
  function run(fn: () => Promise<SeqResult>, done?: () => void) {
    setError(null)
    start(async () => {
      const r = await fn().catch((e: Error) => ({ ok: false, error: e.message }) as SeqResult)
      if (!r.ok) setError(r.error ?? 'That did not save.')
      else done?.()
    })
  }
  return { error, busy, run }
}

const Err = ({ text }: { text: string | null }) =>
  text ? <p role="alert" className="mt-1 text-xs text-bad">{text}</p> : null

const iconBtn =
  'focus-ring grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted transition-colors ' +
  'hover:bg-white/[0.05] hover:text-fg disabled:cursor-not-allowed disabled:opacity-30'

/** Up / down / rename / retire for one row. `kind` picks which actions it calls. */
function RowTools({
  label, ids, id, first, last, onMove, onRename, onRetire, title, retireWhy,
}: {
  label: string
  ids: string[]
  id: string
  first: boolean
  last: boolean
  onMove: (ordered: string[]) => Promise<SeqResult>
  onRename: (title: string) => Promise<SeqResult>
  onRetire: () => Promise<SeqResult>
  title: string
  retireWhy: string
}) {
  const { error, busy, run } = useRun()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const [asking, setAsking] = useState(false)

  if (editing) {
    return (
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => { e.preventDefault(); run(() => onRename(draft), () => setEditing(false)) }}
      >
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={120} autoFocus aria-label={`New title for ${label}`} className="w-56" dir="auto" />
        <button type="submit" disabled={busy} aria-label="Save title" className={iconBtn}><Check aria-hidden className="size-4" /></button>
        <button type="button" onClick={() => { setEditing(false); setDraft(title) }} aria-label="Cancel" className={iconBtn}><X aria-hidden className="size-4" /></button>
        <Err text={error} />
      </form>
    )
  }
  if (asking) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <span>Retire {label}? {retireWhy}</span>
        <Button type="button" tone="bad" size="sm" pending={busy} pendingLabel="Retiring" onClick={() => run(onRetire, () => setAsking(false))}>Retire</Button>
        <Button type="button" tone="ghost" size="sm" onClick={() => setAsking(false)}>Keep</Button>
        <Err text={error} />
      </div>
    )
  }
  return (
    <div>
      <div className="flex items-center justify-end">
        <button type="button" disabled={busy || first} onClick={() => run(() => onMove(orderAfterMove(ids, id, 'up')))} aria-label={`Move ${label} earlier`} className={iconBtn}><ArrowUp aria-hidden className="size-4" /></button>
        <button type="button" disabled={busy || last} onClick={() => run(() => onMove(orderAfterMove(ids, id, 'down')))} aria-label={`Move ${label} later`} className={iconBtn}><ArrowDown aria-hidden className="size-4" /></button>
        <button type="button" disabled={busy} onClick={() => { setDraft(title); setEditing(true) }} aria-label={`Rename ${label}`} className={iconBtn}><Pencil aria-hidden className="size-4" /></button>
        <button type="button" disabled={busy} onClick={() => setAsking(true)} aria-label={`Retire ${label}`} className={iconBtn}><Trash2 aria-hidden className="size-4" /></button>
      </div>
      <Err text={error} />
    </div>
  )
}

export function SequenceTools({ project, ids, id, title }: { project: string; ids: string[]; id: string; title: string }) {
  const i = ids.indexOf(id)
  return (
    <RowTools
      label={id} ids={ids} id={id} first={i <= 0} last={i === ids.length - 1} title={title}
      retireWhy="Its number stays spent. A sequence with blocks cannot be retired."
      onMove={(o) => reorderSequencesAction(project, o)}
      onRename={(t) => renameSequenceAction(project, id, t)}
      onRetire={() => retireSequenceAction(project, id)}
    />
  )
}

export function BlockTools({ project, sequence, ids, id, title }: { project: string; sequence: string; ids: string[]; id: string; title: string }) {
  const i = ids.indexOf(id)
  return (
    <RowTools
      label={id} ids={ids} id={id} first={i <= 0} last={i === ids.length - 1} title={title}
      retireWhy="Its number stays spent and its history is kept."
      onMove={(o) => reorderBlocksAction(project, sequence, o)}
      onRename={(t) => renameBlockAction(project, sequence, id, t)}
      onRetire={() => retireBlockAction(project, sequence, id)}
    />
  )
}

export function NewSequence({ project }: { project: string }) {
  const { error, busy, run } = useRun()
  const [title, setTitle] = useState('')
  return (
    <form
      className="flex flex-wrap items-start gap-2"
      onSubmit={(e) => { e.preventDefault(); run(() => addSequence(project, title), () => setTitle('')) }}
    >
      <div>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="New sequence title" aria-label="New sequence title" className="w-72" dir="auto" />
        <Err text={error} />
      </div>
      <Button type="submit" tone="accent" size="sm" pending={busy} pendingLabel="Adding" disabled={!title.trim()} className="h-9">
        <Plus aria-hidden className="size-3.5" /> New sequence
      </Button>
    </form>
  )
}

export function NewBlock({ project, sequence }: { project: string; sequence: string }) {
  const { error, busy, run } = useRun()
  const [title, setTitle] = useState('')
  const [duration, setDuration] = useState('')
  return (
    <form
      className="flex flex-wrap items-start gap-2"
      onSubmit={(e) => { e.preventDefault(); run(() => addBlock(project, sequence, title, duration), () => { setTitle(''); setDuration('') }) }}
    >
      <div>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="New block title" aria-label="New block title" className="w-72" dir="auto" />
        <Err text={error} />
      </div>
      <Input
        value={duration} onChange={(e) => setDuration(e.target.value)} inputMode="numeric" placeholder="Seconds"
        aria-label="Target duration in seconds" className="w-24 font-mono"
      />
      <Button type="submit" tone="accent" size="sm" pending={busy} pendingLabel="Adding" disabled={!title.trim()} className="h-9">
        <Plus aria-hidden className="size-3.5" /> New block
      </Button>
    </form>
  )
}

/** The target duration as text; click to change it. Empty means not set. */
export function DurationEdit({ project, sequence, id, seconds }: { project: string; sequence: string; id: string; seconds: number | null }) {
  const { error, busy, run } = useRun()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(seconds === null ? '' : String(seconds))
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setDraft(seconds === null ? '' : String(seconds)); setEditing(true) }}
        aria-label={`Change target duration of ${id}`}
        className="focus-ring cursor-pointer rounded px-1 font-mono text-[13px] text-muted tabular-nums transition-colors hover:text-fg"
      >
        {seconds === null ? '—' : `${seconds} s`}
      </button>
    )
  }
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => { e.preventDefault(); run(() => setDurationAction(project, sequence, id, draft), () => setEditing(false)) }}
    >
      <Input value={draft} onChange={(e) => setDraft(e.target.value)} inputMode="numeric" autoFocus aria-label={`Target duration of ${id} in seconds`} className="h-8 w-20 font-mono" />
      <button type="submit" disabled={busy} aria-label="Save duration" className={iconBtn}><Check aria-hidden className="size-4" /></button>
      <button type="button" onClick={() => setEditing(false)} aria-label="Cancel" className={iconBtn}><X aria-hidden className="size-4" /></button>
      <Err text={error} />
    </form>
  )
}
