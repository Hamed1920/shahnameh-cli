import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

export interface Crumb {
  label: string
  /** Absent on the page you are on. */
  href?: string
}

/** Project / Sequence / Block. The last crumb is the current page. */
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-5">
      <ol className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
        {items.map((c, i) => {
          const last = i === items.length - 1
          return (
            <li key={`${i}-${c.label}`} className="flex items-center gap-1.5">
              {c.href && !last ? (
                <Link href={c.href} className="focus-ring rounded transition-colors hover:text-fg">{c.label}</Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className={last ? 'text-fg' : undefined}>{c.label}</span>
              )}
              {!last && <ChevronRight aria-hidden className="size-3 text-faint" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
