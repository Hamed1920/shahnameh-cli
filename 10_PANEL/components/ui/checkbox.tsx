import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * Replaces the bare OS checkbox. The native input still carries the form
 * value -- it is only made invisible (appearance-none) and painted over, so
 * keyboard, form reset and FormData all behave normally.
 *
 * Block-level `flex`, not `inline-flex`: as an inline element it shared a line
 * with whatever followed it in the form and the two overlapped.
 */
export function Checkbox({
  label,
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'> & { label: React.ReactNode }) {
  return (
    <label
      className={cn(
        'group flex w-fit cursor-pointer items-center gap-3 text-sm text-muted',
        'transition-colors duration-150 hover:text-fg',
        className,
      )}
    >
      <span className="relative grid size-4 shrink-0 place-items-center">
        <input
          type="checkbox"
          className={cn(
            'focus-ring peer size-full cursor-pointer appearance-none rounded-[4px]',
            'border border-edge-strong bg-transparent',
            'transition-colors duration-150 group-hover:border-muted',
            'checked:border-fg checked:bg-fg',
          )}
          {...props}
        />
        <Check
          aria-hidden
          strokeWidth={3.5}
          className={cn(
            'pointer-events-none absolute size-2.5 scale-50 text-ink opacity-0',
            'transition-[opacity,transform] duration-150 ease-out-quint',
            'peer-checked:scale-100 peer-checked:opacity-100',
          )}
        />
      </span>
      <span>{label}</span>
    </label>
  )
}
