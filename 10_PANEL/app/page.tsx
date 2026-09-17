import Link from 'next/link'
import { Logo } from '@/components/logo'
import { listProjects } from '@/lib/projects'
import { getWaitingJobs } from '@/lib/store'
import { NewProjectForm } from './new-project-form'

export const dynamic = 'force-dynamic'

/**
 * The project picker: which film do you want to work on?
 *
 * Everything below this page belongs to one project. The system is the same for
 * all of them -- same folders, same ID rules, same review loop -- so starting
 * another one is filling in a name, not setting anything up.
 */
export default async function ProjectsPage() {
  const projects = await listProjects()
  const waiting = await Promise.all(
    projects.map(async (p) => {
      try { return (await getWaitingJobs(p)).length } catch { return 0 }
    }),
  )
  const taken = { slugs: projects.map((p) => p.slug), codes: projects.map((p) => p.code) }

  return (
    <main className="scroll-pane flex-1">
      <div className="mx-auto max-w-3xl px-6 pt-20 pb-24">
        <header className="flex items-center gap-4">
          <Logo className="size-11 text-fg" />
          <div>
            <h1 className="font-display text-[34px] leading-none text-fg">Film Making for Dummies</h1>
            <p className="mt-2 text-[13px] text-muted">
              Every film is its own project: its own cast, places and props, its own prompts and renders.
              Pick one to carry on, or start another.
            </p>
          </div>
        </header>

        <section className="mt-12">
          <h2 className="eyebrow mb-4 text-muted">Your projects</h2>
          {projects.length === 0 ? (
            <p className="rounded-xl border border-dashed border-edge-strong p-6 text-[13px] text-muted">
              No projects yet. Start the first one below.
            </p>
          ) : (
            <ul className="space-y-3">
              {projects.map((p, i) => (
                <li key={p.slug}>
                  <Link
                    href={`/${p.slug}`}
                    className="focus-ring group flex items-center gap-4 rounded-xl border border-edge bg-panel p-5 transition-colors duration-150 hover:border-edge-strong"
                  >
                    <span
                      aria-hidden
                      className="grid size-10 shrink-0 place-items-center rounded-lg bg-fg font-sans text-[19px] leading-none text-ink"
                    >
                      {p.mark}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2.5">
                        <span className="font-display text-[22px] leading-none text-fg">{p.name}</span>
                        <span className="font-mono text-[11px] text-faint">{p.code}</span>
                      </span>
                      {p.description && (
                        <span className="mt-1.5 block max-w-xl truncate text-[13px] text-muted">{p.description}</span>
                      )}
                    </span>
                    {waiting[i] > 0 && (
                      <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 font-mono text-[11px] leading-5 text-ink tabular-nums">
                        {waiting[i]} queued
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <NewProjectForm taken={taken} />
      </div>
    </main>
  )
}
