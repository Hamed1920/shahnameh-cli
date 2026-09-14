'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion } from 'motion/react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { NAV, SIDEBAR_COOKIE, SIDEBAR_RAIL, SIDEBAR_WIDTH } from '@/components/nav-items'
import { EASE, SPRING } from '@/components/ui/motion-tokens'
import { cn } from '@/lib/cn'

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
      className="relative z-20 flex h-full shrink-0 flex-col border-r border-edge bg-ink"
      initial={false}
      animate={{ width: collapsed ? SIDEBAR_RAIL : SIDEBAR_WIDTH }}
      transition={SPRING}
    >
      <div className="flex h-18 shrink-0 items-center gap-3 overflow-hidden pl-[18px]">
        <span
          aria-hidden
          className="grid size-6 shrink-0 place-items-center rounded-md bg-fg font-sans text-[15px] leading-none text-ink"
        >
          ش
        </span>
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.span {...fade} className="font-display text-[22px] leading-none whitespace-nowrap text-fg">
              Shahnameh
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <nav aria-label="Sections" className="pt-2">
        <ul className="space-y-px">
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
                      className="absolute inset-0 rounded-md bg-white/[0.07]"
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
                    </motion.span>
                  )}
                </AnimatePresence>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="mt-auto p-2 pb-3">
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
    </motion.aside>
  )
}
