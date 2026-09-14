import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** One recipe for every text control in the panel. Flat: a hairline that brightens on focus. */
const CONTROL = cn(
  'w-full rounded-md border border-edge-strong bg-white/[0.02] px-3 py-2 text-sm text-fg',
  'placeholder:text-faint',
  'transition-[background-color,border-color] duration-150',
  'hover:border-[#505050]',
  'focus:border-fg/45 focus:bg-transparent focus:outline-none',
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
      <span className="block text-[12.5px] text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs leading-relaxed text-faint">{hint}</span>}
    </label>
  )
}

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input className={cn(CONTROL, 'h-9', className)} {...props} />
}

export function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return <select className={cn(CONTROL, 'select-chevron h-9 cursor-pointer pr-9', className)} {...props} />
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        CONTROL,
        // Grows with the note instead of scrolling a 3-row box, then scrolls
        // inside its own styled pane once it hits the cap.
        'scroll-pane field-sizing-content max-h-64 min-h-24 resize-y py-2.5 leading-relaxed',
        className,
      )}
      {...props}
    />
  )
}
