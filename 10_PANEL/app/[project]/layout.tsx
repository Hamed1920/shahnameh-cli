import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { CatalogSync } from '@/components/catalog-sync'
import { LiveRefresh } from '@/components/live-refresh'
import { SIDEBAR_COOKIE } from '@/components/nav-items'
import { ProjectProvider } from '@/components/project-context'
import { Sidebar } from '@/components/sidebar'
import { authEnabled } from '@/lib/actor-core'
import { getActivity, jobLabel } from '@/lib/activity'
import { freshCatalog } from '@/lib/catalog'
import { getProjectVersion } from '@/lib/live'
import { getProject, publicInfo } from '@/lib/projects'
import { isBlocks } from '@/lib/structure'
import { getGeneratingJobIds, getLearnings, getPending, getQueue, getWaitingJobs, getWorkerState, getWorkerStatus } from '@/lib/store'

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

  // A Sequence / Block project keeps its structure in the database, so it cannot run without login.
  if (isBlocks(pr) && !authEnabled()) {
    return (
      <main className="scroll-pane flex-1">
        <div className="mx-auto max-w-xl px-6 pt-24">
          <h1 className="font-display text-[28px] text-fg">This project needs login</h1>
          <p className="mt-3 text-[14px] text-muted">
            {pr.name} is organised in sequences and blocks, which live in the database. Start the panel with SHM_AUTH=on to open it.
          </p>
        </div>
      </main>
    )
  }

  // Login on only: the name beside Sign out. Off: null, and the sidebar shows no sign-out.
  let signedInAs: string | null = null
  let showApprovals = false
  if (authEnabled()) {
    const actor = await (await import('@/lib/auth/session')).sessionActor()
    signedInAs = actor?.name ?? null
    // The director and the script supervisor have one place: the review area. Staff pages are not theirs.
    if (actor?.role === 'director' || actor?.role === 'supervisor') redirect(`/review-room/${pr.slug}`)
    // The approvals inbox is the owner's.
    showApprovals = actor?.role === 'owner'
  }
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === '1'
  // Taken with the render, so a change between render and mount is not missed.
  // queue.jsonl, state.json, the review log, the worker lock and every staging job.json are
  // in the version, so the badges and the worker dot move with every live refresh. The
  // reads go through the store's per-render cache: the page below costs no more for them.
  const [version, waiting, pending, activity, worker, state, learnings, queue] = await Promise.all([
    getProjectVersion(pr), getWaitingJobs(pr), getPending(pr), getActivity(pr),
    getWorkerStatus(pr), getWorkerState(pr), getLearnings(pr), getQueue(pr),
  ])
  const processed = new Set((state?.processedJobs ?? []) as string[])
  const heldIds = new Set(Object.keys((state?.held ?? {}) as Record<string, unknown>))
  // Several generate at once: name the first, count the rest.
  const generatingIds = [...(await getGeneratingJobIds(pr, processed))]
  const firstLabel = generatingIds.length ? jobLabel(queue.find((q) => q.jobId === generatingIds[0])?.target) : null
  const generating = firstLabel && generatingIds.length > 1 ? `${firstLabel} +${generatingIds.length - 1}` : firstLabel

  return (
    <ProjectProvider project={publicInfo(pr)}>
      <CatalogSync catalog={freshCatalog()}>
        <LiveRefresh project={pr.slug} initialVersion={version}>
          <Sidebar
            defaultCollapsed={collapsed}
            counts={{
              '/review': pending.length,
              '/queue': waiting.length,
              '/learnings': learnings.filter((l) => l.status === 'proposed').length,
            }}
            activity={activity}
            worker={worker}
            generating={generating}
            signedInAs={signedInAs}
            showApprovals={showApprovals}
            held={waiting.filter((q) => heldIds.has(q.jobId)).length}
          />
          {/* A size container, so a page's sticky bar can bleed to its full width (StickyHeader). */}
          <main className="scroll-pane @container flex-1">
            {/* Wide, but not edge to edge: about 1840px, so a big screen keeps a margin and a long line stays readable. */}
            <div className="mx-auto max-w-[1840px] px-6 pt-10 pb-24 lg:px-12">{children}</div>
          </main>
        </LiveRefresh>
      </CatalogSync>
    </ProjectProvider>
  )
}
