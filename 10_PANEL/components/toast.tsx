'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Film, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import { EASE } from '@/components/ui/motion-tokens'
import { cn } from '@/lib/cn'

/**
 * The panel's one way of saying something happened: a request was sent, the
 * worker finished it or refused it, a new take arrived. Bottom right, newest
 * at the bottom, at most four at a time.
 *
 * A problem stays until it is dismissed -- a refusal that disappears before it
 * is read is worse than none. Everything else goes by itself after a few
 * seconds. A toast with an `id` replaces the one already showing with that id,
 * so a "sending..." can turn into "done" in place.
 */

export type ToastTone = 'info' | 'good' | 'bad' | 'working' | 'new'

export interface ToastInput {
  /** Replaces a toast already showing with the same id. */
  id?: string
  tone?: ToastTone
  title: string
  detail?: string
  action?: { label: string; onClick: () => void }
  /** Milliseconds on screen; null stays until dismissed. Default: problems stay, the rest 4.5 s. */
  duration?: number | null
  /** Draw a bar that runs down over this many milliseconds (an Undo window). */
  countdown?: number
}

interface Toast extends Required<Pick<ToastInput, 'id' | 'tone' | 'title'>> {
  detail?: string
  action?: ToastInput['action']
  countdown?: number
  /** Bumped on each replacement, so an in-place update restarts its timer. */
  rev: number
}

interface ToastApi {
  show: (t: ToastInput) => string
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)
const MAX = 4
let seq = 0

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: string) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setToasts((all) => all.filter((t) => t.id !== id))
  }, [])

  const show = useCallback((input: ToastInput) => {
    const id = input.id ?? `t${++seq}`
    const tone = input.tone ?? 'info'
    const duration = input.duration !== undefined ? input.duration : tone === 'bad' ? null : 4500
    setToasts((all) => {
      const prev = all.find((t) => t.id === id)
      const next: Toast = { id, tone, title: input.title, detail: input.detail, action: input.action, countdown: input.countdown, rev: (prev?.rev ?? 0) + 1 }
      const rest = all.filter((t) => t.id !== id)
      return [...rest, next].slice(-MAX)
    })
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    if (duration != null) timers.current.set(id, setTimeout(() => dismiss(id), duration))
    return id
  }, [dismiss])

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss])
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {mounted && createPortal(
        <div
          aria-live="polite"
          className="pointer-events-none fixed right-0 bottom-0 z-[130] flex w-full flex-col items-end gap-2 p-4 sm:w-auto sm:p-6"
        >
          <AnimatePresence initial={false}>
            {toasts.map((t) => <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />)}
          </AnimatePresence>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast must be used inside <ToastProvider> (app/layout.tsx)')
  return api
}

const ICON: Record<ToastTone, React.ReactNode> = {
  info: null,
  good: <Check aria-hidden className="size-4 shrink-0 text-good" />,
  bad: <TriangleAlert aria-hidden className="size-4 shrink-0 text-bad" />,
  working: <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin text-muted" />,
  new: <Film aria-hidden className="size-4 shrink-0 text-fg" />,
}

function ToastCard({ toast: t, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 16, transition: { duration: 0.16, ease: EASE } }}
      transition={{ duration: 0.2, ease: EASE }}
      role={t.tone === 'bad' ? 'alert' : 'status'}
      className={cn(
        'pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-lg border bg-raise py-2.5 pr-2 pl-3.5 text-[13px] sm:w-[23rem]',
        'shadow-[0_16px_40px_-12px_rgba(0,0,0,0.85)]',
        t.tone === 'bad' ? 'border-bad/50' : 'border-edge-strong',
      )}
    >
      {ICON[t.tone] && <span className="mt-0.5">{ICON[t.tone]}</span>}
      <div className="min-w-0 flex-1 py-px">
        <div className="text-fg" dir="auto">{t.title}</div>
        {t.detail && <div className={cn('mt-0.5 line-clamp-2 text-[12px] leading-snug', t.tone === 'bad' ? 'text-bad/90' : 'text-muted')} dir="auto">{t.detail}</div>}
      </div>
      {t.action && (
        <button
          type="button"
          onClick={() => { t.action!.onClick(); if (!t.countdown) onDismiss() }}
          className="focus-ring h-7 shrink-0 cursor-pointer rounded-md border border-edge-strong px-2.5 text-[12.5px] text-fg transition-colors duration-150 hover:bg-white/[0.06]"
        >
          {t.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="focus-ring grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-faint transition-colors duration-150 hover:bg-white/[0.05] hover:text-fg"
      >
        <X aria-hidden className="size-3.5" />
      </button>
      {t.countdown && (
        <motion.span
          key={t.rev}
          aria-hidden
          initial={{ scaleX: 1 }}
          animate={{ scaleX: 0 }}
          transition={{ duration: t.countdown / 1000, ease: 'linear' }}
          className="absolute inset-x-0 bottom-0 h-px origin-left bg-fg/70"
        />
      )}
    </motion.div>
  )
}
