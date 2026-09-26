import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import { CatalogSync } from '@/components/catalog-sync'
import { LiveRefresh } from '@/components/live-refresh'
import { SIDEBAR_COOKIE } from '@/components/nav-items'
import { ProjectProvider } from '@/components/project-context'
import { Sidebar } from '@/components/sidebar'
import { freshCatalog } from '@/lib/catalog'
import { getProjectVersion } from '@/lib/live'
import { getProject, listProjects, publicInfo } from '@/lib/projects'
import { getSidebarData } from '@/lib/sidebar'

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
  // queue.jsonl, state.json, the review log, the lock and every staging job.json are
  // in the version, so the badges and the worker line move with every live refresh.
  const [version, sidebar, films] = await Promise.all([getProjectVersion(pr), getSidebarData(pr), listProjects()])

  return (
    <ProjectProvider project={publicInfo(pr)}>
      <CatalogSync catalog={freshCatalog()}>
        <LiveRefresh project={pr.slug} initialVersion={version}>
          {/* A row beside the rail on a wide screen; a column under the top bar on a narrow one. */}
          <div className="flex h-full min-w-0 flex-1 flex-col lg:flex-row">
            <Sidebar
              defaultCollapsed={collapsed}
              data={sidebar}
              films={films.map((f) => ({ slug: f.slug, name: f.name, mark: f.mark }))}
            />
            {/* A size container, so a page's sticky bar can bleed to its full width (StickyHeader). */}
            <main className="scroll-pane @container min-h-0 flex-1">
              <div className="mx-auto max-w-[1600px] px-4 pt-8 pb-24 sm:px-6 lg:px-12 lg:pt-10">{children}</div>
            </main>
          </div>
        </LiveRefresh>
      </CatalogSync>
    </ProjectProvider>
  )
}
