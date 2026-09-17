import { CheckCheck, Images, Inbox, LayoutGrid, Library, ListOrdered, ScrollText, Sparkles } from 'lucide-react'

/**
 * The sections of the panel: the finished work first, then the review loop.
 * Every one lives under the open project, so `path` is relative to /<project>.
 */
export const NAV = [
  { path: '', label: 'Gallery', icon: LayoutGrid },
  { path: '/review', label: 'Review', icon: Inbox },
  { path: '/decided', label: 'Decided', icon: CheckCheck },
  { path: '/references', label: 'References', icon: Images },
  { path: '/entities', label: 'Index', icon: Library },
  { path: '/learnings', label: 'Learnings', icon: Sparkles },
  { path: '/prompts', label: 'Prompts', icon: ScrollText },
  { path: '/queue', label: 'Queue', icon: ListOrdered },
] as const

/** The href of a section within one project. */
export const navHref = (project: string, path: string) => `/${project}${path}`

export const SIDEBAR_WIDTH = 240
export const SIDEBAR_RAIL = 60

/**
 * Read on the server so the rail renders at its persisted width in the very
 * first paint. localStorage would mean a frame at the wrong width on reload.
 */
export const SIDEBAR_COOKIE = 'shm-sidebar-collapsed'
