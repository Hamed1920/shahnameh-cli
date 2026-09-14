'use client'

import { LoaderCircle } from 'lucide-react'
import { motion, type HTMLMotionProps } from 'motion/react'
import { cn } from '@/lib/cn'

/**
 * Flat controls. The primary action is the one white thing on the screen;
 * everything else is an outline or bare text, so the eye lands on it first.
 * `good` shares the primary look -- accepting is the main action wherever it
 * appears -- while `bad` is tinted rather than filled, so a destructive button
 * is unmistakable without shouting.
 */
const PRIMARY = 'border-transparent bg-fg text-ink hover:bg-white'

const TONES = {
  accent: PRIMARY,
  good: PRIMARY,
  bad: 'border-bad/30 bg-bad/10 text-bad hover:border-bad/55 hover:bg-bad/15',
  outline: 'border-edge-strong bg-transparent text-fg/90 hover:border-[#505050] hover:bg-white/[0.04] hover:text-fg',
  ghost: 'border-transparent bg-transparent text-muted hover:bg-white/[0.05] hover:text-fg',
} as const

const SIZES = {
  sm: 'h-8 gap-1.5 px-3 text-[13px]',
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
      whileTap={off ? undefined : { scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 700, damping: 30 }}
      disabled={off}
      className={cn(
        'focus-ring inline-flex shrink-0 cursor-pointer items-center justify-center',
        'rounded-md border font-medium whitespace-nowrap select-none',
        'transition-[background-color,border-color,color,opacity] duration-150',
        'disabled:cursor-not-allowed disabled:opacity-35',
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
