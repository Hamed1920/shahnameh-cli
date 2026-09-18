'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { EASE } from '@/components/ui/motion-tokens'
import { cn } from '@/lib/cn'

/**
 * A centred dialog, portalled to <body> so no transformed ancestor can trap
 * its `position: fixed`. Escape and a click on the backdrop close it.
 */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide = false,
  size,
  onKeyGuard,
  clip = true,
}: {
  open: boolean
  title: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  wide?: boolean
  /** md = form, lg = wide form, xl = near full screen. `wide` is the old name for lg. */
  size?: 'md' | 'lg' | 'xl'
  /** Return false to ignore Escape (e.g. while a dialog opened from this one is up). */
  onKeyGuard?: () => boolean
  /** False lets a popup near the bottom (an @-mention list) hang past the dialog's edge. */
  clip?: boolean
}) {
  const width = size ?? (wide ? 'lg' : 'md')
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      // A popup inside the dialog (an @-mention list) that handled Escape itself marks it handled.
      if (e.key === 'Escape' && !e.defaultPrevented && (onKeyGuard?.() ?? true)) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, onKeyGuard])

  if (!mounted) return null
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: EASE }}
          className="overlay fixed inset-0 z-100 overflow-y-auto overscroll-contain"
        >
          <div className="flex min-h-full items-start justify-center p-4 sm:p-12" onClick={onClose}>
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 10 }}
              transition={{ duration: 0.2, ease: EASE }}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                clip && 'overflow-hidden',
                'w-full rounded-2xl border border-edge-strong bg-panel shadow-[0_24px_80px_-24px_rgba(0,0,0,0.9)]',
                width === 'xl' ? 'max-w-7xl' : width === 'lg' ? 'max-w-4xl' : 'max-w-lg',
              )}
            >
              <div className="flex items-center gap-3 border-b border-edge py-4 pr-4 pl-6">
                <h2 className="text-[15px] font-medium tracking-[-0.005em] text-fg">{title}</h2>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="focus-ring ml-auto grid size-8 cursor-pointer place-items-center rounded-md text-muted transition-colors duration-150 hover:bg-white/[0.05] hover:text-fg"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </div>
              <div className="p-6">{children}</div>
              {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-edge px-6 py-4">{footer}</div>}
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
