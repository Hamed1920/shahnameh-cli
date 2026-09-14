'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AtSign, ImageOff, Search, TriangleAlert } from 'lucide-react'
import { Input, Textarea } from '@/components/ui/field'
import { EASE } from '@/components/ui/motion-tokens'
import { cn } from '@/lib/cn'
import { parseMentions } from '@/lib/mentions'

/** One reference the note may point at: an image attached to this job. */
export interface MentionOption {
  /** Inserted into the note, e.g. @LOC-007/V02 or @upload:u3. */
  token: string
  /** Position in the attachment order, as the model will receive it. */
  position: number
  title: string
  subtitle: string
  thumb: string | null
  /** Extra words the search should match (file name, kind, full id). */
  keywords: string
}

/**
 * A note box where "@" opens a searchable picker of the references attached to
 * this job -- exactly the list under "References for the regeneration". The
 * chosen token goes into the note; the worker maps it to that image's position
 * when it builds the prompt.
 */
export function MentionTextarea({
  value,
  onChange,
  options,
  sameRef,
  ...props
}: Omit<React.ComponentProps<'textarea'>, 'value' | 'onChange'> & {
  value: string
  onChange: (value: string) => void
  options: MentionOption[]
  /** True when a mention written in the note refers to this option. */
  sameRef: (mention: string, option: MentionOption) => boolean
}) {
  const area = useRef<HTMLTextAreaElement>(null)
  const search = useRef<HTMLInputElement>(null)
  // Where the "@" that opened the picker sits, or null when opened by button.
  const [open, setOpen] = useState<{ at: number | null; caret: number } | null>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  // Several review stages stay mounted at once; ids must not collide.
  const listId = useId()

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

  function openPicker(at: number | null, caret: number) {
    setQuery('')
    setActive(0)
    setOpen({ at, caret })
  }

  function close(refocus = true) {
    const caret = open?.caret ?? value.length
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
    const before = value.slice(0, start)
    const lead = open.at === null && before && !/\s$/.test(before) ? ' ' : ''
    const next = `${before}${lead}${o.token} ${value.slice(end)}`
    const caret = start + lead.length + o.token.length + 1
    onChange(next)
    setOpen(null)
    requestAnimationFrame(() => {
      area.current?.focus()
      area.current?.setSelectionRange(caret, caret)
    })
  }

  const mentioned = parseMentions(value).map((m) => ({
    token: m,
    option: options.find((o) => sameRef(m, o)),
  }))

  return (
    <div className="relative">
      <Textarea
        ref={area}
        value={value}
        onChange={(e) => {
          const el = e.target
          const caret = el.selectionStart ?? el.value.length
          onChange(el.value)
          // Open on a freshly typed "@" at a word boundary, not inside an email.
          const typed = el.value.length === value.length + 1 && el.value[caret - 1] === '@'
          const boundary = caret < 2 || /\s/.test(el.value[caret - 2])
          if (typed && boundary && options.length > 0) openPicker(caret - 1, caret)
        }}
        {...props}
      />

      <div className="mt-2 flex flex-wrap items-center gap-1.5" dir="ltr">
        <button
          type="button"
          disabled={options.length === 0}
          onClick={() => openPicker(null, area.current?.selectionStart ?? value.length)}
          className="focus-ring inline-flex h-6 cursor-pointer items-center gap-1 rounded-[5px] border border-edge-strong px-2 text-[11px] text-muted transition-colors duration-150 hover:border-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          <AtSign aria-hidden className="size-3" />
          Reference
        </button>
        {mentioned.map((m) =>
          m.option ? (
            <span
              key={m.token}
              className="inline-flex h-6 items-center rounded-[5px] bg-white/[0.08] px-2 text-[11px] text-fg"
            >
              <span className="font-mono">{m.token}</span>{' '}
              <span className="text-muted">
                #{m.option.position} {m.option.title}
              </span>
            </span>
          ) : (
            <span
              key={m.token}
              className="inline-flex h-6 items-center gap-1 rounded-[5px] bg-bad/10 px-2 text-[11px] text-bad"
            >
              <TriangleAlert aria-hidden className="size-3" />
              <span className="font-mono">{m.token}</span> is not in the references for this job
            </span>
          ),
        )}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            dir="ltr"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14, ease: EASE }}
            className="absolute top-full left-0 z-50 mt-1.5 w-full max-w-md overflow-hidden rounded-lg border border-edge-strong bg-raise shadow-[0_16px_40px_-12px_rgba(0,0,0,0.85)]"
          >
            <div className="relative border-b border-edge p-2">
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4.5 size-3.5 -translate-y-1/2 text-muted" />
              <Input
                ref={search}
                value={query}
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-label="Search the references for this job"
                placeholder="Search references: palace, LOC-007, flag…"
                className="h-9 py-1.5 pl-8"
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

            <ul id={listId} role="listbox" className="scroll-pane max-h-72 overflow-y-auto p-1.5">
              {shown.length === 0 ? (
                <li className="px-2 py-3 text-center text-xs text-muted">
                  No reference for this job matches. Add one under References first.
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
                        'flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors duration-100',
                        i === active ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]',
                      )}
                    >
                      <span className="w-5 shrink-0 text-center font-mono text-[11px] text-muted">#{o.position}</span>
                      {o.thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={o.thumb} alt="" className="checker size-10 shrink-0 rounded-md border border-edge object-cover" />
                      ) : (
                        <span className="checker grid size-10 shrink-0 place-items-center rounded-md border border-edge">
                          <ImageOff aria-hidden className="size-4 text-muted/60" />
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block font-mono text-[11px] text-fg">{o.token}</span>
                        <span className="block truncate text-xs text-muted">
                          {o.title} &middot; {o.subtitle}
                        </span>
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
