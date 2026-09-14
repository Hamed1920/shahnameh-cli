'use client'

import { useId, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { EASE } from '@/components/ui/motion-tokens'

/**
 * Replaces the native <details>, which cannot animate its own height.
 *
 * `type="button"` matters: two of these live inside forms that post to server
 * actions, and a bare <button> would submit them.
 */
export function Disclosure({
  summary,
  defaultOpen = false,
  className,
  children,
}: {
  summary: React.ReactNode
  defaultOpen?: boolean
  className?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()

  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'focus-ring inline-flex cursor-pointer items-center gap-1.5 rounded',
          'text-xs text-muted transition-colors duration-150 hover:text-fg',
        )}
      >
        <motion.span
          aria-hidden
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.2, ease: EASE }}
          className="inline-flex"
        >
          <ChevronRight className="size-3.5" />
        </motion.span>
        {summary}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={id}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="pt-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
