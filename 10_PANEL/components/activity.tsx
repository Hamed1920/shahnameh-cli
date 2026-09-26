'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { navHref } from '@/components/nav-items'
import { useToast } from '@/components/toast'
import { EASE } from '@/components/ui/motion-tokens'
import type { ActivityItem } from '@/lib/activity'
import { cn } from '@/lib/cn'
import { plainReason } from '@/lib/plain'

/**
 * The worker's outcomes, wherever Hamed is (lib/activity.ts).
 *
 * The project layout hands the latest items to the sidebar on every render,
 * and every live refresh is a render. Anything newer than what this browser
 * has already seen becomes a toast: a problem stays until dismissed and offers
 * to open the page it concerns; the rest are said once and go.
 *
 * Remembered per project in localStorage: what has been toasted, and what has
 * been read in the Activity list (the sidebar's unread count). A browser that
 * has never seen the project starts from now rather than replaying history.
 */

const store = {
  get(key: string): string | null {
    try { return localStorage.getItem(key) } catch { return null }
  },
  set(key: string, value: string) {
    try { localStorage.setItem(key, value) } catch { /* private window: forget it */ }
  },
}

const newest = (items: ActivityItem[]) => items.reduce((m, i) => (i.ts > m ? i.ts : m), '')

export function useActivity(project: string, items: ActivityItem[], pathname: string) {
  const router = useRouter()
  const toaster = useToast()
  const seenKey = `fmfd-activity-seen:${project}`
  const readKey = `fmfd-activity-read:${project}`
  const [readTs, setReadTs] = useState<string | null>(null)
  const shown = useRef(new Set<string>())

  useEffect(() => {
    let seen = store.get(seenKey)
    if (seen === null) {
      seen = newest(items) || new Date().toISOString()
      store.set(seenKey, seen)
    }
    setReadTs((r) => r ?? store.get(readKey) ?? seen)

    const fresh = items.filter((i) => i.ts > seen! && !shown.current.has(i.id))
    if (fresh.length === 0) return
    fresh.forEach((i) => shown.current.add(i.id))
    store.set(seenKey, newest(fresh))

    const here = (i: ActivityItem) => i.href !== undefined && pathname === navHref(project, i.href)
    for (const i of fresh.filter((x) => x.tone === 'bad')) {
      toaster.show({
        id: `activity-${i.id}`,
        tone: 'bad',
        title: i.title,
        detail: i.detail ? plainReason(i.detail) : undefined,
        action: i.href && !here(i) ? { label: 'Open', onClick: () => router.push(navHref(project, i.href!)) } : undefined,
      })
    }
    // Review announces its own arrivals, with a button that jumps to the take.
    const rest = fresh.filter((x) => x.tone !== 'bad' && !(x.tone === 'new' && here(x)))
    if (rest.length === 1) {
      const [i] = rest
      toaster.show({
        tone: i.tone === 'good' ? 'good' : i.tone === 'new' ? 'new' : 'info',
        title: i.title,
        detail: i.detail,
        action: i.href && !here(i) ? { label: 'Open', onClick: () => router.push(navHref(project, i.href!)) } : undefined,
        duration: i.tone === 'new' ? 8000 : 5000,
      })
    } else if (rest.length > 1) {
      toaster.show({ tone: 'info', title: `${rest.length} updates from the worker`, detail: rest.slice(0, 2).map((i) => i.title).join(' · '), duration: 6000 })
    }
  }, [items, pathname, project, router, seenKey, readKey, toaster])

  const unread = useMemo(
    () => (readTs === null ? 0 : items.filter((i) => i.ts > readTs && i.tone !== 'info').length),
    [items, readTs],
  )
  const markRead = () => {
    const ts = newest(items)
    if (!ts) return
    store.set(readKey, ts)
    setReadTs(ts)
  }
  return { unread, markRead }
}

const TONE_DOT = { good: 'bg-good', bad: 'bg-bad', info: 'bg-faint', new: 'bg-fg' } as const

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** The list behind the sidebar's Activity row: the last fifty things the worker did or could not do. */
export function ActivitySheet({ open, onClose, project, items }: { open: boolean; onClose: () => void; project: string; items: ActivityItem[] }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  // Portalled: the sidebar that opens it is its own stacking layer.
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[110]" role="dialog" aria-modal="true" aria-label="Activity">
          <motion.div
            className="overlay absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: EASE }}
            onClick={onClose}
          />
          <motion.aside
            className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-edge bg-ink"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.24, ease: EASE }}
          >
            <header className="flex items-end justify-between border-b border-edge px-6 pt-7 pb-5">
              <div>
                <div className="eyebrow text-faint">From the worker</div>
                <h2 className="mt-2 font-display text-[40px] leading-none text-fg">Activity</h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="focus-ring grid size-9 cursor-pointer place-items-center rounded-md text-faint hover:bg-white/[0.05] hover:text-fg"
              >
                <X aria-hidden className="size-4.5" />
              </button>
            </header>
            {items.length === 0 ? (
              <p className="px-6 py-10 text-sm leading-relaxed text-muted">
                Nothing yet. What the worker does with your prompts, decisions and changes shows up here as it happens.
              </p>
            ) : (
              <ol className="scroll-pane flex-1 px-3 py-3">
                {items.map((i) => {
                  const body = (
                    <>
                      <span aria-hidden className={cn('mt-[7px] size-1.5 shrink-0 rounded-full', TONE_DOT[i.tone])} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] text-fg" dir="auto">{i.title}</span>
                        {i.detail && (
                          <span className={cn('mt-0.5 line-clamp-3 text-[12.5px] leading-snug', i.tone === 'bad' ? 'text-bad/90' : 'text-muted')} dir="auto" title={i.detail}>
                            {i.tone === 'bad' ? plainReason(i.detail) : i.detail}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 pt-px font-mono text-[10.5px] text-faint tabular-nums">{ago(i.ts)}</span>
                    </>
                  )
                  return (
                    <li key={i.id}>
                      {i.href ? (
                        <Link href={navHref(project, i.href)} onClick={onClose} className="focus-ring flex gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-white/[0.035]">
                          {body}
                        </Link>
                      ) : (
                        <div className="flex gap-3 px-3 py-2.5">{body}</div>
                      )}
                    </li>
                  )
                })}
              </ol>
            )}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
