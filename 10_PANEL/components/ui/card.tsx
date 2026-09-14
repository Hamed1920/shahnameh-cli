import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** The panel's one card recipe: a flat surface one step above the page, and a hairline. */
export function Card({
  interactive = false,
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        'lit rounded-xl border border-edge bg-panel',
        interactive && 'transition-colors duration-200 hover:border-edge-strong',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

/** The "nothing here" box. */
export function EmptyState({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-dashed border-edge-strong/70 px-8 py-14',
        'text-center text-sm leading-relaxed text-muted',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function StatTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Card interactive className="px-6 pt-5 pb-6">
      <div className="eyebrow text-muted">{label}</div>
      <div className="mt-5 font-display text-5xl leading-none text-fg tabular-nums">{value}</div>
    </Card>
  )
}
