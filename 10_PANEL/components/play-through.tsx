'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowDownUp, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, GripVertical, Pause, Play, RotateCcw, Volume2, VolumeX, X,
} from 'lucide-react'
import { useAssetUrls, useProject } from '@/components/project-context'
import { Button } from '@/components/ui/button'
import { EASE } from '@/components/ui/motion-tokens'
import { Modal } from '@/components/ui/modal'
import { isVideo } from '@/lib/asset'
import { cn } from '@/lib/cn'
import { bestOption, chosenOption, moveInOrder, orderStops, type PlayStop } from '@/lib/play-through'

/** The volume the viewer last chose, kept for the next run. Storage can be blocked; the run works without it. */
const VOLUME_KEY = 'play-through-volume'
const readVolume = () => {
  try {
    const v = parseFloat(localStorage.getItem(VOLUME_KEY) ?? '')
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1
  } catch { return 1 }
}

/** 83.4 -> "1:23". */
const clock = (t: number) => {
  const s = Math.max(0, Math.floor(Number.isFinite(t) ? t : 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** How long a still stays up before the run moves on. */
const STILL_MS = 4000

/**
 * "Play through": every shot of the page, one after another.
 *
 * Each shot plays the best take it has -- a final over a draft, then the filed
 * one, then the later attempt (lib/play-through.ts) -- and the ticks under the
 * picture let the viewer pick another. A tick is only this run's choice: it
 * decides nothing, accepts nothing and never reaches the worker.
 *
 * One <video> element is reused for the whole run. The click that opened it is
 * the gesture the browser wants before it lets a video play with sound, and a
 * fresh element per shot would have to be let in again every time.
 */
export function PlayThroughButton({
  stops, scope, label = 'Play through', size = 'sm', className,
}: {
  /** In their natural order: the order the author numbered them in. */
  stops: PlayStop[]
  /** Names this page's arrangement, so Review and each episode keep their own. */
  scope: string
  label?: string
  size?: 'sm' | 'md'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [arranging, setArranging] = useState(false)
  const [order, setOrder] = usePlayOrder(scope)
  const ordered = useMemo(() => orderStops(stops, order), [stops, order])
  return (
    <>
      <Button
        type="button"
        size={size}
        tone="outline"
        className={className}
        disabled={ordered.length === 0}
        title={ordered.length === 0 ? 'Nothing here has footage to play yet.' : `Play ${ordered.length} shot${ordered.length === 1 ? '' : 's'} one after another`}
        onClick={() => setOpen(true)}
      >
        <Play aria-hidden className="size-3.5" /> {label}
      </Button>
      <Button
        type="button"
        size={size}
        tone="ghost"
        className={className}
        disabled={ordered.length < 2}
        title="Drag the shots into the order you want them played"
        onClick={() => setArranging(true)}
      >
        <ArrowDownUp aria-hidden className="size-3.5" /> Reorder
        {order.length > 0 && <span className="size-1.5 rounded-full bg-accent" role="img" aria-label="custom order" />}
      </Button>
      <Player stops={ordered} open={open} onClose={() => setOpen(false)} />
      <ReorderDialog open={arranging} stops={ordered} custom={order.length > 0} onOrder={setOrder} onClose={() => setArranging(false)} />
    </>
  )
}

// ---------------------------------------------------------------- order

const ORDER_EVENT = 'play-order-change'

/**
 * A page's own arrangement of its shots, kept in this browser.
 *
 * Which order to watch things in is the viewer's choice, not a fact about the
 * film, so nothing here reaches the worker or the registries. An empty list means
 * "as numbered". Every user of the same scope hears a change, so Review's strip
 * and its Play through button never disagree.
 */
export function usePlayOrder(scope: string): [string[], (order: string[]) => void] {
  const { slug } = useProject()
  const key = `play-order:${slug}:${scope}`
  const [order, setOrderState] = useState<string[]>([])

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? '[]')
      setOrderState(Array.isArray(saved) ? saved.filter((x) => typeof x === 'string') : [])
    } catch { setOrderState([]) }
    const heard = (e: Event) => {
      const d = (e as CustomEvent<{ key: string; order: string[] }>).detail
      if (d.key === key) setOrderState(d.order)
    }
    window.addEventListener(ORDER_EVENT, heard)
    return () => window.removeEventListener(ORDER_EVENT, heard)
  }, [key])

  const setOrder = useCallback((next: string[]) => {
    try { localStorage.setItem(key, JSON.stringify(next)) } catch {}
    window.dispatchEvent(new CustomEvent(ORDER_EVENT, { detail: { key, order: next } }))
  }, [key])

  return [order, setOrder]
}

/** Drag the shots into the order to play them; the arrows do the same without a mouse. */
function ReorderDialog({
  open, stops, custom, onOrder, onClose,
}: {
  open: boolean
  stops: PlayStop[]
  custom: boolean
  onOrder: (order: string[]) => void
  onClose: () => void
}) {
  const [from, setFrom] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const ids = stops.map((s) => s.id)
  const move = (a: number, b: number) => onOrder(moveInOrder(ids, a, b))
  const end = () => { setFrom(null); setOver(null) }

  return (
    <Modal
      open={open}
      size="lg"
      title="Play order"
      onClose={onClose}
      footer={
        <>
          <Button type="button" tone="ghost" disabled={!custom} onClick={() => onOrder([])}>
            <RotateCcw aria-hidden className="size-3.5" /> Back to numbered order
          </Button>
          <Button type="button" tone="accent" onClick={onClose}>Done</Button>
        </>
      }
    >
      <p className="mb-4 text-[13px] leading-relaxed text-muted">
        Drag a shot to where it should play, or use the arrows. This is only the order you watch them in —
        nothing is accepted or changed — and it is kept in this browser.
      </p>
      <ol className="space-y-1.5">
        {stops.map((s, i) => (
          <li
            key={s.id}
            draggable
            onDragStart={(e) => { setFrom(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.id) }}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== i) setOver(i) }}
            onDrop={(e) => { e.preventDefault(); if (from !== null) move(from, i); end() }}
            onDragEnd={end}
            className={cn(
              'flex items-center gap-3 rounded-md border bg-panel px-2.5 py-2 transition',
              from === i ? 'opacity-40' : 'opacity-100',
              over === i && from !== null && from !== i
                ? from > i ? 'border-accent border-t-2' : 'border-accent border-b-2'
                : 'border-edge',
            )}
          >
            <GripVertical aria-hidden className="size-4 shrink-0 cursor-grab text-faint" />
            <span className="w-6 shrink-0 text-right font-mono text-[11px] text-faint tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[13px] text-fg">{s.title}</span>
              {s.subtitle && <span className="block truncate text-[11.5px] text-muted">{s.subtitle}</span>}
            </span>
            <button
              type="button"
              aria-label={`Move ${s.title} up`}
              disabled={i === 0}
              onClick={() => move(i, i - 1)}
              className="focus-ring grid size-7 cursor-pointer place-items-center rounded-md text-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronUp aria-hidden className="size-4" />
            </button>
            <button
              type="button"
              aria-label={`Move ${s.title} down`}
              disabled={i === stops.length - 1}
              onClick={() => move(i, i + 1)}
              className="focus-ring grid size-7 cursor-pointer place-items-center rounded-md text-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronDown aria-hidden className="size-4" />
            </button>
          </li>
        ))}
      </ol>
    </Modal>
  )
}

function Player({ stops, open, onClose }: { stops: PlayStop[]; open: boolean; onClose: () => void }) {
  const { assetUrl } = useAssetUrls()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const [at, setAt] = useState(0)
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [paused, setPaused] = useState(false)
  // Sound is the viewer's to set, and it holds from shot to shot: the one <video>
  // element is reused, but its volume is re-applied below whenever it changes.
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  useEffect(() => setVolume(readVolume()), [])
  const setLevel = useCallback((v: number) => {
    const level = Math.min(1, Math.max(0, v))
    setVolume(level)
    setMuted(level === 0)
    try { localStorage.setItem(VOLUME_KEY, String(level)) } catch {}
  }, [])
  const [finished, setFinished] = useState(false)
  // Where the playing video is, for the timeline. Read off the element, never kept as the truth.
  const [time, setTime] = useState(0)
  const [dur, setDur] = useState(0)
  const video = useRef<HTMLVideoElement>(null)
  const shell = useRef<HTMLDivElement>(null)
  // The picture fills the screen; the controls sit over it and step aside when the mouse is still.
  const [awake, setAwake] = useState(true)
  const sleep = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wake = useCallback(() => {
    setAwake(true)
    if (sleep.current) clearTimeout(sleep.current)
    sleep.current = setTimeout(() => setAwake(false), 2500)
  }, [])
  useEffect(() => {
    if (open) wake()
    return () => { if (sleep.current) clearTimeout(sleep.current) }
  }, [open, wake])
  const hasStops = stops.length > 0
  // A new closure every render; the full-screen effect below must not restart for it.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // Full screen by default. The run opens from a click, which is the gesture
  // the browser wants for this; if it still says no, the overlay already fills
  // the window, so nothing is lost. Leaving full screen (Esc) ends the run.
  useEffect(() => {
    const el = shell.current
    if (!open || !el || !hasStops) return
    let entered = false
    const onChange = () => {
      if (document.fullscreenElement === el) entered = true
      else if (entered) closeRef.current()
    }
    document.addEventListener('fullscreenchange', onChange)
    el.requestFullscreen?.().catch(() => {})
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      if (document.fullscreenElement === el) void document.exitFullscreen().catch(() => {})
    }
  }, [open, hasStops])

  // The stops can change under an open run (live refresh); keep the position on the same shot.
  const stop = stops[Math.min(at, stops.length - 1)] ?? null
  const take = stop ? chosenOption(stop, picks) : null
  const best = stop ? bestOption(stop.options) : null
  const next = stops[at + 1]
  const nextTake = next ? chosenOption(next, picks) : null
  const playing = take && isVideo(take.file)

  // Unmuting from a volume of zero would stay silent, so it comes up to half instead.
  const toggleMute = useCallback(() => {
    if (muted || volume === 0) setLevel(volume || 0.5)
    else setMuted(true)
  }, [muted, volume, setLevel])

  // Every run starts from the top, with no leftover ticks.
  useEffect(() => {
    if (!open) return
    setAt(0); setPicks({}); setPaused(false); setFinished(false)
  }, [open])

  const go = useCallback((to: number) => {
    setAt(Math.max(0, Math.min(stops.length - 1, to)))
    setPaused(false)
    setFinished(false)
  }, [stops.length])

  /** The take ended: the next shot, or the end of the run. */
  const advance = useCallback(() => {
    if (at + 1 < stops.length) go(at + 1)
    else setFinished(true)
  }, [at, stops.length, go])

  // Start the take the moment it is chosen. A browser that refuses sound is
  // asked again muted, so the run still moves instead of sitting on a frame.
  const src = take ? assetUrl(take.file) : null
  useEffect(() => {
    const el = video.current
    if (!open || !el || !playing || finished) return
    el.currentTime = 0
    el.volume = volume
    el.muted = muted
    // A browser that will not start a video with sound is asked again muted, and the
    // speaker button then shows it as muted -- one click on it (a gesture) turns sound on.
    el.play().catch(() => { setMuted(true); el.muted = true; el.play().catch(() => setPaused(true)) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, src, playing, finished])

  useEffect(() => {
    const el = video.current
    if (!el) return
    el.volume = volume
    el.muted = muted
  }, [volume, muted, src])

  useEffect(() => {
    const el = video.current
    if (!el) return
    if (paused) el.pause()
    else if (open && playing && !finished && el.paused) el.play().catch(() => {})
  }, [paused, open, playing, finished])

  // A still has no end of its own.
  useEffect(() => {
    if (!open || !take || playing || paused || finished) return
    const t = setTimeout(advance, STILL_MS)
    return () => clearTimeout(t)
  }, [open, take, playing, paused, finished, advance])

  /** Jump within the playing video (also what the timeline does). */
  const seekTo = useCallback((t: number) => {
    const el = video.current
    if (!el || !Number.isFinite(el.duration)) return
    el.currentTime = Math.min(el.duration, Math.max(0, t))
    setTime(el.currentTime)
    setFinished(false)
  }, [])
  const seekBy = useCallback((d: number) => { if (video.current) seekTo(video.current.currentTime + d) }, [seekTo])

  /** A click or drag along the playing shot's segment: that fraction of the video. */
  const scrubTo = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const el = video.current
    if (!el || !Number.isFinite(el.duration)) return
    const box = e.currentTarget.getBoundingClientRect()
    seekTo(el.duration * Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)))
  }, [seekTo])

  // Capture phase and stopped: Review's own A / D / X / J / K must not fire underneath.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key
      if (k === 'Escape') onClose()
      else if (k === 'ArrowRight' && e.shiftKey) seekBy(5)
      else if (k === 'ArrowLeft' && e.shiftKey) seekBy(-5)
      else if (k === 'ArrowRight') go(at + 1)
      else if (k === 'ArrowLeft') go(at - 1)
      else if (k === ' ') setPaused((p) => !p)
      else if (k === 'm' || k === 'M') toggleMute()
      else if (k === 'ArrowUp') setLevel((muted ? 0 : volume) + 0.1)
      else if (k === 'ArrowDown') setLevel((muted ? 0 : volume) - 0.1)
      else return
      wake()
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, at, go, onClose, wake, muted, volume, setLevel, toggleMute, seekBy])

  const chromeOff = !awake && !paused && !finished
  const rail = useMemo(() => stops.map((s) => s.id), [stops])

  if (!mounted) return null

  const ctl =
    'focus-ring grid size-9 cursor-pointer place-items-center rounded-md border border-edge-strong bg-panel text-muted transition-colors hover:border-[#505050] hover:text-fg disabled:cursor-not-allowed disabled:opacity-35'

  return createPortal(
    <AnimatePresence>
      {open && stop && take && (
        <motion.div
          key="play-through"
          ref={shell}
          role="dialog"
          aria-modal="true"
          aria-label="Play through"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: EASE }}
          onMouseMove={wake}
          onClick={wake}
          className={cn('fixed inset-0 z-100 overflow-hidden bg-black', !awake && !paused && !finished && 'cursor-none')}
        >
          {/* The picture: the whole screen. */}
          <div className="absolute inset-0">
            <video
              ref={video}
              src={playing ? src! : undefined}
              onEnded={advance}
              onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => { setDur(e.currentTarget.duration || 0); setTime(0) }}
              onDurationChange={(e) => setDur(e.currentTarget.duration || 0)}
              onClick={() => setPaused((p) => !p)}
              playsInline
              preload="auto"
              className={cn('size-full cursor-pointer object-contain', !playing && 'hidden')}
            />
            {!playing && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={assetUrl(take.file)} alt={stop.title} className="size-full object-contain" />
            )}
            {finished && (
              <div className="absolute inset-0 grid place-items-center bg-black/70">
                <div className="grid justify-items-center gap-4 text-center">
                  <p className="font-display text-4xl text-fg">That was all {stops.length}.</p>
                  <div className="flex gap-2">
                    <Button type="button" tone="accent" onClick={() => go(0)}>
                      <RotateCcw aria-hidden className="size-3.5" /> Play again
                    </Button>
                    <Button type="button" tone="outline" onClick={onClose}>Close</Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className={cn('absolute inset-x-0 top-0 flex items-center gap-4 bg-gradient-to-b from-black/80 to-transparent px-5 pt-4 pb-10 transition-opacity duration-300', chromeOff && 'pointer-events-none opacity-0')}>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-sm font-medium text-fg">{stop.title}</p>
              {stop.subtitle && <p className="truncate text-[12.5px] text-muted">{stop.subtitle}</p>}
            </div>
            <span className="font-mono text-xs text-muted tabular-nums">
              <span className="text-fg">{String(at + 1).padStart(2, '0')}</span> / {String(stops.length).padStart(2, '0')}
            </span>
            <button type="button" onClick={onClose} aria-label="Close" autoFocus className={ctl}>
              <X aria-hidden className="size-4" />
            </button>
          </div>

          {/* Bottom controls, over the picture. */}
          <div className={cn('absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent pt-12 transition-opacity duration-300', chromeOff && 'pointer-events-none opacity-0')}>
          {/* The ticks: which take of this shot the run plays. */}
          <div className="flex flex-wrap items-center gap-2 px-5">
            <span className="mr-1 text-[11.5px] text-faint">{stop.options.length > 1 ? 'Play' : 'Only take'}</span>
            {stop.options.map((o) => {
              const on = o.id === take.id
              return (
                <button
                  key={o.id}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => { setPicks((p) => ({ ...p, [stop.id]: o.id })); setPaused(false); setFinished(false) }}
                  className={cn(
                    'focus-ring flex h-8 cursor-pointer items-center gap-2 rounded-md border px-2.5 text-left text-[12px] transition',
                    on ? 'border-accent bg-accent/[0.07] text-fg' : 'border-edge text-muted hover:border-edge-strong hover:text-fg',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors',
                      on ? 'border-accent bg-accent text-ink' : 'border-edge-strong text-transparent',
                    )}
                  >
                    <Check strokeWidth={3.5} className="size-2.5" />
                  </span>
                  <span className="font-mono">{o.label}</span>
                  {o.id === best?.id && stop.options.length > 1 && <span className="text-[10.5px] text-good">best</span>}
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-2 px-5 py-4">
            <button type="button" onClick={() => go(at - 1)} disabled={at === 0} aria-label="Previous shot" className={ctl}>
              <ChevronLeft aria-hidden className="size-4" />
            </button>
            <button type="button" onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Play' : 'Pause'} className={ctl}>
              {paused ? <Play aria-hidden className="size-4" /> : <Pause aria-hidden className="size-4" />}
            </button>
            <button type="button" onClick={() => go(at + 1)} disabled={at + 1 >= stops.length} aria-label="Next shot" className={ctl}>
              <ChevronRight aria-hidden className="size-4" />
            </button>
            {playing && dur > 0 && (
              <span className="ml-1 hidden w-24 shrink-0 text-right font-mono text-[11px] text-muted tabular-nums sm:block">
                {clock(time)} / {clock(dur)}
              </span>
            )}
            {/* One segment per shot. The one playing fills as its video plays and can be clicked or dragged to
                go back or ahead inside that video; any other segment jumps to that shot. */}
            <div className="flex min-w-0 flex-1 items-center gap-1" role="group" aria-label="Shots">
              {rail.map((id, i) => {
                const here = i === at
                const fill = i < at ? 100 : here && playing && dur > 0 ? Math.min(100, (time / dur) * 100) : 0
                return (
                  <button
                    key={id}
                    type="button"
                    aria-label={here && playing ? `Shot ${i + 1}, ${clock(time)} of ${clock(dur)}` : `Shot ${i + 1}`}
                    aria-current={here ? 'true' : undefined}
                    onClick={() => { if (!here) go(i) }}
                    onPointerDown={here && playing ? (e) => { e.currentTarget.setPointerCapture(e.pointerId); scrubTo(e) } : undefined}
                    onPointerMove={here && playing ? (e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) scrubTo(e) } : undefined}
                    className="focus-ring group/seg flex h-5 min-w-2 flex-1 cursor-pointer items-center"
                  >
                    <span
                      className={cn(
                        'relative block w-full overflow-hidden rounded-full bg-edge-strong transition-[height] duration-150',
                        here ? 'h-2' : 'h-1.5 group-hover/seg:h-2',
                      )}
                    >
                      <span
                        className={cn('absolute inset-y-0 left-0 rounded-full', here ? 'bg-fg' : 'bg-muted')}
                        style={{ width: `${fill}%` }}
                      />
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} className={ctl}>
                {muted || volume === 0 ? <VolumeX aria-hidden className="size-4" /> : <Volume2 aria-hidden className="size-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => setLevel(parseFloat(e.target.value))}
                aria-label="Volume"
                className="h-1.5 w-24 cursor-pointer accent-white"
              />
            </div>
            <span className="hidden font-mono text-[11px] text-faint lg:block">← → shots · ⇧← ⇧→ ±5s · space pause · M mute · ↑ ↓ volume</span>
          </div>
          </div>

          {/* Warm the next shot's take so the cut is not a stall. */}
          {nextTake && isVideo(nextTake.file) && (
            <video key={nextTake.file} src={assetUrl(nextTake.file)} preload="auto" muted className="hidden" aria-hidden />
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
