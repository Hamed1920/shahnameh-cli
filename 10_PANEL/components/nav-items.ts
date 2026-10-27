import { CheckCheck, Clapperboard, Images, Inbox, LayoutGrid, Library, ListOrdered, ScrollText, Shapes, Sparkles } from 'lucide-react'
import type { Structure } from '@/lib/structure'

/**
 * The sections of the panel: the finished work first, then the review loop.
 * Every one lives under the open project, so `path` is relative to /<project>.
 */
export const NAV = [
  { path: '', label: 'Gallery', icon: LayoutGrid },
  { path: '/episodes', label: 'Episodes', icon: Clapperboard },
  { path: '/review', label: 'Review', icon: Inbox },
  { path: '/decided', label: 'Decided', icon: CheckCheck },
  { path: '/references', label: 'References', icon: Images },
  { path: '/entities', label: 'Index', icon: Library },
  { path: '/learnings', label: 'Learnings', icon: Sparkles },
  { path: '/prompts', label: 'Prompts', icon: ScrollText },
  { path: '/queue', label: 'Queue', icon: ListOrdered },
] as const

/**
 * A Sequence / Block project: Sequences stands where Episodes stood, and the pre-production Library
 * follows it. Everything else keeps its place; the flat order is unchanged.
 */
const BLOCKS_NAV = [
  { path: '', label: 'Gallery', icon: LayoutGrid },
  { path: '/sequences', label: 'Sequences', icon: Clapperboard },
  { path: '/library', label: 'Library', icon: Shapes },
  { path: '/review', label: 'Review', icon: Inbox },
  { path: '/decided', label: 'Decided', icon: CheckCheck },
  { path: '/references', label: 'References', icon: Images },
  { path: '/entities', label: 'Index', icon: Library },
  { path: '/learnings', label: 'Learnings', icon: Sparkles },
  { path: '/prompts', label: 'Prompts', icon: ScrollText },
  { path: '/queue', label: 'Queue', icon: ListOrdered },
] as const

/** The sections for a project's layout; an episodes project (or none given) gets NAV unchanged. */
export const navFor = (structure: Structure | undefined): readonly { path: string; label: string; icon: typeof Library }[] =>
  structure === 'blocks' ? BLOCKS_NAV : NAV

/** The href of a section within one project. */
export const navHref = (project: string, path: string) => `/${project}${path}`

export const SIDEBAR_WIDTH = 240
export const SIDEBAR_RAIL = 60

/**
 * Read on the server so the rail renders at its persisted width in the very
 * first paint. localStorage would mean a frame at the wrong width on reload.
 */
export const SIDEBAR_COOKIE = 'shm-sidebar-collapsed'
