'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Coins, Plus, RotateCcw, X } from 'lucide-react'
import { requestRegenerate } from '@/app/decided/actions'
import { IndexPicker } from '@/components/index-picker'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { Modal } from '@/components/ui/modal'
import { Badge } from '@/components/ui/text'
import { isVideoModel } from '@/lib/batch-rules'
import type { CatalogEntity, RegenerateSource, RegenerationView } from '@/lib/types'

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export interface RegenerateConfig {
  models: { image: string[]; video: string[] }
  aspectRatios: string[]
  videoDurations: number[]
}

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
  const [refs, setRefs] = useState<string[]>(source?.refs ?? [])
  const [model, setModel] = useState(source?.model ?? '')
  const [stage, setStage] = useState<'draft' | 'final'>(source?.stage ?? 'draft')
  const [variant, setVariant] = useState(source?.variant ?? 'V01')
  const [aspect, setAspect] = useState(String(source?.params.aspect_ratio ?? cfg.aspectRatios[0] ?? '16:9'))
  const [duration, setDuration] = useState(String(source?.params.duration ?? cfg.videoDurations[0] ?? 15))
  const [sound, setSound] = useState(source ? String(source.params.generate_audio) !== 'false' : true)
  const [note, setNote] = useState('')

  const video = isVideoModel(model)
  const priceStillValid = source
    && model === source.model
    && (!video || (stage === (source.stage ?? 'draft') && String(duration) === String(source.params.duration ?? '') && sound === (String(source.params.generate_audio) !== 'false')))
  const refName = (token: string) => {
    const [id, v] = token.replace(/^@/, '').split('/')
    const e = catalog.find((x) => x.id === id || x.shortId === id)
    return e ? `${e.shortId}${v ? '/' + v : ''} ${e.name}` : token
  }

  function reset() {
    setPrompt(source?.prompt ?? '')
    setRefs(source?.refs ?? [])
    setModel(source?.model ?? '')
    setStage(source?.stage ?? 'draft')
    setVariant(source?.variant ?? 'V01')
    setAspect(String(source?.params.aspect_ratio ?? cfg.aspectRatios[0] ?? '16:9'))
    setDuration(String(source?.params.duration ?? cfg.videoDurations[0] ?? 15))
    setSound(source ? String(source.params.generate_audio) !== 'false' : true)
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
    fd.set('refs', JSON.stringify(refs))
    fd.set('model', model)
    fd.set('variant', variant)
    fd.set('aspect_ratio', aspect)
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
            <div className="space-y-2">
              <span className="block text-[12.5px] text-muted">References, in the order the model gets them</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {refs.map((t, n) => (
                  <span key={t} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-edge-strong pl-2.5 pr-1 font-mono text-[11.5px] text-fg">
                    <span className="text-faint">{n + 1}</span> {refName(t)}
                    <button type="button" aria-label={`Remove ${t}`} onClick={() => setRefs(refs.filter((x) => x !== t))} className="focus-ring grid size-5 cursor-pointer place-items-center rounded text-muted hover:text-fg">
                      <X aria-hidden className="size-3" />
                    </button>
                  </span>
                ))}
                <Button type="button" size="sm" tone="outline" onClick={() => setPicker(true)}>
                  <Plus aria-hidden className="size-3.5" /> Add
                </Button>
              </div>
            </div>

            <Field label="Model">
              <Select value={model} onChange={(e) => setModel(e.target.value)}>
                <optgroup label="Video">{cfg.models.video.map((m) => <option key={m} value={m}>{m}</option>)}</optgroup>
                <optgroup label="Image">{cfg.models.image.map((m) => <option key={m} value={m}>{m}</option>)}</optgroup>
                {model && !cfg.models.video.includes(model) && !cfg.models.image.includes(model) && <option value={model}>{model}</option>}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Look">
                <Input dir="ltr" value={variant} onChange={(e) => setVariant(e.target.value.toUpperCase())} className="font-mono" />
              </Field>
              <Field label="Aspect ratio">
                <Select value={aspect} onChange={(e) => setAspect(e.target.value)}>
                  {cfg.aspectRatios.map((a) => <option key={a} value={a}>{a}</option>)}
                  {!cfg.aspectRatios.includes(aspect) && <option value={aspect}>{aspect}</option>}
                </Select>
              </Field>
            </div>
            {video && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="First render">
                    <Select value={stage} onChange={(e) => setStage(e.target.value as 'draft' | 'final')}>
                      <option value="draft">draft</option>
                      <option value="final">final</option>
                    </Select>
                  </Field>
                  <Field label="Duration">
                    <Select value={duration} onChange={(e) => setDuration(e.target.value)}>
                      {cfg.videoDurations.map((d) => <option key={d} value={String(d)}>{d} s</option>)}
                      {!cfg.videoDurations.map(String).includes(duration) && <option value={duration}>{duration} s</option>}
                    </Select>
                  </Field>
                </div>
                <Checkbox checked={sound} onChange={(e) => setSound(e.target.checked)} label="Sound" />
              </>
            )}
            {error && <p className="rounded-md border border-bad/35 bg-bad/8 px-3 py-2 text-xs leading-relaxed text-bad" dir="auto">{error}</p>}
          </div>
        </div>
      </Modal>

      <IndexPicker
        open={picker}
        mode="ref"
        title="Add a reference"
        catalog={catalog}
        onClose={() => setPicker(false)}
        onPickRef={(token) => { if (!refs.includes(token)) setRefs([...refs, token]); setPicker(false) }}
      />
    </div>
  )
}
