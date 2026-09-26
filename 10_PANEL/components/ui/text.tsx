import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Page title in the display serif, an optional mono meta line, and an optional description. */
export function PageHeader({
  title,
  eyebrow,
  meta,
  children,
}: {
  title: ReactNode
  /** Small mono line above the title. */
  eyebrow?: ReactNode
  meta?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="border-b border-edge pb-9">
      {eyebrow && <div className="eyebrow mb-4 text-faint">{eyebrow}</div>}
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <h1 className="font-display text-[56px] leading-[0.95] tracking-[-0.01em] text-fg">{title}</h1>
        {meta && <span className="pb-1.5 font-mono text-xs text-muted tabular-nums">{meta}</span>}
      </div>
      {children && (
        <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-muted">{children}</p>
      )}
    </header>
  )
}

export { StickyHeader } from './sticky-header'

const DOT_TONES = {
  accent: 'bg-fg',
  good: 'bg-good',
  bad: 'bg-bad',
  muted: 'bg-faint',
} as const

/** Mono section label, its count, and a rule running out to the right edge. */
export function SectionHeading({
  tone = 'accent',
  count,
  className,
  children,
}: {
  tone?: keyof typeof DOT_TONES
  count?: number
  className?: string
  children: ReactNode
}) {
  return (
    <h2 className={cn('mb-6 flex items-center gap-3', className)}>
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', DOT_TONES[tone])} />
      <span className="eyebrow text-fg/85">{children}</span>
      {count !== undefined && <span className="font-mono text-[11px] leading-none text-faint tabular-nums">{count}</span>}
      <span aria-hidden className="h-px flex-1 bg-edge" />
    </h2>
  )
}

const BADGE_TONES = {
  accent: 'bg-white/[0.09] text-fg',
  good: 'bg-good/10 text-good',
  bad: 'bg-bad/10 text-bad',
  muted: 'text-muted ring-1 ring-edge-strong ring-inset',
} as const

export function Badge({
  tone = 'muted',
  className,
  children,
}: {
  tone?: keyof typeof BADGE_TONES
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-[5px] px-1.5 text-[11px] leading-none font-medium whitespace-nowrap',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
