import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import { LiveRefresh } from '@/components/live-refresh'
import { SIDEBAR_COOKIE } from '@/components/nav-items'
import { ProjectProvider } from '@/components/project-context'
import { Sidebar } from '@/components/sidebar'
import { getProjectVersion } from '@/lib/live'
import { getProject, publicInfo } from '@/lib/projects'
import { getPending, getWaitingJobs } from '@/lib/store'

export async function generateMetadata({ params }: LayoutProps<'/[project]'>): Promise<Metadata> {
  const pr = await getProject((await params).project)
  return { title: pr ? `${pr.name} · Film Making for Dummies` : 'Film Making for Dummies' }
}

/**
 * One film's shell: its sidebar, its live refresh, its pages.
 *
 * An unknown project is a 404 rather than an empty panel -- a stale bookmark
 * from a renamed or removed project must not look like a project with nothing
 * in it.
 */
export default async function ProjectLayout({ children, params }: LayoutProps<'/[project]'>) {
  const pr = await getProject((await params).project)
  if (!pr) notFound()

  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === '1'
  // Taken with the render, so a change between render and mount is not missed.
  // queue.jsonl, state.json, the review log and every staging job.json are in the version,
  // so both badges move with every live refresh.
  const [version, waiting, pending] = await Promise.all([getProjectVersion(pr), getWaitingJobs(pr), getPending(pr)])

  return (
    <ProjectProvider project={publicInfo(pr)}>
      <LiveRefresh project={pr.slug} initialVersion={version}>
        <Sidebar defaultCollapsed={collapsed} counts={{ '/review': pending.length, '/queue': waiting.length }} />
        <main className="scroll-pane flex-1">
          <div className="mx-auto max-w-[1600px] px-6 pt-10 pb-24 lg:px-12">{children}</div>
        </main>
      </LiveRefresh>
    </ProjectProvider>
  )
}
