'use client'

import { Select } from '@/components/ui/field'
import { modelInfo, modelsFor } from '@/lib/models'

/**
 * Every Higgsfield model a prompt can use, from the worker's catalogue
 * (worker/MODEL_CATALOG.json): the config's pinned ones first, then all video
 * and all image models by name, with a search box. `kind` narrows it (the
 * reference studio makes images only). A model the job already names but the
 * catalogue no longer lists stays selectable, so an old job still shows what it used.
 */
export function ModelPicker({
  value, onChange, pinned = [], kind = null, allowDefault, className, 'aria-label': ariaLabel,
}: {
  value: string
  onChange: (model: string) => void
  pinned?: string[]
  kind?: 'image' | 'video' | null
  /** A first option meaning "no override", e.g. "Batch default (Seedance 2.5)". */
  allowDefault?: string
  className?: string
  'aria-label'?: string
}) {
  const list = modelsFor(kind, pinned)
  const top = list.filter((m) => pinned.includes(m.job_type))
  const rest = list.filter((m) => !pinned.includes(m.job_type))
  const video = rest.filter((m) => m.type === 'video')
  const image = rest.filter((m) => m.type === 'image')
  const known = value === '' || list.some((m) => m.job_type === value)
  const label = (m: { display_name: string; job_type: string }) => (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="truncate">{m.display_name}</span>
      <span className="font-mono text-[10.5px] text-faint">{m.job_type}</span>
    </span>
  )
  const kindTag = (t: string) => (t === 'video' ? 'Video' : 'Image')

  return (
    <Select searchable value={value} onChange={(e) => onChange(e.target.value)} className={className} aria-label={ariaLabel ?? 'Model'}>
      {allowDefault !== undefined && <option value="">{allowDefault}</option>}
      {top.length > 0 && (
        <optgroup label="Pinned">
          {top.map((m) => <option key={m.job_type} value={m.job_type}>{label({ ...m, display_name: `${m.display_name} · ${kindTag(m.type)}` })}</option>)}
        </optgroup>
      )}
      {video.length > 0 && <optgroup label="Video">{video.map((m) => <option key={m.job_type} value={m.job_type}>{label(m)}</option>)}</optgroup>}
      {image.length > 0 && <optgroup label="Image">{image.map((m) => <option key={m.job_type} value={m.job_type}>{label(m)}</option>)}</optgroup>}
      {!known && <option value={value}>{modelInfo(value)?.display_name ?? value} (not in the model list)</option>}
    </Select>
  )
}
