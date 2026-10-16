'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { AtSign, ImageOff, Search, TriangleAlert } from 'lucide-react'
import { Lightbox } from '@/components/lightbox'
import { Input, Textarea } from '@/components/ui/field'
import { EASE } from '@/components/ui/motion-tokens'
import { caretBox, type CaretBox } from '@/lib/caret'
import { cn } from '@/lib/cn'
import { parseMentions } from '@/lib/mentions'
import { displayOf, toDisplay, toToken } from '@/lib/mention-names'

/** One reference the note may point at: an image attached to this job. */
export interface MentionOption {
  /** What the worker reads, e.g. @LOC-007/V02 or @upload:u3. Never shown: the box shows `title`. */
  token: string
  /** Position in the attachment order, as the model will receive it. 0 when there is no order (a rule picks from the whole index). */
  position: number
  /** The name a person knows it by: Armayel, Slaughter Prep Room. */
  title: string
  /** What kind of thing and which look: "Character · look 2". */
  subtitle: string
  thumb: string | null
  /** The full-size picture, for the preview and the enlarged view. Falls back to `thumb`. */
  full?: string | null
  /** The original file, for the enlarged view only. Falls back to `full`. */
  original?: string | null
  /** Extra words the search should match (file name, kind, full id). */
  keywords: string
}

const pictureOf = (o: MentionOption) => o.full ?? o.thumb
const enlargedOf = (o: MentionOption) => o.original ?? pictureOf(o)

const POPUP_W = 288
const PREVIEW_W = 224
const EDGE = 12

/**
 * A note box where "@" opens a small popup, at the "@", of the references attached
 * to this job -- exactly the list under "References for the regeneration".
 *
 * What is written and shown in the box is names: `@Armayel (look 2)`. The id the
 * worker reads (`@CHR-007/V02`) is what `onChange` is given and `value` holds, so
 * nothing outside this box changes; it is swapped in both directions here
 * (lib/mention-names.ts). The worker maps the id to that image's position when it
 * builds the prompt.
 */
export function MentionTextarea({
  value,
  onChange,
  options,
  sameRef,
  missingLabel = 'is not in the references for this job',
  ...props
}: Omit<React.ComponentProps<'textarea'>, 'value' | 'onChange'> & {
  /** In ids: @CHR-007/V02. */
  value: string
  onChange: (value: string) => void
  options: MentionOption[]
  /** Said after a mention that matches no option. */
  missingLabel?: string
  /** True when a mention written in the note refers to this option. */
  sameRef: (mention: string, option: MentionOption) => boolean
}) {
  const area = useRef<HTMLTextAreaElement>(null)
  const search = useRef<HTMLInputElement>(null)
  // Where the "@" that opened the picker sits (in the box's own text), or null when opened by button; and the spot on screen to hang the popup from.
  const [open, setOpen] = useState<{ at: number | null; caret: number; anchor: CaretBox } | null>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  // Several review stages stay mounted at once; ids must not collide.
  const listId = useId()

  // The box shows names; everything outside it keeps ids.
  const text = toDisplay(value, options, sameRef)
  const emit = (display: string) => onChange(toToken(display, options))

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return options.filter((o) => {
      const hay = `${o.token} #${o.position} ${o.title} ${o.subtitle} ${o.keywords}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
  }, [options, query])

  useEffect(() => {
    if (open) requestAnimationFrame(() => search.current?.focus())
  }, [open])

  // A popup hung at a spot on the screen stays there; if the page moves under it, it goes.
  useEffect(() => {
    if (!open) return
    const away = () => setOpen(null)
    window.addEventListener('scroll', away, true)
    window.addEventListener('resize', away)
    return () => {
      window.removeEventListener('scroll', away, true)
      window.removeEventListener('resize', away)
    }
  }, [open])

  function openPicker(at: number | null, caret: number, anchor: CaretBox) {
    setQuery('')
    setActive(0)
    setOpen({ at, caret, anchor })
  }

  function close(refocus = true) {
    const caret = open?.caret ?? text.length
    setOpen(null)
    if (refocus) {
      requestAnimationFrame(() => {
        area.current?.focus()
        area.current?.setSelectionRange(caret, caret)
      })
    }
  }

  function pick(o: MentionOption) {
    if (!open) return
    // Replace the "@" that was typed, or insert at the caret for the button.
    const start = open.at ?? open.caret
    const end = open.at === null ? open.caret : open.at + 1
    const before = text.slice(0, start)
    const lead = open.at === null && before && !/\s$/.test(before) ? ' ' : ''
    const word = displayOf(o)
    const next = `${before}${lead}${word} ${text.slice(end)}`
    const caret = start + lead.length + word.length + 1
    emit(next)
    setOpen(null)
    requestAnimationFrame(() => {
      area.current?.focus()
      area.current?.setSelectionRange(caret, caret)
    })
  }

  const mentioned = parseMentions(value).map((m) => {
    const option = options.find((o) => sameRef(m, o))
    return { token: m, option, name: option ? displayOf(option, m) : null }
  })
  // Enlarging pages through every mentioned picture, in the order they are written.
  const [zoom, setZoom] = useState<number | null>(null)
  const pictured = mentioned.flatMap((m) => (m.option && pictureOf(m.option) ? [{ name: m.name!, option: m.option }] : []))
  const [looking, setLooking] = useState<{ name: string; option: MentionOption } | null>(null)

  // Where the popup goes: under the "@" (or the button), or above it when there is no room below.
  const place = (() => {
    if (!open || typeof window === 'undefined') return null
    const a = open.anchor
    const left = Math.max(EDGE, Math.min(a.left, window.innerWidth - POPUP_W - EDGE))
    const below = window.innerHeight - a.bottom
    const flip = below < 300 && a.top > below
    const previewRight = left + POPUP_W + PREVIEW_W + 8 <= window.innerWidth - EDGE
    return { left, flip, previewRight, top: a.bottom + 6, bottom: window.innerHeight - a.top + 6 }
  })()
  const current = shown[active]

  return (
    <div className="relative">
      <Textarea
        ref={area}
        value={text}
        onChange={(e) => {
          const el = e.target
          const caret = el.selectionStart ?? el.value.length
          emit(el.value)
          // Open on a freshly typed "@" at a word boundary, not inside an email.
          const typed = el.value.length === text.length + 1 && el.value[caret - 1] === '@'
          const boundary = caret < 2 || /\s/.test(el.value[caret - 2])
          if (typed && boundary && options.length > 0) openPicker(caret - 1, caret, caretBox(el, caret - 1))
        }}
        {...props}
      />

      <div className="mt-2 flex flex-wrap items-center gap-1.5" dir="ltr">
        <button
          type="button"
          disabled={options.length === 0}
          onClick={(e) => {
            const b = e.currentTarget.getBoundingClientRect()
            openPicker(null, area.current?.selectionStart ?? text.length, { left: b.left, top: b.top, bottom: b.bottom })
          }}
          className="focus-ring inline-flex h-6 cursor-pointer items-center gap-1 rounded-[5px] border border-edge-strong px-2 text-[11px] text-muted transition-colors duration-150 hover:border-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          <AtSign aria-hidden className="size-3" />
          Reference
        </button>
        {mentioned.map((m) =>
          m.option ? (
            // The picture is the point: a thumbnail on the chip, the same image large on hover,
            // and a click opens it full size. The name is what it is called everywhere.
            <span key={m.token} className="group relative">
              <button
                type="button"
                onClick={() => { const at = pictured.findIndex((p) => p.option === m.option && p.name === m.name); if (at >= 0) setZoom(at) }}
                disabled={!pictureOf(m.option)}
                title={pictureOf(m.option) ? 'Click to see it larger' : undefined}
                className="focus-ring inline-flex h-7 cursor-zoom-in items-center gap-1.5 rounded-[5px] bg-white/[0.08] py-0.5 pr-2 pl-0.5 text-[11.5px] text-fg transition-colors hover:bg-white/[0.14] disabled:cursor-default"
              >
                {pictureOf(m.option) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.option.thumb ?? pictureOf(m.option)!} alt="" className="checker size-6 rounded-[4px] border border-edge object-cover" />
                ) : (
                  <span className="checker grid size-6 place-items-center rounded-[4px] border border-edge">
                    <ImageOff aria-hidden className="size-3 text-muted/60" />
                  </span>
                )}
                <span>{m.name!.slice(1)}</span>
                {m.option.position > 0 && <span className="font-mono text-[10.5px] text-muted">#{m.option.position}</span>}
              </button>
              {pictureOf(m.option) && (
                <span className="pointer-events-none absolute bottom-full left-0 z-40 mb-2 hidden w-64 overflow-hidden rounded-lg border border-edge-strong bg-raise shadow-[0_16px_40px_-12px_rgba(0,0,0,0.85)] group-hover:block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pictureOf(m.option)!} alt={m.option.title} className="checker max-h-64 w-full object-contain" />
                  <span className="block truncate border-t border-edge px-2 py-1 text-[11px] text-muted">{m.name!.slice(1)} · {m.option.subtitle}</span>
                </span>
              )}
            </span>
          ) : (
            <span
              key={m.token}
              className="inline-flex h-6 items-center gap-1 rounded-[5px] bg-bad/10 px-2 text-[11px] text-bad"
            >
              <TriangleAlert aria-hidden className="size-3" />
              <span className="font-mono">{m.token}</span> {missingLabel}
            </span>
          ),
        )}
      </div>

      {/* The popup: small, at the "@", like a right-click menu. In the body so no dialog or clipped box can cut it off. */}
      {mounted &&
        createPortal(
          <AnimatePresence>
            {open && place && (
              <motion.div
                key="mention-popup"
                dir="ltr"
                initial={{ opacity: 0, y: place.flip ? 4 : -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12, ease: EASE }}
                style={{ position: 'fixed', left: place.left, width: POPUP_W, ...(place.flip ? { bottom: place.bottom } : { top: place.top }) }}
                className="z-[120] rounded-lg border border-edge-strong bg-raise shadow-[0_16px_40px_-12px_rgba(0,0,0,0.85)]"
              >
                <div className="relative border-b border-edge p-1.5">
                  <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-3 -translate-y-1/2 text-muted" />
                  <Input
                    ref={search}
                    value={query}
                    role="combobox"
                    aria-expanded="true"
                    aria-controls={listId}
                    aria-label="Search the references for this job"
                    placeholder="Search by name"
                    className="h-7 py-1 pl-7 text-[12.5px]"
                    onChange={(e) => { setQuery(e.target.value); setActive(0) }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, shown.length - 1)) }
                      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
                      else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) pick(shown[active]) }
                      else if (e.key === 'Escape') { e.preventDefault(); close() }
                    }}
                    onBlur={() => setTimeout(() => setOpen((o) => (o && document.activeElement !== search.current ? null : o)), 150)}
                  />
                </div>

                <ul id={listId} role="listbox" className="scroll-pane max-h-60 overflow-y-auto p-1">
                  {shown.length === 0 ? (
                    <li className="px-2 py-3 text-center text-xs text-muted">
                      Nothing attached matches. Add it under References first.
                    </li>
                  ) : (
                    shown.map((o, i) => (
                      <li key={o.token} role="option" aria-selected={i === active}>
                        <button
                          type="button"
                          // mousedown, not click: a click would blur the search box first.
                          onMouseDown={(e) => { e.preventDefault(); pick(o) }}
                          onMouseEnter={() => setActive(i)}
                          className={cn(
                            'flex w-full cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1 text-left transition-colors duration-100',
                            i === active ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]',
                          )}
                        >
                          {o.thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={o.thumb} alt="" className="checker size-8 shrink-0 rounded-[5px] border border-edge object-cover" />
                          ) : (
                            <span className="checker grid size-8 shrink-0 place-items-center rounded-[5px] border border-edge">
                              <ImageOff aria-hidden className="size-3.5 text-muted/60" />
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] text-fg">{displayOf(o).slice(1)}</span>
                            <span className="block truncate text-[11px] text-muted">{o.subtitle}</span>
                          </span>
                          {o.position > 0 && <span className="shrink-0 font-mono text-[10.5px] text-faint">#{o.position}</span>}
                        </button>
                      </li>
                    ))
                  )}
                </ul>

                {/* What the highlighted one looks like, beside the list: hover or arrow to it; click to enlarge. */}
                {current && pictureOf(current) && (
                  <button
                    type="button"
                    // mousedown, not click: a click would blur the search box and close the popup.
                    onMouseDown={(e) => { e.preventDefault(); setLooking({ name: displayOf(current), option: current }); setOpen(null) }}
                    title="Click to see it larger"
                    style={{ width: PREVIEW_W }}
                    className={cn(
                      'absolute top-0 hidden cursor-zoom-in overflow-hidden rounded-lg border border-edge-strong bg-raise shadow-[0_16px_40px_-12px_rgba(0,0,0,0.85)] sm:block',
                      place.previewRight ? 'left-full ml-2' : 'right-full mr-2',
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={pictureOf(current)!} alt={current.title} className="checker max-h-60 w-full object-contain" />
                    <span className="block truncate border-t border-edge px-2 py-1 text-left text-[11.5px] text-muted">{displayOf(current).slice(1)}</span>
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}

      <Lightbox
        items={
          looking
            ? [{ src: enlargedOf(looking.option)!, title: looking.name.slice(1), subtitle: looking.option.subtitle }]
            : pictured.map((p) => ({ src: enlargedOf(p.option)!, title: p.name.slice(1), subtitle: p.option.subtitle }))
        }
        index={looking ? 0 : zoom}
        onIndex={(i) => setZoom(i)}
        onClose={() => { setLooking(null); setZoom(null) }}
      />
    </div>
  )
}
