'use client'

import { useId } from 'react'
import { motion } from 'motion/react'
import { SPRING_SNAPPY } from '@/components/ui/motion-tokens'
import { cn } from '@/lib/cn'

/**
 * A few mutually exclusive choices as one joined control, the selection a
 * sliding fill. For two to four short options; more belongs in a Select.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  'aria-label': ariaLabel,
  className,
}: {
  value: T
  options: readonly (readonly [T, string])[]
  onChange: (value: T) => void
  'aria-label': string
  className?: string
}) {
  const group = useId()
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('inline-flex h-9 items-center rounded-md border border-edge-strong bg-white/[0.02] p-[3px]', className)}>
      {options.map(([v, label]) => {
        const on = v === value
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(v)}
            className={cn(
              'focus-ring relative h-full cursor-pointer rounded-[5px] px-3 text-[13px] whitespace-nowrap transition-colors duration-150',
              on ? 'text-ink' : 'text-muted hover:text-fg',
            )}
          >
            {on && <motion.span aria-hidden layoutId={`seg-${group}`} transition={SPRING_SNAPPY} className="absolute inset-0 rounded-[5px] bg-fg" />}
            <span className="relative">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
