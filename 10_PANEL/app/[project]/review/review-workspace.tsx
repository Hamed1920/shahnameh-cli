'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Film } from 'lucide-react'
import { useHoldLiveRefresh } from '@/components/live-refresh'
import { PlayThroughButton, usePlayOrder } from '@/components/play-through'
import type { RegenerateConfig } from '@/components/regenerate-button'
import { orderBy, reviewStops } from '@/lib/play-through'
import { useProject } from '@/components/project-context'
import { useToast } from '@/components/toast'
import { EmptyState } from '@/components/ui/card'
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

let seq = 0

/** The toast for a decision still inside its Undo window. */
const heldToast = (heldId: number) => `review-held-${heldId}`

/**
 * The review page: one candidate at a time, a strip to move between them, and
 * a short Undo window on every decision.
 *
 * Undo is real rather than cosmetic: the decision is only sent once the window
 * closes, so nothing reaches the worker -- and no credits are spent -- until
 * then. Every stage stays mounted (hidden) so moving away and back, or undoing,
 * keeps what was typed and uploaded.
 */
export function ReviewWorkspace({ items, catalog, episodeTitles, regenCfg, prices }: {
  items: ReviewItem[]
  catalog: CatalogEntity[]
  /** For the "Continue from here" panel on an earlier attempt. */
  regenCfg: RegenerateConfig
  prices: Record<string, number>
  /** EP001 -> "Zahhak Entry", from the episode folders on disk. */
  episodeTitles: Record<string, string>
}) {
  const project = useProject()
  const [currentPath, setCurrentPath] = useState<string | null>(items[0]?.candidate.path ?? null)
  /** '' is every episode; 'none' is everything that is not footage. */
  const [episodeFilter, setEpisodeFilter] = useState('')
  const [held, setHeld] = useState<Held[]>([])
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const toaster = useToast()
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; entries: MenuEntry[] } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  // The viewer's own arrangement (Reorder), shared with the Play through button; empty means as numbered.
  const [playOrder] = usePlayOrder('review')
  const sorted = useMemo(() => orderBy(items, playOrder, (i) => i.candidate.sidecar.target), [items, playOrder])
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
  const waiting = sorted.filter((i) => !hidden.has(i.candidate.path))
  const queue = waiting.filter(inEpisode)
  const episodes = episodesIn([], waiting.map((i) => i.context.episode))
  const looseItems = waiting.some((i) => i.context.episode === null)
  const countIn = (episode: string) =>
    waiting.filter((i) => (episode === 'none' ? i.context.episode === null : i.context.episode === episode)).length
  const current = queue.find((i) => i.candidate.path === currentPath) ?? queue[0] ?? null
  const index = current ? queue.indexOf(current) : -1
  const shownRef = useRef<string | null>(null)
  shownRef.current = current?.candidate.path ?? null

  // Play through: the strip as it stands (the episode filter applies), a stop per shot.
  const playStops = useMemo(
    () =>
      reviewStops(
        queue.map((i) => {
          const s = i.candidate.sidecar
          return {
            path: i.candidate.path,
            target: s.target,
            title: i.context.label ?? i.context.scene ?? s.target.slice(-12),
            subtitle: i.context.beats.join(' → ') || undefined,
            take: i.candidate.take,
            stage: s.stage,
            attempt: s.attempt,
            createdAt: s.createdAt,
          }
        }),
      ),
    // `queue` is rebuilt every render; its paths are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queue.map((i) => i.candidate.path).join('|')],
  )

  /** The next candidate after `path` in page order that is still in the queue. */
  const nextAfter = useCallback(
    (path: string, skip: Set<string>) => {
      const order = sorted.filter(inEpisode).map((i) => i.candidate.path)
      const at = order.indexOf(path)
      const rest = [...order.slice(at + 1), ...order.slice(0, Math.max(at, 0))]
      return rest.find((p) => !skip.has(p)) ?? null
    },
    [sorted, inEpisode],
  )

  const commit = useCallback(
    async (h: Held) => {
      setHeld((all) => all.filter((x) => x.id !== h.id))
      toaster.dismiss(heldToast(h.id))
      setSaving((s) => new Set(s).add(h.path))
      const r = await h.commit().catch((e: Error) => ({ ok: false, error: e.message }))
      if (r.ok) {
        toaster.show({ tone: 'good', title: `${h.title} ${h.verdict}`, detail: 'Sent to the worker.', duration: 2500 })
        // The server refresh removes it from `items`; until then it stays hidden.
      } else {
        setSaving((s) => { const n = new Set(s); n.delete(h.path); return n })
        toaster.show({
          tone: 'bad',
          title: `${h.title} was not saved`,
          detail: r.error ?? 'Something went wrong sending it. Try again.',
          action: { label: 'Open', onClick: () => setCurrentPath(h.path) },
        })
      }
    },
    [toaster],
  )

  const onQueue = useCallback(
    (d: QueuedDecision) => {
      const id = ++seq
      const h: Held = { ...d, id, timer: setTimeout(() => commit(h), UNDO_MS) }
      setHeld((all) => [...all, h])
      const verb = d.verdict === 'accepted' ? 'Accepted' : d.verdict === 'discarded' ? 'Discarded' : d.regenerates ? 'Denied, regenerating' : 'Denied'
      toaster.show({
        id: heldToast(id),
        title: `${verb} ${d.title}`,
        detail: 'Sent when the bar runs out.',
        action: { label: 'Undo', onClick: () => undo(id) },
        duration: null,
        countdown: UNDO_MS,
      })
      setCurrentPath(nextAfter(d.path, new Set([...hidden, d.path])))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit, toaster, nextAfter, held, saving],
  )

  function undo(heldId: number) {
    const h = heldRef.current.find((x) => x.id === heldId)
    if (!h) return
    clearTimeout(h.timer)
    setHeld((all) => all.filter((x) => x.id !== heldId))
    toaster.dismiss(heldToast(heldId))
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
        : `New: ${name}${first.context.attemptNumber > 1 ? ` · attempt ${first.context.attemptNumber}` : ''}${s.stage === 'final' ? ' · final' : ''}`
    toaster.show({ tone: 'new', title: text, action: { label: 'Open', onClick: () => setCurrentPath(first.candidate.path) }, duration: 10000 })
  }, [items, toaster])

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
          <div className="ml-auto flex items-center gap-4 pb-0.5">
            {queue.length > 1 && (
              <span className="hidden items-center gap-1.5 text-xs text-faint sm:flex">
                <Kbd>J</Kbd> <Kbd>K</Kbd> <span className="ml-1">to move</span>
              </span>
            )}
            <PlayThroughButton stops={playStops} scope="review" />
          </div>
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
      </StickyHeader>

      <div className={cn('grid gap-6 lg:gap-8', queue.length > 0 && 'lg:grid-cols-[176px_minmax(0,1fr)]')}>
        {/* ------------------------------------------------ plans, down the side */}
        {queue.length > 0 && (
          <nav
            aria-label="Plans waiting for review"
            className={cn(
              // Beside the stage on a wide screen, stuck under the header and scrolling on its own; a row above it on a narrow one.
              'scroll-pane-x -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1',
              'lg:sticky lg:top-[calc(var(--sticky-h,0px)+1.5rem)] lg:mx-0 lg:max-h-[calc(100vh-var(--sticky-h,0px)-3rem)]',
              'lg:flex-col lg:gap-1 lg:self-start lg:overflow-x-visible lg:overflow-y-auto lg:px-0 lg:pb-0 lg:pr-1',
            )}
          >
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
                  ref={on ? (el) => el?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) : undefined}
                  className={cn(
                    'focus-ring flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-md border px-3 text-left transition-colors duration-150 lg:w-full',
                    on ? 'border-fg bg-fg text-ink' : 'border-edge text-muted hover:border-edge-strong hover:text-fg',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      i.candidate.failedDecision
                        ? 'bg-bad'
                        : i.candidate.sidecar.stage === 'final'
                          ? 'bg-good'
                          : on ? 'bg-ink/35' : 'bg-faint',
                    )}
                  />
                  <span className="min-w-0 truncate font-mono text-xs font-medium">
                    {c.label ?? c.scene ?? i.candidate.sidecar.target.slice(-12)}
                  </span>
                  {i.candidate.sidecar.stage === 'final' && (
                    <span className={cn('text-[11px] lg:ml-auto', on ? 'text-ink/60' : 'text-good')}>final</span>
                  )}
                  {i.context.attemptNumber > 1 && (
                    <span className={cn('font-mono text-[11px]', i.candidate.sidecar.stage === 'final' ? '' : 'lg:ml-auto', on ? 'text-ink/50' : 'text-faint')}>×{i.context.attemptNumber}</span>
                  )}
                </button>
              )
            })}
          </nav>
        )}

        <div className={cn('min-w-0', queue.length > 0 && 'lg:col-start-2 lg:row-start-1')}>
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
          regenCfg={regenCfg}
          prices={prices}
          active={i === current}
          near={index >= 0 && queue.includes(i) && Math.abs(queue.indexOf(i) - index) === 1}
          onQueue={onQueue}
        />
      ))}
        </div>
      </div>

      <ContextMenu at={menu?.at ?? null} entries={menu?.entries ?? []} onClose={() => setMenu(null)} />
      {copied && <MenuNote text={copied} bad={copied.startsWith('Could not')} />}
    </div>
  )
}
