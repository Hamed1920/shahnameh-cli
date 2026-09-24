'use client'

import { Plus, X } from 'lucide-react'
import { IndexPicker } from '@/components/index-picker'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, Input, Select } from '@/components/ui/field'
import { ModelPicker } from '@/components/model-picker'
import { priceKey } from '@/lib/batch-rules'
import { cn } from '@/lib/cn'
import {
  aspectRatiosFor, durationsFor, extraParams, hasDraft, hasSound, isVideoModel, stageResolutionFor, type ModelParam,
} from '@/lib/models'
import type { CatalogEntity } from '@/lib/types'

export interface GenerationConfig {
  /** Shown first in the model picker (worker/config.json pinnedModels). */
  pinned: string[]
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
  /** The model's own settings (Kling's mode, Nano Banana's resolution, ...), as strings. */
  extra: Record<string, string>
}

/** The model settings a job carries, for the fields this model shows. */
export function extraFrom(model: string, params: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of extraParams(model)) {
    const v = params?.[p.name]
    if (v !== undefined && v !== null && v !== '') out[p.name] = String(v)
  }
  return out
}

/** Only the settings the chosen model has; a switch of model drops the rest. */
export function extraFor(model: string, extra: Record<string, string>): Record<string, string> {
  const names = new Set(extraParams(model).map((p) => p.name))
  return Object.fromEntries(Object.entries(extra).filter(([k, v]) => names.has(k) && v !== ''))
}

/** Put the settings on a form as JSON, read back by readGenerationForm (lib/generation-form.ts). */
export function setExtra(fd: FormData, model: string, extra: Record<string, string>) {
  const e = extraFor(model, extra)
  if (Object.keys(e).length) fd.set('extra', JSON.stringify(e))
}

/**
 * A field for each setting the model has beyond aspect, duration, quality and
 * sound, drawn from its schema: a list as a dropdown, a number as a number,
 * a yes/no as a checkbox. Empty means the model's own default.
 */
export function ModelParamFields({ model, value, onChange }: {
  model: string
  value: Record<string, string>
  onChange: (next: Record<string, string>) => void
}) {
  const params = extraParams(model)
  if (params.length === 0) return null
  const set = (name: string, v: string) => onChange({ ...value, [name]: v })
  const title = (p: ModelParam) => p.name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
  return (
    <div className="grid grid-cols-2 gap-3">
      {params.map((p) => {
        const current = value[p.name] ?? ''
        if (p.enum) {
          return (
            <Field key={p.name} label={title(p)}>
              <Select value={current} onChange={(e) => set(p.name, e.target.value)}>
                <option value="">{`Default${p.default != null ? ` (${p.default})` : ''}`}</option>
                {p.enum.map((v) => <option key={String(v)} value={String(v)}>{String(v)}</option>)}
              </Select>
            </Field>
          )
        }
        if (p.type.startsWith('boolean')) {
          return (
            <div key={p.name} className="flex items-end pb-2">
              <Checkbox
                checked={current === '' ? p.default === true : current === 'true'}
                onChange={(e) => set(p.name, e.target.checked ? 'true' : 'false')}
                label={title(p)}
              />
            </div>
          )
        }
        const numeric = /integer|number/.test(p.type)
        return (
          <Field key={p.name} label={title(p)}>
            <Input
              dir="ltr"
              inputMode={numeric ? 'decimal' : undefined}
              value={current}
              placeholder={p.default === null || p.default === undefined ? 'model default' : `default ${p.default}`}
              onChange={(e) => set(p.name, numeric ? e.target.value.replace(/[^\d.-]/g, '') : e.target.value)}
              className="font-mono"
            />
          </Field>
        )
      })}
    </div>
  )
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
    extra: extraFrom(job?.model ?? '', job?.params),
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
    { stage: 'draft' as const, label: 'Draft', resolution: stageResolutionFor(model, 'draft', cfg) ?? cfg.videoDraftResolution },
    { stage: 'final' as const, label: 'Final', resolution: stageResolutionFor(model, 'final', cfg) ?? cfg.videoFinalResolution },
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
        A draft you accept is re-run at {options[1].resolution} on its own, so the final is only paid for once it is
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
  const { refs, model, variant, aspect, stage, duration, sound, extra } = value
  const aspects = aspectRatiosFor(model, cfg.aspectRatios)
  const durations = durationsFor(model, cfg.videoDurations)
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
        <ModelPicker
          value={model}
          pinned={cfg.pinned}
          onChange={(m) => {
            // Keep the aspect ratio when the new model takes it, else its first one.
            const a = aspectRatiosFor(m, cfg.aspectRatios)
            onChange({ model: m, aspect: a.includes(aspect) ? aspect : a[0] ?? aspect, extra: extraFor(m, extra) })
          }}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Look">
          <Input dir="ltr" value={variant} onChange={(e) => onChange({ variant: e.target.value.toUpperCase() })} className="font-mono" />
        </Field>
        <Field label="Aspect ratio">
          <Select value={aspect} onChange={(e) => onChange({ aspect: e.target.value })}>
            {aspects.map((a) => <option key={a} value={a}>{a}</option>)}
            {!aspects.includes(aspect) && <option value={aspect}>{aspect}</option>}
          </Select>
        </Field>
      </div>
      {isVideoModel(model) && (
        <>
          {hasDraft(model) && (
            <QualityToggle
              value={stage}
              onChange={(stage) => onChange({ stage })}
              cfg={cfg}
              model={model}
              duration={duration}
              sound={sound}
              prices={prices}
            />
          )}
          {durations && (
            <Field label="Duration">
              <Select value={duration} onChange={(e) => onChange({ duration: e.target.value })}>
                {durations.map((d) => <option key={d} value={String(d)}>{d} s</option>)}
                {!durations.map(String).includes(duration) && <option value={duration}>{duration} s</option>}
              </Select>
            </Field>
          )}
          {hasSound(model) && <Checkbox checked={sound} onChange={(e) => onChange({ sound: e.target.checked })} label="Sound" />}
        </>
      )}
      <ModelParamFields model={model} value={extra} onChange={(next) => onChange({ extra: next })} />
    </div>
  )
}
