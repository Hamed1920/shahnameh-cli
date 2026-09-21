'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { Film, Plus, Search } from 'lucide-react'
import { EASE } from '@/components/ui/motion-tokens'
import { cn } from '@/lib/cn'
import { CONTROL } from '@/components/ui/control'
import { searchEpisodes, shortEpisode, type EpisodeChoice, type EpisodeOption } from '@/lib/episodes'

/**
 * Which episode this footage goes to: one typed line that searches and starts.
 *
 * A row of chips does not survive a film with fifteen episodes, and it asks for
 * the number rather than the name, which is not how anyone thinks about it. So:
 * type, and the list narrows; type something that is not there, and the last
 * row starts an episode called that.
 *
 * The number of a new episode is never the typed one. Numbers are handed out in
 * order and never reused (docs/INDEXING.md section 9), so it is always the next
 * free one and the note says so when the typed number was something else.
 *
 * Portalled and placed at the pointer, like the right-click menu it usually
 * opens from, so a card with a transform on it cannot trap it.
 */
export function EpisodePicker({
  at,
  title,
  episodes,
  next,
  exclude = [],
  onPick,
  onClose,
}: {
  /** Where to open, in viewport coordinates. Null is closed. */
  at: { x: number; y: number } | null
  /** "Move 3 shots to". */
  title: string
  episodes: EpisodeOption[]
  /** The next free number, worked out by the server from every episode that exists. */
  next: string
  /** Episodes to leave out: the one this footage is already in. */
  exclude?: string[]
  onPick: (choice: EpisodeChoice) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  /**
   * A fresh open starts from an empty line, wherever the last one was left --
   * and the line is cleared on the way OUT, not on the way in. Clearing it on
   * open would leave the first render showing the old, shorter list, which is
   * the one the effect below would then measure and place.
   */
  useEffect(() => { if (!at) { setQuery(''); setActive(0); setPos(null) } }, [at])

  const skip = exclude.join(',')
  const { matches, create, note } = useMemo(
    () => searchEpisodes(query, episodes, next, skip ? skip.split(',') : []),
    [query, episodes, next, skip],
  )
  const rows: EpisodeChoice[] = useMemo(
    () => [...matches.map((e) => ({ id: e.id, title: e.title, isNew: false })), ...create],
    [matches, create],
  )
  const clamped = Math.min(active, Math.max(0, rows.length - 1))
  const listId = 'episode-picker-list'
  const rowId = (i: number) => `episode-picker-row-${i}`

  useEffect(() => {
    if (!at || !ref.current) return
    const { width, height } = ref.current.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(at.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(at.y, window.innerHeight - height - 8)),
    })
    input.current?.focus()
  }, [at])

  useEffect(() => {
    if (!at) return
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    window.addEventListener('mousedown', down, true)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('mousedown', down, true)
      window.removeEventListener('resize', onClose)
    }
  }, [at, onClose])

  if (!mounted || !at) return null

  const take = (row: EpisodeChoice | undefined) => {
    if (!row) return
    onClose()
    onPick(row)
  }

  return createPortal(
    <motion.div
      ref={ref}
      role="dialog"
      aria-label={title}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: pos ? 1 : 0, scale: 1 }}
      transition={{ duration: 0.1, ease: EASE }}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: pos?.left ?? at.x, top: pos?.top ?? at.y }}
      className="fixed z-130 flex w-72 flex-col rounded-lg border border-edge-strong bg-raise p-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.85)]"
    >
      <div className="truncate px-2.5 pt-1.5 pb-2 font-mono text-[11px] text-faint">{title}</div>

      <div className="relative px-1">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-3.5 -translate-y-1/2 text-faint" />
        <input
          ref={input}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0) }}
          placeholder="Search, or type a number and a name"
          aria-label="Search the episodes, or type a number and a name to start one"
          role="combobox"
          aria-expanded
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={rows.length ? rowId(clamped) : undefined}
          dir="auto"
          className={cn(CONTROL, 'h-8 pl-8 text-[13px]')}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return }
            if (e.key === 'Enter') { e.preventDefault(); take(rows[clamped]); return }
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            e.preventDefault()
            if (rows.length === 0) return
            setActive((i) => (Math.min(i, rows.length - 1) + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length)
          }}
        />
      </div>

      <div id={listId} className="scroll-pane mt-1 max-h-64 overflow-y-auto" role="listbox" aria-label="Episodes">
        {rows.length === 0 && (
          <p className="px-2.5 py-3 text-[12px] leading-relaxed text-faint">
            Nothing matches that.
          </p>
        )}
        {rows.map((row, i) => {
          const shots = row.isNew ? null : matches.find((m) => m.id === row.id)?.shots ?? 0
          return (
            <button
              key={`${row.id}-${row.isNew ? 'new' : 'has'}`}
              id={rowId(i)}
              type="button"
              role="option"
              aria-selected={i === clamped}
              onMouseEnter={() => setActive(i)}
              onClick={() => take(row)}
              className={cn(
                'flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left transition-colors duration-100',
                i === clamped ? 'bg-white/[0.07] text-fg' : 'text-fg/85',
              )}
            >
              <span className="grid size-4 shrink-0 place-items-center text-muted">
                {row.isNew ? <Plus aria-hidden className="size-3.5" /> : <Film aria-hidden className="size-3.5" />}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px]">
                <span className="font-mono text-[12px]">{shortEpisode(row.id)}</span>
                {row.title && <span className="ml-2 text-fg/80">{row.title}</span>}
                {row.isNew && !row.title && <span className="ml-2 text-faint">new episode</span>}
              </span>
              {row.isNew ? (
                <span className="font-mono text-[10px] text-faint">{row.id === next ? 'new · next' : 'new'}</span>
              ) : (
                <span className="font-mono text-[10px] text-faint tabular-nums">{shots}</span>
              )}
            </button>
          )
        })}
      </div>

      {note && <p className="px-2.5 pt-1.5 pb-2 text-[11.5px] leading-relaxed text-faint">{note}</p>}
    </motion.div>,
    document.body,
  )
}
