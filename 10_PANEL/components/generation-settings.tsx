'use client'

import { Plus, X } from 'lucide-react'
import { IndexPicker } from '@/components/index-picker'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, Input, Select } from '@/components/ui/field'
import { isVideoModel, priceKey } from '@/lib/batch-rules'
import { cn } from '@/lib/cn'
import type { CatalogEntity } from '@/lib/types'

export interface GenerationConfig {
  models: { image: string[]; video: string[] }
  aspectRatios: string[]
  videoDurations: number[]
  /** What a draft and a final actually render at, from the worker's config. */
  videoDraftResolution: string
  videoFinalResolution: string
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
 * The two qualities a video can render at, side by side and priced.
 *
 * `stage` is what the worker reads; it moves `params.resolution` with it
 * (worker/lib/job-requests.mjs), so this is the cost control rather than a
 * scheduling detail. The old control said only "draft" or "final", which named
 * neither the resolution nor the price -- the two things the choice is about.
 *
 * A price is the last real ledger price for that exact model, resolution,
 * duration and sound. A combination nobody has generated yet says so instead
 * of guessing at it.
 */
function QualityToggle({
  value, onChange, cfg, model, duration, sound, prices,
}: {
  value: 'draft' | 'final'
  onChange: (stage: 'draft' | 'final') => void
  cfg: GenerationConfig
  model: string
  duration: string
  sound: boolean
  prices?: Record<string, number>
}) {
  const options = [
    { stage: 'draft' as const, label: 'Draft', resolution: cfg.videoDraftResolution },
    { stage: 'final' as const, label: 'Final', resolution: cfg.videoFinalResolution },
  ]
  return (
    <div className="space-y-1.5">
      <span className="block text-[12.5px] text-muted">Quality</span>
      <div className="grid grid-cols-2 gap-2">
        {options.map((o) => {
          const credits = prices?.[priceKey(model, { resolution: o.resolution, duration, generate_audio: sound })]
          const on = value === o.stage
          return (
            <button
              key={o.stage}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o.stage)}
              className={cn(
                'focus-ring cursor-pointer rounded-lg border px-3 py-2.5 text-left transition',
                on ? 'border-accent bg-accent/8' : 'border-edge hover:border-edge-strong',
              )}
            >
              <span className="flex items-baseline gap-1.5">
                <span className="text-[13px] text-fg">{o.label}</span>
                <span className="font-mono text-[11.5px] text-muted">{o.resolution}</span>
              </span>
              <span className="mt-0.5 block font-mono text-[11px] text-faint tabular-nums">
                {credits != null ? `≈ ${credits} cr` : 'priced when it runs'}
              </span>
            </button>
          )
        })}
      </div>
      <p className="text-[11.5px] leading-relaxed text-faint">
        A draft you accept is re-run at {cfg.videoFinalResolution} on its own, so the final is only paid for once it is
        worth having.
      </p>
    </div>
  )
}

/**
 * The side column of the Regenerate and Generate dialogs: references in the
 * order the model gets them (same picker as Review), model, look, aspect
 * ratio, and for video the quality, duration and sound. The parent owns
 * the picker's open state so its dialog can ignore Escape while it is up.
 */
export function GenerationSettings({
  value, onChange, catalog, cfg, picker, onPicker, prices, showRefs = true,
}: {
  value: GenerationSettingsValue
  onChange: (patch: Partial<GenerationSettingsValue>) => void
  catalog: CatalogEntity[]
  cfg: GenerationConfig
  picker: boolean
  onPicker: (open: boolean) => void
  /** Last real price per priceKey, from the ledger. Absent while unknown. */
  prices?: Record<string, number>
  /** False where the dialog shows references itself, as thumbnails (Regenerate). */
  showRefs?: boolean
}) {
  const { refs, model, variant, aspect, stage, duration, sound } = value
  const refName = (token: string) => {
    const [id, v] = token.replace(/^@/, '').split('/')
    const e = catalog.find((x) => x.id === id || x.shortId === id)
    return e ? `${e.shortId}${v ? '/' + v : ''} ${e.name}` : token
  }

  return (
    <div className="space-y-4">
      {showRefs && (<>
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
      <IndexPicker
        open={picker}
        mode="ref"
        title="Add a reference"
        catalog={catalog}
        onClose={() => onPicker(false)}
        onPickRef={(token) => { if (!refs.includes(token)) onChange({ refs: [...refs, token] }); onPicker(false) }}
      />
      </>)}

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
          <QualityToggle
            value={stage}
            onChange={(stage) => onChange({ stage })}
            cfg={cfg}
            model={model}
            duration={duration}
            sound={sound}
            prices={prices}
          />
          <Field label="Duration">
            <Select value={duration} onChange={(e) => onChange({ duration: e.target.value })}>
              {cfg.videoDurations.map((d) => <option key={d} value={String(d)}>{d} s</option>)}
              {!cfg.videoDurations.map(String).includes(duration) && <option value={duration}>{duration} s</option>}
            </Select>
          </Field>
          <Checkbox checked={sound} onChange={(e) => onChange({ sound: e.target.checked })} label="Sound" />
        </>
      )}
    </div>
  )
}
