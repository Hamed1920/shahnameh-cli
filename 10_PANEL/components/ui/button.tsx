'use client'

import { LoaderCircle } from 'lucide-react'
import { motion, type HTMLMotionProps } from 'motion/react'
import { buttonClasses, type SIZES, type TONES } from '@/components/ui/button-styles'

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
      className={buttonClasses({ tone, size, className })}
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
