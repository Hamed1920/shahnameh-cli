import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ProjectProvider } from '@/components/project-context'
import { SignOutButton } from '@/components/sign-out-button'
import { portalActor } from '@/lib/portal'
import { getProject, publicInfo } from '@/lib/projects'

export const metadata: Metadata = { title: 'Film Making for Dummies' }

/**
 * The client portal's shell: the film's name and a way out. No sidebar, no live refresh (that
 * polls a staff route): the portal is static until a person reloads or acts.
 */
export default async function ClientLayout({ children, params }: LayoutProps<'/client/[project]'>) {
  const slug = (await params).project
  const actor = await portalActor(slug)
  const pr = await getProject(slug)
  if (!pr) notFound()

  return (
    <ProjectProvider project={publicInfo(pr)}>
      <main className="scroll-pane flex-1">
        <div className="mx-auto max-w-5xl px-6 pt-8 pb-24 lg:px-12">
          <div className="flex items-center justify-between gap-4 border-b border-edge pb-5">
            <span className="font-display text-[24px] leading-none text-fg">{pr.name}</span>
            <SignOutButton name={actor.name} />
          </div>
          <div className="pt-10">{children}</div>
        </div>
      </main>
    </ProjectProvider>
  )
}
