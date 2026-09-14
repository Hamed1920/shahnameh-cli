'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { EASE } from '@/components/ui/motion-tokens'

export interface LightboxItem {
  /** Direct URL: an /api/asset URL or a blob: preview. */
  src: string
  title: string
  subtitle?: string
  video?: boolean
}

/**
 * Full-screen viewer over a set of images or videos, with arrow-key paging.
 *
 * Portalled to <body> deliberately: review content sits inside transformed
 * motion components, and a transformed ancestor makes `position: fixed`
 * resolve against it instead of the viewport.
 */
export function Lightbox({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: LightboxItem[]
  index: number | null
  onIndex: (i: number) => void
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const current = index === null ? null : items[index]

  useEffect(() => {
    if (index === null) return
    function onKey(e: KeyboardEvent) {
      // Capture phase + stop: the review page's own shortcuts must not fire underneath.
      if (['Escape', 'ArrowRight', 'ArrowLeft'].includes(e.key)) e.stopPropagation()
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight' && items.length > 1) onIndex((index! + 1) % items.length)
      if (e.key === 'ArrowLeft' && items.length > 1) onIndex((index! - 1 + items.length) % items.length)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [index, items.length, onClose, onIndex])

  if (!mounted) return null

  const nav =
    'focus-ring fixed top-1/2 grid size-11 -translate-y-1/2 cursor-pointer place-items-center rounded-md border border-edge-strong bg-panel text-muted transition-colors duration-150 hover:border-[#505050] hover:text-fg'

  return createPortal(
    <AnimatePresence>
      {current && (
        <motion.div
          key="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={current.title}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: EASE }}
          className="fixed inset-0 z-100 overflow-y-auto overscroll-contain bg-black/92"
        >
          <div className="flex min-h-full items-center justify-center p-6 sm:p-10" onClick={onClose}>
            <motion.figure
              initial={{ opacity: 0, scale: 0.97, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 10 }}
              transition={{ duration: 0.22, ease: EASE }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-6xl overflow-hidden rounded-2xl border border-edge bg-panel"
            >
              {current.video ? (
                <video src={current.src} className="checker max-h-[72vh] w-full object-contain" controls autoPlay loop muted playsInline />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={current.src} alt={current.title} className="checker max-h-[72vh] w-full object-contain" />
              )}
              <figcaption className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-edge px-6 py-4">
                <span className="font-mono text-sm font-medium text-fg">{current.title}</span>
                {current.subtitle && <span className="text-[13px] break-all text-muted">{current.subtitle}</span>}
                {items.length > 1 && (
                  <span className="ml-auto font-mono text-xs text-muted tabular-nums">
                    <span className="text-fg">{String(index! + 1).padStart(2, '0')}</span> / {String(items.length).padStart(2, '0')}
                  </span>
                )}
              </figcaption>
            </motion.figure>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            autoFocus
            className="focus-ring fixed top-5 right-5 grid size-11 cursor-pointer place-items-center rounded-md border border-edge-strong bg-panel text-muted transition-colors duration-150 hover:border-[#505050] hover:text-fg"
          >
            <X aria-hidden className="size-4.5" />
          </button>
          {items.length > 1 && (
            <>
              <button type="button" onClick={() => onIndex((index! - 1 + items.length) % items.length)} aria-label="Previous" className={`${nav} left-5`}>
                <ChevronLeft aria-hidden className="size-5" />
              </button>
              <button type="button" onClick={() => onIndex((index! + 1) % items.length)} aria-label="Next" className={`${nav} right-5`}>
                <ChevronRight aria-hidden className="size-5" />
              </button>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
