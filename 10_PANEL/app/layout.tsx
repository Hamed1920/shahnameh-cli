import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: 'Shahnameh Review Panel',
  description: 'Review, accept and deny Higgsfield outputs for the Shahnameh project.',
}

const NAV = [
  { href: '/', label: 'Review' },
  { href: '/entities', label: 'Index' },
  { href: '/learnings', label: 'Learnings' },
  { href: '/queue', label: 'Queue' },
]

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-[var(--color-edge)] bg-[var(--color-panel)]">
          <div className="mx-auto flex max-w-[1600px] items-center gap-6 px-6 py-3">
            <span className="text-sm font-semibold tracking-wide text-[var(--color-accent)]">
              SHAHNAMEH
            </span>
            <nav className="flex gap-4 text-sm">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="text-[var(--color-muted)] transition-colors hover:text-white"
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] px-6 py-6">{children}</main>
      </body>
    </html>
  )
}
