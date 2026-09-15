'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Coins, RotateCcw } from 'lucide-react'
import { requestRegenerate } from '@/app/decided/actions'
import { GenerationSettings, settingsFrom, type GenerationConfig, type GenerationSettingsValue } from '@/components/generation-settings'
import { Button } from '@/components/ui/button'
import { Field, Textarea } from '@/components/ui/field'
import { Modal } from '@/components/ui/modal'
import { Badge } from '@/components/ui/text'
import { isVideoModel } from '@/lib/batch-rules'
import type { CatalogEntity, RegenerateSource, RegenerationView } from '@/lib/types'

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export type RegenerateConfig = GenerationConfig

/**
 * Run an accepted take's job again, with anything changed: the prompt, the
 * references (same picker as Review), model, first render, look, aspect
 * ratio, duration, sound, and a note. One click is the approval; the price is
 * on the button while the settings that decide it are unchanged.
 */
export function RegenerateButton({
  jobId, decisionId, credits, source, catalog, cfg, regenerations,
}: {
  jobId: string
  decisionId: string
  credits: number | null
  source: RegenerateSource | null
  catalog: CatalogEntity[]
  cfg: RegenerateConfig
  regenerations: RegenerationView[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [picker, setPicker] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [prompt, setPrompt] = useState(source?.prompt ?? '')
  const [settings, setSettings] = useState<GenerationSettingsValue>(() => settingsFrom(source, cfg))
  const [note, setNote] = useState('')
  const { model, stage, duration, sound } = settings

  const video = isVideoModel(model)
  const priceStillValid = source
    && model === source.model
    && (!video || (stage === (source.stage ?? 'draft') && String(duration) === String(source.params.duration ?? '') && sound === (String(source.params.generate_audio) !== 'false')))

  function reset() {
    setPrompt(source?.prompt ?? '')
    setSettings(settingsFrom(source, cfg))
    setNote('')
    setError(null)
  }

  async function send() {
    setBusy(true)
    setError(null)
    const fd = new FormData()
    fd.set('jobId', jobId)
    fd.set('decisionId', decisionId)
    fd.set('prompt', prompt)
    fd.set('refs', JSON.stringify(settings.refs))
    fd.set('model', model)
    fd.set('variant', settings.variant)
    fd.set('aspect_ratio', settings.aspect)
    if (video) {
      fd.set('stage', stage)
      fd.set('duration', duration)
      if (sound) fd.set('sound', 'on')
    }
    fd.set('note', note)
    const r = await requestRegenerate(fd).catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(false)
    if (!r.ok) { setError(r.error ?? 'Could not send that.'); return }
    setOpen(false)
    reset()
    router.refresh()
  }

  return (
    <div className="space-y-2.5">
      {regenerations.length > 0 && (
        <ul className="space-y-1 text-xs text-muted">
          {regenerations.map((r) => (
            <li key={r.reqId} className="flex flex-wrap items-center gap-2">
              <RotateCcw aria-hidden className="size-3 text-faint" />
              <span>Regenerated {when(r.ts)}</span>
              {r.state === 'queued' && <Badge tone="good">queued{r.jobId ? ` · ${r.jobId}` : ''}</Badge>}
              {r.state === 'waiting' && <Badge tone="accent">waiting for the worker</Badge>}
              {r.state === 'rejected' && <Badge tone="bad">not queued: {r.reason}</Badge>}
              {r.note && <span className="text-faint" dir="auto">“{r.note}”</span>}
            </li>
          ))}
        </ul>
      )}
      <Button type="button" size="sm" tone="outline" disabled={!source} onClick={() => { reset(); setOpen(true) }} title={source ? undefined : 'The queue record for this job is missing'}>
        <RotateCcw aria-hidden className="size-3.5" /> Regenerate
      </Button>

      <Modal
        open={open}
        size="lg"
        title="Regenerate this take"
        onClose={() => setOpen(false)}
        onKeyGuard={() => !picker}
        footer={
          <>
            <span className="mr-auto flex items-center gap-1.5 self-center text-xs text-faint">
              <Coins aria-hidden className="size-3.5" />
              {priceStillValid && credits != null ? `≈ ${credits} credits` : 'priced by the worker before it runs'}
            </span>
            <Button type="button" tone="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" tone="accent" pending={busy} pendingLabel="Sending" disabled={!prompt.trim()} onClick={send}>
              <RotateCcw aria-hidden className="size-3.5" /> Regenerate
            </Button>
          </>
        }
      >
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-4">
            <Field label="Prompt (sent as written)">
              <Textarea dir="auto" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={12} className="min-h-56 max-h-[50vh] text-[13px]" />
            </Field>
            {source && source.revisionNotes.length > 0 && (
              <div className="space-y-1.5 text-xs text-muted">
                <span className="block text-[12.5px]">Notes from earlier attempts, still applied</span>
                <ul className="space-y-1 border-l border-edge pl-3">
                  {source.revisionNotes.map((n, i) => <li key={i} dir="auto">{n}</li>)}
                </ul>
              </div>
            )}
            <Field label="Anything else to change? (optional, Farsi or English)">
              <Textarea dir="auto" rows={3} value={note} onChange={(e) => setNote(e.target.value)} className="min-h-20 text-[13px]" placeholder="Added to the prompt as a revision note." />
            </Field>
          </div>

          <div className="space-y-4">
            <GenerationSettings
              value={settings}
              onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
              catalog={catalog}
              cfg={cfg}
              picker={picker}
              onPicker={setPicker}
            />
            {error && <p className="rounded-md border border-bad/35 bg-bad/8 px-3 py-2 text-xs leading-relaxed text-bad" dir="auto">{error}</p>}
          </div>
        </div>
      </Modal>
    </div>
  )
}
