import Link from 'next/link'
import { ProblemPage } from '@/components/problem-page'
import { buttonClasses } from '@/components/ui/button-styles'

/**
 * Inside a film, something the address names is not there: an episode that
 * was never started, or a link from before a rename. The sidebar stays.
 */
export default function ProjectNotFound() {
  return (
    <ProblemPage
      eyebrow="Not here"
      title="Nothing at this address"
      actions={<Link href="/" className={buttonClasses({ tone: 'outline' })}>All films</Link>}
    >
      <p>
        What this link points to is not in the film: it may have been renamed, taken out, or never started.
        Nothing is ever deleted from the index, so the sidebar will find it under its new place.
      </p>
    </ProblemPage>
  )
}
