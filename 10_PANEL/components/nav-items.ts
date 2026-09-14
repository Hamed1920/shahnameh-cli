import { CheckCheck, Inbox, Library, ListOrdered, Sparkles } from 'lucide-react'

/** The five sections of the panel, in review-loop order. */
export const NAV = [
  { href: '/', label: 'Review', icon: Inbox },
  { href: '/decided', label: 'Decided', icon: CheckCheck },
  { href: '/entities', label: 'Index', icon: Library },
  { href: '/learnings', label: 'Learnings', icon: Sparkles },
  { href: '/queue', label: 'Queue', icon: ListOrdered },
] as const

export const SIDEBAR_WIDTH = 240
export const SIDEBAR_RAIL = 60

/**
 * Read on the server so the rail renders at its persisted width in the very
 * first paint. localStorage would mean a frame at the wrong width on reload.
 */
export const SIDEBAR_COOKIE = 'shm-sidebar-collapsed'
