'use client'

import { useState } from 'react'
import { Check, FolderOpen, Layers, X } from 'lucide-react'
import { revealInFolder } from '@/app/[project]/reveal-action'
import { useAssetUrls, useProject } from '@/components/project-context'
import { MenuNote } from '@/components/item-menu'
import { TakeMedia } from '@/components/take-media'
import { Modal } from '@/components/ui/modal'
import { Badge } from '@/components/ui/text'
import { cn } from '@/lib/cn'
import type { PlanRevision, ShotOutput } from '@/lib/types'

/**
 * Every output a shot has ever had, each one playable.
 *
 * The card says "3 takes" and that number was the end of the story: there was
 * no way to see the other two, or the ones that were turned down, without
 * digging through 09_OUTPUT by hand. This is the shot's history -- filed takes,
 * approved drafts and denied attempts alike, oldest first -- with the note that
 * was written at the time, because a denied take without the reason it was
 * denied teaches nothing.
 *
 * Each video keeps its own controls: comparing two takes means scrubbing them
 * independently, so nothing here is synchronised or autoplayed.
 */
export function TakesDialog({
  shot,
  label,
  outputs,
  plan,
}: {
  shot: string
  /** "Plan 14", for the heading. */
  label: string
  outputs: ShotOutput[]
  plan: PlanRevision[]
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'plan' | 'takes'>('plan')
  const count = outputs.length

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        title={count === 0 ? `${shot} has no outputs yet` : `See all ${count} output${count === 1 ? '' : 's'} of ${shot}`}
        className="focus-ring inline-flex h-[18px] cursor-pointer items-center gap-1 rounded-full border border-edge-strong px-2 text-[10.5px] text-muted transition-colors hover:border-muted hover:text-fg"
      >
        <Layers aria-hidden className="size-2.5" />
        History{count > 0 && ` · ${count}`}
      </button>

      <Modal
        open={open}
        size="xl"
        title={
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span>{label}</span>
            <span className="font-mono text-[12px] font-normal text-faint">{shot}</span>
          </span>
        }
        onClose={() => setOpen(false)}
      >
        <div className="mb-5 flex gap-2">
          {([['plan', `Plan history${plan.length ? ` · ${plan.length}` : ''}`], ['takes', `Takes${count ? ` · ${count}` : ''}`]] as const).map(([k, text]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={cn(
                'focus-ring h-7 cursor-pointer rounded-full border px-3 text-[12px] transition-colors',
                tab === k ? 'border-fg text-fg' : 'border-edge text-muted hover:text-fg',
              )}
            >
              {text}
            </button>
          ))}
        </div>
        {tab === 'plan' ? <PlanHistory plan={plan} /> : <TakeList outputs={outputs} />}
      </Modal>
    </>
  )
}

const when = (iso: string) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null

/** Every prompt queued against this plan, oldest first, with the notes that changed it. */
function PlanHistory({ plan }: { plan: PlanRevision[] }) {
  if (plan.length === 0) {
    return <p className="text-[13px] leading-relaxed text-muted">No prompt has been queued for this plan yet. Its versions will appear here.</p>
  }
  return (
    <ol className="space-y-4">
      {plan.map((p, i) => (
        <li key={p.jobId} className="rounded-xl border border-edge bg-panel p-4">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span className="font-mono text-[13px] text-fg">v{i + 1}</span>
            <span className="font-mono text-[11px] text-faint">{p.jobId}</span>
            {p.stage && <Badge tone="muted">{p.stage}</Badge>}
            {p.attempt > 1 && <Badge tone="muted">attempt {p.attempt}</Badge>}
            {i > 0 && !p.changed && <Badge tone="muted">same prompt</Badge>}
            {i > 0 && p.changed && <Badge tone="accent">prompt changed</Badge>}
            {p.ts && <span className="ml-auto font-mono text-[10.5px] text-faint tabular-nums">{when(p.ts)}</span>}
          </div>
          {p.notes.length > 0 && (
            <p className="mt-2.5 text-[12.5px] leading-relaxed whitespace-pre-line text-fg/80" dir="auto">
              <span className="eyebrow mr-2 text-accent">why it was revised</span>
              {p.notes.join('\n')}
            </p>
          )}
          {(p.changed || i === 0) ? (
            <details className="mt-2.5">
              <summary className="cursor-pointer text-[12px] text-muted hover:text-fg">Show the prompt</summary>
              <pre className="mt-2 max-h-80 overflow-auto text-[12px] leading-relaxed whitespace-pre-wrap text-fg/80" dir="auto">{p.prompt}</pre>
            </details>
          ) : (
            <p className="mt-2.5 text-[12px] text-faint">Prompt unchanged from v{i}.</p>
          )}
          {p.refs.length > 0 && <p className="mt-2 font-mono text-[10.5px] break-all text-faint">{p.refs.join(' ')}</p>}
        </li>
      ))}
    </ol>
  )
}

function TakeList({ outputs }: { outputs: ShotOutput[] }) {
  const project = useProject()
  const { assetUrl } = useAssetUrls()
  const [note, setNote] = useState<string | null>(null)

  const reveal = (path: string) =>
    void revealInFolder(project.slug, path).then((r) => {
      if (!r.ok) { setNote(r.error ?? 'Could not open the folder.'); setTimeout(() => setNote(null), 5000) }
    })

  if (outputs.length === 0) {
    return <p className="text-[13px] leading-relaxed text-muted">Nothing has been generated for this shot yet. Its history will appear here.</p>
  }

  return (
    <>
      <p className="mb-5 text-[13px] leading-relaxed text-muted">
        Every output this shot has, oldest first. The one marked <span className="text-fg">filed</span> is the
        footage the episode holds now; the rest are kept as the record of how it got there — nothing is
        deleted.
      </p>

      <ol className="space-y-5">
        {outputs.map((o) => (
          <li
            key={o.file}
            className={cn(
              'flex flex-col gap-4 rounded-xl border bg-panel p-4 sm:flex-row',
              o.filed ? 'border-good/40' : 'border-edge',
            )}
          >
            <div className="shrink-0 sm:w-72">
              <TakeMedia file={o.file} alt={o.take} />
            </div>

            <div className="min-w-0 flex-1 space-y-2.5">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <span className="font-mono text-[13px] text-fg">{o.take}</span>
                {o.filed && (
                  <Badge tone="good" className="gap-1">
                    <Check aria-hidden className="size-2.5" /> filed
                  </Badge>
                )}
                {o.verdict === 'denied' && (
                  <Badge tone="bad" className="gap-1">
                    <X aria-hidden className="size-2.5" /> denied
                  </Badge>
                )}
                {o.verdict === 'accepted' && !o.filed && <Badge tone="muted">accepted</Badge>}
                {o.verdict === 'discarded' && <Badge tone="muted">discarded</Badge>}
                {o.stage === 'draft' && <Badge tone="muted">draft</Badge>}
                {o.attempt > 1 && <Badge tone="muted">attempt {o.attempt}</Badge>}
                {o.ts && <span className="ml-auto font-mono text-[10.5px] text-faint tabular-nums">{when(o.ts)}</span>}
              </div>

              {o.notes && (
                <p className="text-[12.5px] leading-relaxed whitespace-pre-line text-fg/80" dir="auto">
                  <span className={cn('eyebrow mr-2', o.verdict === 'denied' ? 'text-bad' : 'text-good')}>
                    {o.verdict === 'denied' ? 'why it was denied' : 'why it worked'}
                  </span>
                  {o.notes}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-0.5">
                <span className="min-w-0 font-mono text-[10.5px] break-all text-faint">{o.file}</span>
                <button
                  type="button"
                  onClick={() => reveal(o.file)}
                  className="focus-ring inline-flex h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-edge px-2 text-[11px] text-muted transition hover:border-edge-strong hover:text-fg"
                >
                  <FolderOpen aria-hidden className="size-3" /> Show in folder
                </button>
                <a
                  href={assetUrl(o.file)}
                  target="_blank"
                  rel="noopener"
                  className="focus-ring inline-flex h-6 shrink-0 items-center rounded-md border border-edge px-2 text-[11px] text-muted transition hover:border-edge-strong hover:text-fg"
                >
                  Open
                </a>
              </div>
            </div>
          </li>
        ))}
      </ol>

      {note && <MenuNote text={note} bad />}
    </>
  )
}
