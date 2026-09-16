import type { ReactNode } from 'react'
import { CONTROL } from '@/components/ui/control'
import { cn } from '@/lib/cn'

/** The panel's own dropdown; same children and value/onChange as a native select. */
export { Select, type SelectChange } from '@/components/ui/select'

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
