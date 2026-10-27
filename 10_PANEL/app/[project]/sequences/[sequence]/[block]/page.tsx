import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Breadcrumb } from '@/components/breadcrumb'
import { TakeMedia } from '@/components/take-media'
import { buttonClasses } from '@/components/ui/button-styles'
import { Card, EmptyState } from '@/components/ui/card'
import { Badge, PageHeader, SectionHeading } from '@/components/ui/text'
import { NoteItem } from '@/components/review-notes'
import { gLabel } from '@/lib/pd/numbering'
import { continuityWarning } from '@/lib/pd/submission'
import { getBatches, getCatalog, getWorkerConfig } from '@/lib/store'
import { sequencePage } from '../../guard'
import { StatusLabel } from '../../status'
import { GenerationReviewControls, MarkRead, ResolutionSelect } from './review-controls'
import { AssetLinks, GeneratePanel, PromptEditor, type LinkLine, type VersionLine } from './workspace'

export const dynamic = 'force-dynamic'

const when = (d: Date | string) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const OPERATION: Record<string, string> = { generate: 'Generate', edit: 'Edit', revision: 'Revision', final_of_draft: 'Final of draft' }
const DECISION: Record<string, { text: string; tone: 'good' | 'bad' | 'muted' | 'accent' }> = {
  pending: { text: 'Pending review', tone: 'accent' },
  accepted: { text: 'Accepted', tone: 'good' },
  denied: { text: 'Denied', tone: 'bad' },
  discarded: { text: 'Discarded', tone: 'muted' },
}

/**
 * The production workspace of one block: its prompt (every wording kept as a version), the assets it
 * uses, Generate, and every generation it has ever had, G01 onward. Nothing is hidden or deleted here.
 */
export default async function BlockPage({ params }: PageProps<'/[project]/sequences/[sequence]/[block]'>) {
  const p = await params
  const { pr, actor } = await sequencePage(p.project)
  const { getBlock, getSequence, listBlocks } = await import('@/lib/pd-store')
  const seq = await getSequence(pr.slug, String(p.sequence ?? '').toUpperCase())
  const block = await getBlock(pr.slug, String(p.block ?? '').toUpperCase())
  if (!seq || !block || block.sequenceId !== seq.id) notFound()

  const gens = await import('@/lib/pd-generations')
  await gens.syncGenerations(pr)
  const [{ listPromptVersions }, { listAssetLinks }] = await Promise.all([import('@/lib/pd-prompts'), import('@/lib/pd-assets')])
  const [line, versions, links, rows, catalog, batches, cfg] = await Promise.all([
    listBlocks(seq.id, actor).then((l) => l.find((b) => b.id === block.displayId)),
    listPromptVersions(block.id),
    listAssetLinks(block.id),
    gens.listGenerations(block.id),
    getCatalog(pr),
    getBatches(pr),
    getWorkerConfig(),
  ])
  const states = await gens.resolveGenerationFiles(pr, rows)
  const rev = await (await import('@/lib/pd-review')).productionReview(block.id, actor.id)
  const activeSub = rev.submissions.find((s) => s.id === rev.activeId) ?? null
  const allNotes = rev.submissions.flatMap((s) => s.notes).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
  const versionNo = new Map(versions.map((v) => [v.id, v.versionNumber]))

  const versionLines: VersionLine[] = versions.map((v) => ({ versionNumber: v.versionNumber, text: v.promptText, by: v.createdBy ?? 'local', at: when(v.createdAt) }))
  const linkLines: LinkLine[] = links.map((l) => {
    const e = catalog.find((c) => c.id === l.entityId)
    const v = e?.variants.find((x) => x.variant === (l.variant ?? e.canonical)) ?? e?.variants[0]
    return { id: l.id, entityId: l.entityId, shortId: e?.shortId ?? l.entityId, name: e?.name ?? l.entityId, variant: l.variant, role: l.role, path: v?.path ?? null }
  })
  // Batches for this block that are still going somewhere; a finished one is gone after a few minutes.
  const mine = batches
    .filter((b) => b.jobs.some((j) => j.target === block.internalId) && b.status !== 'discarded')
    .filter((b) => b.status !== 'queued' || Date.now() - new Date(b.submittedAt).getTime() < 10 * 60 * 1000)

  const defaultModel = String(cfg.defaultVideoModel ?? cfg.defaultImageModel ?? '')
  const genCfg = {
    pinned: (cfg.pinnedModels as string[] | undefined) ?? [],
    aspectRatios: (cfg.aspectRatios as string[]) ?? ['16:9', '9:16', '1:1'],
    videoDurations: (cfg.videoDurations as number[]) ?? [5, 10, 15],
    videoDraftResolution: String(cfg.videoDraftResolution ?? '480p'),
    videoFinalResolution: String(cfg.videoFinalResolution ?? '1080p'),
  }

  return (
    <div className="space-y-14">
      <div>
        <Breadcrumb
          items={[
            { label: pr.name, href: `/${pr.slug}/sequences` },
            { label: `${seq.displayId} ${seq.title}`, href: `/${pr.slug}/sequences/${seq.displayId}` },
            { label: block.displayId },
          ]}
        />
        <PageHeader title={block.title} eyebrow={block.displayId}>
          <span className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
            <span>{seq.displayId} · position {block.displayOrder}</span>
            <span>{block.targetDurationSeconds ? `Target ${block.targetDurationSeconds} s` : 'No target duration'}</span>
            {line && <StatusLabel status={line.status} />}
            <span className="tabular-nums">{rows.length} generation{rows.length === 1 ? '' : 's'}</span>
          </span>
        </PageHeader>
      </div>

      <section id="prompt">
        <SectionHeading count={versions.length}>Prompt</SectionHeading>
        <PromptEditor key={versions.length} blockId={block.id} versions={versionLines} />
      </section>

      <section id="assets">
        <SectionHeading count={links.length}>Assets</SectionHeading>
        <AssetLinks blockId={block.id} links={linkLines} catalog={catalog} />
      </section>

      <section id="generate">
        <SectionHeading>Generate</SectionHeading>
        <GeneratePanel key={versions.length} blockId={block.id} startText={versions.at(-1)?.promptText ?? ''} cfg={genCfg} batches={mine} defaultModel={defaultModel} />
      </section>

      <section id="history">
        <SectionHeading count={rows.length}>History</SectionHeading>
        {rows.length === 0 ? (
          <EmptyState>Nothing generated for this block yet.</EmptyState>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((g) => {
              const st = states.get(`${g.hfJobId}|${g.candidate}`)
              const d = DECISION[st?.decision ?? 'pending']
              const pv = g.promptVersionId ? versionNo.get(g.promptVersionId) : null
              return (
                <Card key={g.id} className="space-y-3 p-4" data-g={gLabel(g.gNumber)}>
                  {st?.file ? (
                    <TakeMedia file={st.file} alt={`${gLabel(g.gNumber)} of ${block.displayId}`} />
                  ) : (
                    <div className="grid aspect-video place-items-center rounded-lg border border-dashed border-edge text-xs text-muted">File not found</div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[14px] text-fg">{gLabel(g.gNumber)}</span>
                    <Badge tone={d.tone}>{d.text}</Badge>
                    <span className="text-[12.5px] text-muted">{OPERATION[g.operationType]}</span>
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
                    <dt className="text-faint">Quality</dt><dd className="text-muted">{[g.stage, g.resolution].filter(Boolean).join(' · ') || '—'}</dd>
                    <dt className="text-faint">Prompt</dt><dd className="font-mono text-muted">{pv ? `pv${pv}` : '—'}</dd>
                    <dt className="text-faint">By</dt><dd className="text-muted">{g.createdBy ?? '—'}</dd>
                    <dt className="text-faint">When</dt><dd className="text-muted">{when(g.createdAt)}</dd>
                    <dt className="text-faint">Cost</dt><dd className="text-muted tabular-nums">{g.costCredits != null ? `${Number(g.costCredits)} credits` : '—'}</dd>
                  </dl>
                  <GenerationReviewControls
                    project={pr.slug} blockId={block.id}
                    g={{
                      generationId: g.id, gLabel: gLabel(g.gNumber),
                      rounds: rev.submissions.filter((s) => s.generationId === g.id).map((s) => s.round).reverse(),
                      active: activeSub?.generationId === g.id,
                      nextRound: Math.max(0, ...rev.submissions.map((s) => s.round)) + 1,
                      approved: rev.submissions.some((s) => s.generationId === g.id && s.status === 'approved'),
                      isFinal: rev.final?.generationId === g.id,
                      hasFile: !!st?.file && st.decision !== 'denied' && st.decision !== 'discarded',
                      replacesRound: activeSub && activeSub.generationId !== g.id ? activeSub.round : null,
                    }}
                  />
                  {(st?.decision ?? 'pending') === 'pending' && st?.file && (
                    <Link href={`/${pr.slug}/review`} className={buttonClasses({ tone: 'outline', size: 'sm' })}>Review it</Link>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </section>

      <section id="review">
        <SectionHeading count={rev.submissions.length}>Director review</SectionHeading>
        <MarkRead project={pr.slug} ids={rev.unreadIds} />
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]" data-active-round={activeSub?.round ?? ''}>
            {activeSub ? (
              <>
                <span className="font-mono text-[14px] text-fg">Current: Round {activeSub.round} · {activeSub.gLabel}</span>
                {line && <StatusLabel status={line.status} />}
                <span className="text-muted">Sent by {activeSub.submittedByName}, {when(activeSub.submittedAt)}</span>
                {activeSub.decidedByName && activeSub.decidedAt && (
                  <span className="text-muted">Decided by {activeSub.decidedByName}, {when(activeSub.decidedAt)}</span>
                )}
              </>
            ) : (
              <span className="text-muted">Nothing is with the director. Use Send to Director Review on a generation above.</span>
            )}
          </div>

          <div data-final={rev.final?.gLabel ?? ''}>
            <h3 className="eyebrow text-fg/85">Final</h3>
            {rev.final ? (
              <p className="mt-2 text-[13.5px] text-fg">
                {rev.final.gLabel}{rev.final.round !== null && <> · approved as Round {rev.final.round}</>}
                <span className="ml-3 text-[12.5px] text-muted">set by {rev.final.byName}, {when(rev.final.at)}</span>
              </p>
            ) : (
              <p className="mt-2 text-[13px] text-faint">No Final yet. A generation the director approved can be marked as Final above.</p>
            )}
            {continuityWarning(rev.openContinuity) && (
              <p role="status" className="mt-2 text-[12.5px] text-muted">Warning: {continuityWarning(rev.openContinuity)} Check them before you rely on the Final.</p>
            )}
          </div>

          <div>
            <h3 className="eyebrow text-fg/85">Rounds <span className="ml-1 font-mono text-faint">{rev.submissions.length}</span></h3>
            {rev.submissions.length === 0 ? (
              <p className="mt-2 text-[13px] text-faint">No generation has been sent to the director yet.</p>
            ) : (
              <ol className="mt-3 divide-y divide-edge rounded-lg border border-edge text-[13px]">
                {rev.submissions.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3.5 py-2" data-round={s.round}>
                    <span className="font-mono text-fg">Round {s.round} · {s.gLabel}</span>
                    <span className="text-muted">{s.status === 'pending' ? 'Waiting for review' : s.status === 'approved' ? 'Approved' : 'Revision requested'}</span>
                    {s.isActive && <span className="text-fg">Current</span>}
                    <span className="text-faint">sent by {s.submittedByName}, {when(s.submittedAt)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div>
            <h3 className="eyebrow text-fg/85">Notes <span className="ml-1 font-mono text-faint">{allNotes.length}</span></h3>
            {allNotes.length === 0 ? (
              <p className="mt-2 text-[13px] text-faint">No notes from the director or the script supervisor yet.</p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {allNotes.map((n) => (
                  <NoteItem key={n.id} note={n} showResolution={false}>
                    <ResolutionSelect project={pr.slug} feedbackId={n.id} value={n.resolutionStatus} />
                  </NoteItem>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
