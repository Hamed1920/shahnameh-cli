'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Coins, LoaderCircle, Search, Sparkles } from 'lucide-react'
import { approveBatch, generateFromPrompt } from './actions'
import { GenerationSettings, settingsFrom, type GenerationConfig, type GenerationSettingsValue } from '@/components/generation-settings'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/card'
import { Disclosure } from '@/components/ui/disclosure'
import { Field, Input, Textarea } from '@/components/ui/field'
import { Modal } from '@/components/ui/modal'
import { Table, Td, Th, Thead, Tr } from '@/components/ui/table'
import { Badge, SectionHeading } from '@/components/ui/text'
import { isVideoModel } from '@/lib/batch-rules'
import type { BatchView, CatalogEntity, PromptLibraryItem } from '@/lib/types'

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const STATE: Record<PromptLibraryItem['state'], { text: string; tone: 'accent' | 'good' | 'bad' | 'muted' }> = {
  queued: { text: 'queued', tone: 'muted' },
  generating: { text: 'generating', tone: 'accent' },
  failed: { text: 'did not generate', tone: 'bad' },
  'to-review': { text: 'to review', tone: 'accent' },
  accepted: { text: 'accepted', tone: 'good' },
  denied: { text: 'denied', tone: 'bad' },
}

const PAGE = 25

/**
 * Every prompt that has been queued, one row per prompt however many times it
 * was revised. Generate starts it again from scratch, with anything changed:
 * a take that went badly is often cheaper to rebuild than to keep revising.
 */
export function PromptLibrary({
  items, catalog, cfg, batches,
}: {
  items: PromptLibraryItem[]
  catalog: CatalogEntity[]
  cfg: GenerationConfig
  batches: BatchView[]
}) {
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [active, setActive] = useState<PromptLibraryItem | null>(null)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((i) => [i.label, i.target, i.prompt, i.jobId, i.rootJobId, i.model].some((s) => String(s ?? '').toLowerCase().includes(q)))
  }, [items, query])

  const name = (target: string) => catalog.find((e) => e.id === target)?.name ?? null

  return (
    <section>
      <SectionHeading count={items.length}>All prompts</SectionHeading>
      <p className="mb-5 max-w-2xl text-[13px] leading-relaxed text-muted">
        Every prompt that has been queued, as its latest attempt. Generate starts one again from scratch, a new job
        with no revision notes carried over, after you change the prompt, references or settings. It is priced first
        and waits for your approval like any batch.
      </p>

      {items.length === 0 ? (
        <EmptyState>Nothing has been queued yet. Prompts appear here once a batch is approved.</EmptyState>
      ) : (
        <div className="space-y-4">
          <label className="relative block max-w-sm">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-faint" />
            <Input value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE) }} placeholder="Search label, target or prompt text" className="pl-8" dir="auto" />
          </label>

          {shown.length === 0 ? (
            <p className="text-[13px] text-muted">No prompt matches “{query}”.</p>
          ) : (
            <Table>
              <Thead>
                <tr>
                  <Th>Prompt</Th>
                  <Th>For</Th>
                  <Th>Model</Th>
                  <Th>Latest</Th>
                  <Th className="text-right"><span className="sr-only">Generate</span></Th>
                </tr>
              </Thead>
              <tbody>
                {shown.slice(0, limit).map((i) => (
                  <Tr key={i.rootJobId}>
                    <Td className="max-w-md">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-fg">{i.label || i.rootJobId}</span>
                        <span className="font-mono text-[11px] text-faint">{i.jobId}</span>
                      </div>
                      <div className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-muted" dir="auto">{i.prompt}</div>
                    </Td>
                    <Td className="font-mono text-xs text-fg">
                      {i.target}
                      <div className="text-[11px] text-faint">{i.variant}{name(i.target) ? ` · ${name(i.target)}` : ''}</div>
                    </Td>
                    <Td className="font-mono text-xs text-muted">{i.model}{i.stage ? ` · ${i.stage}` : ''}</Td>
                    <Td className="text-xs text-muted">
                      <Badge tone={STATE[i.state].tone}>{STATE[i.state].text}</Badge>
                      <div className="mt-1 font-mono text-[11px] text-faint tabular-nums">
                        {i.attempts > 1 ? `${i.attempts} attempts · ` : ''}{when(i.enqueuedAt)}
                      </div>
                    </Td>
                    <Td className="text-right">
                      <Button type="button" size="sm" tone="outline" onClick={() => setActive(i)}>
                        <Sparkles aria-hidden className="size-3.5" /> Generate
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          {shown.length > limit && (
            <Button type="button" size="sm" tone="ghost" onClick={() => setLimit((l) => l + PAGE)}>
              Show {Math.min(PAGE, shown.length - limit)} more of {shown.length - limit}
            </Button>
          )}
        </div>
      )}

      {active && (
        <GenerateDialog key={active.rootJobId + active.jobId} item={active} catalog={catalog} cfg={cfg} batches={batches} onClose={() => setActive(null)} />
      )}
    </section>
  )
}

/**
 * Edit, then Generate: the dialog sends a one-row batch and stays open while
 * the worker prices it, so the approval happens right here. Closing it early
 * is safe; the batch waits in Batches below.
 */
function GenerateDialog({
  item, catalog, cfg, batches, onClose,
}: {
  item: PromptLibraryItem
  catalog: CatalogEntity[]
  cfg: GenerationConfig
  batches: BatchView[]
  onClose: () => void
}) {
  const router = useRouter()
  const [picker, setPicker] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [batchId, setBatchId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState(item.prompt)
  const [settings, setSettings] = useState<GenerationSettingsValue>(() => ({
    ...settingsFrom(item, cfg),
    // A fresh start is a draft first, whatever the last attempt was.
    stage: 'draft',
    // Old queue lines carry the string "false" from before sound was on by default; only a real false keeps it off.
    sound: item.params.generate_audio !== false,
  }))

  const batch = batchId ? batches.find((b) => b.batchId === batchId) ?? null : null
  const status = batchId ? batch?.status ?? 'received' : null

  async function send() {
    setBusy(true)
    setError(null)
    const fd = new FormData()
    fd.set('jobId', item.jobId)
    fd.set('prompt', prompt)
    fd.set('refs', JSON.stringify(settings.refs))
    fd.set('model', settings.model)
    fd.set('variant', settings.variant)
    fd.set('aspect_ratio', settings.aspect)
    if (isVideoModel(settings.model)) {
      fd.set('stage', settings.stage)
      fd.set('duration', settings.duration)
      if (settings.sound) fd.set('sound', 'on')
    }
    const r = await generateFromPrompt(fd).catch((e: Error) => ({ ok: false, error: e.message, batchId: undefined }))
    setBusy(false)
    if (!r.ok || !r.batchId) { setError(r.error ?? 'Could not send that.'); return }
    setBatchId(r.batchId)
    router.refresh()
  }

  async function approve() {
    if (!batch) return
    setBusy(true)
    setError(null)
    const r = await approveBatch(batch.batchId, batch.total).catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(false)
    if (!r.ok) setError(r.error ?? 'Could not approve.')
    router.refresh()
  }

  const waiting = status === 'received' || status === 'validated' || status === 'pricing' || status === 'approving'
  const footer = !batchId ? (
    <>
      <span className="mr-auto flex items-center gap-1.5 self-center text-xs text-faint">
        <Coins aria-hidden className="size-3.5" /> priced before anything spends
      </span>
      <Button type="button" tone="ghost" onClick={onClose}>Cancel</Button>
      <Button type="button" tone="accent" pending={busy} pendingLabel="Sending" disabled={!prompt.trim() || !settings.model} onClick={send}>
        <Sparkles aria-hidden className="size-3.5" /> Generate
      </Button>
    </>
  ) : (
    <>
      <span className="mr-auto flex items-center gap-1.5 self-center text-xs text-muted">
        {waiting && <LoaderCircle aria-hidden className="size-3.5 animate-spin" />}
        {status === 'received' && 'Waiting for the worker to check it…'}
        {(status === 'validated' || status === 'pricing') && 'Pricing…'}
        {status === 'priced' && <><Coins aria-hidden className="size-3.5" /> Priced{batch?.unpriced ? ' (the worker could not price it)' : ''}</>}
        {status === 'approving' && 'Approved, queueing…'}
        {status === 'queued' && <><Check aria-hidden className="size-3.5 text-good" /> Queued. The take comes to Review when it is done.</>}
        {status === 'discarded' && 'Discarded.'}
        {status === 'rejected' && 'The worker refused it.'}
      </span>
      <Button type="button" tone="ghost" onClick={onClose}>{status === 'queued' || status === 'rejected' || status === 'discarded' ? 'Close' : 'Later'}</Button>
      {status === 'priced' && (
        <Button type="button" tone="good" pending={busy} pendingLabel="Approving" onClick={approve}>
          <Check aria-hidden className="size-3.5" /> Approve{batch?.total != null ? ` · ${batch.total} credits` : ''}
        </Button>
      )}
    </>
  )

  return (
    <Modal open size="lg" title={`Generate ${item.label || item.target} from scratch`} onClose={onClose} onKeyGuard={() => !picker} footer={footer}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-4">
          <p className="font-mono text-xs text-muted">
            For {item.target} · copied from {item.jobId}{item.attempts > 1 ? ` (attempt ${item.attempts})` : ''}
          </p>
          <Field label="Prompt (sent as written)">
            <Textarea dir="auto" value={prompt} disabled={!!batchId} onChange={(e) => setPrompt(e.target.value)} rows={14} className="min-h-64 max-h-[55vh] text-[13px]" />
          </Field>
          {item.revisionNotes.length > 0 && (
            <Disclosure summary={`${item.revisionNotes.length} revision note${item.revisionNotes.length === 1 ? '' : 's'} from the last attempt, not carried over`}>
              <ul className="space-y-1 border-l border-edge pl-3 text-xs text-muted">
                {item.revisionNotes.map((n, i) => <li key={i} dir="auto" className="whitespace-pre-wrap">{n}</li>)}
              </ul>
              <p className="mt-2 text-xs text-faint">Write anything you still want into the prompt itself.</p>
            </Disclosure>
          )}
        </div>

        <div className="space-y-4">
          <fieldset disabled={!!batchId} className="contents">
            <GenerationSettings
              value={settings}
              onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
              catalog={catalog}
              cfg={cfg}
              picker={picker}
              onPicker={setPicker}
            />
          </fieldset>
          {batch?.message && <p className="rounded-md border border-bad/35 bg-bad/8 px-3 py-2 text-xs leading-relaxed text-bad" dir="auto">{batch.message}</p>}
          {error && <p className="rounded-md border border-bad/35 bg-bad/8 px-3 py-2 text-xs leading-relaxed text-bad" dir="auto">{error}</p>}
        </div>
      </div>
    </Modal>
  )
}
