'use client'

import { useEffect } from 'react'
import { ProblemPage } from '@/components/problem-page'
import { Button } from '@/components/ui/button'

/**
 * The panel itself could not be drawn: the film list, or a film's shell (its
 * sidebar). Pages inside a film have their own, which keeps the sidebar
 * (app/[project]/error.tsx).
 */
export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error) }, [error])
  return (
    <main className="scroll-pane flex-1 px-4 sm:px-6">
      <ProblemPage
        eyebrow="Something went wrong"
        title="The panel could not be drawn"
        detail={[error.message, error.digest && `digest ${error.digest}`].filter(Boolean).join(' · ')}
        actions={<Button type="button" tone="accent" onClick={() => retry()}>Try again</Button>}
      >
        <p>
          Nothing you sent to the worker is lost, and the workers keep running without the page. Try again in a
          moment; if it keeps happening, the small print below says what broke.
        </p>
      </ProblemPage>
    </main>
  )
}
