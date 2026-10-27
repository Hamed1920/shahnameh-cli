import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { SignOutButton } from '@/components/sign-out-button'

/** The review room's header: project, where you are, a way back, sign out. */
export function ReviewHeader({ project, title, eyebrow, back, name, children }: {
  project: string
  title: string
  eyebrow: string
  back?: { href: string; label: string }
  name: string
  children?: React.ReactNode
}) {
  void project
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="eyebrow text-faint">{eyebrow}</p>
        <h1 className="mt-2 font-display text-[32px] leading-none text-fg" dir="auto">{title}</h1>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        {back && (
          <Link href={back.href} className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg">
            <ArrowLeft aria-hidden className="size-3.5" /> {back.label}
          </Link>
        )}
        <SignOutButton name={name} />
      </div>
    </header>
  )
}
