'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, Coins, LoaderCircle, TriangleAlert } from 'lucide-react'
import { approveBatch, discardBatch } from './actions'
import { useProject } from '@/components/project-context'
import { Button } from '@/components/ui/button'
import { Card, EmptyState } from '@/components/ui/card'
import { Disclosure } from '@/components/ui/disclosure'
import { Modal } from '@/components/ui/modal'
import { Table, Td, Th, Thead, Tr } from '@/components/ui/table'
import { Badge, SectionHeading } from '@/components/ui/text'
import type { BatchStatus, BatchView, WorkerStatus } from '@/lib/types'

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const STATUS: Record<BatchStatus, { text: string; tone: 'accent' | 'good' | 'bad' | 'muted'; busy?: boolean }> = {
  received: { text: 'waiting for the worker', tone: 'muted', busy: true },
  validated: { text: 'checked, pricing…', tone: 'accent', busy: true },
  pricing: { text: 'pricing…', tone: 'accent', busy: true },
  priced: { text: 'priced, waiting for your approval', tone: 'accent' },
  approving: { text: 'approved, queueing…', tone: 'accent', busy: true },
  queued: { text: 'queued', tone: 'good' },
  discarded: { text: 'discarded', tone: 'muted' },
  rejected: { text: 'rejected', tone: 'bad' },
}

/**
 * Every batch sent from this page and where it stands. Approve is the spend
 * gate: the worker has priced every job by then and the total is on the
 * button. Discard is allowed until the batch is queued.
 */
export function Batches({ batches, worker }: { batches: BatchView[]; worker: WorkerStatus }) {
  const project = useProject()
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<Record<string, string>>({})
  const [confirm, setConfirm] = useState<BatchView | null>(null)

  const live = batches.some((b) => STATUS[b.status].busy || b.pending.length > 0)
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => router.refresh(), 2000)
    return () => clearInterval(t)
  }, [live, router])

  const oldest = batches.filter((b) => b.pending.length > 0).map((b) => b.submittedAt).sort()[0]
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t) }, [])
  const waited = oldest ? now - new Date(oldest).getTime() : 0
  const waitNote = !oldest ? null
    : !worker.running ? worker.autostartOff ? `The worker isn’t running here (${worker.autostartOff}), so nothing is checked or priced.` : 'The worker is starting…'
    : worker.outdated && waited > 10000 ? 'Restart the worker: it is running code from before the last update.'
    : waited > 30000 ? 'Taking longer than usual. Check the worker log for errors.'
    : null

  async function act(b: BatchView, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(b.batchId)
    const r = await fn().catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(null)
    setNote((n) => ({ ...n, [b.batchId]: r.ok ? 'Sent to the worker…' : r.error ?? 'Could not send that.' }))
    router.refresh()
  }

  return (
    <section>
      <SectionHeading count={batches.length}>Batches</SectionHeading>
      {waitNote && (
        <p className="mb-5 flex items-start gap-2.5 rounded-md border border-edge-strong bg-sunken px-3.5 py-2.5 text-[13px] leading-relaxed text-fg">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-bad" /> {waitNote}
        </p>
      )}
      {batches.length === 0 ? (
        <EmptyState>Nothing submitted yet. Batches you send appear here with their price.</EmptyState>
      ) : (
        <div className="space-y-5">
          {batches.map((b) => {
            const s = STATUS[b.status]
            const okJobs = b.jobs.filter((j) => j.ok)
            const badJobs = b.jobs.filter((j) => !j.ok)
            return (
              <Card key={b.batchId} className="space-y-4 p-5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="font-display text-2xl leading-none text-fg" dir="auto">{b.name}</span>
                  <span className="font-mono text-xs text-muted">{b.batchId}</span>
                  <Badge tone={s.tone}>{s.busy && <LoaderCircle aria-hidden className="mr-1 size-3 animate-spin" />}{s.text}</Badge>
                  <span className="ml-auto font-mono text-[11px] text-faint tabular-nums">{when(b.submittedAt)}</span>
                </div>

                <Table>
                  <Thead>
                    <tr>
                      <Th>Prompt</Th>
                      <Th>For</Th>
                      <Th>Model</Th>
                      <Th className="text-right">Credits</Th>
                    </tr>
                  </Thead>
                  <tbody>
                    {b.jobs.map((j) => (
                      <Tr key={j.key} className={j.ok ? undefined : 'opacity-70'}>
                        <Td className="max-w-md">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs text-fg">{j.label || j.key}</span>
                            {!j.ok && <Badge tone="bad">skipped</Badge>}
                            {j.jobId && b.status === 'queued' && <span className="font-mono text-[11px] text-faint">{j.jobId}</span>}
                          </div>
                          <div className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-muted" dir="auto">{j.prompt}</div>
                          {j.reason && <div className="mt-1 text-xs text-bad">{j.reason}</div>}
                        </Td>
                        <Td className="font-mono text-xs text-fg">
                          {j.assignedId ?? j.target}
                          {j.assignedId && <div className="text-[11px] text-faint">was {j.target}</div>}
                        </Td>
                        <Td className="font-mono text-xs text-muted">{j.model}{j.stage ? ` · ${j.stage}` : ''}</Td>
                        <Td className="text-right font-mono text-xs text-fg tabular-nums">
                          {!j.ok ? '' : j.credits == null ? (b.status === 'validated' || b.status === 'pricing' ? '…' : '?') : j.credits}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>

                {b.newEntities.length > 0 && (
                  <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span className="eyebrow text-faint">new entities</span>
                    {b.newEntities.map((n) => (
                      <Badge key={n.key} tone={n.assigned ? 'good' : 'muted'} className="font-mono">
                        {n.assigned ?? `NEW/${n.kind}/${n.slug}`}
                      </Badge>
                    ))}
                    {b.status !== 'queued' && <span className="text-faint">numbered when you approve</span>}
                  </p>
                )}

                {b.message && (
                  <p className="rounded-md border border-bad/35 bg-bad/8 px-3.5 py-2.5 text-[13px] leading-relaxed text-bad" dir="auto">{b.message}</p>
                )}
                {b.ceilingNote && (
                  <p className="text-xs leading-relaxed text-muted">{b.ceilingNote}</p>
                )}

                <div className="flex flex-wrap items-center gap-3 border-t border-edge pt-4">
                  <span className="flex items-center gap-2 text-[13px] text-muted">
                    <Coins aria-hidden strokeWidth={1.75} className="size-3.5 text-fg/70" />
                    {okJobs.length} job{okJobs.length === 1 ? '' : 's'}
                    {badJobs.length > 0 && <>, {badJobs.length} skipped</>}
                    {b.total != null && <> · <span className="text-fg tabular-nums">{b.total} credits</span></>}
                    {b.unpriced > 0 && <> (+{b.unpriced} unpriced)</>}
                  </span>
                  {note[b.batchId] && <span className="text-xs text-muted">{note[b.batchId]}</span>}
                  <span className="ml-auto flex items-center gap-2">
                    {b.status === 'queued' && (
                      <Link href={`/${project.slug}/queue`} className="focus-ring rounded text-xs text-muted underline hover:text-fg">Open the queue</Link>
                    )}
                    {!['queued', 'discarded', 'rejected'].includes(b.status) && (
                      <Button type="button" size="sm" tone="ghost" disabled={busy === b.batchId} onClick={() => setConfirm(b)}>Discard</Button>
                    )}
                    {b.status === 'priced' && (
                      <Button type="button" size="sm" tone="good" pending={busy === b.batchId} pendingLabel="Approving" onClick={() => act(b, () => approveBatch(project.slug, b.batchId, b.total))}>
                        <Check aria-hidden className="size-3.5" /> Approve{b.total != null ? ` · ${b.total} credits` : ''}
                      </Button>
                    )}
                  </span>
                </div>

                {b.status === 'queued' && (
                  <Disclosure summary="Receipt">
                    <pre className="scroll-pane max-h-64 rounded-md border border-edge bg-sunken p-3 font-mono text-[11.5px] leading-relaxed text-fg/80">
                      {[
                        `batch ${b.batchId}`,
                        ...b.newEntities.filter((n) => n.assigned).map((n) => `NEW/${n.kind}/${n.slug} -> ${n.assigned}`),
                        ...b.jobs.filter((j) => j.ok).map((j) => `${(j.label || j.key).padEnd(12)} ${(j.jobId ?? '').padEnd(16)} ${j.assignedId ?? j.target}`),
                      ].join('\n')}
                    </pre>
                  </Disclosure>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <Modal
        open={confirm !== null}
        title={`Discard ${confirm?.name ?? ''}?`}
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button type="button" tone="ghost" onClick={() => setConfirm(null)}>Keep it</Button>
            <Button type="button" tone="bad" onClick={async () => { const b = confirm!; setConfirm(null); await act(b, () => discardBatch(project.slug, b.batchId)) }}>Discard</Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-muted">Nothing has been generated or numbered. The batch stays in the log as discarded; you can submit the prompts again any time.</p>
      </Modal>
    </section>
  )
}
