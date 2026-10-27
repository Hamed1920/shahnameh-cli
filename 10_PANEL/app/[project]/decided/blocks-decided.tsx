import Link from 'next/link'
import { StatusLabel } from '../sequences/status'
import { Breadcrumb } from '@/components/breadcrumb'
import { EmptyState } from '@/components/ui/card'
import { Badge, PageHeader, SectionHeading } from '@/components/ui/text'
import { cn } from '@/lib/cn'
import {
  buildTree, creatorsOf, projectCounts, viewGenerations, viewOf, VIEWS,
  type Counts, type TreeBlock, type TreeFilters, type TreeGeneration,
} from '@/lib/decided-tree'
import { BLOCK_STATUS_LABEL, type BlockStatus } from '@/lib/pd/status'
import type { Project } from '@/lib/projects'
import type { Actor } from '@/lib/actor-core'

const STATUSES = Object.keys(BLOCK_STATUS_LABEL) as BlockStatus[]
const one = (v: string | string[] | undefined) => String(Array.isArray(v) ? v[0] : v ?? '').trim()
const day = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '')

function CountsLine({ c }: { c: Counts }) {
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[12px] text-muted tabular-nums">
      <span>{c.total} block{c.total === 1 ? '' : 's'}</span>
      <span>{c.ready} ready for review</span>
      <span className={c.revision ? 'text-bad' : undefined}>{c.revision} revision needed</span>
      <span className={c.final ? 'text-good' : undefined}>{c.final} final</span>
    </span>
  )
}

const VERDICT_TONE = { accepted: 'good', denied: 'bad', discarded: 'muted', pending: 'accent' } as const

function GenerationRow({ g, view }: { g: TreeGeneration; view: string }) {
  return (
    <li data-generation={g.gLabel} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
      <span className="font-mono text-[12.5px] text-fg">{g.gLabel}</span>
      <Badge tone={VERDICT_TONE[g.verdict]}>{g.verdict === 'pending' ? 'not decided' : g.verdict}</Badge>
      {g.isFinal && <Badge tone="good">Final</Badge>}
      {g.rounds.map((r) => (
        <span key={r.round} className="font-mono text-[12px] text-muted">
          Round {r.round} · {r.status === 'revision_requested' ? 'revision' : r.status}
        </span>
      ))}
      {view === 'all' && g.rounds.length === 0 && <span className="text-[12px] text-faint">never sent</span>}
      <span className="ml-auto font-mono text-[11px] text-faint tabular-nums">
        {g.createdBy ? `${g.createdBy} · ` : ''}{g.createdAt.slice(0, 16).replace('T', ' ')}
      </span>
    </li>
  )
}

async function BlockDetail({ pr, actor, b, view, href }: {
  pr: Project; actor: Actor; b: TreeBlock; view: string; href: (over: Record<string, string>) => string
}) {
  const { productionReview } = await import('@/lib/pd-review')
  const review = await productionReview(b.id, actor.id)
  const notes = review.submissions.flatMap((s) => s.notes)
  const by = { open: 0, in_progress: 0, resolved: 0 }
  for (const n of notes) by[n.resolutionStatus]++
  const shown = viewGenerations(b.generations, viewOf(view))
  return (
    <section className="space-y-6" data-block-detail={b.id}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-mono text-[15px] text-fg">{b.id}</h2>
        <span className="text-[15px] text-fg/90" dir="auto">{b.title}</span>
        <StatusLabel status={b.status} />
        <Link href={`/${pr.slug}/sequences/${b.sequenceId}/${b.id}`} className="focus-ring ml-auto text-[13px] text-accent hover:underline">
          Open the block workspace
        </Link>
      </div>

      <div role="tablist" aria-label="Views of this block" className="flex flex-wrap gap-1.5">
        {VIEWS.map((v) => {
          const n = viewGenerations(b.generations, v.id).length
          return (
            <Link
              key={v.id}
              role="tab"
              aria-selected={viewOf(view) === v.id}
              href={href({ block: b.id, view: v.id })}
              className={cn(
                'focus-ring inline-flex h-7 items-center rounded-full border px-3 text-[12.5px] transition',
                viewOf(view) === v.id ? 'border-accent bg-accent/8 text-fg' : 'border-edge text-muted hover:border-edge-strong',
              )}
            >
              {v.label}<span className="ml-1.5 font-mono text-faint tabular-nums">{n}</span>
            </Link>
          )
        })}
      </div>

      {shown.length === 0 ? (
        <EmptyState>Nothing in this view.</EmptyState>
      ) : (
        <ul className="divide-y divide-edge rounded-xl border border-edge bg-panel">
          {shown.map((g) => <GenerationRow key={g.id} g={g} view={view} />)}
        </ul>
      )}

      <div>
        <SectionHeading count={notes.length}>Feedback</SectionHeading>
        {notes.length === 0 ? (
          <p className="text-[13px] text-muted">No notes on this block yet.</p>
        ) : (
          <div className="space-y-3">
            <p className="flex flex-wrap gap-x-4 font-mono text-[12px] text-muted tabular-nums">
              <span>{by.open} open</span><span>{by.in_progress} in progress</span><span>{by.resolved} resolved</span>
              {review.unreadIds.length > 0 && <span className="text-fg">{review.unreadIds.length} unread</span>}
            </p>
            <ul className="space-y-2">
              {notes.slice(-5).reverse().map((n) => (
                <li key={n.id} className="rounded-lg border border-edge px-3 py-2 text-[13px]">
                  <span className="font-mono text-[11.5px] text-muted">Round {n.round} · {n.category} · {n.authorName} · {n.resolutionStatus.replace('_', ' ')}</span>
                  <p className="mt-1 text-fg/90" dir="auto">{n.body}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * Decided for a Sequence / Block project (PRD 11): Project, then Sequence, then Block, as links so
 * the address says where you are. Inside a block the three views are tabs over the same records.
 */
export async function BlocksDecided({ pr, actor, searchParams }: {
  pr: Project; actor: Actor; searchParams: Record<string, string | string[] | undefined>
}) {
  const { loadDecidedTree } = await import('@/lib/pd-decided')
  const { sequences, blocks } = await loadDecidedTree(pr, actor)
  const f: TreeFilters = { q: one(searchParams.q), status: one(searchParams.status), from: day(one(searchParams.from)), to: day(one(searchParams.to)), creator: one(searchParams.by) }
  const tree = buildTree(sequences, blocks, f)
  const total = projectCounts(tree)
  const seqId = one(searchParams.seq)
  const blockId = one(searchParams.block)
  const view = one(searchParams.view)
  const node = tree.find((n) => n.seq.id === seqId) ?? tree.find((n) => n.blocks.some((b) => b.id === blockId)) ?? null
  const block = node?.blocks.find((b) => b.id === blockId) ?? null

  const keep: Record<string, string> = {}
  if (f.q) keep.q = f.q
  if (f.status) keep.status = f.status
  if (f.from) keep.from = f.from
  if (f.to) keep.to = f.to
  if (f.creator) keep.by = f.creator
  const href = (over: Record<string, string>) => {
    const qs = new URLSearchParams({ ...keep, ...over }).toString()
    return `/${pr.slug}/decided${qs ? `?${qs}` : ''}`
  }
  const field = 'focus-ring h-8 rounded-md border border-edge bg-panel px-2 text-[12.5px] text-fg'

  return (
    <div className="space-y-10">
      <div>
        <Breadcrumb items={[
          { label: pr.name, href: href({}) },
          ...(node ? [{ label: `${node.seq.id} ${node.seq.title}`, href: block ? href({ seq: node.seq.id }) : undefined }] : []),
          ...(block ? [{ label: block.id }] : []),
        ]} />
        <PageHeader title="Decided" eyebrow="Generations, rounds and Finals">
          Every sequence and block of {pr.name}, with what was generated, what was sent to the director, and what was approved.
        </PageHeader>
      </div>

      <form method="get" action={`/${pr.slug}/decided`} className="flex flex-wrap items-end gap-3" role="search">
        {node && <input type="hidden" name="seq" value={node.seq.id} />}
        {block && <input type="hidden" name="block" value={block.id} />}
        {view && <input type="hidden" name="view" value={viewOf(view)} />}
        <label className="grid gap-1 text-[11.5px] text-faint">Block id or title
          <input name="q" defaultValue={f.q} placeholder="PD-S01-B003" className={cn(field, 'w-48')} />
        </label>
        <label className="grid gap-1 text-[11.5px] text-faint">Status
          <select name="status" defaultValue={f.status} className={field}>
            <option value="">Any</option>
            {STATUSES.map((s) => <option key={s} value={s}>{BLOCK_STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-[11.5px] text-faint">From
          <input type="date" name="from" defaultValue={f.from} className={field} />
        </label>
        <label className="grid gap-1 text-[11.5px] text-faint">To
          <input type="date" name="to" defaultValue={f.to} className={field} />
        </label>
        <label className="grid gap-1 text-[11.5px] text-faint">Made by
          <select name="by" defaultValue={f.creator} className={field}>
            <option value="">Anyone</option>
            {creatorsOf(blocks).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <button type="submit" className="focus-ring h-8 cursor-pointer rounded-md border border-edge-strong px-3 text-[12.5px] text-fg hover:border-accent">Filter</button>
        {Object.keys(keep).length > 0 && <Link href={`/${pr.slug}/decided`} className="focus-ring pb-1.5 text-[12.5px] text-muted hover:text-fg">Clear</Link>}
      </form>

      <section aria-label="Project" className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <h2 className="font-display text-xl text-fg">{pr.name}</h2>
          <CountsLine c={total} />
        </div>
        {tree.length === 0 ? (
          <EmptyState>Nothing matches.</EmptyState>
        ) : (
          <ul className="divide-y divide-edge rounded-xl border border-edge bg-panel">
            {tree.map((n) => {
              const open = node?.seq.id === n.seq.id
              return (
                <li key={n.seq.id} data-sequence={n.seq.id}>
                  <Link href={open ? href({}) : href({ seq: n.seq.id })} aria-expanded={open} className="focus-ring flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-white/[0.03]">
                    <span className="font-mono text-[12.5px] text-muted">{n.seq.id}</span>
                    <span className="min-w-0 flex-1 text-[15px] text-fg" dir="auto">{n.seq.title}</span>
                    <CountsLine c={n.counts} />
                  </Link>
                  {open && (
                    <ul className="divide-y divide-edge border-t border-edge bg-white/[0.015]">
                      {n.blocks.length === 0 && <li className="px-8 py-3 text-[13px] text-muted">No blocks.</li>}
                      {n.blocks.map((b) => (
                        <li key={b.id} data-block={b.id}>
                          <Link href={href({ seq: n.seq.id, block: b.id })} aria-current={block?.id === b.id ? 'true' : undefined} className={cn('focus-ring flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 pr-4 pl-8 hover:bg-white/[0.03]', block?.id === b.id && 'bg-white/[0.04]')}>
                            <span className="font-mono text-[12.5px] text-muted">{b.id}</span>
                            <span className="min-w-0 flex-1 text-[14px] text-fg" dir="auto">{b.title}</span>
                            <StatusLabel status={b.status} />
                            <span className="font-mono text-[12px] text-muted tabular-nums">{b.generations.length} generation{b.generations.length === 1 ? '' : 's'}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {block && node && <BlockDetail pr={pr} actor={actor} b={block} view={view} href={href} />}
    </div>
  )
}
