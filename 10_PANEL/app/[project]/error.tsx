'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ProblemPage } from '@/components/problem-page'
import { Button } from '@/components/ui/button'
import { buttonClasses } from '@/components/ui/button-styles'

/**
 * A page of the film that crashed while drawing. The sidebar stays, so every
 * other page is a click away, and nothing sent to the worker is lost: requests
 * are files it has already been given.
 */
export default function ProjectError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { project } = useParams<{ project: string }>()
  useEffect(() => { console.error(error) }, [error])
  return (
    <ProblemPage
      eyebrow="Something went wrong"
      title="This page could not be drawn"
      detail={[error.message, error.digest && `digest ${error.digest}`].filter(Boolean).join(' · ')}
      actions={
        <>
          <Button type="button" tone="accent" onClick={() => retry()}>Try again</Button>
          <Link href={`/${project}/queue`} className={buttonClasses({ tone: 'outline' })}>Open the queue</Link>
        </>
      }
    >
      <p>
        Nothing you sent to the worker is lost: prompts, decisions and changes are saved the moment you send them,
        and the worker carries on without this page.
      </p>
      <p>Try again in a moment. If it keeps happening, the small print below says what broke.</p>
    </ProblemPage>
  )
}
