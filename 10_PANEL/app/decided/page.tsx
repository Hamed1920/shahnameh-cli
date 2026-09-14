import fs from 'node:fs/promises'
import path from 'node:path'
import { ROOT } from '@/lib/paths'
import { assetUrl, isVideo } from '@/lib/asset'
import { getDecisions } from '@/lib/store'
import type { ReviewDecision } from '@/lib/types'
import { Card, EmptyState } from '@/components/ui/card'
import { Reveal } from '@/components/ui/reveal'
import { Badge, PageHeader, SectionHeading } from '@/components/ui/text'

export const dynamic = 'force-dynamic'

/**
 * Where a decided candidate ended up. The worker moves the file out of
 * _staging, so the path recorded on the decision is stale by design — search
 * the destinations in the order the worker uses them.
 */
async function locate(d: ReviewDecision): Promise<string | null> {
  const base = path.basename(d.candidate)
  const guesses =
    d.verdict === 'denied'
      ? [path.join('09_OUTPUT', '_rejected', d.hfJobId, base)]
      : [
          path.join('07_EPISODES'), // shot finals, resolved below
          path.join('09_OUTPUT', '_drafts', d.hfJobId, base),
          d.candidate,
        ]

  for (const g of guesses) {
    if (g === '07_EPISODES') {
      try {
        const eps = await fs.readdir(path.join(ROOT, '07_EPISODES'))
        for (const ep of eps) {
          const dir = path.join(ROOT, '07_EPISODES', ep, 'shots')
          let names: string[] = []
          try {
            names = await fs.readdir(dir)
          } catch {
            continue
          }
          const hit = names.find((n) => n.startsWith(d.target))
          if (hit) return `07_EPISODES/${ep}/shots/${hit}`
        }
      } catch {
        /* no episodes yet */
      }
      continue
    }
    try {
      await fs.access(path.join(ROOT, g))
      return g.split(path.sep).join('/')
    } catch {
      /* next */
    }
  }
  return null
}

export default async function DecidedPage() {
  const decisions = (await getDecisions()).slice().reverse()
  const located = await Promise.all(decisions.map(async (d) => ({ d, at: await locate(d) })))
  const accepted = located.filter((x) => x.d.verdict === 'accepted')
  const denied = located.filter((x) => x.d.verdict === 'denied')

  return (
    <div className="space-y-10">
      <PageHeader title="Decided">
        Everything you have accepted or denied, and where each file now lives. Nothing is deleted —
        a denied take is kept as the evidence <code className="text-fg">/learn</code> distils rules
        from.
      </PageHeader>

      <section>
        <SectionHeading tone="good">Accepted ({accepted.length})</SectionHeading>
        {accepted.length === 0 ? (
          <EmptyState>Nothing accepted yet.</EmptyState>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {accepted.map(({ d, at }, i) => (
              <Reveal key={d.id} index={i} lift>
                <Card interactive className="p-4">
                  {at ? (
                    isVideo(at) ? (
                      <video
                        src={assetUrl(at)}
                        className="checker w-full rounded-lg"
                        controls
                        muted
                        loop
                        preload="metadata"
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={assetUrl(at)}
                        alt={d.target}
                        className="checker w-full rounded-lg"
                      />
                    )
                  ) : (
                    <div className="rounded-lg border border-dashed border-edge p-6 text-center text-xs text-muted">
                      File is being moved by the worker
                    </div>
                  )}
                  <div className="mt-3">
                    <div className="font-mono text-xs text-fg">
                      {d.target} {d.variant} {d.take}
                    </div>
                    <div className="mt-1 font-mono text-xs break-all text-muted">{at ?? '—'}</div>
                    {d.notes && (
                      <p className="mt-2 text-xs leading-relaxed text-muted">
                        <span className="text-good">why it worked:</span> {d.notes}
                      </p>
                    )}
                  </div>
                </Card>
              </Reveal>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeading tone="bad">Denied ({denied.length})</SectionHeading>
        {denied.length === 0 ? (
          <EmptyState>Nothing denied.</EmptyState>
        ) : (
          <div className="space-y-2">
            {denied.map(({ d, at }, i) => (
              <Reveal key={d.id} index={i}>
                <Card interactive className="px-4 py-3.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-fg">
                      {d.target} {d.take}
                    </span>
                    {d.requeue && <Badge tone="accent">regenerating</Badge>}
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted">{d.notes}</p>
                  <p className="mt-1.5 font-mono text-[10px] break-all text-muted/70">
                    {at ?? 'file pending move'}
                  </p>
                </Card>
              </Reveal>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
