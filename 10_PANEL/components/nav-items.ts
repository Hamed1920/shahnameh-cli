import { BookOpenCheck, CheckCheck, Clapperboard, Images, Inbox, LayoutGrid, Library, ListOrdered, ScrollText } from 'lucide-react'

/**
 * The sections of the panel, in the order the work goes round: write prompts
 * and watch them run, judge what comes back, see the film take shape, and the
 * library everything draws on. Every one lives under the open project, so
 * `path` is relative to /<project>; '' is the project's home, the Gallery.
 */
export const NAV_GROUPS = [
  {
    label: 'Make',
    items: [
      { path: '/prompts', label: 'Prompts', icon: ScrollText },
      { path: '/queue', label: 'Queue', icon: ListOrdered },
    ],
  },
  {
    label: 'Review',
    items: [
      { path: '/review', label: 'Review', icon: Inbox },
      { path: '/decided', label: 'Decided', icon: CheckCheck },
    ],
  },
  {
    label: 'Film',
    items: [
      { path: '/episodes', label: 'Episodes', icon: Clapperboard },
      { path: '', label: 'Gallery', icon: LayoutGrid },
    ],
  },
  {
    label: 'Library',
    items: [
      { path: '/references', label: 'References', icon: Images },
      { path: '/entities', label: 'Index', icon: Library },
      { path: '/learnings', label: 'Learnings', icon: BookOpenCheck },
    ],
  },
] as const

/** The href of a section within one project. */
export const navHref = (project: string, path: string) => `/${project}${path}`

export const SIDEBAR_WIDTH = 248
export const SIDEBAR_RAIL = 60

/**
 * Read on the server so the rail renders at its persisted width in the very
 * first paint. localStorage would mean a frame at the wrong width on reload.
 */
export const SIDEBAR_COOKIE = 'shm-sidebar-collapsed'
