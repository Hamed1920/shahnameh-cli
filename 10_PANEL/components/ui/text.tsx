import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Page title, optional description, optional right-aligned count. */
export function PageHeader({
  title,
  meta,
  children,
}: {
  title: ReactNode
  meta?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="space-y-2">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
        {meta && <span className="shrink-0 text-sm text-muted">{meta}</span>}
      </div>
      {children && (
        <p className="max-w-3xl text-sm leading-relaxed text-muted">{children}</p>
      )}
      <hr className="hairline mt-4!" />
    </header>
  )
}

const HEADING_TONES = {
  accent: 'text-accent',
  good: 'text-good',
  bad: 'text-bad',
  muted: 'text-muted',
} as const

export function SectionHeading({
  tone = 'accent',
  className,
  children,
}: {
  tone?: keyof typeof HEADING_TONES
  className?: string
  children: ReactNode
}) {
  return (
    <h2
      className={cn(
        'mb-4 flex items-center gap-2.5 text-[11px] font-semibold tracking-[0.12em] uppercase',
        HEADING_TONES[tone],
        className,
      )}
    >
      <span aria-hidden className="lozenge" />
      {children}
    </h2>
  )
}

const BADGE_TONES = {
  accent: 'bg-accent/15 text-accent ring-accent/25',
  good: 'bg-good/15 text-good ring-good/25',
  bad: 'bg-bad/15 text-bad ring-bad/25',
  muted: 'bg-white/[0.06] text-muted ring-white/10',
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
        'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium',
        'ring-1 ring-inset',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
