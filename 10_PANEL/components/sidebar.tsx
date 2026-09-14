'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion } from 'motion/react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { NAV, SIDEBAR_COOKIE, SIDEBAR_RAIL, SIDEBAR_WIDTH } from '@/components/nav-items'
import { EASE, SPRING } from '@/components/ui/motion-tokens'
import { cn } from '@/lib/cn'

/**
 * Collapsible icon rail.
 *
 * Geometry note: every row is inset 8px (mx-2) and pads 12px, so an icon sits
 * 20px from the aside edge and its centre lands at 30px — exactly half the
 * 60px rail. That is why the icons do not drift sideways as the rail
 * collapses; only the labels move.
 *
 * Lives in the root layout, which persists across client navigations, so the
 * rail never remounts or replays its animation when you change page.
 */
export function Sidebar({ defaultCollapsed }: { defaultCollapsed: boolean }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [hovered, setHovered] = useState<string | null>(null)
  const pathname = usePathname()

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
      className="glass relative z-20 flex h-full shrink-0 flex-col border-r border-edge"
      initial={false}
      animate={{ width: collapsed ? SIDEBAR_RAIL : SIDEBAR_WIDTH }}
      transition={SPRING}
    >
      <div className="flex h-14 shrink-0 items-center gap-3 overflow-hidden border-b border-edge pl-5">
        <span aria-hidden className="grid size-5 shrink-0 place-items-center">
          <span className="size-2.5 rotate-45 rounded-[2px] bg-linear-to-br from-accent-lit to-accent-deep shadow-[0_0_14px_rgba(201,162,39,0.55)]" />
        </span>
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -4 }}
              transition={{ duration: 0.15, ease: EASE }}
              className="text-sm font-semibold tracking-[0.14em] whitespace-nowrap text-accent"
            >
              SHAHNAMEH
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <nav aria-label="Sections" className="py-3">
        <ul className="space-y-0.5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
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
                    'focus-ring relative flex h-10 items-center gap-3 overflow-hidden rounded-lg px-3',
                    'transition-colors duration-150',
                    active ? 'text-fg' : 'text-muted hover:bg-raise hover:text-fg',
                  )}
                >
                  {active && (
                    <motion.span
                      aria-hidden
                      layoutId="nav-active"
                      transition={SPRING}
                      className={cn(
                        'absolute inset-0 rounded-lg ring-1 ring-accent/30 ring-inset',
                        'bg-linear-to-r from-accent/22 to-accent/8',
                        'shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_20px_-6px_rgba(201,162,39,0.6)]',
                      )}
                    />
                  )}
                  <Icon
                    aria-hidden
                    className={cn(
                      'relative size-5 shrink-0 transition-colors duration-150',
                      active && 'text-accent',
                    )}
                  />
                  <AnimatePresence initial={false}>
                    {!collapsed && (
                      <motion.span
                        initial={{ opacity: 0, x: -4 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -4 }}
                        transition={{ duration: 0.15, ease: EASE }}
                        className="relative text-sm font-medium whitespace-nowrap"
                      >
                        {label}
                      </motion.span>
                    )}
                  </AnimatePresence>
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
                        'pointer-events-none absolute top-1/2 left-full z-50 ml-2',
                        'rounded-md border border-edge bg-raise px-2.5 py-1.5',
                        'text-xs whitespace-nowrap text-fg shadow-lg shadow-black/50',
                      )}
                    >
                      {label}
                    </motion.span>
                  )}
                </AnimatePresence>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="mt-auto border-t border-edge p-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'focus-ring flex h-10 w-full cursor-pointer items-center gap-3 overflow-hidden rounded-lg px-3',
            'text-muted transition-colors duration-150 hover:bg-raise hover:text-fg',
          )}
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden className="size-5 shrink-0" />
          ) : (
            <PanelLeftClose aria-hidden className="size-5 shrink-0" />
          )}
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -4 }}
                transition={{ duration: 0.15, ease: EASE }}
                className="text-sm whitespace-nowrap"
              >
                Collapse
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </motion.aside>
  )
}
