import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { TakeMedia } from '@/components/take-media'
import { EmptyState } from '@/components/ui/card'
import { Badge, PageHeader, SectionHeading } from '@/components/ui/text'
import { assetToRef } from '@/lib/asset-ref'
import { getDecidedEntries } from '@/lib/decided'
import { portalActor } from '@/lib/portal'
import { requireProject } from '@/lib/projects'
import { refCovers, type ReleaseKind } from '@/lib/release-match'
import { CommentForm } from './comment-form'

export const dynamic = 'force-dynamic'

const when = (d: Date) => d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const MEDIA = /\.(mp4|mov|webm|png|jpe?g|webp)$/i

/**
 * One released item: its media, then the conversation. A take shows its own file; a shot or an
 * episode shows every accepted, filed take it covers, found with the same rule api/asset applies.
 */
export default async function ReleasePage({ params }: PageProps<'/client/[project]/[releaseId]'>) {
  const { project: slug, releaseId } = await params
  const actor = await portalActor(slug)
  const pr = await requireProject(slug)
  const { getRelease, listComments } = await import('@/lib/releases')
  const rel = await getRelease(releaseId)
  if (!rel || rel.projectSlug !== pr.slug || rel.revokedAt) notFound()

  const key = [{ kind: rel.kind as ReleaseKind, ref: rel.ref }]
  const entries = await getDecidedEntries(pr)
  const files = [...new Set(
    entries
      .filter((e) => e.decision.verdict === 'accepted' && e.file && MEDIA.test(e.file))
      .map((e) => e.file as string)
      .filter((f) => { const r = assetToRef(f); return r !== null && refCovers(key, r) }),
  )].sort()
  const comments = await listComments(rel.id)

  return (
    <div className="space-y-12">
      <div>
        <Link href={`/client/${pr.slug}`} className="focus-ring mb-5 inline-flex items-center gap-1.5 rounded text-[12.5px] text-muted transition-colors hover:text-fg">
          <ArrowLeft aria-hidden className="size-3.5" /> All released
        </Link>
        <PageHeader title={rel.label || rel.ref} eyebrow={`${rel.kind} · released ${when(rel.releasedAt)}`} />
      </div>

      <section>
        <SectionHeading count={files.length}>Watch</SectionHeading>
        {files.length === 0 ? (
          <EmptyState>Nothing to show for this yet.</EmptyState>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {files.map((f) => (
              <figure key={f} className="space-y-2">
                <TakeMedia file={f} alt={f.split('/').pop() ?? f} />
                <figcaption className="truncate font-mono text-[11px] text-faint">{f.split('/').pop()}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeading count={comments.length}>Comments</SectionHeading>
        {comments.length === 0 ? (
          <p className="mb-6 text-sm text-muted">No comments yet.</p>
        ) : (
          <ul className="mb-8 space-y-3">
            {comments.map((c) => (
              <li key={c.id} className="rounded-xl border border-edge bg-panel px-5 py-4">
                <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[12.5px]">
                  <span className="text-fg">{c.author}</span>
                  {c.verdict && <Badge tone={c.verdict === 'approve' ? 'good' : 'bad'}>{c.verdict === 'approve' ? 'approved' : 'rejected'}</Badge>}
                  <span className="ml-auto font-mono text-[11px] text-faint tabular-nums">{when(c.createdAt)}</span>
                </div>
                {c.body && <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-fg/90" dir="auto">{c.body}</p>}
              </li>
            ))}
          </ul>
        )}
        {actor.role === 'client' && <CommentForm project={pr.slug} releaseId={rel.id} />}
      </section>
    </div>
  )
}
