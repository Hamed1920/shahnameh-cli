'use client'

import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * The bar pinned to the top of a working page (Review, References).
 *
 * It bleeds to the full width of the page area whatever the screen
 * (`bleed-x`, app/globals.css), and cancels the content's top padding set in
 * app/[project]/layout.tsx -- keep the two in step.
 *
 * Its height changes as it wraps, so it publishes that height as --sticky-h
 * on the page's scroller: anything else that sticks below it (the References
 * categories, the Review verdict) uses it instead of guessing a fixed offset.
 */
export function StickyHeader({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    const main = el?.closest('main')
    if (!el || !main) return
    const set = () => main.style.setProperty('--sticky-h', `${el.offsetHeight}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => { ro.disconnect(); main.style.removeProperty('--sticky-h') }
  }, [])
  return (
    <div
      ref={ref}
      className={cn('bleed-x sticky top-0 z-30 -mt-8 mb-10 border-b border-edge bg-ink/95 pt-7 pb-4 lg:-mt-10', className)}
    >
      {children}
    </div>
  )
}
