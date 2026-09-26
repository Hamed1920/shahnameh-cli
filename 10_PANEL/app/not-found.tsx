import Link from 'next/link'
import { ProblemPage } from '@/components/problem-page'
import { buttonClasses } from '@/components/ui/button-styles'

/** No film by that name on this machine: a stale bookmark, or a project that was renamed. */
export default function NotFound() {
  return (
    <main className="scroll-pane flex-1 px-4 sm:px-6">
      <ProblemPage
        eyebrow="Not here"
        title="No such film"
        actions={<Link href="/" className={buttonClasses({ tone: 'accent' })}>See all films</Link>}
      >
        <p>
          There is no film at this address on this computer. It may have a new name, or its folder may not have
          been pulled onto this machine yet.
        </p>
      </ProblemPage>
    </main>
  )
}
