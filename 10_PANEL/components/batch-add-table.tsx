'use client'

import { useMemo, useRef, useState } from 'react'
import { Check, CornerDownRight, Library, Trash2, Ungroup } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { Table, Td, Th, Thead, Tr } from '@/components/ui/table'
import { Badge } from '@/components/ui/text'
import { RoleHelp } from '@/components/role-help'
import { cn } from '@/lib/cn'
import { checkProposal, type Confidence, type Proposal } from '@/lib/batch-add'
import { KINDS, KIND_LABEL, UPLOAD_ROLES, entitySlug, type Kind } from '@/lib/indexing'
import type { UploadDraft } from '@/components/reference-editor'
import type { CatalogEntity } from '@/lib/types'

/**
 * A dropped folder, one row per file, with what each will become already
 * filled in from its name (lib/batch-add). Forty UploadCards would be a
 * kilometre of form; this is the same fields at a density you can scan.
 *
 * Every row is still only a proposal. Nothing is numbered until the worker
 * files the batch, so the ID column shows ### and "becomes V04" and says so.
 */

/** Rows the reviewer still has to answer for, first. */
const RANK: Record<Confidence, number> = { none: 0, low: 1, high: 2 }

export interface BatchRowProblem { id: string; problems: string[] }

/** What a draft looks like to the shared rules, which know nothing about Files. */
function asProposal(u: UploadDraft, order: string[]): Proposal {
  return {
    mode: u.mode,
    entity: u.entity,
    groupOf: u.groupOf ? order.indexOf(u.groupOf) : -1,
    kind: u.kind,
    name: u.name,
    description: u.description,
    role: u.role as Proposal['role'],
    descriptor: u.descriptor,
    confidence: u.confidence ?? 'low',
    candidates: u.candidates ?? [],
    needs: u.needs ?? [],
    why: u.why ?? '',
  }
}

/** Every row's problems, by upload id: the same rules the server applies. */
export function batchProblems(uploads: UploadDraft[], catalog: CatalogEntity[]): Map<string, string[]> {
  const order = uploads.map((u) => u.id)
  const batch = uploads.map((u) => asProposal(u, order))
  const out = new Map<string, string[]>()
  uploads.forEach((u, i) => {
    const problems = checkProposal(batch[i], catalog, batch, i)
    if (problems.length) out.set(u.id, problems)
  })
  return out
}

export function BatchAddTable({
  uploads,
  catalog,
  problems,
  onChange,
  onDrop,
  onUngroup,
  onGroup,
  onPickEntity,
  onView,
}: {
  uploads: UploadDraft[]
  catalog: CatalogEntity[]
  problems: Map<string, string[]>
  onChange: (id: string, patch: Partial<UploadDraft>) => void
  onDrop: (id: string) => void
  onUngroup: (id: string) => void
  onGroup: (ids: string[], leaderId: string) => void
  onPickEntity: (id: string) => void
  onView: (id: string) => void
}) {
  const [order, setOrder] = useState<'attention' | 'dropped'>('attention')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p)
      if (!next.delete(id)) next.add(id)
      return next
    })

  /**
   * How badly each row needed attention when it arrived, which is what the
   * "needs attention" order sorts by. Held from the drop rather than read live,
   * so answering a row does not make it leap out from under the cursor -- but
   * the rows themselves are rebuilt on every change, so ungrouping shows at once.
   */
  const rank = useRef(new Map<string, number>())
  for (const u of uploads) if (!rank.current.has(u.id)) rank.current.set(u.id, RANK[u.confidence ?? 'low'])

  /** Group members always sit under their leader, so a group reads as one block. */
  const rows = useMemo(() => {
    const leaders = uploads.filter((u) => !u.groupOf)
    const sorted = order === 'dropped'
      ? leaders
      : [...leaders].sort((a, b) => (rank.current.get(a.id) ?? 1) - (rank.current.get(b.id) ?? 1))
    return sorted.flatMap((lead) => [lead, ...uploads.filter((u) => u.groupOf === lead.id)])
  }, [uploads, order])

  const selected = [...picked].filter((id) => uploads.some((u) => u.id === id))
  const bulk = (patch: Partial<UploadDraft>) => { selected.forEach((id) => onChange(id, patch)); setPicked(new Set()) }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {selected.length > 0 ? (
          <>
            <span className="text-xs text-muted">{selected.length} selected</span>
            <Select aria-label="Set the kind of every selected row" value="" onChange={(e) => e.target.value && bulk({ kind: e.target.value })} className="h-8 w-40">
              <option value="">Set kind…</option>
              {KINDS.map((k) => <option key={k} value={k}>{k} · {KIND_LABEL[k]}</option>)}
            </Select>
            <Select aria-label="Set the role of every selected row" value="" onChange={(e) => e.target.value && bulk({ role: e.target.value })} className="h-8 w-36">
              <option value="">Set role…</option>
              {UPLOAD_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
            {selected.length > 1 && (
              <Button type="button" size="sm" tone="outline" onClick={() => { onGroup(selected.slice(1), selected[0]); setPicked(new Set()) }}>
                One thing, {selected.length} looks
              </Button>
            )}
            <Button type="button" size="sm" tone="ghost" onClick={() => { selected.forEach(onDrop); setPicked(new Set()) }}>
              <Trash2 aria-hidden className="size-3.5" />
              Discard
            </Button>
          </>
        ) : (
          <span className="text-xs text-muted">Tick rows to set their kind or role together.</span>
        )}
        <Segmented
          className="ml-auto"
          aria-label="Row order"
          value={order}
          options={[['attention', 'Needs attention'], ['dropped', 'As dropped']] as const}
          onChange={setOrder}
        />
      </div>

      <div className="max-h-[58vh] overflow-y-auto rounded-xl border border-edge">
        <Table>
          <Thead>
            <tr>
              <Th className="w-8" />
              <Th className="w-14">Image</Th>
              <Th>File</Th>
              <Th className="w-[19rem]">Becomes</Th>
              <Th className="w-32"><span className="inline-flex items-center gap-1.5">Role <RoleHelp /></span></Th>
              <Th className="w-56">Description</Th>
              <Th className="w-9" />
            </tr>
          </Thead>
          <tbody>
            {rows.map((u) => (
              <Row
                key={u.id}
                upload={u}
                catalog={catalog}
                problems={problems.get(u.id) ?? []}
                leader={u.groupOf ? uploads.find((x) => x.id === u.groupOf) : undefined}
                position={u.groupOf ? uploads.filter((x) => x.groupOf === u.groupOf).indexOf(u) + 2 : 0}
                checked={picked.has(u.id)}
                onToggle={() => toggle(u.id)}
                onChange={(patch) => onChange(u.id, patch)}
                onDrop={() => onDrop(u.id)}
                onUngroup={() => onUngroup(u.id)}
                onPickEntity={() => onPickEntity(u.id)}
                onView={() => onView(u.id)}
              />
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  )
}

function Row({
  upload: u, catalog, problems, leader, position, checked, onToggle, onChange, onDrop, onUngroup, onPickEntity, onView,
}: {
  upload: UploadDraft
  catalog: CatalogEntity[]
  problems: string[]
  /** The new-entity row this one is a look of, when it is in a group. */
  leader?: UploadDraft
  /** V02, V03 ... within its group; 0 when it leads or stands alone. */
  position: number
  checked: boolean
  onToggle: () => void
  onChange: (patch: Partial<UploadDraft>) => void
  onDrop: () => void
  onUngroup: () => void
  onPickEntity: () => void
  onView: () => void
}) {
  const bad = problems.length > 0
  return (
    <Tr className={cn(bad && 'border-l-2 border-l-bad', leader && 'bg-white/[0.015]')}>
      <Td className="pt-3.5">
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          aria-label={`Select ${u.file.name}`}
          onClick={onToggle}
          className={cn(
            'focus-ring grid size-[18px] shrink-0 cursor-pointer place-items-center rounded-[4px] border transition-colors duration-150',
            checked ? 'border-fg bg-fg text-ink' : 'border-edge-strong text-transparent hover:border-muted',
          )}
        >
          <Check aria-hidden strokeWidth={3.5} className="size-2.5" />
        </button>
      </Td>

      <Td>
        <button type="button" onClick={onView} aria-label={`View ${u.file.name}`} className="focus-ring block cursor-zoom-in">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={u.preview} alt="" className="checker size-12 rounded-md border border-edge object-cover" />
        </button>
      </Td>

      <Td>
        <div className="flex items-start gap-1.5">
          {leader && <CornerDownRight aria-hidden className="mt-0.5 size-3.5 shrink-0 text-faint" />}
          <div className="min-w-0">
            <div className="truncate font-mono text-[11px] text-fg/85" title={u.file.name}>{u.file.name}</div>
            {u.why && <p className="mt-1 text-[11px] leading-relaxed text-faint">{u.why}</p>}
            {problems.map((p) => <p key={p} className="mt-1 text-[11px] leading-relaxed text-bad">{p}</p>)}
          </div>
        </div>
      </Td>

      <Td>
        {leader ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="muted">V{String(position).padStart(2, '0')}</Badge>
            <span className="text-xs text-muted">of {leader.name || 'the new entity above'}</span>
            <Button type="button" size="sm" tone="ghost" onClick={onUngroup} className="h-7 px-2">
              <Ungroup aria-hidden className="size-3.5" />
              Not the same
            </Button>
          </div>
        ) : u.mode === 'variant' ? (
          <ExistingTarget upload={u} catalog={catalog} onChange={onChange} onPickEntity={onPickEntity} />
        ) : (
          <NewTarget upload={u} catalog={catalog} onChange={onChange} />
        )}
      </Td>

      <Td>
        <Select aria-label={`Role for ${u.file.name}`} value={u.role} onChange={(e) => onChange({ role: e.target.value })} className="h-8">
          {UPLOAD_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
      </Td>

      <Td>
        <Input
          dir="ltr"
          aria-label={`Description for ${u.file.name}`}
          value={u.descriptor}
          onChange={(e) => onChange({ descriptor: e.target.value, needs: (u.needs ?? []).filter((n) => n !== 'descriptor') })}
          placeholder="night facade"
          className="h-8 font-mono text-[11px]"
        />
      </Td>

      <Td>
        <Button type="button" size="sm" tone="ghost" onClick={onDrop} aria-label={`Discard ${u.file.name}`} className="h-8 px-2">
          <Trash2 aria-hidden className="size-3.5" />
        </Button>
      </Td>
    </Tr>
  )
}

/** A new look of something already in the index. */
function ExistingTarget({ upload: u, catalog, onChange, onPickEntity }: {
  upload: UploadDraft
  catalog: CatalogEntity[]
  onChange: (patch: Partial<UploadDraft>) => void
  onPickEntity: () => void
}) {
  const ent = catalog.find((e) => e.id === u.entity)
  const next = ent
    ? `V${String(ent.variants.reduce((m, v) => Math.max(m, parseInt(v.variant.slice(1), 10) || 0), 0) + 1).padStart(2, '0')}`
    : ''
  const options = (u.candidates ?? []).map((id) => catalog.find((e) => e.id === id)).filter((e): e is CatalogEntity => !!e)

  return (
    <div className="space-y-1.5">
      {ent ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-[11px] text-fg">{ent.shortId}</span>
          <span className="truncate text-xs text-muted">{ent.name}</span>
          <Badge tone="muted">{next}</Badge>
        </div>
      ) : options.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange({ entity: o.id, needs: (u.needs ?? []).filter((n) => n !== 'entity'), confidence: 'high' })}
              className="focus-ring cursor-pointer rounded-md border border-edge-strong px-2 py-1 font-mono text-[11px] text-muted transition-colors duration-150 hover:border-fg hover:text-fg"
            >
              {o.shortId}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="button" size="sm" tone="outline" onClick={onPickEntity} className="h-7 px-2">
          <Library aria-hidden className="size-3.5" />
          {ent ? 'Change' : 'Choose'}
        </Button>
        <Button
          type="button"
          size="sm"
          tone="ghost"
          onClick={() => onChange({ mode: 'new', entity: '', needs: (u.needs ?? []).filter((n) => n !== 'entity') })}
          className="h-7 px-2"
        >
          It is new
        </Button>
      </div>
    </div>
  )
}

/** Something the index does not have yet. The worker gives it its number. */
function NewTarget({ upload: u, catalog, onChange }: {
  upload: UploadDraft
  catalog: CatalogEntity[]
  onChange: (patch: Partial<UploadDraft>) => void
}) {
  const slug = entitySlug(u.name)
  const clash = slug ? catalog.find((e) => e.slug === slug) : undefined
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        <Select
          aria-label={`Kind for ${u.file.name}`}
          value={u.kind}
          onChange={(e) => onChange({
            kind: e.target.value,
            role: e.target.value === 'REF' ? 'BOARD' : u.role,
            needs: (u.needs ?? []).filter((n) => n !== 'kind'),
          })}
          className="h-8 w-24"
        >
          <option value="">Kind…</option>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </Select>
        <Input
          dir="ltr"
          aria-label={`Name for ${u.file.name}`}
          value={u.name}
          onChange={(e) => onChange({ name: e.target.value, needs: (u.needs ?? []).filter((n) => n !== 'name') })}
          placeholder="Iron Lantern"
          className="h-8"
        />
      </div>
      {clash ? (
        <p className="text-[11px] text-bad">
          {clash.shortId} already has this name.{' '}
          <button
            type="button"
            className="cursor-pointer underline"
            onClick={() => onChange({ mode: 'variant', entity: clash.id, needs: [] })}
          >
            Add it as a new look of {clash.shortId}
          </button>
        </p>
      ) : slug && u.kind ? (
        <p className="font-mono text-[10.5px] text-faint">
          {u.kind}-###-{slug} · the worker assigns the number
        </p>
      ) : null}
    </div>
  )
}

/** The counts under the table, so the footer and the summary agree. */
export function batchCounts(uploads: UploadDraft[], problems: Map<string, string[]>) {
  const groups = new Set(uploads.filter((u) => u.groupOf).map((u) => u.groupOf))
  return {
    files: uploads.length,
    newEntities: uploads.filter((u) => u.mode === 'new' && !u.groupOf).length,
    newLooks: uploads.filter((u) => u.mode === 'variant' && !u.groupOf).length,
    groups: groups.size,
    bad: [...problems.keys()].filter((id) => uploads.some((u) => u.id === id)).length,
    bytes: uploads.reduce((n, u) => n + u.file.size, 0),
  }
}
