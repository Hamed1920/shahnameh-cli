'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy, Film, TriangleAlert, Undo2 } from 'lucide-react'
import { useHoldLiveRefresh } from '@/components/live-refresh'
import { useProject } from '@/components/project-context'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/card'
import { EASE } from '@/components/ui/motion-tokens'
import { ContextMenu, type MenuEntry } from '@/components/ui/context-menu'
import { MenuNote } from '@/components/item-menu'
import { StickyHeader } from '@/components/ui/text'
import { cn } from '@/lib/cn'
import { episodeLabel, episodesIn, shortEpisode, NO_EPISODE_LABEL } from '@/lib/episodes'
import type { CatalogEntity, ReviewItem } from '@/lib/types'
import { Kbd, ReviewStage, isTyping, type QueuedDecision } from './review-stage'

/** How long a decision can be taken back before it is actually recorded. */
const UNDO_MS = 6000

interface Held extends QueuedDecision {
  id: number
  timer: ReturnType<typeof setTimeout>
}

type Toast =
  | { id: number; kind: 'held'; heldId: number; text: string }
  | { id: number; kind: 'saved'; text: string }
  | { id: number; kind: 'error'; text: string; path: string }
  | { id: number; kind: 'arrived'; text: string; path: string }

let seq = 0

/**
 * The review page: one candidate at a time, a strip to move between them, and
 * a short Undo window on every decision.
 *
 * Undo is real rather than cosmetic: the decision is only sent once the window
 * closes, so nothing reaches the worker -- and no credits are spent -- until
 * then. Every stage stays mounted (hidden) so moving away and back, or undoing,
 * keeps what was typed and uploaded.
 */
export function ReviewWorkspace({ items, catalog, episodeTitles }: {
  items: ReviewItem[]
  catalog: CatalogEntity[]
  /** EP001 -> "Zahhak Entry", from the episode folders on disk. */
  episodeTitles: Record<string, string>
}) {
  const project = useProject()
  const [currentPath, setCurrentPath] = useState<string | null>(items[0]?.candidate.path ?? null)
  /** '' is every episode; 'none' is everything that is not footage. */
  const [episodeFilter, setEpisodeFilter] = useState('')
  const [held, setHeld] = useState<Held[]>([])
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [toasts, setToasts] = useState<Toast[]>([])
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; entries: MenuEntry[] } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const heldRef = useRef(held)
  heldRef.current = held

  const hidden = new Set([...held.map((h) => h.path), ...saving])
  /**
   * Reviewing one episode at a time. The filter is only which candidates are on
   * the strip -- a decision on any of them is the same decision either way, and
   * turning the filter off brings the rest straight back.
   */
  const inEpisode = useCallback(
    (i: ReviewItem) =>
      !episodeFilter
        ? true
        : episodeFilter === 'none'
          ? i.context.episode === null
          : i.context.episode === episodeFilter,
    [episodeFilter],
  )
  const waiting = items.filter((i) => !hidden.has(i.candidate.path))
  const queue = waiting.filter(inEpisode)
  const episodes = episodesIn([], waiting.map((i) => i.context.episode))
  const looseItems = waiting.some((i) => i.context.episode === null)
  const countIn = (episode: string) =>
    waiting.filter((i) => (episode === 'none' ? i.context.episode === null : i.context.episode === episode)).length
  const current = queue.find((i) => i.candidate.path === currentPath) ?? queue[0] ?? null
  const index = current ? queue.indexOf(current) : -1
  const shownRef = useRef<string | null>(null)
  shownRef.current = current?.candidate.path ?? null

  const toast = useCallback((t: Toast, ms?: number) => {
    setToasts((all) => [...all, t])
    if (ms) setTimeout(() => setToasts((all) => all.filter((x) => x.id !== t.id)), ms)
  }, [])
  const dropToast = (id: number) => setToasts((all) => all.filter((x) => x.id !== id))

  /** The next candidate after `path` in page order that is still in the queue. */
  const nextAfter = useCallback(
    (path: string, skip: Set<string>) => {
      const order = items.filter(inEpisode).map((i) => i.candidate.path)
      const at = order.indexOf(path)
      const rest = [...order.slice(at + 1), ...order.slice(0, Math.max(at, 0))]
      return rest.find((p) => !skip.has(p)) ?? null
    },
    [items, inEpisode],
  )

  const commit = useCallback(
    async (h: Held) => {
      setHeld((all) => all.filter((x) => x.id !== h.id))
      setToasts((all) => all.filter((t) => !(t.kind === 'held' && t.heldId === h.id)))
      setSaving((s) => new Set(s).add(h.path))
      const r = await h.commit().catch((e: Error) => ({ ok: false, error: e.message }))
      if (r.ok) {
        toast({ id: ++seq, kind: 'saved', text: `${h.title} ${h.verdict === 'accepted' ? 'accepted' : 'denied'}` }, 2500)
        // The server refresh removes it from `items`; until then it stays hidden.
      } else {
        setSaving((s) => { const n = new Set(s); n.delete(h.path); return n })
        toast({ id: ++seq, kind: 'error', text: `${h.title} was not saved: ${r.error ?? 'unknown error'}`, path: h.path })
      }
    },
    [toast],
  )

  const onQueue = useCallback(
    (d: QueuedDecision) => {
      const id = ++seq
      const h: Held = { ...d, id, timer: setTimeout(() => commit(h), UNDO_MS) }
      setHeld((all) => [...all, h])
      const verb = d.verdict === 'accepted' ? 'Accepted' : d.regenerates ? 'Denied, regenerating' : 'Denied'
      toast({ id: ++seq, kind: 'held', heldId: id, text: `${verb} ${d.title}` })
      setCurrentPath(nextAfter(d.path, new Set([...hidden, d.path])))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit, toast, nextAfter, held, saving],
  )

  function undo(heldId: number) {
    const h = heldRef.current.find((x) => x.id === heldId)
    if (!h) return
    clearTimeout(h.timer)
    setHeld((all) => all.filter((x) => x.id !== heldId))
    setToasts((all) => all.filter((t) => !(t.kind === 'held' && t.heldId === heldId)))
    setCurrentPath(h.path)
  }

  // Once the server stops listing a saved candidate, forget it.
  useEffect(() => {
    const listed = new Set(items.map((i) => i.candidate.path))
    setSaving((s) => {
      const n = new Set([...s].filter((p) => listed.has(p)))
      return n.size === s.size ? s : n
    })
  }, [items])

  // Leaving the page records anything still waiting out its Undo window.
  //  - Another page of the panel: this unmounts, and each is committed as usual.
  //  - Closing the tab, reloading, typing another address: nothing unmounts, so
  //    each is sent with a beacon as the page goes (api/decide). A decision with
  //    uploaded files may be too big for a beacon (about 64 KB), so for those the
  //    browser still asks before leaving.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (heldRef.current.some((h) => h.hasUploads)) { e.preventDefault(); e.returnValue = '' }
    }
    const flush = () => {
      for (const h of heldRef.current) {
        if (navigator.sendBeacon(`/${project.slug}/api/decide`, h.form)) clearTimeout(h.timer)
      }
    }
    window.addEventListener('beforeunload', warn)
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('beforeunload', warn)
      window.removeEventListener('pagehide', flush)
      heldRef.current.forEach((h) => { clearTimeout(h.timer); void h.commit() })
    }
  }, [project.slug])

  // New videos arrive through <LiveRefresh> in the layout. It waits while a
  // decision is still in its Undo window.
  useHoldLiveRefresh(held.length > 0)

  // A new video lands in the strip; say so unless it is already on screen.
  const seenRef = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!seenRef.current) {
      seenRef.current = new Set(items.map((i) => i.candidate.path))
      return
    }
    const seen = seenRef.current
    const fresh = items.filter((i) => !seen.has(i.candidate.path))
    fresh.forEach((i) => seen.add(i.candidate.path))
    const unseen = fresh.filter((i) => !i.candidate.failedDecision && i.candidate.path !== shownRef.current)
    if (unseen.length === 0) return
    const first = unseen[0]
    const s = first.candidate.sidecar
    const name = first.context.label ?? first.context.scene ?? s.target
    const text =
      unseen.length > 1
        ? `${unseen.length} new videos to review`
        : `New: ${name}${s.attempt > 1 ? ` · attempt ${s.attempt}` : ''}${s.stage === 'final' ? ' · final' : ''}`
    toast({ id: ++seq, kind: 'arrived', text, path: first.candidate.path }, 10000)
  }, [items, toast])

  // J / K move through the queue.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
      if (document.querySelector('[role=dialog]') || !current) return
      const step = e.key === 'j' || e.key === 'J' ? 1 : e.key === 'k' || e.key === 'K' ? -1 : 0
      if (!step || queue.length < 2) return
      e.preventDefault()
      setCurrentPath(queue[(index + step + queue.length) % queue.length].candidate.path)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, queue, index])

  /** The episode chips as a menu, plus what this one candidate is. */
  const menuFor = (i: ReviewItem): MenuEntry[] => [
    { heading: `${i.context.label ?? i.context.scene ?? i.candidate.sidecar.target} · ${i.candidate.sidecar.target}` },
    {
      caption: 'Review only',
      chips: [
        { label: 'All', active: !episodeFilter, onSelect: () => setEpisodeFilter('') },
        ...episodes.map((e) => ({ label: shortEpisode(e), active: episodeFilter === e, onSelect: () => setEpisodeFilter(e) })),
        ...(looseItems ? [{ label: 'No episode', active: episodeFilter === 'none', onSelect: () => setEpisodeFilter('none') }] : []),
      ],
    },
    { divider: true },
    { label: 'Open it', icon: <Film className="size-3.5" />, onSelect: () => setCurrentPath(i.candidate.path) },
    {
      label: 'Copy the shot id',
      icon: <Copy className="size-3.5" />,
      onSelect: () => {
        const id = i.candidate.sidecar.target
        navigator.clipboard.writeText(id).then(() => {
          setCopied(`Copied ${id}`)
          setTimeout(() => setCopied(null), 2200)
        }, () => setCopied('Could not copy that.'))
      },
    },
  ]

  return (
    <div>
      {/* ------------------------------------------------ queue strip */}
      <StickyHeader>
        <div className="flex items-end gap-5">
          <h1 className="font-display text-[40px] leading-[0.9] text-fg">Review</h1>
          <span className="pb-0.5 font-mono text-xs text-muted tabular-nums">
            {queue.length === 0 ? 'nothing waiting' : (
              <>
                <span className="text-fg">{String(index + 1).padStart(2, '0')}</span>
                <span className="text-faint"> / {String(queue.length).padStart(2, '0')}</span>
              </>
            )}
          </span>
          {queue.length > 1 && (
            <span className="ml-auto hidden items-center gap-1.5 pb-0.5 text-xs text-faint sm:flex">
              <Kbd>J</Kbd> <Kbd>K</Kbd> <span className="ml-1">to move</span>
            </span>
          )}
        </div>
        {(episodes.length > 1 || (episodes.length === 1 && looseItems)) && (
          <div className="mt-5 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11.5px] text-faint">Episode</span>
            {[{ id: '', label: 'All' }, ...episodes.map((e) => ({ id: e, label: episodeLabel(e, episodeTitles) })),
              ...(looseItems ? [{ id: 'none', label: NO_EPISODE_LABEL }] : [])].map((e) => {
              const on = episodeFilter === e.id
              return (
                <button
                  key={e.id || 'all'}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setEpisodeFilter(e.id)}
                  className={cn(
                    'focus-ring h-6 cursor-pointer rounded-full border px-2.5 text-[11.5px] transition',
                    on ? 'border-accent bg-accent/8 text-fg' : 'border-edge text-muted hover:border-edge-strong',
                  )}
                >
                  {e.label}
                  <span className="ml-1.5 font-mono text-faint tabular-nums">{e.id ? countIn(e.id) : waiting.length}</span>
                </button>
              )
            })}
          </div>
        )}

        {queue.length > 0 && (
          <div className="scroll-pane-x mt-6 flex gap-1.5 overflow-x-auto pb-1">
            {queue.map((i) => {
              const on = i === current
              const c = i.context
              return (
                <button
                  key={i.candidate.path}
                  type="button"
                  onClick={() => setCurrentPath(i.candidate.path)}
                  onContextMenu={(ev) => { ev.preventDefault(); ev.stopPropagation(); setMenu({ at: { x: ev.clientX, y: ev.clientY }, entries: menuFor(i) }) }}
                  aria-current={on ? 'true' : undefined}
                  title={c.beats.join(' → ')}
                  className={cn(
                    'focus-ring flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-md border px-3 text-left transition-colors duration-150',
                    on ? 'border-fg bg-fg text-ink' : 'border-edge text-muted hover:border-edge-strong hover:text-fg',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'size-1.5 rounded-full',
                      i.candidate.failedDecision
                        ? 'bg-bad'
                        : i.candidate.sidecar.stage === 'final'
                          ? 'bg-good'
                          : on ? 'bg-ink/35' : 'bg-faint',
                    )}
                  />
                  <span className="font-mono text-xs font-medium">
                    {c.label ?? c.scene ?? i.candidate.sidecar.target.slice(-12)}
                  </span>
                  {i.candidate.sidecar.stage === 'final' && (
                    <span className={cn('text-[11px]', on ? 'text-ink/60' : 'text-good')}>final</span>
                  )}
                  {i.candidate.sidecar.attempt > 1 && (
                    <span className={cn('font-mono text-[11px]', on ? 'text-ink/50' : 'text-faint')}>×{i.candidate.sidecar.attempt}</span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </StickyHeader>

      {/* ------------------------------------------------ stages */}
      {queue.length === 0 && held.length === 0 && (
        <EmptyState className="py-28">
          {waiting.length > 0 ? (
            <>
              <p className="font-display text-4xl text-fg">Nothing waiting in this episode.</p>
              <p className="mx-auto mt-4 max-w-md">
                {waiting.length} video{waiting.length === 1 ? '' : 's'} elsewhere.{' '}
                <button type="button" onClick={() => setEpisodeFilter('')} className="focus-ring cursor-pointer underline">
                  Show every episode
                </button>
              </p>
            </>
          ) : (
            <>
              <p className="font-display text-4xl text-fg">All caught up.</p>
              <p className="mx-auto mt-4 max-w-md">
                New videos from the worker appear here on their own. Everything you decided is on the
                Decided page.
              </p>
            </>
          )}
        </EmptyState>
      )}

      {items.map((i) => (
        <ReviewStage
          key={i.candidate.path}
          item={i}
          catalog={catalog}
          active={i === current}
          onQueue={onQueue}
        />
      ))}

      <ContextMenu at={menu?.at ?? null} entries={menu?.entries ?? []} onClose={() => setMenu(null)} />
      {copied && <MenuNote text={copied} bad={copied.startsWith('Could not')} />}

      {/* ------------------------------------------------ toasts */}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-90 flex flex-col items-center gap-2 px-4">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.2, ease: EASE }}
              role="status"
              className={cn(
                'pointer-events-auto relative flex w-full max-w-md items-center gap-3 overflow-hidden rounded-lg border bg-raise py-2.5 pr-2.5 pl-4 text-[13px] shadow-[0_16px_40px_-12px_rgba(0,0,0,0.85)]',
                t.kind === 'error' ? 'border-bad/50' : 'border-edge-strong',
              )}
            >
              {t.kind === 'error' ? (
                <TriangleAlert aria-hidden className="size-4 shrink-0 text-bad" />
              ) : t.kind === 'saved' ? (
                <Check aria-hidden className="size-4 shrink-0 text-good" />
              ) : t.kind === 'arrived' ? (
                <Film aria-hidden className="size-4 shrink-0 text-fg" />
              ) : null}
              <span className="min-w-0 flex-1 text-fg" dir="auto">{t.text}</span>

              {t.kind === 'held' && (
                <>
                  <Button type="button" size="sm" tone="outline" onClick={() => undo(t.heldId)}>
                    <Undo2 aria-hidden className="size-3.5" /> Undo
                  </Button>
                  <motion.span
                    aria-hidden
                    initial={{ scaleX: 1 }}
                    animate={{ scaleX: 0 }}
                    transition={{ duration: UNDO_MS / 1000, ease: 'linear' }}
                    className="absolute inset-x-0 bottom-0 h-px origin-left bg-fg/70"
                  />
                </>
              )}
              {(t.kind === 'error' || t.kind === 'arrived') && (
                <>
                  <Button type="button" size="sm" tone="outline" onClick={() => { setCurrentPath(t.path); dropToast(t.id) }}>
                    Open
                  </Button>
                  <button type="button" aria-label="Dismiss" onClick={() => dropToast(t.id)} className="focus-ring grid size-7 cursor-pointer place-items-center rounded-md text-muted hover:bg-white/[0.05] hover:text-fg">
                    ×
                  </button>
                </>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}
