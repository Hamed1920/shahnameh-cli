import { CheckCircle2, Circle, LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { NoteView } from '@/lib/pd-review'

const when = (d: Date | string) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export const ROLE_LABEL: Record<string, string> = { owner: 'Owner', production: 'Production', director: 'Director', supervisor: 'Script supervisor' }
export const CATEGORY_NOTE_LABEL = { director: 'Director note', continuity: 'Continuity note' } as const

const RES = {
  open: { text: 'Open', Icon: Circle, tone: 'text-fg' },
  in_progress: { text: 'In progress', Icon: LoaderCircle, tone: 'text-muted' },
  resolved: { text: 'Resolved', Icon: CheckCircle2, tone: 'text-good' },
} as const

/** Handling status of a note: icon and words, never colour alone. */
export function ResolutionLabel({ status }: { status: NoteView['resolutionStatus'] }) {
  const { text, Icon, tone } = RES[status]
  return (
    <span className={cn('inline-flex items-center gap-1 text-[12px] whitespace-nowrap', tone)}>
      <Icon aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0" /> {text}
    </span>
  )
}

export function timecodeLabel(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s - m * 60
  return `${m}:${sec.toFixed(sec % 1 ? 1 : 0).padStart(sec % 1 ? 4 : 2, '0')}`
}

/** One note: who, in what role, when, at which second; the body never changes. Unread ones are marked in words. */
export function NoteItem({ note, showResolution = true, highlightUnread = true, children }: {
  note: NoteView
  showResolution?: boolean
  highlightUnread?: boolean
  children?: React.ReactNode
}) {
  const unread = highlightUnread && !note.read
  return (
    <li className={cn('rounded-lg border px-3.5 py-2.5', unread ? 'border-fg/40 bg-white/[0.04]' : 'border-edge bg-panel')} data-note={note.id} data-unread={unread ? 'true' : undefined}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
        <span className="font-mono text-muted">Round {note.round}</span>
        <span className="text-fg/80">{CATEGORY_NOTE_LABEL[note.category]}</span>
        <span className="text-fg">{note.authorName}</span>
        <span className="text-muted">{ROLE_LABEL[note.authorRole] ?? note.authorRole}</span>
        <span className="text-faint">{when(note.createdAt)}</span>
        {note.timecodeSeconds !== null && <span className="font-mono text-muted">at {timecodeLabel(note.timecodeSeconds)}</span>}
        {unread && <span className="font-medium text-fg">New</span>}
        {showResolution && <span className="ml-auto"><ResolutionLabel status={note.resolutionStatus} /></span>}
      </div>
      <p className="mt-1.5 text-[13.5px] leading-relaxed whitespace-pre-wrap text-fg/90" dir="auto">{note.body}</p>
      {children}
    </li>
  )
}
