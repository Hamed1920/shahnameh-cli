'use client'

import { Library } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/field'
import { cn } from '@/lib/cn'
import { KINDS, KIND_LABEL, entitySlug } from '@/lib/indexing'
import type { DraftRow, TargetMode } from '@/lib/batch-rules'
import type { CatalogEntity } from '@/lib/types'

/**
 * What a prompt is for: an entity from the index, a shot of an episode, or a
 * new entity the worker will number at approval. Same three-way control as
 * the upload card on Review, so it reads the same everywhere.
 */
export function TargetCell({
  row,
  catalog,
  knownShots,
  listId,
  onChange,
  onPickEntity,
}: {
  row: DraftRow
  catalog: CatalogEntity[]
  knownShots: string[]
  listId: string
  onChange: (patch: Partial<DraftRow>) => void
  onPickEntity: () => void
}) {
  const entity = catalog.find((e) => e.id === row.target || e.shortId === row.target)
  const slug = entitySlug(row.newName)
  const clash = row.targetMode === 'new' && slug ? catalog.find((e) => e.slug === slug) : undefined

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="This prompt is for" className="flex flex-wrap gap-1.5">
        {([
          ['entity', 'An entity'],
          ['shot', 'A shot'],
          ['new', 'A new entity'],
        ] as const).map(([mode, text]) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={row.targetMode === mode}
            onClick={() => onChange({ targetMode: mode as TargetMode })}
            className={cn(
              'focus-ring h-8 cursor-pointer rounded-md border px-3 text-[13px] transition-colors duration-150',
              row.targetMode === mode ? 'border-fg bg-fg text-ink' : 'border-edge-strong text-muted hover:border-muted hover:text-fg',
            )}
          >
            {text}
          </button>
        ))}
      </div>

      {row.targetMode === 'entity' && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" tone="outline" onClick={onPickEntity}>
            <Library aria-hidden className="size-3.5" />
            {entity ? 'Change entity' : 'Choose entity'}
          </Button>
          {entity ? (
            <span className="text-xs text-muted">
              <span className="font-mono text-fg">{entity.shortId}</span> {entity.name}
              {entity.canonical && <span className="text-faint"> · main look {entity.canonical}</span>}
            </span>
          ) : row.target ? (
            <span className="font-mono text-xs text-bad">{row.target} is not in the index</span>
          ) : (
            <span className="text-xs text-faint">Pick from the index.</span>
          )}
        </div>
      )}

      {row.targetMode === 'shot' && (
        <Field label="Shot id" hint="Episode, scene and shot: SHM-EP001-SC004-SH0010. Shots count in tens.">
          <Input
            dir="ltr"
            list={listId}
            value={row.target}
            onChange={(e) => onChange({ target: e.target.value.trim().toUpperCase() })}
            placeholder="SHM-EP001-SC001-SH0010"
            className="font-mono"
          />
          <datalist id={listId}>
            {knownShots.map((s) => <option key={s} value={s} />)}
          </datalist>
        </Field>
      )}

      {row.targetMode === 'new' && (
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <Field label="Kind">
            <Select value={row.newKind} onChange={(e) => onChange({ newKind: e.target.value })}>
              <option value="">Choose...</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>{k} · {KIND_LABEL[k]}</option>
              ))}
            </Select>
          </Field>
          <Field
            label="Name (English)"
            hint={
              clash ? (
                <span className="text-bad">
                  {clash.shortId} already has this name.{' '}
                  <button type="button" className="cursor-pointer underline" onClick={() => onChange({ targetMode: 'entity', target: clash.id })}>
                    Target {clash.shortId} instead
                  </button>
                </span>
              ) : slug && row.newKind ? (
                <span className="font-mono">SHM-{row.newKind}-###-{slug} · the worker assigns the number when you approve</span>
              ) : undefined
            }
          >
            <Input dir="ltr" value={row.newName} onChange={(e) => onChange({ newName: e.target.value })} placeholder="Iranian Banner" />
          </Field>
          <Field label="What is it? (optional, English)" className="sm:col-span-2">
            <Input dir="ltr" value={row.newDescription} onChange={(e) => onChange({ newDescription: e.target.value })} placeholder="Red and gold war standard carried by the delegation" />
          </Field>
        </div>
      )}
    </div>
  )
}
