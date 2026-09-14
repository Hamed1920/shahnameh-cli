'use client'

import { MotionConfig } from 'motion/react'

/**
 * One reduced-motion policy for the whole app. `reducedMotion="user"` makes
 * every motion component honour the OS setting, so no component has to check
 * for itself. The plain CSS transitions are covered by the media query in
 * globals.css.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}
