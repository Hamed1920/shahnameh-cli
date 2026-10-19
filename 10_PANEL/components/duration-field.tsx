'use client'

import { Select } from '@/components/ui/field'
import { durationOptions } from '@/lib/models'

/**
 * The length of a video, always a dropdown: the lengths the model names, or every whole second
 * between its two limits when it takes any number in a range. A value outside the choices (say from
 * a document) is kept as an extra option rather than lost.
 * `value` is the seconds as text ('' = not set, for a per-row override that follows the batch).
 */
export function DurationField({
  model,
  fallback,
  value,
  onChange,
  placeholder,
  emptyLabel,
  className,
  'aria-label': ariaLabel = 'Duration',
}: {
  model: string
  /** The config's list, for a model whose limits the catalogue does not know. */
  fallback: number[]
  value: string
  onChange: (value: string) => void
  /** The empty option's text when `emptyLabel` is not given and nothing is chosen yet. */
  placeholder?: string
  /** A Select's empty choice (a per-row override); omit when a value is required. */
  emptyLabel?: string
  className?: string
  'aria-label'?: string
}) {
  const opts = durationOptions(model, fallback)
  if (!opts) return null

  const values =
    opts.kind === 'range'
      ? Array.from({ length: Math.max(0, Math.floor(opts.max) - Math.ceil(opts.min) + 1) }, (_, i) => Math.ceil(opts.min) + i)
      : opts.values
  const shown = value !== '' && !values.map(String).includes(value)
  const empty = emptyLabel ?? (value === '' ? placeholder : undefined)
  return (
    <Select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      {empty !== undefined && <option value="">{empty}</option>}
      {values.map((d) => <option key={d} value={String(d)}>{d} s</option>)}
      {shown && <option value={value}>{value} s</option>}
    </Select>
  )
}
