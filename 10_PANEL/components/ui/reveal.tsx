'use client'

import { motion } from 'motion/react'
import { EASE } from '@/components/ui/motion-tokens'

/**
 * Staggered entry for list items, with an optional hover lift.
 *
 * Client component, but children are passed through as props -- so a server
 * page can wrap server-rendered rows in this without pulling any of them
 * across the client boundary.
 */
export function Reveal({
  index = 0,
  lift = false,
  className,
  children,
}: {
  index?: number
  lift?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.2,
        ease: EASE,
        // Capped low: a page should look finished almost at once, not crawl in card by card.
        delay: Math.min(index * 0.025, 0.12),
      }}
      whileHover={lift ? { y: -2, transition: { duration: 0.15, ease: EASE } } : undefined}
      className={className}
    >
      {children}
    </motion.div>
  )
}
