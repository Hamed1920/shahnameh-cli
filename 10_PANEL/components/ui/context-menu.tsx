'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { EASE } from '@/components/ui/motion-tokens'
import { cn } from '@/lib/cn'

export type MenuEntry =
  | { label: string; icon?: React.ReactNode; onSelect: () => void; tone?: 'bad'; disabled?: boolean; hint?: string }
  | { divider: true }
  | { heading: string }
  /** A row of small toggles, e.g. roles or statuses, so a submenu is not needed. */
  | { chips: { label: string; active?: boolean; onSelect: () => void }[]; caption?: string }

/**
 * A right-click menu at the pointer, kept inside the viewport. Portalled above
 * everything (dialogs included); Escape and any outside click close it.
 */
export function ContextMenu({
  at,
  entries,
  onClose,
}: {
  at: { x: number; y: number } | null
  entries: MenuEntry[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  /**
   * Measure, then clamp so a menu opened near an edge opens back toward the
   * middle. A menu with more in it than the window is tall -- the Gallery's,
   * which carries the whole filter bar -- is pinned to the top and scrolls
   * inside itself, rather than running off the bottom where the last rows
   * cannot be reached at all.
   */
  useLayoutEffect(() => {
    if (!at || !ref.current) { setPos(null); return }
    const { width, height } = ref.current.getBoundingClientRect()
    const left = at.x + width > window.innerWidth - 8 ? Math.max(8, at.x - width) : at.x
    const top = at.y + height > window.innerHeight - 8 ? Math.max(8, window.innerHeight - height - 8) : at.y
    setPos({ left, top })
    ref.current.querySelector<HTMLElement>('[role=menuitem]:not([disabled])')?.focus()
  }, [at, entries])

  useEffect(() => {
    if (!at) return
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onClose(); return }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled])') ?? [])]
      const i = items.indexOf(document.activeElement as HTMLElement)
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
    }
    // Scrolling the page moves what the menu was opened on out from under it.
    // A wheel inside the menu's own scroller is not that, so it is left alone.
    const away = (e?: Event) => { if (e && ref.current?.contains(e.target as Node)) return; onClose() }
    window.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('resize', away)
    window.addEventListener('wheel', away, { passive: true })
    window.addEventListener('scroll', away, { capture: true, passive: true })
    return () => {
      window.removeEventListener('mousedown', down, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('resize', away)
      window.removeEventListener('wheel', away)
      window.removeEventListener('scroll', away, true)
    }
  }, [at, onClose])

  // Nothing to offer is not a menu; it would open as an empty box at the pointer.
  if (!mounted || !at || entries.length === 0) return null
  const pick = (fn: () => void) => { onClose(); fn() }

  return createPortal(
    <motion.div
      ref={ref}
      role="menu"
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: pos ? 1 : 0, scale: 1 }}
      transition={{ duration: 0.1, ease: EASE }}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: pos?.left ?? at.x, top: pos?.top ?? at.y, maxHeight: 'calc(100vh - 16px)' }}
      className="scroll-pane fixed z-120 min-w-56 max-w-72 origin-top-left overflow-y-auto overscroll-contain rounded-lg border border-edge-strong bg-raise p-1 text-[13px] shadow-[0_16px_40px_-12px_rgba(0,0,0,0.85)]"
    >
      {entries.map((entry, i) => {
        if ('divider' in entry) return <div key={i} className="-mx-1 my-1 h-px bg-edge-strong/70" />
        if ('heading' in entry) {
          return <div key={i} className="truncate px-2.5 pt-1.5 pb-2 font-mono text-[11px] text-faint">{entry.heading}</div>
        }
        if ('chips' in entry) {
          return (
            <div key={i} className="px-2.5 py-1.5">
              {entry.caption && <div className="eyebrow mb-2 text-faint">{entry.caption}</div>}
              <div className="flex flex-wrap gap-1">
                {entry.chips.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    role="menuitem"
                    onClick={() => pick(c.onSelect)}
                    className={cn(
                      'focus-ring h-6 cursor-pointer rounded-md border px-2 font-mono text-[10px] transition-colors duration-100',
                      c.active ? 'border-fg bg-fg text-ink' : 'border-edge-strong text-muted hover:border-muted hover:text-fg',
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          )
        }
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            onClick={() => pick(entry.onSelect)}
            className={cn(
              'focus-ring flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-40',
              entry.tone === 'bad' ? 'text-bad hover:bg-bad/10 focus:bg-bad/10' : 'text-fg/90 hover:bg-white/[0.06] hover:text-fg focus:bg-white/[0.06]',
            )}
          >
            <span className="grid size-4 shrink-0 place-items-center text-muted">{entry.icon}</span>
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            {entry.hint && <span className="font-mono text-[11px] text-faint">{entry.hint}</span>}
          </button>
        )
      })}
    </motion.div>,
    document.body,
  )
}
