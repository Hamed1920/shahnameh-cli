import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * The panel's one card recipe -- previously copy-pasted across six call sites.
 * `pane` is translucent and blurred so the star lattice and the colour washes
 * read through it; `edge-lit` adds the top catch-light and the shadow beneath.
 */
export function Card({
  interactive = false,
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        'pane edge-lit rounded-xl border border-edge',
        interactive &&
          'transition-colors duration-200 hover:border-edge-strong hover:bg-raise/60',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

/**
 * The dashed "nothing here" box -- previously copy-pasted across six call
 * sites. Deliberately the most transparent surface in the app: an empty state
 * is the one place the ground pattern gets to be the whole point.
 */
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
        'rounded-xl border border-dashed border-edge bg-panel/15 px-8 py-12',
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
    <Card interactive className="relative overflow-hidden px-5 py-4">
      {/* Corner gleam, so a row of tiles is not four identical grey boxes. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-8 -right-8 size-20 rounded-full bg-accent/10 blur-2xl"
      />
      <div className="relative text-2xl leading-none font-semibold tabular-nums text-fg">
        {value}
      </div>
      <div className="relative mt-2 text-[11px] font-medium tracking-[0.1em] text-muted uppercase">
        {label}
      </div>
    </Card>
  )
}
