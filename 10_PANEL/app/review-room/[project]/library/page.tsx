import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { SignOutButton } from '@/components/sign-out-button'
import { Badge } from '@/components/ui/text'
import { authEnabled, Forbidden } from '@/lib/actor-core'
import { requireCan } from '@/lib/actor'
import { CATEGORY_LABEL, CATEGORY_ORDER, REVIEW_LABEL } from '@/lib/pd-category'
import { getProject } from '@/lib/projects'
import { isBlocks } from '@/lib/structure'
import { DecisionForm } from './decision-form'

export const dynamic = 'force-dynamic'

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const TONE = { presented: 'accent', selected: 'accent', revision_requested: 'bad', approved: 'good' } as const

/**
 * The director's library: only the asset versions production sent, grouped by category, each with
 * Select, Request revision (a note is required) and Approve. The director and the owner. The script
 * supervisor has no part in the library review, so for them this page does not exist. The pictures
 * come from the review-media route by review id; no file path is on this page.
 */
export default async function LibraryReviewPage({ params }: PageProps<'/review-room/[project]/library'>) {
  if (!authEnabled()) notFound()
  const pr = await getProject((await params).project)
  if (!pr || !isBlocks(pr)) notFound()
  const { sessionActor } = await import('@/lib/auth/session')
  const actor = await sessionActor()
  if (!actor) redirect('/login')
  try {
    await requireCan(pr.slug, 'asset.review')
  } catch (e) {
    if (e instanceof Forbidden) notFound()
    throw e
  }

  const { getDirectorLibrary } = await import('@/lib/pd-library')
  const items = await getDirectorLibrary(pr)
  const byCategory = CATEGORY_ORDER.map((c) => ({ c, items: items.filter((i) => i.asset.category === c) })).filter((g) => g.items.length > 0)

  return (
    <main className="scroll-pane flex-1">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow text-faint">{pr.name}</p>
            <h1 className="mt-2 font-display text-[32px] leading-none text-fg">Library review</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/review-room/${pr.slug}`} className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg">
              <ArrowLeft aria-hidden className="size-3.5" /> Review room
            </Link>
            <SignOutButton name={actor.name} />
          </div>
        </header>

        {byCategory.length === 0 ? (
          <p className="mt-12 rounded-xl border border-dashed border-edge-strong/70 px-8 py-14 text-center text-sm text-muted">
            Nothing has been sent to you yet.
          </p>
        ) : (
          byCategory.map(({ c, items: list }) => (
            <section key={c} className="mt-10" data-category={c}>
              <h2 className="eyebrow text-fg/85">{CATEGORY_LABEL[c]} <span className="ml-1 font-mono text-faint">{list.length}</span></h2>
              <ul className="mt-4 space-y-5">
                {list.map(({ review: r, asset: a }) => (
                  <li key={r.id} className="lit rounded-xl border border-edge bg-panel p-4 sm:flex sm:gap-5" data-review={r.id}>
                    <a href={`/${pr.slug}/api/asset-review-media/${r.id}`} target="_blank" rel="noreferrer" className="block shrink-0 sm:w-72">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/${pr.slug}/api/asset-review-media/${r.id}`} alt={`${a.name} ${r.variant}`} loading="lazy"
                        className="aspect-[4/3] w-full rounded-lg bg-sunken object-contain" />
                    </a>
                    <div className="mt-4 min-w-0 flex-1 sm:mt-0">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <h3 className="font-display text-[22px] leading-none text-fg" dir="auto">{a.name}</h3>
                        <span className="font-mono text-[11.5px] text-muted">{a.shortId} {r.variant}</span>
                        <Badge tone={TONE[r.status]}>{REVIEW_LABEL[r.status]}</Badge>
                        {a.isMain ? <Badge tone="accent">Main look</Badge> : null}
                      </div>
                      {a.description ? <p className="mt-2 text-[13px] text-muted" dir="auto">{a.description}</p> : null}
                      <p className="mt-2 text-[12px] text-faint">Sent by {r.presentedBy}, {when(r.presentedAt)}</p>
                      {r.directorNotes ? (
                        <p className="mt-3 rounded-md border border-edge bg-sunken px-2.5 py-2 text-[13px] text-fg/90" dir="auto">
                          {r.directorNotes}
                          {r.decidedBy && r.decidedAt ? <span className="mt-1 block text-[11.5px] text-faint">{r.decidedBy}, {when(r.decidedAt)}</span> : null}
                        </p>
                      ) : null}
                      {r.status === 'presented' || r.status === 'selected' ? (
                        <DecisionForm project={pr.slug} reviewId={r.id} status={r.status} canMakeMain={!a.isMain} />
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </main>
  )
}
