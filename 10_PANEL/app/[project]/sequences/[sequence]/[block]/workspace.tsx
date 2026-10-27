'use client'

import { useState, useTransition } from 'react'
import { Check, Coins, LoaderCircle, Plus, Sparkles, X } from 'lucide-react'
import { useAssetUrls, useProject } from '@/components/project-context'
import { GenerationSettings, settingsFrom, setExtra, type GenerationConfig, type GenerationSettingsValue } from '@/components/generation-settings'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { Badge } from '@/components/ui/text'
import { isVideoModel } from '@/lib/models'
import { approveBatch, discardBatch } from '../../../prompts/actions'
import type { BatchView, CatalogEntity } from '@/lib/types'
import { addLinkAction, generateForBlock, removeLinkAction, savePromptAction } from './actions'

const Err = ({ text }: { text: string | null }) =>
  text ? <p role="alert" className="rounded-md border border-bad/35 bg-bad/8 px-3 py-2 text-xs leading-relaxed text-bad" dir="auto">{text}</p> : null

export interface VersionLine {
  versionNumber: number
  text: string
  by: string
  at: string
}

/** The prompt: the latest version's text is the starting point; saving a changed text makes version n+1. */
export function PromptEditor({ blockId, versions }: { blockId: string; versions: VersionLine[] }) {
  const project = useProject()
  const latest = versions.at(-1)
  const [text, setText] = useState(latest?.text ?? '')
  const [shown, setShown] = useState<number | null>(latest?.versionNumber ?? null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, start] = useTransition()

  function save() {
    setError(null); setNote(null)
    start(async () => {
      const r = await savePromptAction(project.slug, blockId, text).catch((e: Error) => ({ ok: false, error: e.message, version: undefined, created: undefined }))
      if (!r.ok) setError(r.error ?? 'That did not save.')
      else { setNote(r.created ? `Saved as version ${r.version}.` : `No change: this is still version ${r.version}.`); setShown(r.version ?? null) }
    })
  }

  return (
    <div className="space-y-4">
      <Field label={shown ? `Prompt · editing from version ${shown}` : 'Prompt'}>
        <Textarea dir="auto" value={text} onChange={(e) => setText(e.target.value)} rows={12} className="min-h-56 text-[13px]" />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" tone="outline" size="sm" pending={busy} pendingLabel="Saving" disabled={!text.trim()} onClick={save}>Save as new version</Button>
        {note && <span className="text-xs text-muted">{note}</span>}
        <span className="text-xs text-faint">A version is never overwritten: a changed text is saved as the next one.</span>
      </div>
      <Err text={error} />
      {versions.length > 0 && (
        <ol className="divide-y divide-edge rounded-lg border border-edge text-[13px]">
          {[...versions].reverse().map((v) => (
            <li key={v.versionNumber} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2">
              <span className="font-mono text-[12.5px] text-fg">pv{v.versionNumber}</span>
              <span className="text-muted">{v.by}</span>
              <span className="text-faint">{v.at}</span>
              <span className="min-w-0 flex-1 truncate text-faint" dir="auto">{v.text.slice(0, 80)}</span>
              <Button type="button" size="sm" tone="ghost" onClick={() => { setText(v.text); setShown(v.versionNumber) }}>Use this text</Button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

export interface LinkLine {
  id: string
  entityId: string
  shortId: string
  name: string
  variant: string | null
  role: string | null
  /** The look's file, for a thumbnail. */
  path: string | null
}

export function AssetLinks({ blockId, links, catalog }: { blockId: string; links: LinkLine[]; catalog: CatalogEntity[] }) {
  const project = useProject()
  const { thumbUrl } = useAssetUrls()
  const [entity, setEntity] = useState('')
  const [variant, setVariant] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, start] = useTransition()
  const picked = catalog.find((e) => e.id === entity)

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) {
    setError(null)
    start(async () => {
      const r = await fn().catch((e: Error) => ({ ok: false, error: e.message }))
      if (!r.ok) setError(r.error ?? 'That did not save.')
      else done?.()
    })
  }

  return (
    <div className="space-y-4">
      {links.length === 0 ? (
        <p className="text-sm text-muted">No assets linked yet.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {links.map((l) => (
            <li key={l.id} className="flex items-center gap-3 rounded-lg border border-edge p-2.5">
              {l.path ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbUrl(l.path, 96)} alt="" className="checker size-14 shrink-0 rounded object-cover" />
              ) : <div className="size-14 shrink-0 rounded bg-sunken" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-fg" dir="auto">{l.name}</div>
                <div className="font-mono text-[11.5px] text-muted">{l.shortId}{l.variant ? `/${l.variant}` : ''}</div>
                {l.role && <div className="text-[11.5px] text-faint">{l.role}</div>}
              </div>
              <button type="button" aria-label={`Remove ${l.shortId}`} disabled={busy} onClick={() => run(() => removeLinkAction(project.slug, blockId, l.id))} className="focus-ring grid size-7 cursor-pointer place-items-center rounded text-muted hover:text-fg">
                <X aria-hidden className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Asset">
          <Select value={entity} onChange={(e) => { setEntity(e.target.value); setVariant('') }}>
            <option value="">Choose…</option>
            {catalog.map((e) => <option key={e.id} value={e.id}>{e.shortId} {e.name}</option>)}
          </Select>
        </Field>
        <Field label="Look">
          <Select value={variant} onChange={(e) => setVariant(e.target.value)} disabled={!picked}>
            <option value="">Main look</option>
            {picked?.variants.map((v) => <option key={v.variant} value={v.variant}>{v.variant}</option>)}
          </Select>
        </Field>
        <Button type="button" size="sm" tone="outline" disabled={!entity || busy} onClick={() => run(() => addLinkAction(project.slug, blockId, entity, variant, ''), () => { setEntity(''); setVariant('') })}>
          <Plus aria-hidden className="size-3.5" /> Link
        </Button>
      </div>
      <Err text={error} />
    </div>
  )
}

const STATUS_TEXT: Record<string, string> = {
  received: 'Waiting for the worker to check it…',
  validated: 'Pricing…',
  pricing: 'Pricing…',
  priced: 'Priced, waiting for approval',
  approving: 'Approved, queueing…',
  queued: 'Queued. The take comes to Review when it is done.',
  discarded: 'Discarded.',
  rejected: 'The worker refused it.',
}

/** Generate this block, and the priced batches waiting for it. Nothing spends before Approve. */
export function GeneratePanel({
  blockId, startText, cfg, batches, defaultModel,
}: { blockId: string; startText: string; cfg: GenerationConfig; batches: BatchView[]; defaultModel: string }) {
  const project = useProject()
  const [prompt, setPrompt] = useState(startText)
  const [picker, setPicker] = useState(false)
  const [settings, setSettings] = useState<GenerationSettingsValue>(() => ({ ...settingsFrom({ model: defaultModel }, cfg), stage: 'draft' }))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})

  async function send() {
    setBusy('send'); setError(null)
    const fd = new FormData()
    fd.set('project', project.slug)
    fd.set('block', blockId)
    fd.set('prompt', prompt)
    fd.set('model', settings.model)
    fd.set('variant', settings.variant)
    fd.set('aspect_ratio', settings.aspect)
    if (isVideoModel(settings.model)) {
      fd.set('stage', settings.stage)
      fd.set('duration', settings.duration)
      if (settings.sound) fd.set('sound', 'on')
    }
    setExtra(fd, settings.model, settings.extra)
    const r = await generateForBlock(fd).catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(null)
    if (!r.ok) setError(r.error ?? 'Could not send that.')
  }

  async function act(b: BatchView, kind: 'approve' | 'discard') {
    setBusy(b.batchId)
    const r = await (kind === 'approve' ? approveBatch(project.slug, b.batchId, b.total) : discardBatch(project.slug, b.batchId)).catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(null)
    setNotes((n) => ({ ...n, [b.batchId]: r.ok ? 'Sent to the worker…' : r.error ?? 'Could not send that.' }))
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Field label="Prompt to generate (saved as a version if it changed)">
          <Textarea dir="auto" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={8} className="min-h-40 text-[13px]" />
        </Field>
        <GenerationSettings value={settings} onChange={(p) => setSettings((s) => ({ ...s, ...p }))} catalog={[]} cfg={cfg} picker={picker} onPicker={setPicker} showRefs={false} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" tone="accent" pending={busy === 'send'} pendingLabel="Sending" disabled={!prompt.trim() || !settings.model} onClick={send}>
          <Sparkles aria-hidden className="size-3.5" /> Generate
        </Button>
        <span className="flex items-center gap-1.5 text-xs text-faint"><Coins aria-hidden className="size-3.5" /> priced by the worker before anything spends; linked assets go as references</span>
      </div>
      <Err text={error} />

      {batches.map((b) => {
        const ok = b.jobs.filter((j) => j.ok)
        const ended = ['queued', 'discarded', 'rejected'].includes(b.status)
        const busyStatus = ['received', 'validated', 'pricing', 'approving'].includes(b.status)
        return (
          <div key={b.batchId} className="flex flex-wrap items-center gap-3 rounded-lg border border-edge px-3.5 py-3 text-[13px]">
            <span className="font-mono text-[12.5px] text-fg">{b.name}</span>
            <Badge tone={b.status === 'rejected' ? 'bad' : b.status === 'queued' ? 'good' : 'muted'}>{b.status}</Badge>
            <span className="flex items-center gap-1.5 text-muted">
              {busyStatus && <LoaderCircle aria-hidden className="size-3.5 animate-spin" />}
              {STATUS_TEXT[b.status]}
              {b.total != null && <> · <span className="text-fg tabular-nums">{b.total} credits</span></>}
            </span>
            {b.message && <span className="text-xs text-bad" dir="auto">{b.message}</span>}
            {notes[b.batchId] && <span className="text-xs text-muted">{notes[b.batchId]}</span>}
            <span className="ml-auto flex items-center gap-2">
              {!ended && <Button type="button" size="sm" tone="ghost" disabled={busy === b.batchId} onClick={() => act(b, 'discard')}>Discard</Button>}
              {b.status === 'priced' && b.unpriced === 0 && ok.length > 0 && b.total != null && (
                <Button type="button" size="sm" tone="good" pending={busy === b.batchId} pendingLabel="Approving" onClick={() => act(b, 'approve')}>
                  <Check aria-hidden className="size-3.5" /> Approve {b.total} credits
                </Button>
              )}
              {b.status === 'priced' && b.unpriced > 0 && <span className="text-xs text-bad">Could not be priced, so it cannot be approved. Discard it and try again.</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export { Input }
