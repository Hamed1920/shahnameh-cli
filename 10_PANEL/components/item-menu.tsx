'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Copy, ExternalLink, Film, FolderOpen, ListFilter } from 'lucide-react'
import { revealInFolder } from '@/app/[project]/reveal-action'
import { useProject } from '@/components/project-context'
import { ContextMenu, type MenuEntry } from '@/components/ui/context-menu'
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
  const [note, setNote] = useState<{ id: number; text: string; bad?: boolean } | null>(null)

  const say = (text: string, bad?: boolean) => {
    const id = ++seq
    setNote({ id, text, bad })
    setTimeout(() => setNote((n) => (n?.id === id ? null : n)), 2200)
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
          e.preventDefault()
          e.stopPropagation()
          setAt({ x: e.clientX, y: e.clientY })
        }}
      >
        {children}
      </Tag>
      <ContextMenu at={at} entries={entries} onClose={() => setAt(null)} />
      {note && <MenuNote text={note.text} bad={note.bad} />}
    </>
  )
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
        'pointer-events-none fixed inset-x-0 bottom-6 z-120 mx-auto w-fit max-w-md rounded-lg border bg-raise px-4 py-2.5 text-[13px] shadow-[0_16px_40px_-12px_rgba(0,0,0,0.85)]',
        bad ? 'border-bad/50 text-bad' : 'border-edge-strong text-fg',
      )}
    >
      {text}
    </div>,
    document.body,
  )
}
