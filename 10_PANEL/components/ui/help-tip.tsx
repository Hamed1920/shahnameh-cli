'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { CircleHelp } from 'lucide-react'
import { EASE } from '@/components/ui/motion-tokens'
import { cn } from '@/lib/cn'

/**
 * A small "?" that explains something on hover, focus or tap.
 *
 * The bubble is portalled to <body> and positioned against the viewport: review
 * cards clip their overflow and sit inside a transformed Reveal, so an
 * in-place absolute bubble would be cut off at the card edge.
 */
export function HelpTip({
  label,
  children,
  width = 380,
  dir,
  lang,
}: {
  /** Accessible name of the trigger. */
  label: string
  children: ReactNode
  width?: number
  dir?: 'rtl' | 'ltr'
  lang?: string
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const bubble = useRef<HTMLDivElement>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0, width, above: false, maxHeight: 480 })
  const id = useId()

  useEffect(() => setMounted(true), [])

  const place = useCallback(() => {
    const el = trigger.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const w = Math.min(width, window.innerWidth - 24)
    const left = Math.min(Math.max(r.left + r.width / 2 - w / 2, 12), window.innerWidth - w - 12)
    // Measure the real bubble once it exists; before that, assume a tall one.
    const height = bubble.current?.scrollHeight ?? 480
    const spaceBelow = window.innerHeight - r.bottom - 16
    const spaceAbove = r.top - 16
    // Below if it fits, else above if it fits, else the roomier side and scroll inside.
    const above = height > spaceBelow && (height <= spaceAbove || spaceAbove > spaceBelow)
    setPos({
      top: above ? r.top - 8 : r.bottom + 8,
      left,
      width: w,
      above,
      maxHeight: Math.max(120, above ? spaceAbove : spaceBelow),
    })
  }, [width])

  // Re-place after the bubble mounts, now that its true height is known.
  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  const show = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    place()
    setOpen(true)
  }, [place])

  // A short grace period lets the pointer travel from the "?" into the bubble.
  const hide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setOpen(false), 140)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, place])

  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current) }, [])

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
        // Tap on touch screens; also stops the enclosing <label> from acting.
        onClick={(e) => {
          e.preventDefault()
          if (open) setOpen(false)
          else show()
        }}
        className={cn(
          'focus-ring inline-grid size-4 cursor-help place-items-center rounded-full align-middle',
          'text-faint transition-colors duration-150 hover:text-fg',
          open && 'text-fg',
        )}
      >
        <CircleHelp aria-hidden className="size-3.5" />
      </button>

      {mounted &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                key="tip"
                ref={bubble}
                id={id}
                role="tooltip"
                dir={dir}
                lang={lang}
                initial={{ opacity: 0, y: pos.above ? 4 : -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: pos.above ? 4 : -4 }}
                transition={{ duration: 0.16, ease: EASE }}
                onPointerEnter={show}
                onPointerLeave={hide}
                style={{
                  top: pos.top,
                  left: pos.left,
                  width: pos.width,
                  maxHeight: pos.maxHeight,
                  translate: pos.above ? '0 -100%' : undefined,
                }}
                className={cn(
                  // Solid: the bubble floats over busy thumbnails.
                  'scroll-pane fixed z-110 overflow-y-auto overscroll-contain rounded-lg border border-edge-strong bg-raise px-4 py-3.5',
                  'text-xs leading-relaxed text-fg shadow-[0_16px_40px_-12px_rgba(0,0,0,0.85)]',
                )}
              >
                {children}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  )
}
