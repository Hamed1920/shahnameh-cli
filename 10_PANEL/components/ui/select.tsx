'use client'

import {
  Children, Fragment, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type ReactElement, type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown } from 'lucide-react'
import { CONTROL } from '@/components/ui/control'
import { EASE } from '@/components/ui/motion-tokens'
import { cn } from '@/lib/cn'

/** Shaped like a native change event, so `e.target.value` call sites read the same. */
export interface SelectChange {
  target: { value: string }
  currentTarget: { value: string }
}

type Item =
  | { kind: 'option'; value: string; label: ReactNode; text: string; disabled: boolean }
  | { kind: 'group'; label: string }

const textOf = (node: ReactNode): string =>
  Children.toArray(node).map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : isValidElement(c) ? textOf((c.props as { children?: ReactNode }).children) : '')).join('')

/** Reads `<option>` and `<optgroup>` children (through fragments and arrays) into a flat list. */
function collect(children: ReactNode, out: Item[] = []): Item[] {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    const el = child as ReactElement<{ children?: ReactNode; value?: string | number; label?: string; disabled?: boolean }>
    if (el.type === Fragment) collect(el.props.children, out)
    else if (el.type === 'optgroup') { out.push({ kind: 'group', label: String(el.props.label ?? '') }); collect(el.props.children, out) }
    else if (el.type === 'option') {
      const text = textOf(el.props.children)
      out.push({ kind: 'option', value: String(el.props.value ?? text), label: el.props.children, text, disabled: !!el.props.disabled })
    }
  })
  return out
}

const MAX_LIST = 320

/**
 * The panel's dropdown. Takes the same `<option>` / `<optgroup>` children and
 * `value` / `onChange` as a native select, but draws its own list in the
 * panel's type and surfaces instead of the operating system's.
 *
 * Focus stays on the trigger (aria-activedescendant), so the keyboard works
 * like a native select: arrows, Home/End, Enter or Space, a typed letter,
 * Escape. The list is portalled and fixed, so a card or a dialog never clips
 * it; Escape is caught before a surrounding dialog sees it.
 */
export function Select({
  value,
  onChange,
  children,
  className,
  disabled,
  title,
  id,
  'aria-label': ariaLabel,
}: {
  value: string
  onChange?: (e: SelectChange) => void
  children: ReactNode
  className?: string
  disabled?: boolean
  title?: string
  id?: string
  'aria-label'?: string
}) {
  const items = useMemo(() => collect(children), [children])
  const options = items.filter((i): i is Extract<Item, { kind: 'option' }> => i.kind === 'option')
  const selected = options.find((o) => o.value === String(value))

  const listId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null)
  const typed = useRef({ buffer: '', at: 0 })
  // The list is portalled into <body>, which only exists after hydration.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const enabled = useCallback((i: number) => i >= 0 && i < options.length && !options[i].disabled, [options])
  const step = (from: number, dir: 1 | -1) => {
    for (let n = 1; n <= options.length; n++) {
      const i = (from + dir * n + options.length) % options.length
      if (enabled(i)) return i
    }
    return from
  }

  const place = useCallback(() => {
    const t = trigger.current?.getBoundingClientRect()
    if (!t) return
    const below = window.innerHeight - t.bottom - 12
    const above = t.top - 12
    const want = Math.min(MAX_LIST, (list.current?.scrollHeight ?? MAX_LIST) + 2)
    const up = below < want && above > below
    setPos({
      left: Math.min(t.left, window.innerWidth - Math.max(t.width, 180) - 8),
      width: t.width,
      ...(up ? { bottom: window.innerHeight - t.top + 4 } : { top: t.bottom + 4 }),
      maxHeight: Math.max(120, Math.min(MAX_LIST, up ? above : below)),
    })
  }, [])

  const show = () => {
    if (disabled) return
    const i = options.findIndex((o) => o.value === String(value))
    setActive(enabled(i) ? i : step(-1, 1))
    setOpen(true)
  }
  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }
  const pick = (i: number) => {
    if (!enabled(i)) return
    const v = options[i].value
    close()
    if (v !== String(value)) onChange?.({ target: { value: v }, currentTarget: { value: v } })
  }

  useLayoutEffect(() => { if (open) place() }, [open, place])

  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => {
      const t = e.target as Node
      if (!list.current?.contains(t) && !trigger.current?.contains(t)) close(false)
    }
    const key = (e: KeyboardEvent) => {
      // Before a dialog's own Escape handler: close the list, not the dialog.
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close() }
    }
    const follow = () => place()
    window.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('resize', follow)
    window.addEventListener('scroll', follow, true)
    return () => {
      window.removeEventListener('mousedown', down, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('resize', follow)
      window.removeEventListener('scroll', follow, true)
    }
  }, [open, place])

  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active, listId])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    const k = e.key
    if (!open) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') { e.preventDefault(); show() }
      return
    }
    if (k === 'ArrowDown') { e.preventDefault(); setActive((a) => step(a, 1)) }
    else if (k === 'ArrowUp') { e.preventDefault(); setActive((a) => step(a, -1)) }
    else if (k === 'Home') { e.preventDefault(); setActive(step(-1, 1)) }
    else if (k === 'End') { e.preventDefault(); setActive(step(options.length, -1)) }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); pick(active) }
    else if (k === 'Tab') close(false)
    else if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now()
      typed.current = { buffer: now - typed.current.at > 600 ? k.toLowerCase() : typed.current.buffer + k.toLowerCase(), at: now }
      const q = typed.current.buffer
      const start = q.length === 1 ? active + 1 : active
      for (let n = 0; n < options.length; n++) {
        const i = (start + n) % options.length
        if (enabled(i) && options[i].text.trim().toLowerCase().startsWith(q)) { setActive(i); break }
      }
    }
  }

  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKeyDown}
        className={cn(CONTROL, 'relative inline-grid h-9 cursor-pointer items-center pr-9 text-left', open && 'border-fg/45', className)}
      >
        {/* Every label stacked invisibly in one cell: a `w-auto` select is as wide as its widest option, like a native one. */}
        {options.map((o) => (
          <span key={`size-${o.value}`} aria-hidden className="invisible col-start-1 row-start-1 h-0 overflow-hidden whitespace-nowrap">{o.label}</span>
        ))}
        <span className={cn('col-start-1 row-start-1 min-w-0 truncate', !selected?.value && 'text-muted')}>
          {selected ? selected.label : String(value)}
        </span>
        <ChevronDown
          aria-hidden
          className={cn('pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-muted transition-transform duration-150', open && 'rotate-180')}
        />
      </button>

      {mounted && createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={list}
              id={listId}
              role="listbox"
              aria-label={ariaLabel}
              initial={{ opacity: 0, y: pos?.bottom !== undefined ? 3 : -3 }}
              animate={{ opacity: pos ? 1 : 0, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
              transition={{ duration: 0.12, ease: EASE }}
              style={{ left: pos?.left ?? 0, top: pos?.top, bottom: pos?.bottom, minWidth: pos?.width, maxHeight: pos?.maxHeight }}
              className="scroll-pane fixed z-120 max-w-[min(28rem,calc(100vw-16px))] overflow-y-auto rounded-lg border border-edge-strong bg-raise p-1 text-[13px] shadow-[0_16px_40px_-12px_rgba(0,0,0,0.85)]"
            >
              {(() => {
                let n = -1
                return items.map((item, k) => {
                  if (item.kind === 'group') {
                    return <div key={`g-${k}`} role="presentation" className="eyebrow px-2.5 pt-2.5 pb-1.5 text-faint first:pt-1.5">{item.label}</div>
                  }
                  const i = ++n
                  const on = item.value === String(value)
                  return (
                    <div
                      key={`o-${k}`}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={on}
                      aria-disabled={item.disabled || undefined}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => { if (enabled(i)) setActive(i) }}
                      onClick={() => pick(i)}
                      className={cn(
                        'flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2.5 whitespace-nowrap transition-colors duration-75',
                        i === active ? 'bg-white/[0.07] text-fg' : on ? 'text-fg' : 'text-fg/80',
                        item.disabled && 'cursor-not-allowed opacity-40',
                      )}
                    >
                      <span className={cn('min-w-0 truncate', !item.value && 'text-muted')}>{item.label}</span>
                      <Check aria-hidden className={cn('ml-auto size-3.5 shrink-0 pl-0', on ? 'text-fg' : 'invisible')} />
                    </div>
                  )
                })
              })()}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}
