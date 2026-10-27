import { notFound, redirect } from 'next/navigation'
import { SignOutButton } from '@/components/sign-out-button'
import { authEnabled } from '@/lib/actor-core'
import { getProject } from '@/lib/projects'

export const dynamic = 'force-dynamic'

/**
 * The director's and the script supervisor's place. A placeholder until the review area is
 * built; it exists so the redirect from the project pages has somewhere to land. Login on only.
 */
export default async function ReviewRoomPage({ params }: PageProps<'/review-room/[project]'>) {
  if (!authEnabled()) notFound()
  const pr = await getProject((await params).project)
  if (!pr) notFound()
  const { sessionActor } = await import('@/lib/auth/session')
  const actor = await sessionActor()
  if (!actor) redirect('/login')

  return (
    <main className="scroll-pane flex-1">
      <div className="mx-auto max-w-xl px-6 pt-24">
        <p className="eyebrow text-faint">{pr.name}</p>
        <h1 className="mt-3 font-display text-[28px] text-fg">The review area is being built</h1>
        <div className="mt-6">
          <SignOutButton name={actor.name} />
        </div>
      </div>
    </main>
  )
}
