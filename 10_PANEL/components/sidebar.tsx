'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion } from 'motion/react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { ArrowLeftRight, Bell } from 'lucide-react'
import { ActivitySheet, useActivity } from '@/components/activity'
import { NAV, SIDEBAR_COOKIE, SIDEBAR_RAIL, SIDEBAR_WIDTH, navHref } from '@/components/nav-items'
import { useProject } from '@/components/project-context'
import { EASE, SPRING } from '@/components/ui/motion-tokens'
import type { ActivityItem } from '@/lib/activity'
import type { WorkerStatus } from '@/lib/types'
import { NOT_STARTING_MS, TONE_DOT, describeWorker } from '@/lib/worker-words'
import { cn } from '@/lib/cn'

/** Counts that are information, not something waiting on Hamed: drawn quietly. */
const QUIET = new Set<string>(['/queue'])

const fade = {
  initial: { opacity: 0, x: -4 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -4 },
  transition: { duration: 0.15, ease: EASE },
}

/**
 * Collapsible icon rail.
 *
 * Geometry note: every row is inset 8px (mx-2) and pads 12px, so an icon sits
 * 20px from the aside edge and its centre lands at 30px — exactly half the
 * 60px rail. The 24px mark is inset 18px for the same centre. That is why
 * nothing drifts sideways as the rail collapses; only the labels move.
 *
 * Lives in the project layout, which persists across client navigations within
 * a project, so the rail never remounts or replays its animation when you
 * change page. The mark and name at the top say which film you are in.
 */
export function Sidebar({
  defaultCollapsed,
  counts = {},
  activity = [],
  worker: status,
  generating = null,
  held = 0,
}: {
  defaultCollapsed: boolean
  /** Badge per nav path, e.g. jobs waiting on the Queue. Zero shows nothing. */
  counts?: Partial<Record<string, number>>
  /** The worker's latest outcomes (lib/activity.ts): toasts as they come, and the Activity list. */
  activity?: ActivityItem[]
  /** For the dot beside the film's name. */
  worker: WorkerStatus
  /** "EP13 · SC001" while a job is generating. */
  generating?: string | null
  /** Queued jobs the worker is holding back (over the credit limit, not signed in). */
  held?: number
}) {
  // A worker still "starting" a minute after this page first saw it is not starting.
  const settling = !status.running && !status.autostartOff && !status.paused && !status.stopRequested
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!settling) { setSlow(false); return }
    const t = setTimeout(() => setSlow(true), NOT_STARTING_MS)
    return () => clearTimeout(t)
  }, [settling])
  const worker = describeWorker(status, { generating, held, slow })
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [hovered, setHovered] = useState<string | null>(null)
  const pathname = usePathname()
  const project = useProject()
  const home = navHref(project.slug, '')
  const { unread, markRead } = useActivity(project.slug, activity, pathname)
  const [sheet, setSheet] = useState(false)
  const openActivity = () => { setSheet(true); markRead() }

  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    setHovered(null)
    document.cookie =
      SIDEBAR_COOKIE + '=' + (next ? '1' : '0') + '; path=/; max-age=31536000; samesite=lax'
  }

  return (
    <motion.aside
      // Tooltips escape this box, so it must not clip. Each row clips its own
      // label instead.
      // Above the pages' sticky bars (z-30), so its tooltips are not drawn under them; below dialogs (z-100).
      className="relative z-40 flex h-full shrink-0 flex-col border-r border-edge bg-ink"
      initial={false}
      animate={{ width: collapsed ? SIDEBAR_RAIL : SIDEBAR_WIDTH }}
      transition={SPRING}
    >
      <div className="relative flex h-18 shrink-0 items-center">
        {/* The film's name opens its home. */}
        <Link href={home} className="focus-ring flex min-w-0 flex-1 items-center gap-3 self-stretch overflow-hidden rounded-md pl-[18px]">
          <span
            aria-hidden
            className="grid size-6 shrink-0 place-items-center rounded-md bg-fg font-sans text-[15px] leading-none text-ink"
          >
            {project.mark}
          </span>
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.span {...fade} className="min-w-0 truncate font-display text-[22px] leading-none whitespace-nowrap text-fg">
                {project.name}
              </motion.span>
            )}
          </AnimatePresence>
        </Link>
        {/* The worker in one dot: beside the name, or on the mark's corner when collapsed. Opens the Queue. */}
        <Link
          href={navHref(project.slug, '/queue')}
          aria-label={`${worker.headline}, ${worker.detail}. Open the queue.`}
          onMouseEnter={() => setHovered('worker')}
          onMouseLeave={() => setHovered(null)}
          onFocus={() => setHovered('worker')}
          onBlur={() => setHovered(null)}
          className={cn(
            'focus-ring absolute grid place-items-center rounded-full',
            collapsed ? 'top-[40px] left-[34px] size-3.5 bg-ink' : 'top-1/2 right-3 size-6 -translate-y-1/2 hover:bg-white/[0.05]',
          )}
        >
          <span aria-hidden className="relative grid size-2 place-items-center">
            {worker.tone === 'busy' && <span className="absolute inset-0 animate-ping rounded-full bg-good/60" />}
            <span className={cn('relative size-2 rounded-full', TONE_DOT[worker.tone])} />
          </span>
          <AnimatePresence>
            {hovered === 'worker' && (
              <motion.span
                role="tooltip"
                initial={{ opacity: 0, y: -2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2 }}
                transition={{ duration: 0.14, ease: EASE }}
                className={cn(
                  'pointer-events-none absolute top-full z-50 mt-2 w-max max-w-64',
                  collapsed ? 'left-0' : 'right-0',
                  'rounded-md border border-edge-strong bg-raise px-2.5 py-1.5 text-left text-xs text-fg',
                )}
              >
                {worker.headline}
                <span className="block text-muted">{worker.detail}</span>
              </motion.span>
            )}
          </AnimatePresence>
        </Link>
      </div>

      <nav aria-label="Sections" className="pt-2">
        <ul className="space-y-px">
          {NAV.map(({ path, label, icon: Icon }) => {
            const href = navHref(project.slug, path)
            const active = path === '' ? pathname === home : pathname.startsWith(href)
            const count = counts[path] ?? 0
            const countText = count > 99 ? '99+' : String(count)
            return (
              <li key={href} className="relative mx-2">
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  onMouseEnter={() => setHovered(href)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(href)}
                  onBlur={() => setHovered(null)}
                  className={cn(
                    'focus-ring relative flex h-9 items-center gap-3 overflow-hidden rounded-md px-3',
                    'transition-colors duration-150',
                    active ? 'text-fg' : 'text-muted hover:bg-white/[0.03] hover:text-fg',
                  )}
                >
                  {active && (
                    <motion.span
                      aria-hidden
                      layoutId="nav-active"
                      transition={SPRING}
                      className="lit absolute inset-0 rounded-md bg-white/[0.07]"
                    />
                  )}
                  <Icon aria-hidden strokeWidth={1.75} className="relative size-5 shrink-0" />
                  <AnimatePresence initial={false}>
                    {!collapsed && (
                      <motion.span {...fade} className="relative text-[13.5px] whitespace-nowrap">
                        {label}
                      </motion.span>
                    )}
                  </AnimatePresence>
                  {count > 0 && (
                    <>
                      <span className="sr-only">, {count} {QUIET.has(path) ? 'in the queue' : 'waiting for you'}</span>
                      {/* Expanded: a pill at the row's end. Collapsed: pinned to the icon's corner.
                          White means it waits on you; the queue's count is only information, so it is quiet. */}
                      <span
                        aria-hidden
                        className={cn(
                          'absolute grid place-items-center rounded-full font-mono leading-none font-medium tabular-nums',
                          'transition-[top,right,height,min-width,font-size] duration-200',
                          QUIET.has(path) ? 'text-faint' : 'bg-accent text-ink',
                          collapsed
                            ? cn('top-[5px] right-[5px] h-3.5 min-w-3.5 px-[3px] text-[9px] ring-2 ring-ink', QUIET.has(path) && 'bg-raise')
                            : 'top-1/2 right-3 h-[18px] min-w-[18px] -translate-y-1/2 px-1.5 text-[10.5px]',
                        )}
                      >
                        {countText}
                      </span>
                    </>
                  )}
                </Link>

                <AnimatePresence>
                  {collapsed && hovered === href && (
                    <motion.span
                      role="tooltip"
                      initial={{ opacity: 0, x: -4, y: '-50%' }}
                      animate={{ opacity: 1, x: 0, y: '-50%' }}
                      exit={{ opacity: 0, x: -4, y: '-50%' }}
                      transition={{ duration: 0.14, ease: EASE }}
                      className={cn(
                        'pointer-events-none absolute top-1/2 left-full z-50 ml-3',
                        'rounded-md border border-edge-strong bg-raise px-2.5 py-1.5',
                        'text-xs whitespace-nowrap text-fg',
                      )}
                    >
                      {label}
                      {count > 0 && <span className="ml-1.5 font-mono text-muted">{countText}</span>}
                    </motion.span>
                  )}
                </AnimatePresence>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="mt-auto p-2 pb-3">
        {/* What the worker did with what was sent, and what it could not do (components/activity.tsx). */}
        <button
          type="button"
          onClick={openActivity}
          onMouseEnter={() => setHovered('activity')}
          onMouseLeave={() => setHovered(null)}
          onFocus={() => setHovered('activity')}
          onBlur={() => setHovered(null)}
          aria-label={unread ? `Activity, ${unread} new` : 'Activity'}
          className={cn(
            'focus-ring relative flex h-9 w-full cursor-pointer items-center gap-3 overflow-hidden rounded-md px-3',
            'text-faint transition-colors duration-150 hover:bg-white/[0.03] hover:text-fg',
          )}
        >
          <Bell aria-hidden strokeWidth={1.75} className="size-5 shrink-0" />
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.span {...fade} className="text-[13px] whitespace-nowrap">
                Activity
              </motion.span>
            )}
          </AnimatePresence>
          {unread > 0 && (
            <span
              aria-hidden
              className={cn(
                'absolute grid place-items-center rounded-full bg-accent font-mono leading-none font-medium text-ink tabular-nums',
                'transition-[top,right,height,min-width,font-size] duration-200',
                collapsed
                  ? 'top-[5px] right-[5px] h-3.5 min-w-3.5 px-[3px] text-[9px] ring-2 ring-ink'
                  : 'top-1/2 right-3 h-[18px] min-w-[18px] -translate-y-1/2 px-1.5 text-[10.5px]',
              )}
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
          <AnimatePresence>
            {collapsed && hovered === 'activity' && (
              <motion.span
                role="tooltip"
                initial={{ opacity: 0, x: -4, y: '-50%' }}
                animate={{ opacity: 1, x: 0, y: '-50%' }}
                exit={{ opacity: 0, x: -4, y: '-50%' }}
                transition={{ duration: 0.14, ease: EASE }}
                className={cn(
                  'pointer-events-none absolute top-1/2 left-full z-50 ml-3',
                  'rounded-md border border-edge-strong bg-raise px-2.5 py-1.5',
                  'text-xs whitespace-nowrap text-fg',
                )}
              >
                Activity
                {unread > 0 && <span className="ml-1.5 font-mono text-muted">{unread} new</span>}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
        {/* Back to the list of films. The panel runs them all; this one is just the open one. */}
        <Link
          href="/"
          onMouseEnter={() => setHovered('switch')}
          onMouseLeave={() => setHovered(null)}
          onFocus={() => setHovered('switch')}
          onBlur={() => setHovered(null)}
          className={cn(
            'focus-ring relative flex h-9 items-center gap-3 overflow-hidden rounded-md px-3',
            'text-faint transition-colors duration-150 hover:bg-white/[0.03] hover:text-fg',
          )}
        >
          <ArrowLeftRight aria-hidden strokeWidth={1.75} className="size-5 shrink-0" />
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.span {...fade} className="text-[13px] whitespace-nowrap">
                Switch project
              </motion.span>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {collapsed && hovered === 'switch' && (
              <motion.span
                role="tooltip"
                initial={{ opacity: 0, x: -4, y: '-50%' }}
                animate={{ opacity: 1, x: 0, y: '-50%' }}
                exit={{ opacity: 0, x: -4, y: '-50%' }}
                transition={{ duration: 0.14, ease: EASE }}
                className={cn(
                  'pointer-events-none absolute top-1/2 left-full z-50 ml-3',
                  'rounded-md border border-edge-strong bg-raise px-2.5 py-1.5',
                  'text-xs whitespace-nowrap text-fg',
                )}
              >
                Switch project
              </motion.span>
            )}
          </AnimatePresence>
        </Link>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'focus-ring flex h-9 w-full cursor-pointer items-center gap-3 overflow-hidden rounded-md px-3',
            'text-faint transition-colors duration-150 hover:bg-white/[0.03] hover:text-fg',
          )}
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden strokeWidth={1.75} className="size-5 shrink-0" />
          ) : (
            <PanelLeftClose aria-hidden strokeWidth={1.75} className="size-5 shrink-0" />
          )}
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.span {...fade} className="text-[13px] whitespace-nowrap">
                Collapse
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
      <ActivitySheet open={sheet} onClose={() => setSheet(false)} project={project.slug} items={activity} />
    </motion.aside>
  )
}
