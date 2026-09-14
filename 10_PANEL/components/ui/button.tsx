'use client'

import { LoaderCircle } from 'lucide-react'
import { motion, type HTMLMotionProps } from 'motion/react'
import { cn } from '@/lib/cn'

/**
 * A filled button is a vertical ramp from the tone's -lit to its -deep token,
 * with a catch-light along the top edge and a drop shadow under it, so it
 * reads as a raised physical control. Hover trades the drop shadow for a
 * coloured glow. Outline and ghost stay flat by design -- they are the
 * secondary actions and should not compete.
 */
const TONES = {
  accent: cn(
    'border-black/30 bg-linear-to-b from-accent-lit to-accent-deep text-ink',
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_1px_2px_rgba(0,0,0,0.45)]',
    'hover:to-accent hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_3px_14px_-3px_rgba(224,187,68,0.55)]',
  ),
  good: cn(
    'border-black/30 bg-linear-to-b from-good-lit to-good-deep text-white',
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_1px_2px_rgba(0,0,0,0.45)]',
    'hover:to-good hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_3px_14px_-3px_rgba(76,176,106,0.55)]',
  ),
  bad: cn(
    'border-black/30 bg-linear-to-b from-bad-lit to-bad-deep text-white',
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_1px_2px_rgba(0,0,0,0.45)]',
    'hover:to-bad hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_3px_14px_-3px_rgba(209,97,90,0.55)]',
  ),
  outline: cn(
    'border-edge bg-white/[0.03] text-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]',
    'hover:border-edge-strong hover:bg-white/[0.07] hover:text-fg',
  ),
  ghost: 'border-transparent bg-transparent text-muted hover:bg-white/[0.06] hover:text-fg',
} as const

const SIZES = {
  sm: 'h-8 gap-1.5 px-3 text-xs',
  md: 'h-10 gap-2 px-4 text-sm',
} as const

export type ButtonProps = HTMLMotionProps<'button'> & {
  tone?: keyof typeof TONES
  size?: keyof typeof SIZES
  /** Renders the spinner and blocks input. Pair with useFormStatus(). */
  pending?: boolean
  pendingLabel?: string
}

export function Button({
  tone = 'outline',
  size = 'md',
  pending = false,
  pendingLabel = 'Saving',
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  const off = disabled || pending
  return (
    <motion.button
      whileTap={off ? undefined : { scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 700, damping: 30 }}
      disabled={off}
      className={cn(
        'focus-ring inline-flex shrink-0 cursor-pointer items-center justify-center',
        'rounded-lg border font-medium whitespace-nowrap select-none',
        'transition-[background-color,background-image,border-color,box-shadow,color] duration-150',
        'disabled:cursor-not-allowed disabled:opacity-45 disabled:saturate-50',
        TONES[tone],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {pending ? (
        <>
          <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </motion.button>
  )
}
