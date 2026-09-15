'use client'

import { Plus, X } from 'lucide-react'
import { IndexPicker } from '@/components/index-picker'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, Input, Select } from '@/components/ui/field'
import { isVideoModel } from '@/lib/batch-rules'
import type { CatalogEntity } from '@/lib/types'

export interface GenerationConfig {
  models: { image: string[]; video: string[] }
  aspectRatios: string[]
  videoDurations: number[]
}

/** Everything about a generation except its prompt. Strings where a <select> holds them. */
export interface GenerationSettingsValue {
  refs: string[]
  model: string
  variant: string
  aspect: string
  stage: 'draft' | 'final'
  duration: string
  sound: boolean
}

/** Settings as a queued job carries them, with the config's first choices where the job is silent. */
export function settingsFrom(
  job: { refs?: string[]; model?: string; variant?: string; stage?: 'draft' | 'final' | null; params?: Record<string, unknown> } | null,
  cfg: GenerationConfig,
): GenerationSettingsValue {
  return {
    refs: job?.refs ?? [],
    model: job?.model ?? '',
    variant: job?.variant ?? 'V01',
    aspect: String(job?.params?.aspect_ratio ?? cfg.aspectRatios[0] ?? '16:9'),
    stage: job?.stage ?? 'draft',
    duration: String(job?.params?.duration ?? cfg.videoDurations[0] ?? 15),
    sound: job ? String(job.params?.generate_audio) !== 'false' : true,
  }
}

/**
 * The side column of the Regenerate and Generate dialogs: references in the
 * order the model gets them (same picker as Review), model, look, aspect
 * ratio, and for video the first render, duration and sound. The parent owns
 * the picker's open state so its dialog can ignore Escape while it is up.
 */
export function GenerationSettings({
  value, onChange, catalog, cfg, picker, onPicker,
}: {
  value: GenerationSettingsValue
  onChange: (patch: Partial<GenerationSettingsValue>) => void
  catalog: CatalogEntity[]
  cfg: GenerationConfig
  picker: boolean
  onPicker: (open: boolean) => void
}) {
  const { refs, model, variant, aspect, stage, duration, sound } = value
  const refName = (token: string) => {
    const [id, v] = token.replace(/^@/, '').split('/')
    const e = catalog.find((x) => x.id === id || x.shortId === id)
    return e ? `${e.shortId}${v ? '/' + v : ''} ${e.name}` : token
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <span className="block text-[12.5px] text-muted">References, in the order the model gets them</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {refs.map((t, n) => (
            <span key={t} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-edge-strong pl-2.5 pr-1 font-mono text-[11.5px] text-fg">
              <span className="text-faint">{n + 1}</span> {refName(t)}
              <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange({ refs: refs.filter((x) => x !== t) })} className="focus-ring grid size-5 cursor-pointer place-items-center rounded text-muted hover:text-fg">
                <X aria-hidden className="size-3" />
              </button>
            </span>
          ))}
          <Button type="button" size="sm" tone="outline" onClick={() => onPicker(true)}>
            <Plus aria-hidden className="size-3.5" /> Add
          </Button>
        </div>
      </div>

      <Field label="Model">
        <Select value={model} onChange={(e) => onChange({ model: e.target.value })}>
          <optgroup label="Video">{cfg.models.video.map((m) => <option key={m} value={m}>{m}</option>)}</optgroup>
          <optgroup label="Image">{cfg.models.image.map((m) => <option key={m} value={m}>{m}</option>)}</optgroup>
          {model && !cfg.models.video.includes(model) && !cfg.models.image.includes(model) && <option value={model}>{model}</option>}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Look">
          <Input dir="ltr" value={variant} onChange={(e) => onChange({ variant: e.target.value.toUpperCase() })} className="font-mono" />
        </Field>
        <Field label="Aspect ratio">
          <Select value={aspect} onChange={(e) => onChange({ aspect: e.target.value })}>
            {cfg.aspectRatios.map((a) => <option key={a} value={a}>{a}</option>)}
            {!cfg.aspectRatios.includes(aspect) && <option value={aspect}>{aspect}</option>}
          </Select>
        </Field>
      </div>
      {isVideoModel(model) && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First render">
              <Select value={stage} onChange={(e) => onChange({ stage: e.target.value as 'draft' | 'final' })}>
                <option value="draft">draft</option>
                <option value="final">final</option>
              </Select>
            </Field>
            <Field label="Duration">
              <Select value={duration} onChange={(e) => onChange({ duration: e.target.value })}>
                {cfg.videoDurations.map((d) => <option key={d} value={String(d)}>{d} s</option>)}
                {!cfg.videoDurations.map(String).includes(duration) && <option value={duration}>{duration} s</option>}
              </Select>
            </Field>
          </div>
          <Checkbox checked={sound} onChange={(e) => onChange({ sound: e.target.checked })} label="Sound" />
        </>
      )}

      <IndexPicker
        open={picker}
        mode="ref"
        title="Add a reference"
        catalog={catalog}
        onClose={() => onPicker(false)}
        onPickRef={(token) => { if (!refs.includes(token)) onChange({ refs: [...refs, token] }); onPicker(false) }}
      />
    </div>
  )
}
