'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Archive, Copy, ExternalLink, Film, FolderOpen, ListFilter, LoaderCircle } from 'lucide-react'
import { revealInFolder } from '@/app/[project]/reveal-action'
import { archiveShots } from '@/app/[project]/episodes/actions'
import { assignToEpisode } from '@/app/[project]/shot-actions'
import { useProject } from '@/components/project-context'
import { EpisodePicker } from '@/components/episode-picker'
import { Button } from '@/components/ui/button'
import { ContextMenu, type MenuEntry } from '@/components/ui/context-menu'
import { Modal } from '@/components/ui/modal'
import { shortEpisode, type EpisodeChoice, type EpisodeOption } from '@/lib/episodes'
import { cn } from '@/lib/cn'

/**
 * Right-click anything and get the same few things.
 *
 * Every action here is **declared, not passed as a function**, so a server page
 * (Decided, Queue) can hand a menu to the browser the same way a client page
 * does. Anything needing the page's own state -- liking a take, toggling a tag
 * -- belongs to that page's own ContextMenu instead; this is the shared set.
 */
export type ItemAction =
  /** Go somewhere: another episode's view of this page, usually. */
  | { kind: 'link'; label: string; href: string; icon?: IconKey; active?: boolean }
  | { kind: 'copy'; label: string; text: string; icon?: IconKey }
  /** Open File Explorer with the file selected. */
  | { kind: 'reveal'; label: string; path: string }
  /** Open the media itself in a new tab. */
  | { kind: 'open'; label: string; href: string }
  /** Assign footage to another episode: the worker moves it (see shot-actions.ts). */
  | {
      kind: 'assign'
      shots: string[]
      /** Every episode that exists, whether or not it has accepted work in it. */
      episodes: EpisodeOption[]
      /** The next free number, from the server. Never worked out in the browser. */
      next: string
      /** The episode this footage is in now, so it is not offered as a destination. */
      exclude?: string[]
      label?: string
      /** Already on its way there, so the row says so instead of asking again. */
      pendingTo?: string | null
    }
  /** Take shots out of their episode: archived, and restorable. Confirmed first. */
  | { kind: 'archive'; label: string; shots: string[]; confirm: string }
  | { kind: 'divider' }
  | { kind: 'heading'; text: string }

export type IconKey = 'episode' | 'filter' | 'copy' | 'folder' | 'link'

const ICONS: Record<IconKey, ReactNode> = {
  episode: <Film className="size-3.5" />,
  filter: <ListFilter className="size-3.5" />,
  copy: <Copy className="size-3.5" />,
  folder: <FolderOpen className="size-3.5" />,
  link: <ExternalLink className="size-3.5" />,
}

let seq = 0

/** What the picker was opened for, kept after the menu that opened it has closed. */
interface Picking {
  at: { x: number; y: number }
  shots: string[]
  episodes: EpisodeOption[]
  next: string
  exclude: string[]
  label: string
}

export function ItemMenu({
  actions,
  as: Tag = 'div',
  className,
  children,
}: {
  actions: ItemAction[]
  /** The element the right-click is bound to. A table row needs `tr`, not a div inside it. */
  as?: 'div' | 'tr' | 'li'
  className?: string
  children: ReactNode
}) {
  const router = useRouter()
  const project = useProject()
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const [picking, setPicking] = useState<Picking | null>(null)
  const [confirming, setConfirming] = useState<{ shots: string[]; body: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ id: number; text: string; bad?: boolean } | null>(null)

  const say = (text: string, bad?: boolean) => {
    const id = ++seq
    setNote({ id, text, bad })
    setTimeout(() => setNote((n) => (n?.id === id ? null : n)), bad ? 6000 : 2600)
  }

  const send = (shots: string[], choice: EpisodeChoice) => {
    void assignToEpisode(project.slug, shots, choice.id, choice.title).then((r) => {
      if (!r.ok) { say(r.error ?? 'That did not save.', true); return }
      const n = r.moved?.length ?? shots.length
      say(`Asked the worker to move ${n === 1 ? 'it' : `${n} shots`} to ${shortEpisode(choice.id)}. It moves them on its next pass.`)
    })
  }

  const entries: MenuEntry[] = actions.map((a) => {
    if (a.kind === 'divider') return { divider: true }
    if (a.kind === 'heading') return { heading: a.text }
    if (a.kind === 'link') {
      return {
        label: a.label,
        icon: ICONS[a.icon ?? 'filter'],
        disabled: a.active,
        hint: a.active ? 'on' : undefined,
        onSelect: () => router.push(a.href),
      }
    }
    if (a.kind === 'copy') {
      return {
        label: a.label,
        icon: ICONS[a.icon ?? 'copy'],
        onSelect: () => {
          navigator.clipboard.writeText(a.text).then(
            () => say(`Copied ${a.text}`),
            () => say('Could not copy that.', true),
          )
        },
      }
    }
    if (a.kind === 'open') {
      return { label: a.label, icon: ICONS.link, onSelect: () => window.open(a.href, '_blank', 'noopener') }
    }
    if (a.kind === 'archive') {
      return {
        label: a.label,
        icon: <Archive className="size-3.5" />,
        tone: 'bad' as const,
        onSelect: () => setConfirming({ shots: a.shots, body: a.confirm }),
      }
    }
    if (a.kind === 'assign') {
      if (a.pendingTo) {
        return {
          label: `Moving to ${shortEpisode(a.pendingTo)}`,
          icon: <LoaderCircle className="size-3.5 animate-spin" />,
          disabled: true,
          hint: 'waiting',
          onSelect: () => {},
        }
      }
      const where = at ?? { x: 0, y: 0 }
      return {
        label: a.label ?? (a.shots.length === 1 ? 'Move it to another episode…' : `Move these ${a.shots.length} to another episode…`),
        icon: ICONS.episode,
        onSelect: () => setPicking({
          at: where,
          shots: a.shots,
          episodes: a.episodes,
          next: a.next,
          exclude: a.exclude ?? [],
          label: a.shots.length === 1 ? 'Move it to' : `Move ${a.shots.length} shots to`,
        }),
      }
    }
    return {
      label: a.label,
      icon: ICONS.folder,
      onSelect: () => {
        void revealInFolder(project.slug, a.path).then((r) => {
          if (!r.ok) say(r.error ?? 'Could not open the folder.', true)
        })
      },
    }
  })

  return (
    <>
      <Tag
        className={className}
        onContextMenu={(e: React.MouseEvent) => {
          if (!actions.length) return
          // A right-click in a text box belongs to the browser: that is where
          // paste lives, and taking it away is worse than any menu is good.
          if (isTextEntry(e.target)) return
          e.preventDefault()
          e.stopPropagation()
          setAt({ x: e.clientX, y: e.clientY })
        }}
      >
        {children}
      </Tag>
      <ContextMenu at={at} entries={entries} onClose={() => setAt(null)} />
      <Modal
        open={!!confirming}
        title={confirming && confirming.shots.length === 1 ? `Take ${confirming.shots[0]} out?` : `Take ${confirming?.shots.length ?? 0} shots out?`}
        onClose={() => setConfirming(null)}
        footer={
          <>
            <Button type="button" tone="ghost" onClick={() => setConfirming(null)}>Cancel</Button>
            <Button
              type="button"
              tone="bad"
              pending={busy}
              onClick={async () => {
                if (!confirming) return
                setBusy(true)
                const r = await archiveShots(project.slug, confirming.shots)
                  .catch((e: Error) => ({ ok: false, error: e.message }))
                setBusy(false)
                setConfirming(null)
                if (!r.ok) { say(r.error ?? 'That did not save.', true); return }
                say('Asked the worker to take it out. It moves the files to the archive on its next pass.')
              }}
            >
              Take it out
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-muted">{confirming?.body}</p>
      </Modal>

      <EpisodePicker
        at={picking?.at ?? null}
        title={picking?.label ?? ''}
        episodes={picking?.episodes ?? []}
        next={picking?.next ?? ''}
        exclude={picking?.exclude ?? []}
        onPick={(choice) => { if (picking) send(picking.shots, choice) }}
        onClose={() => setPicking(null)}
      />
      {note && <MenuNote text={note.text} bad={note.bad} />}
    </>
  )
}

/** Whether the pointer is over something the browser's own menu is for. */
export function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.closest !== 'function') return false
  return !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
}

/**
 * What the menu just did, said once and gone. Portalled to the body: a queue
 * row's menu lives inside a <tbody>, where a loose <div> is invalid HTML.
 */
export function MenuNote({ text, bad }: { text: string; bad?: boolean }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  return createPortal(
    <div
      role="status"
      className={cn(
        'pointer-events-none fixed inset-x-0 bottom-6 z-120 mx-auto w-fit max-w-md rounded-lg border bg-raise px-4 py-2.5 text-center text-[13px] shadow-[0_16px_40px_-12px_rgba(0,0,0,0.85)]',
        bad ? 'border-bad/50 text-bad' : 'border-edge-strong text-fg',
      )}
    >
      {text}
    </div>,
    document.body,
  )
}
