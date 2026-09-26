import type { ReactNode } from 'react'

/**
 * The page shown instead of one that could not be drawn: a crash (error.tsx)
 * or something that is not there (not-found.tsx). Says what happened in plain
 * words and what to do, never a stack trace.
 */
export function ProblemPage({ eyebrow, title, children, actions, detail }: {
  eyebrow: string
  title: string
  children: ReactNode
  actions: ReactNode
  /** Small print for whoever fixes it: the error's message and its digest. */
  detail?: string | null
}) {
  return (
    <div className="mx-auto max-w-xl py-16 sm:py-24">
      <div className="eyebrow text-faint">{eyebrow}</div>
      <h1 className="mt-4 font-display text-[52px] leading-[0.95] text-fg">{title}</h1>
      <div className="mt-6 space-y-3 text-[15px] leading-relaxed text-muted">{children}</div>
      <div className="mt-8 flex flex-wrap gap-3">{actions}</div>
      {detail && (
        <p className="mt-10 border-t border-edge pt-4 font-mono text-[11px] leading-relaxed break-words text-faint">{detail}</p>
      )}
    </div>
  )
}
