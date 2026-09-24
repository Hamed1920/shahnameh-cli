'use client'

import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { GripVertical, ImageOff, Library, Plus, Sparkles, Upload, X } from 'lucide-react'
import { useAssetUrls } from '@/components/project-context'
import { Button } from '@/components/ui/button'
import { EASE } from '@/components/ui/motion-tokens'
import { cn } from '@/lib/cn'
import { UPLOAD_ACCEPT } from '@/lib/indexing'
import { lookPath } from '@/lib/ref-suggest'
import {
  SLOT_GROUPS, groupOf, manualSlot, orderedSlots, placeToken, refsOf, removeSlot, removeToken,
  type Place, type RefSlot,
} from '@/lib/ref-slots'
import type { CatalogEntity } from '@/lib/types'

/** A file added on this page, before the worker files it. */
export interface PageUpload {
  id: string
  preview: string
  name: string
}

/** What a drag carries: a reference token. Files from the computer come as files. */
const DRAG_TYPE = 'application/x-shm-ref'

export interface SlotsChange { slots: RefSlot[]; loose: string[] }

/**
 * A row's references by what they are. Each thing the prompt names gets a
 * slot under its kind (Characters, Locations, Props ...); the tray below takes
 * anything else, in any number. Everything drags: slot to slot swaps, slot to
 * tray and back, the tray reorders, a suggestion or a file from the computer
 * can be dropped anywhere. The slots only guide; nothing needs to be filled.
 *
 * The model gets the pictures in one order, shown in the strip at the top:
 * slots by group, then the tray.
 */
export function RowReferences({
  slots, loose, catalog, uploads, recent, maxRefs, onChange, onPick, onFiles, onCreate,
}: {
  slots: RefSlot[]
  loose: string[]
  catalog: CatalogEntity[]
  uploads: PageUpload[]
  /** "Used recently" tokens not already attached. */
  recent: string[]
  /** What the row's model takes; 0 when it takes no images. */
  maxRefs: number
  onChange: (next: SlotsChange) => void
  /** Open the index picker for a slot (its kind first), or for the tray. */
  onPick: (slotKey: string | null, kind: string | null) => void
  onFiles: (files: File[], slotKey: string | null) => void
  /** Open the reference studio to make a picture for this slot. */
  onCreate?: (slot: RefSlot) => void
}) {
  const order = refsOf(slots, loose)
  const [over, setOver] = useState<string | null>(null)
  const put = (token: string, to: Place) => onChange(placeToken(slots, loose, token, to))

  const drop = (to: Place, slotKey: string | null) => (e: React.DragEvent) => {
    e.preventDefault()
    setOver(null)
    const token = e.dataTransfer.getData(DRAG_TYPE)
    if (token) { put(token, to); return }
    const files = [...e.dataTransfer.files].filter((f) => /^image\//.test(f.type))
    if (files.length) onFiles(files, slotKey)
  }
  const dragOver = (id: string) => (e: React.DragEvent) => {
    if (![...e.dataTransfer.types].some((t) => t === DRAG_TYPE || t === 'Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes(DRAG_TYPE) ? 'move' : 'copy'
    if (over !== id) setOver(id)
  }

  const groups = SLOT_GROUPS.map((g) => ({ g, list: orderedSlots(slots).filter((s) => groupOf(s.kind) === g) })).filter((x) => x.list.length)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[13px] text-fg">References</span>
        <span className={cn('font-mono text-[11px]', order.length > maxRefs ? 'text-bad' : 'text-faint')}>
          {order.length}{maxRefs ? ` / ${maxRefs}` : ''}
        </span>
        {maxRefs === 0 && order.length > 0 && <span className="text-xs text-bad">this model takes no images</span>}
        {order.length > 0 && (
          <span className="flex flex-wrap items-center gap-1 text-[11px] text-faint">
            the model sees:
            {order.map((t, n) => (
              <span key={t} className="rounded-[4px] border border-edge px-1 font-mono text-[10.5px] text-muted">
                {n + 1} {t.startsWith('upload:') ? uploads.find((u) => `upload:${u.id}` === t)?.name.slice(0, 14) ?? 'file' : t.replace(/^@/, '')}
              </span>
            ))}
          </span>
        )}
      </div>

      {groups.length === 0 && (
        <p className="text-xs text-faint">
          Nothing in the prompt matched the index yet. Add a slot for what it needs, or drop pictures in the tray.
        </p>
      )}

      {groups.map(({ g, list }) => (
        <div key={g.id} className="space-y-2">
          <div className="eyebrow text-faint">{g.label}</div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
            <AnimatePresence initial={false}>
              {list.map((s) => (
                <SlotCard
                  key={s.key}
                  slot={s}
                  order={s.token ? order.indexOf(s.token) + 1 : 0}
                  catalog={catalog}
                  uploads={uploads}
                  over={over === s.key}
                  onDragOver={dragOver(s.key)}
                  onDragLeave={() => setOver(null)}
                  onDrop={drop({ slot: s.key }, s.key)}
                  onFill={(token) => put(token, { slot: s.key })}
                  onClear={() => s.token && onChange(removeToken(slots, loose, s.token))}
                  onRemove={() => onChange(removeSlot(s.token ? removeToken(slots, loose, s.token).slots : slots, loose, s.key))}
                  onPick={() => onPick(s.key, s.kind)}
                  onFiles={(files) => onFiles(files, s.key)}
                  onCreate={onCreate && (() => onCreate(s))}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-1.5 text-xs text-faint">
        <span className="mr-1">Add a slot:</span>
        {SLOT_GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => onChange({ slots: [...slots, manualSlot(slots, g.kinds[0])], loose })}
            className="focus-ring inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-dashed border-edge-strong px-2 text-[12px] text-muted transition-colors hover:border-muted hover:text-fg"
          >
            <Plus aria-hidden className="size-3" /> {g.one}
          </button>
        ))}
      </div>

      {/* The tray: anything, in any number, in the order dropped. */}
      <div
        onDragOver={dragOver('tray')}
        onDragLeave={() => setOver(null)}
        onDrop={drop({ tray: loose.length }, null)}
        className={cn(
          'rounded-lg border border-dashed p-3 transition-colors duration-150',
          over === 'tray' ? 'border-accent bg-accent/5' : 'border-edge-strong',
        )}
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Other references</span>
          <span className="text-[11px] text-faint">drop anything here: pictures from the index, or files from your computer</span>
          <div className="ml-auto flex gap-1.5">
            <Button type="button" size="sm" tone="outline" onClick={() => onPick(null, null)}>
              <Library aria-hidden className="size-3.5" /> From the index
            </Button>
            <FileButton onFiles={(f) => onFiles(f, null)} label="Upload" />
          </div>
        </div>
        {loose.length === 0 ? (
          <p className="py-3 text-center text-[11.5px] text-faint">Empty.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <AnimatePresence initial={false}>
              {loose.map((t, i) => (
                <motion.div
                  key={t}
                  layout
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.16, ease: EASE }}
                  onDragOver={dragOver(`tray-${i}`)}
                  onDrop={(e) => { e.stopPropagation(); drop({ tray: i }, null)(e) }}
                  className={cn('rounded-lg', over === `tray-${i}` && 'ring-2 ring-accent/60')}
                >
                  <RefThumb
                    token={t}
                    order={order.indexOf(t) + 1}
                    catalog={catalog}
                    uploads={uploads}
                    size="sm"
                    onRemove={() => onChange(removeToken(slots, loose, t))}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {recent.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-faint">Used recently:</span>
          {recent.map((t) => (
            <Chip key={t} token={t} catalog={catalog} onAdd={() => put(t, { tray: loose.length })} />
          ))}
        </div>
      )}
    </div>
  )
}

/** One thing the prompt needs a picture of. */
function SlotCard({
  slot, order, catalog, uploads, over, onDragOver, onDragLeave, onDrop, onFill, onClear, onRemove, onPick, onFiles, onCreate,
}: {
  slot: RefSlot
  order: number
  catalog: CatalogEntity[]
  uploads: PageUpload[]
  over: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  onFill: (token: string) => void
  onClear: () => void
  onRemove: () => void
  onPick: () => void
  onFiles: (files: File[]) => void
  onCreate?: () => void
}) {
  const entity = slot.entity ? catalog.find((e) => e.shortId === slot.entity) : null
  const noLook = entity && entity.variants.length === 0
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.16, ease: EASE }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'group/slot flex flex-col overflow-hidden rounded-lg border bg-sunken transition-colors duration-150',
        over ? 'border-accent ring-2 ring-accent/40' : slot.token ? 'border-edge-strong' : 'border-dashed border-edge-strong',
      )}
    >
      <div className="flex items-center gap-1.5 px-2.5 pt-2">
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg" title={slot.label}>{slot.label}</span>
        {slot.entity && <span className="font-mono text-[10.5px] text-faint">{slot.entity}</span>}
        {slot.proposal && <span className="rounded-[4px] border border-edge px-1 text-[10px] text-muted">new</span>}
        <button
          type="button"
          aria-label={`Remove the slot ${slot.label}`}
          onClick={onRemove}
          className="focus-ring grid size-5 cursor-pointer place-items-center rounded text-faint opacity-0 transition-opacity group-hover/slot:opacity-100 hover:text-fg focus-visible:opacity-100"
        >
          <X aria-hidden className="size-3" />
        </button>
      </div>

      <div className="p-2.5">
        {slot.token ? (
          <RefThumb token={slot.token} order={order} catalog={catalog} uploads={uploads} onRemove={onClear} bare />
        ) : (
          <div className="checker grid aspect-square place-items-center rounded-md border border-edge text-center">
            <span className="px-3 text-[11.5px] leading-snug text-faint">
              {noLook ? `${entity!.shortId} has no picture yet` : 'Drop a picture here'}
            </span>
          </div>
        )}
      </div>

      {!slot.token && slot.candidates.length > 0 && (
        <div className="flex flex-wrap gap-1 px-2.5 pb-2">
          {slot.candidates.map((t) => <Chip key={t} token={t} catalog={catalog} onAdd={() => onFill(t)} compact />)}
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-1 border-t border-edge px-2 py-1.5">
        <SlotAction onClick={onPick} label="Pick from the index"><Library aria-hidden className="size-3.5" /></SlotAction>
        <FileButton onFiles={onFiles} label="" compact />
        {onCreate && (
          <SlotAction onClick={onCreate} label={`Create a picture of ${slot.label}`} text="Create">
            <Sparkles aria-hidden className="size-3.5" />
          </SlotAction>
        )}
      </div>
    </motion.div>
  )
}

function SlotAction({ onClick, label, text, children }: { onClick: () => void; label: string; text?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="focus-ring inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-[12px] text-muted transition-colors hover:bg-white/[0.05] hover:text-fg"
    >
      {children}{text}
    </button>
  )
}

function FileButton({ onFiles, label, compact }: { onFiles: (files: File[]) => void; label: string; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={UPLOAD_ACCEPT}
        multiple={!compact}
        hidden
        onChange={(e) => { onFiles([...(e.target.files ?? [])]); e.target.value = '' }}
      />
      {compact ? (
        <SlotAction onClick={() => input.current?.click()} label="Upload a picture from your computer"><Upload aria-hidden className="size-3.5" /></SlotAction>
      ) : (
        <Button type="button" size="sm" tone="outline" onClick={() => input.current?.click()}>
          <Upload aria-hidden className="size-3.5" /> {label}
        </Button>
      )}
    </>
  )
}

/** A reference picture that can be dragged anywhere in its row. */
function RefThumb({
  token, order, catalog, uploads, onRemove, size = 'md', bare,
}: {
  token: string
  order: number
  catalog: CatalogEntity[]
  uploads: PageUpload[]
  onRemove: () => void
  size?: 'sm' | 'md'
  /** Inside a slot card, which already says what it is. */
  bare?: boolean
}) {
  const { thumbUrl } = useAssetUrls()
  const upload = token.startsWith('upload:') ? uploads.find((u) => `upload:${u.id}` === token) : null
  const path = upload ? null : lookPath(token, catalog)
  const [id] = token.replace(/^@/, '').split('/')
  const entity = upload ? null : catalog.find((e) => e.shortId === id || e.id === id)
  const src = upload ? upload.preview : path ? thumbUrl(path, 480) : null
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, token); e.dataTransfer.effectAllowed = 'move' }}
      className={cn(
        'group/thumb relative cursor-grab overflow-hidden rounded-md border border-edge bg-sunken active:cursor-grabbing',
        size === 'sm' ? 'w-28' : 'w-full',
      )}
    >
      <div className="checker aspect-square">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={entity?.name ?? upload?.name ?? token} draggable={false} loading="lazy" className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center"><ImageOff aria-hidden className="size-5 text-faint" /></div>
        )}
      </div>
      {order > 0 && (
        <span className="absolute top-1.5 left-1.5 grid h-5 min-w-5 place-items-center rounded-[4px] bg-ink/85 px-1 font-mono text-[10.5px] text-fg">{order}</span>
      )}
      <GripVertical aria-hidden className="absolute top-1.5 left-1/2 size-3.5 -translate-x-1/2 text-fg/70 opacity-0 transition-opacity group-hover/thumb:opacity-100" />
      <button
        type="button"
        aria-label={`Remove ${token}`}
        onClick={onRemove}
        className="focus-ring absolute top-1.5 right-1.5 grid size-6 cursor-pointer place-items-center rounded-[4px] bg-ink/85 text-muted opacity-0 transition-opacity group-hover/thumb:opacity-100 hover:text-fg focus-visible:opacity-100"
      >
        <X aria-hidden className="size-3.5" />
      </button>
      {!bare || upload ? (
        <div className="space-y-0.5 px-2 py-1.5">
          <div className="truncate font-mono text-[11px] text-fg">{upload ? 'new file' : token.replace(/^@/, '')}</div>
          <div className="truncate text-[11px] text-muted">{upload ? upload.name : entity?.name ?? 'not in the index'}</div>
        </div>
      ) : (
        <div className="truncate px-2 py-1.5 font-mono text-[11px] text-muted">{token.replace(/^@/, '')}</div>
      )}
    </div>
  )
}

/** A reference to take: click to add, or drag it onto a slot. */
function Chip({ token, catalog, onAdd, compact }: { token: string; catalog: CatalogEntity[]; onAdd: () => void; compact?: boolean }) {
  const { thumbUrl } = useAssetUrls()
  const [id] = token.replace(/^@/, '').split('/')
  const entity = catalog.find((e) => e.shortId === id || e.id === id)
  const path = lookPath(token, catalog)
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, token); e.dataTransfer.effectAllowed = 'copyMove' }}
      onClick={onAdd}
      title={`${token.replace(/^@/, '')} ${entity?.name ?? ''}`}
      className="group focus-ring inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-edge-strong py-0.5 pr-2 pl-0.5 text-[11.5px] text-muted transition-colors hover:border-muted hover:text-fg"
    >
      <span className="checker size-7 overflow-hidden rounded-[4px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {path && <img src={thumbUrl(path, 96)} alt="" draggable={false} className="size-full object-cover" />}
      </span>
      <span className="font-mono text-fg/90">{token.replace(/^@/, '')}</span>
      {!compact && <span className="max-w-32 truncate text-faint">{entity?.name}</span>}
      <Plus aria-hidden className="size-3 text-faint group-hover:text-fg" />
    </button>
  )
}
