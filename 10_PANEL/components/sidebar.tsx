'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronsUpDown, LayoutList, Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { NAV_GROUPS, SIDEBAR_COOKIE, SIDEBAR_RAIL, SIDEBAR_WIDTH, navHref } from '@/components/nav-items'
import { useProject } from '@/components/project-context'
import { EASE, SPRING } from '@/components/ui/motion-tokens'
import { cn } from '@/lib/cn'
import type { NavBadge, SidebarData } from '@/lib/sidebar'
import { TONE_DOT, describeWorker, type WorkerSummary } from '@/lib/worker-state'

const fade = {
  initial: { opacity: 0, x: -4 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -4 },
  transition: { duration: 0.15, ease: EASE },
}

export interface FilmLink {
  slug: string
  name: string
  mark: string
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

/**
 * The film's navigation, and what its worker is doing.
 *
 * Desktop: a rail that collapses to icons ([ toggles it), remembered in a
 * cookie so the first paint is already the right width. Below lg: a slim top
 * bar and the same list in a drawer.
 *
 * Geometry note: every row is inset 8px (mx-2) and pads 12px, so an icon sits
 * 20px from the aside edge and its centre lands at 30px -- exactly half the
 * 60px rail. The 28px mark is inset 16px for the same centre. That is why
 * nothing drifts sideways as the rail collapses; only the labels move.
 *
 * Lives in the project layout, which persists across client navigations within
 * a project, so it never remounts or replays its animation when you change page.
 */
export function Sidebar({
  defaultCollapsed,
  data,
  films,
}: {
  defaultCollapsed: boolean
  data: SidebarData
  /** Every film on this machine, for the switcher. */
  films: FilmLink[]
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [drawer, setDrawer] = useState(false)
  const pathname = usePathname()
  const project = useProject()

  // A worker still "starting" after a minute is not starting.
  const settling = !data.worker.running && !data.worker.autostartOff && !data.worker.paused && !data.worker.stopRequested
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!settling) { setSlow(false); return }
    const t = setTimeout(() => setSlow(true), 60_000)
    return () => clearTimeout(t)
  }, [settling])
  const worker = describeWorker(data.worker, { generating: data.generating, held: data.held, slow })

  function toggle() {
    setCollapsed((was) => {
      document.cookie = `${SIDEBAR_COOKIE}=${was ? '0' : '1'}; path=/; max-age=31536000; samesite=lax`
      return !was
    })
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '[' || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The drawer closes when a link in it is followed, and on Escape.
  useEffect(() => setDrawer(false), [pathname])
  useEffect(() => {
    if (!drawer) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawer])

  return (
    <>
      {/* ------------------------------------------------ desktop rail */}
      <motion.aside
        // Tooltips escape this box, so it must not clip. Each row clips its own label instead.
        className="relative z-20 hidden h-full shrink-0 flex-col border-r border-edge bg-ink lg:flex"
        initial={false}
        animate={{ width: collapsed ? SIDEBAR_RAIL : SIDEBAR_WIDTH }}
        transition={SPRING}
      >
        <Body collapsed={collapsed} data={data} worker={worker} films={films} pathname={pathname} onToggle={toggle} />
      </motion.aside>

      {/* ------------------------------------------------ small screens: top bar + drawer */}
      <header className="flex h-13 shrink-0 items-center gap-3 border-b border-edge bg-ink px-3 lg:hidden">
        <button
          type="button"
          onClick={() => setDrawer(true)}
          aria-label="Open the menu"
          aria-expanded={drawer}
          className="focus-ring grid size-9 cursor-pointer place-items-center rounded-md text-muted hover:bg-white/[0.04] hover:text-fg"
        >
          <Menu aria-hidden strokeWidth={1.75} className="size-5" />
        </button>
        <Link href={navHref(project.slug, '')} className="focus-ring flex min-w-0 items-center gap-2.5 rounded-md">
          <Mark mark={project.mark} />
          <span className="truncate font-display text-[21px] leading-none text-fg">{project.name}</span>
        </Link>
        <Link href={navHref(project.slug, '/queue')} className="focus-ring ml-auto flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted">
          <Dot tone={worker.tone} />
          <span className="max-w-40 truncate">{worker.headline}</span>
        </Link>
      </header>

      <AnimatePresence>
        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <motion.div
              className="overlay absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: EASE }}
              onClick={() => setDrawer(false)}
            />
            <motion.aside
              className="relative flex h-full w-[min(18rem,80vw)] flex-col border-r border-edge bg-ink"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.24, ease: EASE }}
            >
              <Body collapsed={false} data={data} worker={worker} films={films} pathname={pathname} />
              {/* On the dimmed page beside the drawer, clear of the film switcher. */}
              <button
                type="button"
                onClick={() => setDrawer(false)}
                aria-label="Close the menu"
                className="focus-ring absolute top-5 left-full ml-3 grid size-9 cursor-pointer place-items-center rounded-full border border-edge-strong bg-raise text-muted hover:text-fg"
              >
                <X aria-hidden strokeWidth={1.75} className="size-4.5" />
              </button>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}

/** The rail's contents, shared by the desktop aside and the small-screen drawer. */
function Body({
  collapsed, data, worker, films, pathname, onToggle,
}: {
  collapsed: boolean
  data: SidebarData
  worker: WorkerSummary
  films: FilmLink[]
  pathname: string
  /** Absent in the drawer, which has no rail to collapse to. */
  onToggle?: () => void
}) {
  const project = useProject()
  const home = navHref(project.slug, '')

  return (
    <>
      <FilmSwitcher collapsed={collapsed} films={films} />

      {/* Scrolls only when expanded: a scroller clips, and the collapsed rail's tooltips must escape it. */}
      <nav aria-label="Sections" className={cn('min-h-0 flex-1 pt-3 pb-4', !collapsed && 'scroll-pane')}>
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label} className={cn(gi > 0 && 'mt-5')}>
            <div className="relative mx-2 mb-1.5 h-4">
              <AnimatePresence initial={false}>
                {collapsed ? (
                  gi > 0 && (
                    <motion.span key="rule" {...fade} aria-hidden className="absolute top-1/2 left-3 h-px w-5 bg-edge-strong" />
                  )
                ) : (
                  <motion.span key="label" {...fade} className="absolute inset-y-0 left-3 font-mono text-[10.5px] leading-4 tracking-[0.12em] text-faint uppercase">
                    {group.label}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
            <ul className="space-y-px">
              {group.items.map(({ path, label, icon: Icon }) => {
                const href = navHref(project.slug, path)
                const active = path === '' ? pathname === home : pathname.startsWith(href)
                return (
                  <li key={href} className="mx-2">
                    <Tip show={collapsed} label={label} detail={badgeText(data.badges[path])}>
                      <Link
                        href={href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'focus-ring relative flex h-9 items-center gap-3 overflow-hidden rounded-md px-3',
                          'transition-colors duration-150',
                          active ? 'text-fg' : 'text-muted hover:bg-white/[0.035] hover:text-fg',
                        )}
                      >
                        {active && (
                          <motion.span
                            aria-hidden
                            layoutId="nav-active"
                            transition={SPRING}
                            className="lit absolute inset-0 rounded-md bg-white/[0.075]"
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
                        <Badge badge={data.badges[path]} collapsed={collapsed} />
                      </Link>
                    </Tip>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 space-y-1 p-2 pb-3">
        <WorkerPanel collapsed={collapsed} worker={worker} data={data} />
        {onToggle && (
          <Tip show={collapsed} label="Expand" detail="[">
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={!collapsed}
              aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
              className={cn(
                'focus-ring flex h-9 w-full cursor-pointer items-center gap-3 overflow-hidden rounded-md px-3',
                'text-faint transition-colors duration-150 hover:bg-white/[0.035] hover:text-fg',
              )}
            >
              {collapsed ? (
                <PanelLeftOpen aria-hidden strokeWidth={1.75} className="size-5 shrink-0" />
              ) : (
                <PanelLeftClose aria-hidden strokeWidth={1.75} className="size-5 shrink-0" />
              )}
              <AnimatePresence initial={false}>
                {!collapsed && (
                  <motion.span {...fade} className="flex flex-1 items-center justify-between text-[13px] whitespace-nowrap">
                    Collapse
                    <kbd className="rounded border border-edge px-1.5 font-mono text-[10.5px] leading-4 text-faint">[</kbd>
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          </Tip>
        )}
      </div>
    </>
  )
}

function Mark({ mark, className }: { mark: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('grid size-7 shrink-0 place-items-center rounded-md bg-fg font-sans text-[15px] leading-none text-ink', className)}
    >
      {mark}
    </span>
  )
}

/**
 * The film's name, and a menu of the others. Every film runs at once on this
 * machine (one worker each); this only changes which one the panel shows.
 */
function FilmSwitcher({ collapsed, films }: { collapsed: boolean; films: FilmLink[] }) {
  const project = useProject()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div ref={box} className="relative shrink-0 px-2 pt-4 pb-2">
      <Tip show={collapsed && !open} label={project.name} detail="Switch film">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn(
            'focus-ring flex h-12 w-full cursor-pointer items-center gap-3 overflow-hidden rounded-lg pr-2 pl-2',
            'transition-colors duration-150 hover:bg-white/[0.035]',
            open && 'bg-white/[0.035]',
          )}
        >
          <Mark mark={project.mark} />
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.span {...fade} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-[22px] leading-[1.05] text-fg">{project.name}</span>
                  <span className="block font-mono text-[10.5px] leading-4 tracking-[0.08em] text-faint">{project.code}</span>
                </span>
                <ChevronsUpDown aria-hidden strokeWidth={1.75} className="size-4 shrink-0 text-faint" />
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </Tip>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: EASE }}
            className={cn(
              'absolute top-full z-50 mt-1 w-60 origin-top-left overflow-hidden rounded-lg border border-edge-strong bg-raise p-1',
              'shadow-[0_18px_44px_-14px_rgba(0,0,0,0.9)]',
              collapsed ? 'left-2' : 'inset-x-2 w-auto',
            )}
          >
            <div className="px-2.5 pt-1.5 pb-1 font-mono text-[10.5px] tracking-[0.12em] text-faint uppercase">Films</div>
            {films.map((f) => {
              const here = f.slug === project.slug
              return (
                <Link
                  key={f.slug}
                  role="menuitem"
                  href={navHref(f.slug, '')}
                  onClick={() => setOpen(false)}
                  className="focus-ring flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-muted hover:bg-white/[0.05] hover:text-fg"
                >
                  <Mark mark={f.mark} className="size-5 text-[11px]" />
                  <span className={cn('flex-1 truncate', here && 'text-fg')}>{f.name}</span>
                  {here && <Check aria-hidden className="size-3.5 text-fg" />}
                </Link>
              )
            })}
            <div className="my-1 h-px bg-edge" />
            <Link
              role="menuitem"
              href="/"
              onClick={() => setOpen(false)}
              className="focus-ring flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-muted hover:bg-white/[0.05] hover:text-fg"
            >
              <LayoutList aria-hidden strokeWidth={1.75} className="size-4 text-faint" />
              All films, and start a new one
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function badgeText(b: NavBadge | undefined): string | undefined {
  if (!b) return undefined
  const parts = [b.count > 0 ? String(b.count) : null, b.alert ?? null].filter(Boolean)
  return parts.length ? parts.join(' · ') : undefined
}

/**
 * A white pill: something is waiting on you. A quiet number: how much is in
 * flight. A red dot beside either: something went wrong there.
 */
function Badge({ badge, collapsed }: { badge: NavBadge | undefined; collapsed: boolean }) {
  if (!badge || (badge.count === 0 && !badge.alert)) return null
  const text = badge.count > 99 ? '99+' : String(badge.count)
  const loud = badge.tone === 'needs-you'
  return (
    <>
      <span className="sr-only">
        {badge.count > 0 ? `, ${badge.count} ${loud ? 'waiting for you' : 'in the queue'}` : ''}
        {badge.alert ? `, ${badge.alert}` : ''}
      </span>
      {collapsed ? (
        <span
          aria-hidden
          className={cn(
            'absolute top-[7px] right-[9px] size-2 rounded-full ring-2 ring-ink',
            badge.alert ? 'bg-bad' : loud ? 'bg-fg' : 'bg-faint',
          )}
        />
      ) : (
        <span aria-hidden className="relative ml-auto flex items-center gap-1.5">
          {badge.alert && <span title={badge.alert} className="size-1.5 rounded-full bg-bad" />}
          {badge.count > 0 && (
            <span
              className={cn(
                'grid h-[18px] min-w-[18px] place-items-center rounded-full px-1.5 font-mono text-[10.5px] leading-none font-medium tabular-nums',
                loud ? 'bg-accent text-ink' : 'text-faint',
              )}
            >
              {text}
            </span>
          )}
        </span>
      )}
    </>
  )
}

function Dot({ tone, className }: { tone: WorkerSummary['tone']; className?: string }) {
  return (
    <span aria-hidden className={cn('relative grid size-2 shrink-0 place-items-center', className)}>
      {tone === 'busy' && <span className="absolute inset-0 animate-ping rounded-full bg-good/60" />}
      <span className={cn('relative size-2 rounded-full', TONE_DOT[tone])} />
    </span>
  )
}

/**
 * What the worker is doing, and how much of the account's credit window is
 * spent. The whole block opens the Queue page, where the detail lives.
 */
function WorkerPanel({ collapsed, worker, data }: { collapsed: boolean; worker: WorkerSummary; data: SidebarData }) {
  const project = useProject()
  const { spent, ceiling, hours } = data.spend
  const share = ceiling > 0 ? Math.min(1, spent / ceiling) : 0
  const near = share >= 0.9
  const credits = ceiling > 0
    ? `${Math.round(spent).toLocaleString('en-GB')} of ${ceiling.toLocaleString('en-GB')} credits · ${hours} h`
    : `${Math.round(spent).toLocaleString('en-GB')} credits in ${hours} h`

  return (
    <Tip show={collapsed} label={`${worker.headline} · ${worker.detail}`} detail={credits}>
      <Link
        href={navHref(project.slug, '/queue')}
        aria-label={`${worker.headline}, ${worker.detail}. ${credits}. Open the queue.`}
        className={cn(
          'focus-ring group block overflow-hidden rounded-lg transition-colors duration-150',
          collapsed ? 'grid h-10 place-items-center hover:bg-white/[0.035]' : 'lit border border-edge bg-panel px-3 pt-2.5 pb-3 hover:border-edge-strong',
        )}
      >
        {collapsed ? (
          <Dot tone={worker.tone} />
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Dot tone={worker.tone} />
              <span className="truncate text-[12.5px] text-fg">{worker.headline}</span>
            </div>
            <div
              className={cn('mt-0.5 truncate pl-4 text-[11.5px]', worker.tone === 'bad' ? 'text-bad' : 'text-faint', worker.tone === 'busy' && 'font-mono text-muted')}
              suppressHydrationWarning
            >
              {worker.detail}
            </div>
            <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-white/[0.07]">
              <div
                className={cn('h-full rounded-full transition-[width] duration-500', near ? 'bg-bad' : 'bg-fg/70')}
                style={{ width: `${Math.max(share * 100, spent > 0 ? 2 : 0)}%` }}
              />
            </div>
            <div className={cn('mt-1.5 font-mono text-[10.5px] tabular-nums', near ? 'text-bad' : 'text-faint')}>{credits}</div>
          </>
        )}
      </Link>
    </Tip>
  )
}

/** A label beside a collapsed rail's icon, on hover or keyboard focus. */
function Tip({ show, label, detail, children }: { show: boolean; label: string; detail?: string; children: React.ReactNode }) {
  const [on, setOn] = useState(false)
  return (
    <div
      className="relative"
      onMouseEnter={() => setOn(true)}
      onMouseLeave={() => setOn(false)}
      onFocus={() => setOn(true)}
      onBlur={() => setOn(false)}
    >
      {children}
      <AnimatePresence>
        {show && on && (
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
            {detail && <span className="ml-1.5 font-mono text-muted">{detail}</span>}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}
