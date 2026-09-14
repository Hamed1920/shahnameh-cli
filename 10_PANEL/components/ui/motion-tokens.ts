/** Shared easing and springs, so timings stay consistent across the panel. */

/** Matches --ease-out-quint in globals.css. */
export const EASE = [0.22, 1, 0.36, 1] as const

/** Sidebar width and the sliding active-nav pill. Fast, barely overshoots. */
export const SPRING = { type: 'spring', stiffness: 420, damping: 38 } as const

export const SPRING_SNAPPY = { type: 'spring', stiffness: 600, damping: 40 } as const
