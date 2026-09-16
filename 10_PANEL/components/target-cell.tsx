'use client'

import { useMemo } from 'react'
import { Library } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { KINDS, KIND_LABEL, entitySlug } from '@/lib/indexing'
import { targetCandidates } from '@/lib/ref-suggest'
import type { DraftRow, TargetMode } from '@/lib/batch-rules'
import type { CatalogEntity } from '@/lib/types'

/**
 * Where an accepted result is filed. Not who is in it -- that is the
 * references. Footage goes to a shot, and by default to the next free scene,
 * which the worker numbers at approval. A design image (a new look, a prop
 * sheet) goes to the entity it is a look of, suggested from its references.
 */
export function TargetCell({
  row,
  catalog,
  knownShots,
  scenePreview,
  listId,
  onChange,
  onPickEntity,
}: {
  row: DraftRow
  catalog: CatalogEntity[]
  knownShots: string[]
  /** What the next free scene would be for this row, counting the rows above it. */
  scenePreview: string | null
  listId: string
  onChange: (patch: Partial<DraftRow>) => void
  onPickEntity: () => void
}) {
  const entity = catalog.find((e) => e.id === row.target || e.shortId === row.target)
  const slug = entitySlug(row.newName)
  const clash = row.targetMode === 'new' && slug ? catalog.find((e) => e.slug === slug) : undefined
  const candidates = useMemo(
    () => (row.targetMode === 'entity' ? targetCandidates(row.prompt, row.refs, catalog) : []),
    [row.targetMode, row.prompt, row.refs, catalog],
  )
  const usedShot = row.targetMode === 'shot' && !row.sceneAuto && knownShots.includes(row.target.trim())

  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-x-4 gap-y-3">
      <RowLabel>File under</RowLabel>
      <Segmented
        aria-label="File the result under"
        value={row.targetMode}
        onChange={(mode: TargetMode) => onChange({ targetMode: mode })}
        options={[['shot', 'A shot'], ['entity', 'An entity'], ['new', 'A new entity']]}
      />

      {row.targetMode === 'shot' && (
        <>
          <RowLabel>Scene</RowLabel>
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                aria-label="Which shot"
                value={row.sceneAuto ? 'auto' : 'specific'}
                onChange={(v) => onChange({ sceneAuto: v === 'auto' })}
                options={[['auto', 'Next free'], ['specific', 'Specific shot']]}
              />
              {row.sceneAuto ? (
                <Input
                  dir="ltr"
                  aria-label="Episode"
                  value={row.episode}
                  onChange={(e) => onChange({ episode: e.target.value.trim().toUpperCase() })}
                  placeholder="EP001"
                  className="w-24 font-mono text-[13px]"
                />
              ) : (
                <>
                  <Input
                    dir="ltr"
                    aria-label="Shot id"
                    list={listId}
                    value={row.target}
                    onChange={(e) => onChange({ target: e.target.value.trim().toUpperCase() })}
                    placeholder="SHM-EP001-SC001-SH0010"
                    className="w-64 min-w-0 flex-1 font-mono text-[13px]"
                  />
                  <datalist id={listId}>
                    {knownShots.map((s) => <option key={s} value={s} />)}
                  </datalist>
                </>
              )}
            </div>
            <p className="text-xs leading-relaxed text-faint">
              {row.sceneAuto ? (
                scenePreview ? (
                  <>
                    Becomes <span className="font-mono text-muted">{scenePreview.replace(/^SHM-/, '')}</span> if approved now; the worker numbers it at approval.
                  </>
                ) : 'An episode looks like EP001.'
              ) : usedShot ? 'That shot already has takes; this adds another.' : 'Episode, scene and shot. Shots count in tens.'}
            </p>
          </div>
        </>
      )}

      {row.targetMode === 'entity' && (
        <>
        <RowLabel>Entity</RowLabel>
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" tone="outline" onClick={onPickEntity}>
              <Library aria-hidden className="size-3.5" />
              {entity ? 'Change' : 'Choose from the index'}
            </Button>
            {entity ? (
              <span className="text-xs text-muted">
                <span className="font-mono text-fg">{entity.shortId}</span> {entity.name}
                {entity.canonical && <span className="text-faint"> · main look {entity.canonical}</span>}
              </span>
            ) : row.target ? (
              <span className="font-mono text-xs text-bad">{row.target} is not in the index</span>
            ) : (
              <span className="text-xs text-faint">For a design image: a new look or sheet of something in the index.</span>
            )}
          </div>
          {candidates.some((c) => c !== entity) && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="mr-1 text-faint">{row.refs.length ? 'From its references' : 'Named in the prompt'}</span>
              {candidates.filter((c) => c !== entity).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onChange({ target: c.id })}
                  className="focus-ring inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-edge-strong px-2.5 text-muted transition-colors duration-150 hover:border-muted hover:text-fg"
                >
                  <span className="font-mono text-fg">{c.shortId}</span> {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
        </>
      )}

      {row.targetMode === 'new' && (
        <div className="col-span-2 grid gap-3 sm:grid-cols-[10rem_1fr]">
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

/** The left column of the row's settings: a label centred on the 36px control beside it. */
export function RowLabel({ children }: { children: React.ReactNode }) {
  return <span className="flex h-9 items-center text-[12.5px] text-muted">{children}</span>
}
