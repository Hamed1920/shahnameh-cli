import Link from 'next/link'
import { notFound } from 'next/navigation'
import { EmptyState } from '@/components/ui/card'
import { Badge, PageHeader } from '@/components/ui/text'
import { authEnabled, Forbidden } from '@/lib/actor-core'
import { requireCan } from '@/lib/actor'
import { assetUrl, thumbUrl } from '@/lib/asset'
import { cn } from '@/lib/cn'
import { CATEGORY_LABEL, CATEGORY_ORDER, REVIEW_LABEL, groupByCategory, type Category } from '@/lib/pd-category'
import { requireProject } from '@/lib/projects'
import { isBlocks } from '@/lib/structure'
import { PresentButton } from './present-button'

export const dynamic = 'force-dynamic'

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const TONE = { presented: 'accent', selected: 'accent', revision_requested: 'bad', approved: 'good' } as const

/**
 * The pre-production library of a Sequence / Block project, for the people who make the film.
 * Characters, Locations, References and States, each asset with its versions, what the director
 * said about each, and where it is used. Files and versions are added on the References page and
 * the studio, as always; here a finished version is sent to the director.
 */
export default async function LibraryPage({ params, searchParams }: PageProps<'/[project]/library'>) {
  const pr = await requireProject((await params).project)
  if (!isBlocks(pr) || !authEnabled()) notFound()
  let canPresent = false
  try {
    await requireCan(pr.slug, 'view.drafts')
    try {
      await requireCan(pr.slug, 'asset.present')
      canPresent = true
    } catch (e) {
      if (!(e instanceof Forbidden)) throw e
    }
  } catch (e) {
    if (e instanceof Forbidden) notFound()
    throw e
  }

  const { getProductionLibrary } = await import('@/lib/pd-library')
  const groups = groupByCategory(await getProductionLibrary(pr))
  const asked = (await searchParams).c
  const tabs = CATEGORY_ORDER.filter((c) => c !== 'other')
  const current: Category = (CATEGORY_ORDER as string[]).includes(String(asked)) ? (asked as Category) : 'characters'

  const assets = groups[current]
  return (
    <div className="space-y-8">
      <PageHeader title="Library" eyebrow={`Pre-production · ${pr.code}`}>
        Characters, locations, references and states. Add or revise a look on the{' '}
        <Link href={`/${pr.slug}/references`} className="underline underline-offset-2 hover:text-fg">References page</Link>
        ; a revised look is a new version and the old one stays. Send a finished version to the director from here.
      </PageHeader>

      <nav aria-label="Categories" className="flex flex-wrap items-center gap-1.5">
        {tabs.map((c) => (
          <Link
            key={c}
            href={`/${pr.slug}/library?c=${c}`}
            aria-current={c === current ? 'page' : undefined}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-[13px] transition-colors',
              c === current ? 'border-edge-strong bg-raise text-fg' : 'border-edge text-muted hover:text-fg',
            )}
          >
            {CATEGORY_LABEL[c]} <span className="ml-1 font-mono text-[11px] text-faint">{groups[c].length}</span>
          </Link>
        ))}
        <Link
          href={`/${pr.slug}/library?c=other`}
          aria-current={current === 'other' ? 'page' : undefined}
          className={cn('ml-auto rounded-lg border border-dashed px-3 py-1.5 text-[12px] transition-colors',
            current === 'other' ? 'border-edge-strong bg-raise text-fg' : 'border-edge text-faint hover:text-fg')}
        >
          Other <span className="ml-1 font-mono text-[11px]">{groups.other.length}</span>
        </Link>
      </nav>

      {assets.length === 0 ? (
        <EmptyState>
          Nothing in {CATEGORY_LABEL[current]} yet. Add it on the{' '}
          <Link href={`/${pr.slug}/references`} className="underline underline-offset-2">References page</Link>.
        </EmptyState>
      ) : (
        <ul className="space-y-6">
          {assets.map((a) => (
            <li key={a.id} className="lit rounded-xl border border-edge bg-panel p-5" data-asset={a.id}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="font-display text-[22px] leading-none text-fg" dir="auto">{a.name}</h3>
                <span className="font-mono text-[11.5px] text-muted">{a.id}</span>
                <Badge tone={a.status === 'APPROVED' || a.status === 'LOCKED' ? 'good' : 'muted'}>{a.status}</Badge>
              </div>
              {a.description ? <p className="mt-2 line-clamp-2 max-w-3xl text-[13px] text-muted" dir="auto">{a.description}</p> : null}
              <p className="mt-2 text-[12px] text-faint">
                {a.usedIn.length ? <>Used in <span className="font-mono">{a.usedIn.join(', ')}</span></> : 'Not used in any block yet'}
              </p>

              {a.versions.length === 0 ? (
                <p className="mt-4 text-[13px] text-faint">No picture filed yet.</p>
              ) : (
                <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4">
                  {a.versions.map((v) => (
                    <figure key={v.variant} className="rounded-lg border border-edge bg-sunken p-2.5" data-version={`${a.id}/${v.variant}`}>
                      <a href={assetUrl(pr.slug, v.path)} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={thumbUrl(pr.slug, v.path, 360)} alt={`${a.name} ${v.variant}`} loading="lazy"
                          className="aspect-[4/3] w-full rounded-md bg-ink object-cover" />
                      </a>
                      <figcaption className="mt-2 space-y-1.5 text-[12px]">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-fg">{v.variant}</span>
                          {v.isMain ? <Badge tone="accent">Main look</Badge> : null}
                          {v.review ? <Badge tone={TONE[v.review.status]}>{REVIEW_LABEL[v.review.status]}</Badge> : null}
                        </div>
                        <div className="text-faint">
                          {v.registryStatus} · {v.role}{v.added ? ` · ${v.added}` : ''}{v.source && v.source !== 'unknown' ? ` · ${v.source}` : ''}
                        </div>
                        {v.review ? (
                          <div className="text-faint">
                            Sent by {v.review.presentedBy}, {when(v.review.presentedAt)}
                            {v.review.decidedBy && v.review.decidedAt ? <> · {v.review.decidedBy}, {when(v.review.decidedAt)}</> : null}
                          </div>
                        ) : null}
                        {v.review?.directorNotes ? (
                          <p className="rounded-md border border-edge bg-panel px-2 py-1.5 text-fg/90" dir="auto">
                            <span className="eyebrow mb-0.5 block text-faint">Director</span>
                            {v.review.directorNotes}
                          </p>
                        ) : null}
                        {canPresent && (!v.review || v.review.status === 'revision_requested') ? (
                          <PresentButton project={pr.slug} entityId={a.id} variant={v.variant} />
                        ) : null}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
