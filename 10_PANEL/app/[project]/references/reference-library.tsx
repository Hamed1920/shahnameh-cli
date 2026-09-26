'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Archive, ArchiveRestore, Check, ChevronDown, Copy, FolderOpen, ImageOff, LoaderCircle, Maximize2,
  MoveRight, Pencil, Plus, Search, Star, Tag, Undo2, Upload, X,
} from 'lucide-react'
import { revealInFolder } from '../reveal-action'
import { useAssetUrls, useProject } from '@/components/project-context'
import { requestIndexOp } from './actions'
import { IndexPicker } from '@/components/index-picker'
import { Lightbox, type LightboxItem } from '@/components/lightbox'
import { useReferenceEdits } from '@/components/reference-editor'
import { BatchAddTable, batchCounts, batchProblems } from '@/components/batch-add-table'
import { Button } from '@/components/ui/button'
import { ContextMenu, type MenuEntry } from '@/components/ui/context-menu'
import { EmptyState } from '@/components/ui/card'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { EASE } from '@/components/ui/motion-tokens'
import { Modal } from '@/components/ui/modal'
import { Badge, StickyHeader } from '@/components/ui/text'
import { useToast } from '@/components/toast'
import { cn } from '@/lib/cn'
import {
  KINDS, MAX_ADD_TOTAL_BYTES, MAX_ADD_UPLOADS, MAX_UPLOAD_BYTES, UPLOAD_ACCEPT, entitySlug, type Kind,
} from '@/lib/indexing'
import type { CatalogEntity, LibraryData, LibraryEntity, LookUse } from '@/lib/types'

const ROLES = ['HERO', 'TURNAROUND', 'PLATE', 'DETAIL', 'BOARD', 'RENDER']
const PLURAL: Record<string, string> = {
  CHR: 'Characters', GRP: 'Groups', LOC: 'Locations', PRP: 'Props', CRT: 'Creatures',
  COS: 'Costumes', VEH: 'Vehicles', FX: 'Effects', REF: 'Reference boards',
}
const STATUSES = ['CONCEPT', 'APPROVED', 'LOCKED'] as const
const lookKey = (entityId: string, variant: string) => `${entityId}|${variant}`
const splitLook = (k: string) => { const [entity, variant] = k.split('|'); return { entity, variant } }
type LookRef = { entity: string; variant: string }

type View = 'ALL' | Kind | 'RETIRED' | 'ARCHIVED'

const USE_STATE: Record<LookUse['state'], string> = { generating: 'generating now', queued: 'queued', review: 'waiting for review' }
/** "P12 (waiting for review), P05 (generating now)" */
const usesText = (uses: LookUse[]) => uses.map((u) => `${u.label} (${USE_STATE[u.state]})`).join(', ')
/** Uses the worker has to wait out: it will not pull a file from under a job that still needs it. */
const blockingUses = (uses: LookUse[]) => uses.filter((u) => u.state !== 'review')
type ToastTone = 'good' | 'bad' | 'muted'

function SelectBox({ checked, onChange, label, className }: { checked: boolean; onChange: () => void; label: string; className?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); onChange() }}
      className={cn(
        'focus-ring grid size-[18px] shrink-0 cursor-pointer place-items-center rounded-[4px] border transition-colors duration-150',
        checked ? 'border-fg bg-fg text-ink' : 'border-edge-strong bg-black/70 text-transparent hover:border-muted',
        className,
      )}
    >
      <Check aria-hidden strokeWidth={3.5} className="size-2.5" />
    </button>
  )
}

function Menu({ label, icon, items, disabled }: { label: string; icon: React.ReactNode; items: { label: string; onClick: () => void }[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div ref={ref} className="relative">
      <Button type="button" size="sm" tone="outline" disabled={disabled} onClick={() => setOpen((o) => !o)}>
        {icon} {label} <ChevronDown aria-hidden className="size-3" />
      </Button>
      {open && (
        <div className="absolute bottom-full left-0 z-10 mb-2 min-w-40 rounded-lg border border-edge-strong bg-raise p-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.85)]">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              onClick={() => { setOpen(false); it.onClick() }}
              className="block h-8 w-full cursor-pointer rounded-md px-3 text-left text-[13px] text-fg/90 hover:bg-white/[0.06] hover:text-fg"
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Browse and manage every reference in the index. Every change is a request
 * the worker applies (it is the only writer of the registries), so an edited
 * card shows "applying" for a moment and then refreshes with the result.
 */
/**
 * `actions` sit in the sticky header beside "Add references" (the reference
 * studio's launcher). Rendered above the library instead, they sat under this
 * header, which pulls itself up over whatever comes first on the page.
 */
export function ReferenceLibrary({ data, catalog, actions }: { data: LibraryData; catalog: CatalogEntity[]; actions?: React.ReactNode }) {
  const project = useProject()
  const { assetUrl, thumbUrl } = useAssetUrls()
  const [view, setView] = useState<View>('ALL')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'ALL' | (typeof STATUSES)[number]>('ALL')
  const [selE, setSelE] = useState<Set<string>>(new Set())
  const [selL, setSelL] = useState<Set<string>>(new Set())
  const [selA, setSelA] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<LibraryEntity | null>(null)
  // The entity open in the large view. Looked up by id on every render, so it
  // shows the worker's changes the moment they land.
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState<{ entity: string } | null>(null)
  const [moveLooks, setMoveLooks] = useState<LookRef[] | null>(null)
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; entries: MenuEntry[] } | null>(null)
  const [confirm, setConfirm] = useState<{ title: string; body: string; label: string; run: () => void } | null>(null)
  const [viewer, setViewer] = useState<{ items: LightboxItem[]; index: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const toaster = useToast()

  // The panel's toasts (components/toast.tsx). A problem stays until it is
  // dismissed: it says what to do next, and a few seconds is easy to miss
  // while looking at a picture.
  const toast = useCallback((tone: ToastTone, text: string, ms = 4500) => {
    toaster.show({ tone: tone === 'muted' ? 'working' : tone, title: text, duration: tone === 'bad' ? null : ms })
  }, [toaster])

  // What the worker made of each request arrives as a toast on any page, from
  // the sidebar's activity feed (components/activity.tsx), not from here.
  const oldestPending = data.pending[0]?.ts
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t) }, [])
  // The worker applies a request within a few seconds. When it can't, say why
  // instead of spinning: not running, running code from before an update, or slow.
  const waitedMs = oldestPending ? now - new Date(oldestPending).getTime() : 0
  const waiting = data.pending.length
  const waitNote = !data.worker.running
    ? `${waiting} waiting: the worker isn’t running, so ${waiting === 1 ? 'it is' : 'they are'} applied once it starts. The Queue page says why.`
    : data.worker.outdated && waitedMs > 10000
      ? `${waiting} waiting: the worker restarts on the new code once it is idle, then applies ${waiting === 1 ? 'it' : 'them'}.`
      : waitedMs > 20000
        ? `${waiting} waiting longer than usual. The worker’s log on the Queue page may say why.`
        : null

  const byId = useMemo(() => new Map(data.entities.map((e) => [e.id, e])), [data.entities])
  const pendingFor = (e: LibraryEntity) => data.pending.some((op) => JSON.stringify(op).includes(e.id))

  const live = data.entities.filter((e) => e.status !== 'RETIRED')
  const retired = data.entities.filter((e) => e.status === 'RETIRED')
  const q = query.trim().toLowerCase()
  const visible = (view === 'RETIRED' ? retired : live)
    .filter((e) => view === 'ALL' || view === 'RETIRED' || e.kind === view)
    .filter((e) => status === 'ALL' || e.status === status)
    .filter((e) => !q || [e.id, e.shortId, e.name, e.description].some((s) => s.toLowerCase().includes(q)))

  const sections = view === 'ALL'
    ? KINDS.map((k) => ({ kind: k as string, items: visible.filter((e) => e.kind === k) })).filter((s) => s.items.length)
    : [{ kind: view as string, items: visible }]

  /**
   * Off the set as it is when the click lands, not as it was when the thing
   * that carries the click was built: a right-click menu is built once, on
   * open, and a stale copy of the selection would undo whatever was picked
   * between the two.
   */
  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) => {
    setter((was) => {
      const n = new Set(was)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  }
  const clearSelection = () => { setSelE(new Set()); setSelL(new Set()); setSelA(new Set()) }
  const total = selE.size + selL.size + selA.size

  async function send(op: Record<string, unknown>, fd = new FormData()) {
    fd.set('op', JSON.stringify(op))
    setBusy(true)
    fd.set('project', project.slug)
    // The action re-renders this page in its own response; results arrive through LiveRefresh.
    const r = await requestIndexOp(fd).catch((e: Error) => ({ ok: false as const, error: e.message }))
    setBusy(false)
    if (!r.ok) { toast('bad', r.error ?? 'Could not send that.', 8000); return false }
    toast('muted', 'Sent to the worker…', 2500)
    clearSelection()
    return true
  }

  const selEntities = [...selE].map((id) => byId.get(id)!).filter(Boolean)
  const selLooks = [...selL].map(splitLook)
  const tokensOf = () => [
    ...selEntities.map((e) => `@${e.shortId}`),
    ...selLooks.map((l) => `@${byId.get(l.entity)?.shortId}/${l.variant}`),
  ]
  const lookPath = (l: { entity: string; variant: string }) => byId.get(l.entity)?.looks.find((x) => x.variant === l.variant)?.path

  /** Confirm, then archive. Says up front what happens to anything that uses these looks. */
  const archiveLooks = (looks: LookRef[]) => {
    const label = (l: LookRef) => `${byId.get(l.entity)?.shortId}/${l.variant}`
    const lines = ['The pictures move to “Archived looks” and stop being usable as references. Nothing is deleted, and you can restore them.']
    for (const l of looks) {
      const e = byId.get(l.entity)
      const uses = e?.looks.find((x) => x.variant === l.variant)?.usedBy ?? []
      const blocked = blockingUses(uses)
      const review = uses.filter((u) => u.state === 'review')
      if (blocked.length) lines.push(`${label(l)} is used by ${usesText(blocked)}, so the worker will not archive it until that has finished.`)
      if (review.length) {
        lines.push(`${review.map((u) => u.label).join(', ')} ${review.length === 1 ? 'is' : 'are'} waiting for review with ${label(l)}. `
          + `${review.length === 1 ? 'It' : 'They'} will use ${e?.name ?? 'its'}’s main look instead, so a redo or final still works.`)
      }
    }
    setConfirm({
      title: `Archive ${looks.length === 1 ? label(looks[0]) : `${looks.length} looks`}?`,
      body: lines.join(' '),
      label: 'Archive',
      run: () => send({ type: 'archive', looks }),
    })
  }

  const kindCount = (k: string) => live.filter((e) => e.kind === k).length

  // ------------------------------------------------ right-click menus
  const openMenu = (ev: React.MouseEvent, entries: MenuEntry[]) => {
    ev.preventDefault()
    ev.stopPropagation()
    setMenu({ at: { x: ev.clientX, y: ev.clientY }, entries })
  }
  const copyTokens = async (tokens: string[]) => {
    await navigator.clipboard.writeText(tokens.join(' '))
    toast('good', `Copied ${tokens.join(' ')}`, 3000)
  }
  const reveal = async (p: string) => {
    const r = await revealInFolder(project.slug, p)
    if (!r.ok) toast('bad', r.error ?? 'Could not open the folder.')
  }
  const viewItemsOf = (e: LibraryEntity): LightboxItem[] =>
    e.looks.map((l) => ({ src: assetUrl(l.path), title: `${e.shortId}/${l.variant}`, subtitle: `${e.name} · ${l.role}` }))
  const confirmRetire = (e: LibraryEntity) => setConfirm({
    title: `Retire ${e.shortId}?`,
    body: 'It disappears from pickers and can’t be used in new jobs. Its number and files are kept, and you can restore it from “Retired”.',
    label: 'Retire',
    run: () => send({ type: 'retire', entities: [e.id] }),
  })

  /** Everything you can do to one look, without selecting it first. */
  const lookEntries = (e: LibraryEntity, variant: string, selection?: { selected: boolean; toggle: () => void }): MenuEntry[] => {
    const l = e.looks.find((x) => x.variant === variant)
    if (!l) return []
    const token = `@${e.shortId}/${variant}`
    const one = [{ entity: e.id, variant }]
    const retired = e.status === 'RETIRED'
    const inUse = blockingUses(l.usedBy).length > 0
    return [
      { heading: `${token} · ${e.name}` },
      ...(l.usedBy.length ? [{ heading: `Used by ${usesText(l.usedBy)}` }] : []),
      { label: 'View full screen', icon: <Maximize2 className="size-3.5" />, onSelect: () => setViewer({ items: viewItemsOf(e), index: e.looks.indexOf(l) }) },
      { label: 'Copy reference', icon: <Copy className="size-3.5" />, hint: token, onSelect: () => copyTokens([token]) },
      { label: 'Show in folder', icon: <FolderOpen className="size-3.5" />, onSelect: () => reveal(l.path) },
      { divider: true },
      ...(selection ? [{ label: selection.selected ? 'Unselect' : 'Select', icon: <Check className="size-3.5" />, onSelect: selection.toggle }] : []),
      {
        label: variant === e.canonical ? 'Already the main look' : 'Make main look',
        icon: <Star className="size-3.5" />,
        disabled: variant === e.canonical || retired,
        onSelect: () => send({ type: 'canonical', entity: e.id, variant }),
      },
      { label: 'Move to another entity…', icon: <MoveRight className="size-3.5" />, disabled: retired || inUse, hint: inUse ? 'in use' : undefined, onSelect: () => setMoveLooks(one) },
      { caption: 'Role', chips: ROLES.map((r) => ({ label: r, active: r === l.role, onSelect: () => send({ type: 'role', looks: one, role: r }) })) },
      { divider: true },
      { label: 'Archive…', icon: <Archive className="size-3.5" />, tone: 'bad', disabled: inUse, hint: inUse ? 'in use' : undefined, onSelect: () => archiveLooks(one) },
    ]
  }

  const entityEntries = (e: LibraryEntity): MenuEntry[] => {
    const retired = e.status === 'RETIRED'
    return [
      { heading: `@${e.shortId} · ${e.name}` },
      { label: 'Open', icon: <Maximize2 className="size-3.5" />, onSelect: () => setOpenId(e.id) },
      { label: 'Edit name, ID, description…', icon: <Pencil className="size-3.5" />, onSelect: () => setEditing(e) },
      ...(retired ? [] : [{ label: 'Add looks…', icon: <Plus className="size-3.5" />, onSelect: () => setAdding({ entity: e.id }) }]),
      { label: 'Copy reference', icon: <Copy className="size-3.5" />, hint: `@${e.shortId}`, onSelect: () => copyTokens([`@${e.shortId}`]) },
      { label: selE.has(e.id) ? 'Unselect' : 'Select', icon: <Check className="size-3.5" />, onSelect: () => toggle(setSelE, e.id) },
      ...(retired ? [] : [{ caption: 'Status', chips: STATUSES.map((s) => ({ label: s, active: e.status === s, onSelect: () => send({ type: 'status', entities: [e.id], status: s }) })) }]),
      { divider: true },
      retired
        ? { label: 'Restore', icon: <Undo2 className="size-3.5" />, onSelect: () => send({ type: 'restore', entities: [e.id] }) }
        : { label: 'Retire…', icon: <Archive className="size-3.5" />, tone: 'bad' as const, onSelect: () => confirmRetire(e) },
    ]
  }

  return (
    <div className="pb-24">
      {/* ------------------------------------------------ header */}
      <StickyHeader className="pb-5">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-4">
          <h1 className="font-display text-[40px] leading-[0.9] text-fg">References</h1>
          <span className="pb-0.5 font-mono text-xs text-muted tabular-nums">
            <span className="text-fg">{live.length}</span> entities
            <span className="px-2 text-faint">/</span>
            <span className="text-fg">{live.reduce((n, e) => n + e.looks.length, 0)}</span> looks
          </span>
          {data.pending.length > 0 && (
            <Badge tone={waitNote ? 'bad' : 'accent'} className="mb-0.5 gap-1.5">
              {!waitNote && <LoaderCircle aria-hidden className="size-3 animate-spin" />}
              {waitNote ?? `applying ${waiting}`}
            </Badge>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search ID, name, description" className="w-72 pl-8.5" />
            </div>
            <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="w-36" aria-label="Status">
              <option value="ALL">Any status</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}
            </Select>
            {actions}
            <Button type="button" tone="accent" size="sm" className="h-9 px-3.5" onClick={() => setAdding({ entity: '' })}>
              <Plus aria-hidden className="size-3.5" /> Add references
            </Button>
          </div>
        </div>
      </StickyHeader>

      <div className="grid gap-10 lg:grid-cols-[200px_minmax(0,1fr)]">
        {/* ------------------------------------------------ categories */}
        <nav aria-label="Categories" className="lg:sticky lg:top-[calc(var(--sticky-h,8rem)+1.5rem)] lg:self-start">
          <div className="eyebrow mb-3 hidden px-3 text-faint lg:block">Browse</div>
          <ul className="flex flex-wrap gap-px lg:flex-col">
            {([['ALL', 'All', live.length], ...KINDS.filter((k) => kindCount(k)).map((k) => [k, PLURAL[k], kindCount(k)] as const)] as [View, string, number][]).map(([v, label, n]) => (
              <li key={v}>
                <button
                  type="button"
                  onClick={() => { setView(v); clearSelection() }}
                  className={cn(
                    'focus-ring flex h-9 w-full cursor-pointer items-center justify-between gap-3 rounded-md px-3 text-left text-[13.5px] transition-colors duration-150',
                    view === v ? 'bg-white/[0.07] text-fg' : 'text-muted hover:bg-white/[0.03] hover:text-fg',
                  )}
                >
                  {label} <span className={cn('font-mono text-[11px] tabular-nums', view === v ? 'text-fg/70' : 'text-faint')}>{n}</span>
                </button>
              </li>
            ))}
            <li className="mx-3 my-3 hidden border-t border-edge lg:block" />
            {([['RETIRED', 'Retired', retired.length], ['ARCHIVED', 'Archived looks', data.archived.length]] as [View, string, number][]).map(([v, label, n]) => (
              <li key={v}>
                <button
                  type="button"
                  onClick={() => { setView(v); clearSelection() }}
                  className={cn(
                    'focus-ring flex h-9 w-full cursor-pointer items-center justify-between gap-3 rounded-md px-3 text-left text-[13.5px] transition-colors duration-150',
                    view === v ? 'bg-white/[0.07] text-fg' : 'text-faint hover:bg-white/[0.03] hover:text-fg',
                  )}
                >
                  {label} <span className={cn('font-mono text-[11px] tabular-nums', view === v ? 'text-fg/70' : 'text-faint')}>{n}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* ------------------------------------------------ content */}
        <div className="min-w-0 space-y-14">
          {view === 'ARCHIVED' ? (
            data.archived.length === 0 ? (
              <EmptyState className="py-16">No archived looks. Archiving a look moves it here, and it can be restored.</EmptyState>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
                {data.archived.map((a) => {
                  const on = selA.has(a.archiveId)
                  return (
                    <div
                      key={a.archiveId}
                      onContextMenu={(ev) => openMenu(ev, [
                        { heading: `${a.shortId}/${a.variant} · archived` },
                        { label: 'Restore', icon: <ArchiveRestore className="size-3.5" />, onSelect: () => send({ type: 'unarchive', archiveIds: [a.archiveId] }) },
                        { label: 'Show in folder', icon: <FolderOpen className="size-3.5" />, onSelect: () => reveal(a.file) },
                        { label: on ? 'Unselect' : 'Select', icon: <Check className="size-3.5" />, onSelect: () => toggle(setSelA, a.archiveId) },
                      ])}
                      className={cn('relative overflow-hidden rounded-lg border bg-sunken', on ? 'border-fg/70' : 'border-edge')}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumbUrl(a.file, 480)} alt="" className="checker aspect-4/3 w-full object-cover opacity-80" />
                      <SelectBox checked={on} onChange={() => toggle(setSelA, a.archiveId)} label={`Select archived ${a.shortId} ${a.variant}`} className="absolute top-2 left-2" />
                      <div className="border-t border-edge px-3 py-2.5 text-[11px]">
                        <div className="font-mono text-fg">{a.shortId} / {a.variant}{a.take !== 'T01' ? ` / ${a.take}` : ''}</div>
                        <div className="mt-0.5 text-faint">archived {a.ts.slice(0, 10)}{a.by ? ` by ${a.by}` : ''}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          ) : sections.length === 0 ? (
            <EmptyState className="py-16">Nothing matches.</EmptyState>
          ) : (
            sections.map((s) => (
              <section key={s.kind}>
                <div className="mb-6 flex items-center gap-3">
                  <span aria-hidden className="size-1.5 rounded-full bg-fg" />
                  <h2 className="eyebrow text-fg/85">
                    {PLURAL[s.kind] ?? (s.kind === 'RETIRED' ? 'Retired' : s.kind)}
                  </h2>
                  <span className="font-mono text-[11px] leading-none text-faint">{s.items.length}</span>
                  <span aria-hidden className="h-px flex-1 bg-edge" />
                  <button
                    type="button"
                    onClick={() => {
                      const all = s.items.every((e) => selE.has(e.id))
                      const n = new Set(selE)
                      s.items.forEach((e) => (all ? n.delete(e.id) : n.add(e.id)))
                      setSelE(n)
                    }}
                    className="focus-ring cursor-pointer rounded text-xs text-faint transition-colors duration-150 hover:text-fg"
                  >
                    {s.items.every((e) => selE.has(e.id)) ? 'Unselect all' : 'Select all'}
                  </button>
                </div>
                <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                  {s.items.map((e) => (
                    <EntityCard
                      key={e.id}
                      entity={e}
                      selected={selE.has(e.id)}
                      selectedLooks={selL}
                      pending={pendingFor(e)}
                      onSelect={() => toggle(setSelE, e.id)}
                      onSelectLook={(v) => toggle(setSelL, lookKey(e.id, v))}
                      onEdit={() => setEditing(e)}
                      onAdd={() => setAdding({ entity: e.id })}
                      onOpen={() => setOpenId(e.id)}
                      onEntityMenu={(ev) => openMenu(ev, entityEntries(e))}
                      onLookMenu={(ev, variant) => openMenu(ev, lookEntries(e, variant, {
                        selected: selL.has(lookKey(e.id, variant)),
                        toggle: () => toggle(setSelL, lookKey(e.id, variant)),
                      }))}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>

      {/* ------------------------------------------------ selection bar */}
      <AnimatePresence>
        {total > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.2, ease: EASE }}
            className="fixed inset-x-0 bottom-5 z-80 flex justify-center px-4"
          >
            <div className="flex max-w-full flex-wrap items-center gap-2 rounded-xl border border-edge-strong bg-raise py-2 pr-2 pl-4 shadow-[0_20px_50px_-16px_rgba(0,0,0,0.9)]">
              <span className="font-mono text-xs text-fg">
                {[selE.size && `${selE.size} ${selE.size === 1 ? 'entity' : 'entities'}`, selL.size && `${selL.size} ${selL.size === 1 ? 'look' : 'looks'}`, selA.size && `${selA.size} archived`].filter(Boolean).join(' · ')}
              </span>
              <span className="mx-2 h-5 w-px bg-edge-strong" />

              {selE.size > 0 && (
                <>
                  {selEntities.some((e) => e.status !== 'RETIRED') && (
                    <Button type="button" size="sm" tone="outline" disabled={busy} onClick={() => setConfirm({
                      title: `Retire ${selE.size === 1 ? selEntities[0].shortId : `${selE.size} entities`}?`,
                      body: 'Retired entities disappear from pickers and can’t be used in new jobs. Their number and files are kept, and you can restore them any time from “Retired”.',
                      label: 'Retire',
                      run: () => send({ type: 'retire', entities: [...selE] }),
                    })}>
                      <Archive aria-hidden className="size-3.5" /> Retire
                    </Button>
                  )}
                  {selEntities.some((e) => e.status === 'RETIRED') && (
                    <Button type="button" size="sm" tone="outline" disabled={busy} onClick={() => send({ type: 'restore', entities: [...selE] })}>
                      <Undo2 aria-hidden className="size-3.5" /> Restore
                    </Button>
                  )}
                  <Menu label="Status" icon={<Tag aria-hidden className="size-3.5" />} disabled={busy}
                    items={STATUSES.map((st) => ({ label: st[0] + st.slice(1).toLowerCase(), onClick: () => send({ type: 'status', entities: [...selE], status: st }) }))} />
                </>
              )}

              {selL.size > 0 && (
                <>
                  <Button type="button" size="sm" tone="outline" disabled={busy} onClick={() => setMoveLooks(selLooks)}>
                    <MoveRight aria-hidden className="size-3.5" /> Move to…
                  </Button>
                  <Menu label="Role" icon={<Tag aria-hidden className="size-3.5" />} disabled={busy}
                    items={ROLES.map((r) => ({ label: r, onClick: () => send({ type: 'role', looks: selLooks, role: r }) }))} />
                  {selL.size === 1 && (
                    <Button type="button" size="sm" tone="outline" disabled={busy} onClick={() => send({ type: 'canonical', entity: selLooks[0].entity, variant: selLooks[0].variant })}>
                      <Star aria-hidden className="size-3.5" /> Set as main
                    </Button>
                  )}
                  <Button type="button" size="sm" tone="outline" disabled={busy} onClick={() => archiveLooks(selLooks)}>
                    <Archive aria-hidden className="size-3.5" /> Archive
                  </Button>
                  {selL.size === 1 && lookPath(selLooks[0]) && (
                    <Button type="button" size="sm" tone="ghost" onClick={async () => { const r = await revealInFolder(project.slug, lookPath(selLooks[0])!); if (!r.ok) toast('bad', r.error ?? 'Could not open the folder.') }}>
                      <FolderOpen aria-hidden className="size-3.5" /> Show in folder
                    </Button>
                  )}
                </>
              )}

              {selA.size > 0 && (
                <Button type="button" size="sm" tone="outline" disabled={busy} onClick={() => send({ type: 'unarchive', archiveIds: [...selA] })}>
                  <ArchiveRestore aria-hidden className="size-3.5" /> Restore
                </Button>
              )}

              {(selE.size > 0 || selL.size > 0) && (
                <Button type="button" size="sm" tone="ghost" onClick={async () => {
                  await navigator.clipboard.writeText(tokensOf().join(' '))
                  toast('good', `Copied ${tokensOf().join(' ')}`, 3000)
                }}>
                  <Copy aria-hidden className="size-3.5" /> Copy @refs
                </Button>
              )}
              <button type="button" onClick={clearSelection} aria-label="Clear selection" className="focus-ring ml-1 grid size-8 cursor-pointer place-items-center rounded-md text-muted hover:bg-white/[0.06] hover:text-fg">
                <X aria-hidden className="size-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------ dialogs */}
      {openId && byId.get(openId) && (
        <EntityView
          entity={byId.get(openId)!}
          pending={pendingFor(byId.get(openId)!)}
          busy={busy}
          send={send}
          layered={editing !== null || adding !== null || moveLooks !== null || confirm !== null || viewer !== null || menu !== null}
          onClose={() => setOpenId(null)}
          onEdit={() => setEditing(byId.get(openId)!)}
          onAdd={() => setAdding({ entity: openId })}
          onMove={setMoveLooks}
          onArchive={archiveLooks}
          onLookMenu={(ev, variant, selection) => openMenu(ev, lookEntries(byId.get(openId)!, variant, selection))}
          onConfirm={setConfirm}
          onView={(items, index) => setViewer({ items, index })}
          onToast={toast}
        />
      )}
      <IndexPicker
        open={moveLooks !== null}
        mode="entity"
        title={`Move ${(moveLooks?.length ?? 0) === 1 ? `${byId.get(moveLooks![0].entity)?.shortId}/${moveLooks![0].variant}` : `${moveLooks?.length} looks`} to…`}
        catalog={catalog}
        onClose={() => setMoveLooks(null)}
        onPickEntity={(target) => { const looks = moveLooks ?? []; setMoveLooks(null); send({ type: 'move', looks, to: target.id }) }}
      />

      <Modal
        open={confirm !== null}
        title={confirm?.title}
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button type="button" size="sm" tone="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button type="button" size="sm" tone="bad" onClick={() => { confirm?.run(); setConfirm(null) }}>{confirm?.label}</Button>
          </>
        }
      >
        <p className="text-[15px] leading-relaxed text-muted">{confirm?.body}</p>
      </Modal>

      {editing && <EditDialog entity={editing} onClose={() => setEditing(null)} send={send} busy={busy} />}
      {adding && <AddDialog entity={adding.entity} catalog={catalog} onClose={() => setAdding(null)} send={send} busy={busy} />}

      <Lightbox items={viewer?.items ?? []} index={viewer?.index ?? null} onIndex={(i) => setViewer((v) => (v ? { ...v, index: i } : v))} onClose={() => setViewer(null)} />

      <ContextMenu at={menu?.at ?? null} entries={menu?.entries ?? []} onClose={() => setMenu(null)} />

    </div>
  )
}

function EntityCard({
  entity: e, selected, selectedLooks, pending, onSelect, onSelectLook, onEdit, onAdd, onOpen, onEntityMenu, onLookMenu,
}: {
  entity: LibraryEntity
  selected: boolean
  selectedLooks: Set<string>
  pending: boolean
  onSelect: () => void
  onSelectLook: (variant: string) => void
  onEdit: () => void
  onAdd: () => void
  onOpen: () => void
  onEntityMenu: (ev: React.MouseEvent) => void
  onLookMenu: (ev: React.MouseEvent, variant: string) => void
}) {
  const { thumbUrl } = useAssetUrls()
  const retired = e.status === 'RETIRED'
  return (
    <div
      onContextMenu={onEntityMenu}
      role="button"
      tabIndex={0}
      aria-label={`Open ${e.shortId} ${e.name}`}
      onClick={onOpen}
      onKeyDown={(ev) => { if (ev.target === ev.currentTarget && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); onOpen() } }}
      className={cn(
        'lit focus-ring flex cursor-pointer flex-col rounded-xl border bg-panel p-5 transition-colors duration-200',
        selected ? 'border-fg/70' : 'border-edge hover:border-edge-strong',
        retired && 'opacity-70',
      )}
    >
      <div className="flex items-start gap-3">
        <SelectBox checked={selected} onChange={onSelect} label={`Select ${e.shortId}`} className="mt-1" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span className="truncate font-display text-[26px] leading-none text-fg">{e.name}</span>
            {e.status !== 'CONCEPT' && <Badge tone={retired ? 'bad' : e.status === 'APPROVED' ? 'good' : 'accent'}>{e.status.toLowerCase()}</Badge>}
            {e.flags.includes('NO-ASSET') && <Badge tone="muted">no image</Badge>}
            {pending && <LoaderCircle aria-label="applying" className="size-3.5 animate-spin text-fg" />}
          </div>
          <p className="mt-2 truncate font-mono text-[11px] text-faint" title={e.id}>
            <span className="text-fg/85">{e.shortId}</span>
            <span className="px-1.5">·</span>
            {e.id}
          </p>
        </div>
        <Button type="button" size="sm" tone="ghost" onClick={(ev) => { ev.stopPropagation(); onEdit() }} aria-label={`Edit ${e.shortId}`} className="-mt-1 -mr-1.5 h-8 px-2">
          <Pencil aria-hidden className="size-3.5" />
        </Button>
      </div>

      {e.description && <p className="mt-4 line-clamp-2 text-[13px] leading-relaxed text-muted">{e.description}</p>}

      <div className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {e.looks.map((l) => {
          const on = selectedLooks.has(lookKey(e.id, l.variant))
          return (
            <div key={l.variant} onContextMenu={(ev) => onLookMenu(ev, l.variant)} className={cn('group relative overflow-hidden rounded-md border bg-sunken', on ? 'border-fg ring-1 ring-fg/50' : 'border-edge')}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumbUrl(l.path, 480)} alt="" loading="lazy" className="checker aspect-4/3 w-full object-cover" />
              <SelectBox checked={on} onChange={() => onSelectLook(l.variant)} label={`Select ${e.shortId}/${l.variant}`}
                className={cn('absolute top-1.5 left-1.5 size-4', !on && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100')} />
              {l.variant === e.canonical && (
                <span aria-label="main look" className="absolute top-1.5 right-1.5 grid size-4 place-items-center rounded-[4px] bg-fg text-ink">
                  <Star aria-hidden className="size-2.5 fill-ink" />
                </span>
              )}
              <div className="pointer-events-none absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-[3px] bg-black/80 px-1 py-0.5 font-mono text-[9px] leading-none text-fg">
                {l.variant}<span className="text-muted">{l.role}</span>{l.takes > 1 && <span className="text-muted">×{l.takes}</span>}
              </div>
            </div>
          )
        })}
        {!retired && (
          <button type="button" onClick={(ev) => { ev.stopPropagation(); onAdd() }} className="focus-ring grid aspect-4/3 cursor-pointer place-items-center rounded-md border border-dashed border-edge-strong text-faint transition-colors duration-150 hover:border-muted hover:text-fg" aria-label={`Add a look to ${e.shortId}`}>
            {e.looks.length === 0 ? <span className="flex flex-col items-center gap-1.5 text-[10.5px]"><ImageOff aria-hidden className="size-4" />add image</span> : <Plus aria-hidden className="size-4" />}
          </button>
        )}
      </div>
    </div>
  )
}

function EditDialog({ entity: e, onClose, send, busy }: {
  entity: LibraryEntity
  onClose: () => void
  send: (op: Record<string, unknown>) => Promise<boolean>
  busy: boolean
}) {
  const [name, setName] = useState(e.name)
  const [slug, setSlug] = useState(e.slug)
  const [description, setDescription] = useState(e.description)
  const [canonical, setCanonical] = useState(e.canonical)
  const { code } = useProject()
  const cleanSlug = entitySlug(slug)
  const newId = `${code}-${e.kind}-${e.number}-${cleanSlug || '…'}`
  const idChanges = cleanSlug !== e.slug
  const detailsChange = name.trim() !== e.name || description.trim() !== e.description || idChanges

  async function save() {
    let ok = true
    if (detailsChange) ok = await send({ type: 'rename', entity: e.id, name: name.trim(), slug: cleanSlug, description: description.trim() })
    if (ok && canonical && canonical !== e.canonical) ok = await send({ type: 'canonical', entity: e.id, variant: canonical })
    if (ok) onClose()
  }

  return (
    <Modal
      open
      title={<>Edit <span className="font-mono">{e.shortId}</span></>}
      onClose={onClose}
      footer={
        <>
          <Button type="button" size="sm" tone="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" size="sm" tone="accent" pending={busy} disabled={!detailsChange && canonical === e.canonical} onClick={save}>Save</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name (English)">
          <Input dir="ltr" value={name} onChange={(ev) => setName(ev.target.value)} />
        </Field>
        <Field
          label="ID wording"
          hint={
            <span className="block space-y-1">
              <span className="block font-mono text-fg/80">{newId}</span>
              <span className="block">
                {idChanges
                  ? <>The worker renames the files. <span className="font-mono">@{e.shortId}</span> keeps working because the number never changes.</>
                  : <>The number <span className="font-mono">{e.shortId}</span> never changes.</>}
              </span>
            </span>
          }
        >
          <Input dir="ltr" value={slug} onChange={(ev) => setSlug(ev.target.value.toUpperCase())} className="font-mono" />
        </Field>
        <Field label="Description (English)">
          <Textarea dir="ltr" rows={3} value={description} onChange={(ev) => setDescription(ev.target.value)} />
        </Field>
        {e.looks.length > 1 && (
          <Field label="Main look (used when a prompt says just @ID)">
            <Select value={canonical} onChange={(ev) => setCanonical(ev.target.value)}>
              {e.looks.map((l) => <option key={l.variant} value={l.variant}>{l.variant} · {l.role}</option>)}
            </Select>
          </Field>
        )}
      </div>
    </Modal>
  )
}

const MB = (n: number) => `${Math.round(n / 1024 / 1024)} MB`

/**
 * Drop a folder of references at once. Every file arrives with what its name
 * says it is already filled in (lib/batch-add), and files that show the same
 * new thing arrive grouped as looks of one entity. Hamed scans the table,
 * fixes what inference could not settle, and confirms once.
 *
 * Opened on an entity (the + on its card), every file starts as a new look of
 * that entity instead: that is a deliberate act, not a guess.
 */
function AddDialog({ entity, catalog, onClose, send, busy }: {
  entity: string
  catalog: CatalogEntity[]
  onClose: () => void
  send: (op: Record<string, unknown>, fd?: FormData) => Promise<boolean>
  busy: boolean
}) {
  const { code } = useProject()
  const edits = useReferenceEdits([], { maxUploads: MAX_ADD_UPLOADS })
  const [picking, setPicking] = useState<string | null>(null)
  const [viewing, setViewing] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const target = catalog.find((c) => c.id === entity)

  const problems = useMemo(() => batchProblems(edits.uploads, catalog), [edits.uploads, catalog])
  const counts = batchCounts(edits.uploads, problems)
  const overBudget = counts.bytes > MAX_ADD_TOTAL_BYTES

  const take = (files: FileList | null) => {
    const all = [...(files ?? [])]
    const images = all.filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type))
    const ok = images.filter((f) => f.size <= MAX_UPLOAD_BYTES)
    const over = target
      ? edits.addFiles(ok, { asRef: false, replaceKey: null, entity })
      : edits.addFilesInferred(ok, { code, catalog })
    const said = [
      all.length > images.length && 'only PNG, JPG or WEBP images are accepted',
      images.length > ok.length && `${images.length - ok.length} over ${MB(MAX_UPLOAD_BYTES)} were skipped`,
      over > 0 && `at most ${MAX_ADD_UPLOADS} images at a time`,
    ].filter(Boolean)
    setNotice(said.length ? `Some files were not added: ${said.join('; ')}.` : null)
  }

  async function submit() {
    const fd = new FormData()
    edits.serialize(fd, false)
    if (await send({ type: 'add' }, fd)) onClose()
  }

  const blocked = counts.bad > 0 || overBudget
  return (
    <Modal
      open
      size="xl"
      title={target ? <>Add looks to <span className="font-mono">{target.shortId}</span> {target.name}</> : 'Add references'}
      onClose={() => { if (!picking && viewing === null) onClose() }}
      onKeyGuard={() => !picking && viewing === null}
      footer={
        <>
          <span className="mr-auto self-center text-xs text-muted">
            {counts.bad > 0
              ? `${counts.bad} ${counts.bad === 1 ? 'row needs' : 'rows need'} an answer before this can be sent.`
              : 'Each image gets its proper ID when the worker files it.'}
          </span>
          <Button type="button" size="sm" tone="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" size="sm" tone="accent" pending={busy} disabled={edits.uploads.length === 0 || blocked} onClick={submit}>
            Add {counts.files || ''} {counts.files === 1 ? 'image' : 'images'}
            {counts.newEntities > 0 && ` · ${counts.newEntities} new`}
          </Button>
        </>
      }
    >
      <input ref={input} type="file" accept={UPLOAD_ACCEPT} multiple hidden onChange={(ev) => { take(ev.target.files); ev.target.value = '' }} />

      <div
        onDragOver={(ev) => { ev.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(ev) => { ev.preventDefault(); setDragging(false); take(ev.dataTransfer.files) }}
        className={cn(
          'rounded-xl border border-dashed transition-colors duration-150',
          dragging ? 'border-fg/60 bg-white/[0.03]' : 'border-edge-strong',
          counts.files ? 'flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3' : 'grid place-items-center gap-3 px-6 py-10 text-center',
        )}
      >
        {counts.files === 0 ? (
          <>
            <Upload aria-hidden strokeWidth={1.5} className="size-6 text-muted" />
            <p className="font-display text-2xl text-fg">Drop images here</p>
            <Button type="button" size="sm" tone="outline" onClick={() => input.current?.click()}>Choose images</Button>
            <p className="font-mono text-[11px] text-faint">
              PNG, JPG or WEBP · up to {MAX_ADD_UPLOADS} at a time
              {!target && ' · named from their filenames'}
            </p>
          </>
        ) : (
          <>
            <Upload aria-hidden strokeWidth={1.5} className="size-4 text-muted" />
            <span className="text-[13px] text-fg">
              {counts.files} {counts.files === 1 ? 'file' : 'files'}
              <span className="px-1.5 text-faint">·</span>
              <span className={cn('font-mono text-[11px]', overBudget ? 'text-bad' : 'text-faint')}>{MB(counts.bytes)}</span>
            </span>
            <span className="text-xs text-muted">
              {counts.newEntities} new {counts.newEntities === 1 ? 'entity' : 'entities'}
              {counts.groups > 0 && ` (${counts.groups} with several looks)`}
              <span className="px-1.5 text-faint">·</span>
              {counts.newLooks} new {counts.newLooks === 1 ? 'look' : 'looks'}
            </span>
            <Button type="button" size="sm" tone="outline" onClick={() => input.current?.click()} disabled={counts.files >= MAX_ADD_UPLOADS} className="ml-auto">
              Add more
            </Button>
          </>
        )}
      </div>

      {overBudget && (
        <p className="mt-4 rounded-md border border-bad/35 bg-bad/8 px-3.5 py-2.5 text-xs leading-relaxed text-bad">
          That is {MB(counts.bytes)} in all, more than the {MB(MAX_ADD_TOTAL_BYTES)} the panel can send at once. Take a few
          out and add them in a second batch.
        </p>
      )}
      {notice && <p className="mt-4 rounded-md border border-bad/35 bg-bad/8 px-3.5 py-2.5 text-xs leading-relaxed text-bad">{notice}</p>}

      {counts.files > 0 && (
        <div className="mt-6">
          <p className="mb-4 text-xs text-muted">
            Names and descriptions go into the registry, so write them in English. Nothing is numbered until the worker
            files the batch.
          </p>
          <BatchAddTable
            uploads={edits.uploads}
            catalog={catalog}
            problems={problems}
            onChange={edits.updateUpload}
            onDrop={edits.dropUpload}
            onUngroup={edits.ungroup}
            onGroup={edits.groupUnder}
            onPickEntity={setPicking}
            onView={(id) => setViewing(edits.uploads.findIndex((u) => u.id === id))}
          />
        </div>
      )}

      <Lightbox
        items={edits.uploads.map((u) => ({ src: u.preview, title: u.file.name, subtitle: u.why }))}
        index={viewing}
        onIndex={setViewing}
        onClose={() => setViewing(null)}
      />

      <IndexPicker
        open={picking !== null}
        mode="entity"
        title="Which entity is this a new look of?"
        catalog={catalog}
        onClose={() => setPicking(null)}
        onPickEntity={(c) => {
          if (picking) {
            const u = edits.uploads.find((x) => x.id === picking)
            edits.updateUpload(picking, {
              mode: 'variant', entity: c.id, groupOf: '',
              needs: (u?.needs ?? []).filter((n) => n !== 'entity' && n !== 'kind' && n !== 'name'),
            })
          }
          setPicking(null)
        }}
      />
    </Modal>
  )
}

/**
 * One entity, large: every look at a size you can actually judge, selectable,
 * with the actions beside it. The small cards are for finding; this is for work.
 */
function EntityView({
  entity: e, pending, busy, send, layered, onClose, onEdit, onAdd, onMove, onArchive, onLookMenu, onConfirm, onView, onToast,
}: {
  entity: LibraryEntity
  pending: boolean
  busy: boolean
  send: (op: Record<string, unknown>) => Promise<boolean>
  /** Another dialog is open on top; Escape belongs to it. */
  layered: boolean
  onClose: () => void
  onEdit: () => void
  onAdd: () => void
  onMove: (looks: { entity: string; variant: string }[]) => void
  /** Asks for confirmation first. */
  onArchive: (looks: { entity: string; variant: string }[]) => void
  onLookMenu: (ev: React.MouseEvent, variant: string, selection: { selected: boolean; toggle: () => void }) => void
  onConfirm: (c: { title: string; body: string; label: string; run: () => void }) => void
  onView: (items: LightboxItem[], index: number) => void
  onToast: (tone: ToastTone, text: string, ms?: number) => void
}) {
  const project = useProject()
  const { assetUrl, thumbUrl } = useAssetUrls()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const retired = e.status === 'RETIRED'
  const looks = e.looks
  const chosen = looks.filter((l) => sel.has(l.variant))
  const asOps = (ls: typeof looks) => ls.map((l) => ({ entity: e.id, variant: l.variant }))

  // Looks that no longer exist (archived, moved) drop out of the selection.
  useEffect(() => {
    setSel((s) => {
      const n = new Set([...s].filter((v) => looks.some((l) => l.variant === v)))
      return n.size === s.size ? s : n
    })
  }, [looks])

  const toggle = (v: string) => setSel((s) => { const n = new Set(s); if (n.has(v)) n.delete(v); else n.add(v); return n })
  const all = looks.length > 0 && chosen.length === looks.length
  const viewItems = looks.map((l) => ({ src: assetUrl(l.path), title: `${e.shortId}/${l.variant}`, subtitle: `${e.name} · ${l.role}` }))
  const copy = async (tokens: string[]) => { await navigator.clipboard.writeText(tokens.join(' ')); onToast('good', `Copied ${tokens.join(' ')}`, 3000) }
  // Looks that leave drop out of the selection by themselves (the effect above).
  const archive = (ls: typeof looks) => onArchive(asOps(ls))

  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      onKeyGuard={() => !layered}
      title={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-display text-[30px] leading-none">{e.name}</span>
          <span className="font-mono text-xs text-muted">{e.shortId}</span>
          {e.status !== 'CONCEPT' && <Badge tone={retired ? 'bad' : e.status === 'APPROVED' ? 'good' : 'accent'}>{e.status.toLowerCase()}</Badge>}
          {pending && <Badge tone="accent" className="gap-1.5"><LoaderCircle aria-hidden className="size-3 animate-spin" /> applying</Badge>}
        </span>
      }
      footer={
        chosen.length > 0 ? (
          <>
            <span className="mr-auto self-center text-sm text-fg">{chosen.length} {chosen.length === 1 ? 'look' : 'looks'} selected</span>
            <Button type="button" size="sm" tone="outline" disabled={busy} onClick={() => onMove(asOps(chosen))}>
              <MoveRight aria-hidden className="size-3.5" /> Move to…
            </Button>
            <Menu label="Role" icon={<Tag aria-hidden className="size-3.5" />} disabled={busy}
              items={ROLES.map((r) => ({ label: r, onClick: () => { send({ type: 'role', looks: asOps(chosen), role: r }); setSel(new Set()) } }))} />
            {chosen.length === 1 && chosen[0].variant !== e.canonical && (
              <Button type="button" size="sm" tone="outline" disabled={busy} onClick={() => { send({ type: 'canonical', entity: e.id, variant: chosen[0].variant }); setSel(new Set()) }}>
                <Star aria-hidden className="size-3.5" /> Set as main
              </Button>
            )}
            <Button type="button" size="sm" tone="ghost" onClick={() => copy(chosen.map((l) => `@${e.shortId}/${l.variant}`))}>
              <Copy aria-hidden className="size-3.5" /> Copy @refs
            </Button>
            <Button type="button" size="sm" tone="bad" disabled={busy} onClick={() => archive(chosen)}>
              <Archive aria-hidden className="size-3.5" /> Archive
            </Button>
          </>
        ) : (
          <>
            <span className="mr-auto self-center text-xs text-muted">Click pictures to select them, or right-click one for everything you can do with it.</span>
            {retired ? (
              <Button type="button" size="sm" tone="outline" disabled={busy} onClick={() => send({ type: 'restore', entities: [e.id] })}>
                <Undo2 aria-hidden className="size-3.5" /> Restore
              </Button>
            ) : (
              <Button type="button" size="sm" tone="ghost" disabled={busy} onClick={() => onConfirm({
                title: `Retire ${e.shortId}?`,
                body: 'It disappears from pickers and can’t be used in new jobs. Its number and files are kept, and you can restore it from “Retired”.',
                label: 'Retire',
                run: () => send({ type: 'retire', entities: [e.id] }),
              })}>
                <Archive aria-hidden className="size-3.5" /> Retire
              </Button>
            )}
            <Button type="button" size="sm" tone="outline" onClick={onEdit}>
              <Pencil aria-hidden className="size-3.5" /> Edit
            </Button>
            {!retired && (
              <Button type="button" size="sm" tone="accent" onClick={onAdd}>
                <Plus aria-hidden className="size-3.5" /> Add looks
              </Button>
            )}
          </>
        )
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs text-faint">{e.id}</p>
            {e.description ? (
              <p className="mt-2.5 max-w-3xl text-[15px] leading-relaxed text-fg/85">{e.description}</p>
            ) : (
              <p className="mt-2.5 text-sm text-muted">No description.</p>
            )}
          </div>
          <div className="flex items-center gap-3 font-mono text-xs text-muted">
            <span>{PLURAL[e.kind] ?? e.kind}</span>
            <span className="text-faint">/</span>
            <span>{looks.length} {looks.length === 1 ? 'look' : 'looks'}</span>
            {looks.length > 0 && (
              <button type="button" onClick={() => setSel(all ? new Set() : new Set(looks.map((l) => l.variant)))} className="focus-ring ml-2 cursor-pointer rounded font-sans text-fg underline decoration-edge-strong underline-offset-4 hover:decoration-fg">
                {all ? 'Unselect all' : 'Select all'}
              </button>
            )}
          </div>
        </div>

        {looks.length === 0 ? (
          <EmptyState className="py-16">
            No pictures yet.{' '}
            {!retired && <button type="button" onClick={onAdd} className="cursor-pointer text-fg underline underline-offset-4">Add the first look</button>}
          </EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {looks.map((l, i) => {
              const on = sel.has(l.variant)
              const main = l.variant === e.canonical
              return (
                <figure
                  key={l.variant}
                  onContextMenu={(ev) => onLookMenu(ev, l.variant, { selected: on, toggle: () => toggle(l.variant) })}
                  className={cn(
                    'group relative overflow-hidden rounded-lg border bg-sunken transition-[border-color,box-shadow] duration-150',
                    on ? 'border-fg shadow-[0_0_0_1px_var(--color-fg)]' : 'border-edge hover:border-edge-strong',
                  )}
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    aria-label={`Select ${e.shortId}/${l.variant}`}
                    onClick={() => toggle(l.variant)}
                    className="focus-ring block w-full cursor-pointer"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={thumbUrl(l.path, 720)} alt={`${e.name} ${l.variant}`} className="checker aspect-4/3 w-full object-contain" />
                  </button>

                  <span className={cn(
                    'pointer-events-none absolute top-3 left-3 grid size-5 place-items-center rounded-[4px] border transition-colors duration-150',
                    on ? 'border-fg bg-fg text-ink' : 'border-edge-strong bg-black/70 text-transparent group-hover:text-muted',
                  )}>
                    <Check aria-hidden strokeWidth={3.5} className="size-3" />
                  </span>
                  {main && (
                    <span className="pointer-events-none absolute top-3 left-10 flex h-5 items-center gap-1 rounded-[4px] bg-fg px-1.5 text-[11px] leading-none font-medium text-ink">
                      <Star aria-hidden className="size-2.5 fill-ink" /> main look
                    </span>
                  )}
                  <div className="absolute top-3 right-3 flex gap-1.5 opacity-100 transition-opacity duration-150 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                    <IconAction label="View full screen" onClick={() => onView(viewItems, i)}><Maximize2 aria-hidden className="size-3.5" /></IconAction>
                    <IconAction label="Show in folder" onClick={async () => { const r = await revealInFolder(project.slug, l.path); if (!r.ok) onToast('bad', r.error ?? 'Could not open the folder.') }}><FolderOpen aria-hidden className="size-3.5" /></IconAction>
                    <IconAction label={`Copy @${e.shortId}/${l.variant}`} onClick={() => copy([`@${e.shortId}/${l.variant}`])}><Copy aria-hidden className="size-3.5" /></IconAction>
                  </div>

                  <figcaption className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-t border-edge px-4 py-3 text-xs">
                    <span className="font-mono text-sm font-medium text-fg">{l.variant}</span>
                    <Badge tone="muted">{l.role}</Badge>
                    {l.takes > 1 && <span className="text-muted">{l.takes} takes</span>}
                    <span className="text-muted">{l.source}{l.added ? ` · ${l.added}` : ''}</span>
                    {!main && !retired && (
                      <button type="button" disabled={busy} onClick={() => send({ type: 'canonical', entity: e.id, variant: l.variant })} className="focus-ring ml-auto cursor-pointer rounded text-muted hover:text-fg disabled:opacity-50">
                        Make main
                      </button>
                    )}
                    {l.usedBy.length > 0 && (
                      <span className={cn('w-full text-[11.5px]', blockingUses(l.usedBy).length ? 'text-fg' : 'text-muted')}>
                        Used by {usesText(l.usedBy)}
                      </span>
                    )}
                    <span className="w-full truncate font-mono text-[10.5px] text-faint" title={l.filename}>{l.filename}</span>
                  </figcaption>
                </figure>
              )
            })}
            {!retired && (
              <button type="button" onClick={onAdd} className="focus-ring grid min-h-48 cursor-pointer place-items-center rounded-lg border border-dashed border-edge-strong text-muted transition-colors duration-150 hover:border-muted hover:text-fg">
                <span className="flex flex-col items-center gap-2 text-sm"><Plus aria-hidden className="size-6" /> Add looks</span>
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={(ev) => { ev.stopPropagation(); onClick() }}
      aria-label={label}
      title={label}
      className="focus-ring grid size-8 cursor-pointer place-items-center rounded-md bg-black/80 text-fg/80 transition-colors duration-150 hover:bg-black hover:text-fg"
    >
      {children}
    </button>
  )
}
