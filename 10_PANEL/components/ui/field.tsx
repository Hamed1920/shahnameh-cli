import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * One recipe for every text control in the panel. Before this, three fields
 * shared a copy-pasted class string with no hover, focus or placeholder
 * treatment at all.
 */
const CONTROL = cn(
  'w-full rounded-lg border border-edge bg-sunken/70 px-3.5 py-2.5 text-sm text-fg',
  'shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)]',
  'placeholder:text-muted/50',
  'transition-[color,background-color,border-color,box-shadow] duration-150',
  'hover:border-edge-strong',
  'focus:border-accent/70 focus:bg-sunken focus:outline-none',
  'focus:shadow-[inset_0_1px_2px_rgba(0,0,0,0.35),0_0_0_3px_rgba(201,162,39,0.16)]',
  'disabled:cursor-not-allowed disabled:opacity-50',
)

/** Label + optional hint wrapper. Renders a real <label>, so the text is clickable. */
export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn('block space-y-2', className)}>
      <span className="block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted/70">{hint}</span>}
    </label>
  )
}

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input className={cn(CONTROL, className)} {...props} />
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        CONTROL,
        // Grows with the note instead of scrolling a 3-row box, then scrolls
        // inside its own styled pane once it hits the cap.
        'scroll-pane field-sizing-content max-h-64 min-h-24 resize-y leading-relaxed',
        className,
      )}
      {...props}
    />
  )
}
