'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ImageOff, Library, RefreshCw, RotateCcw, Trash2, Undo2, Upload, X,
} from 'lucide-react'
import { IndexPicker, type PickerMode } from '@/components/index-picker'
import { Lightbox, type LightboxItem } from '@/components/lightbox'
import { RoleHelp } from '@/components/role-help'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, Input, Select } from '@/components/ui/field'
import { EASE } from '@/components/ui/motion-tokens'
import { Badge } from '@/components/ui/text'
import { useAssetUrls } from '@/components/project-context'
import { cn } from '@/lib/cn'
import {
  KINDS, KIND_LABEL, MAX_UPLOADS, MAX_UPLOAD_BYTES, UPLOAD_ACCEPT, UPLOAD_ROLES,
  entitySlug, isAscii,
} from '@/lib/indexing'
import type { CatalogEntity, ResolvedReference } from '@/lib/types'

// ---------------------------------------------------------------- state

interface RefItem {
  key: string
  /** @-token, or empty for an upload that has no token until the worker files it. */
  token: string
  path: string | null
  origin: 'job' | 'index' | 'upload'
  uploadId?: string
  /** Only originals are soft-removed, so they can be restored in place. */
  removed?: boolean
}

export interface UploadDraft {
  id: string
  file: File
  preview: string
  mode: 'variant' | 'new'
  /** Full entity id, for mode=variant. */
  entity: string
  kind: string
  name: string
  description: string
  role: string
  descriptor: string
}

const initialItems = (original: ResolvedReference[]): RefItem[] =>
  original.map((r, i) => ({ key: `job-${i}`, token: r.token, path: r.path, origin: 'job' }))

/**
 * Everything the reviewer changed about a candidate's references. Lives in the
 * card so the form can serialize it on submit.
 */
export function useReferenceEdits(original: ResolvedReference[]) {
  const [items, setItems] = useState<RefItem[]>(() => initialItems(original))
  const [uploads, setUploads] = useState<UploadDraft[]>([])
  const seq = useRef(0)

  // Object URLs pin the file in memory until revoked.
  const previews = useRef(new Set<string>())
  useEffect(() => {
    const set = previews.current
    return () => set.forEach((u) => URL.revokeObjectURL(u))
  }, [])

  const refs = items.filter((i) => !i.removed).map((i) => (i.uploadId ? `upload:${i.uploadId}` : i.token))
  const originalTokens = original.map((r) => r.token)
  const changed =
    refs.length !== originalTokens.length || refs.some((t, i) => t !== originalTokens[i])

  const reset = useCallback(() => {
    setItems(initialItems(original))
    setUploads((us) => {
      us.forEach((u) => { URL.revokeObjectURL(u.preview); previews.current.delete(u.preview) })
      return []
    })
  }, [original])

  /** Put `next` where `replaceKey` was, or at the end. */
  const place = useCallback((next: RefItem, replaceKey: string | null) => {
    setItems((cur) => {
      if (!replaceKey) return [...cur, next]
      const at = cur.findIndex((i) => i.key === replaceKey)
      if (at < 0) return [...cur, next]
      const target = cur[at]
      const copy = [...cur]
      if (target.origin === 'job') {
        copy[at] = { ...target, removed: true }
        copy.splice(at + 1, 0, next)
      } else {
        copy[at] = next
      }
      return copy
    })
  }, [])

  const addToken = useCallback(
    (token: string, path: string, replaceKey: string | null) => {
      place({ key: `idx-${seq.current++}`, token, path, origin: 'index' }, replaceKey)
    },
    [place],
  )

  const addFiles = useCallback(
    (files: File[], opts: { asRef: boolean; replaceKey: string | null; entity: string }) => {
      const room = MAX_UPLOADS - uploads.length
      const accepted = files.slice(0, Math.max(0, room))
      const drafts = accepted.map((file) => {
        const preview = URL.createObjectURL(file)
        previews.current.add(preview)
        return {
          id: `u${++seq.current}`,
          file,
          preview,
          mode: 'variant' as const,
          entity: opts.entity,
          kind: '',
          name: '',
          description: '',
          role: 'PLATE',
          descriptor: '',
        }
      })
      setUploads((us) => [...us, ...drafts])
      if (opts.asRef) {
        drafts.forEach((d, i) =>
          place(
            { key: `up-${d.id}`, token: '', path: d.preview, origin: 'upload', uploadId: d.id },
            i === 0 ? opts.replaceKey : null,
          ),
        )
      }
      return files.length - accepted.length
    },
    [uploads.length, place],
  )

  const remove = useCallback((key: string) => {
    setItems((cur) =>
      cur.flatMap((i) => {
        if (i.key !== key) return [i]
        return i.origin === 'job' ? [{ ...i, removed: true }] : []
      }),
    )
  }, [])

  const restore = useCallback((key: string) => {
    setItems((cur) => cur.map((i) => (i.key === key ? { ...i, removed: false } : i)))
  }, [])

  const updateUpload = useCallback((id: string, patch: Partial<UploadDraft>) => {
    setUploads((us) => us.map((u) => (u.id === id ? { ...u, ...patch } : u)))
  }, [])

  const dropUpload = useCallback((id: string) => {
    setUploads((us) => {
      const gone = us.find((u) => u.id === id)
      if (gone) { URL.revokeObjectURL(gone.preview); previews.current.delete(gone.preview) }
      return us.filter((u) => u.id !== id)
    })
    setItems((cur) => cur.filter((i) => i.uploadId !== id))
  }, [])

  const toggleUploadRef = useCallback(
    (id: string, on: boolean) => {
      if (!on) { setItems((cur) => cur.filter((i) => i.uploadId !== id)); return }
      const u = uploads.find((x) => x.id === id)
      if (!u) return
      place({ key: `up-${id}`, token: '', path: u.preview, origin: 'upload', uploadId: id }, null)
    },
    [uploads, place],
  )

  /** Write the edits onto the decision's FormData. */
  const serialize = useCallback(
    (fd: FormData, refsEditable: boolean) => {
      if (refsEditable && changed) fd.set('refs', JSON.stringify(refs))
      if (uploads.length) {
        fd.set(
          'uploads',
          JSON.stringify(
            uploads.map(({ id, mode, entity, kind, name, description, role, descriptor }) => ({
              id, mode, entity, kind, name, description, role, descriptor,
            })),
          ),
        )
        for (const u of uploads) fd.set(`file:${u.id}`, u.file, u.file.name)
      }
    },
    [changed, refs, uploads],
  )

  return {
    items, uploads, changed, reset, addToken, addFiles, remove, restore,
    updateUpload, dropUpload, toggleUploadRef, serialize,
  }
}

export type ReferenceEdits = ReturnType<typeof useReferenceEdits>

// ---------------------------------------------------------------- view

const shortOf = (token: string) => token.replace(/^@/, '').split('/')[0]

export function ReferenceEditor({
  edits,
  catalog,
  refsEditable,
  lockedReason,
  plate,
}: {
  edits: ReferenceEdits
  catalog: CatalogEntity[]
  /** False when this decision queues nothing, so the list cannot take effect. */
  refsEditable: boolean
  lockedReason: string
  /** A likeness plate to judge against that the job was not given. Shown, never sent. */
  plate?: ResolvedReference | null
}) {
  const { assetUrl } = useAssetUrls()
  const [viewing, setViewing] = useState<number | null>(null)
  const [picker, setPicker] = useState<{ mode: PickerMode; replaceKey: string | null; uploadId?: string } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const pendingFile = useRef<{ replaceKey: string | null; entity: string }>({ replaceKey: null, entity: '' })

  const entityForToken = (token: string) => {
    const short = shortOf(token)
    return catalog.find((e) => e.shortId === short || e.id === short)
  }

  function takeFiles(list: FileList | File[] | null, replaceKey: string | null, entity: string) {
    const all = [...(list ?? [])]
    const images = all.filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type))
    const tooBig = images.filter((f) => f.size > MAX_UPLOAD_BYTES)
    const ok = images.filter((f) => f.size <= MAX_UPLOAD_BYTES)
    const over = edits.addFiles(ok, { asRef: refsEditable, replaceKey, entity })
    const problems = [
      all.length > images.length && 'only PNG, JPG or WEBP images are accepted',
      tooBig.length > 0 && `${tooBig.length} image(s) over ${MAX_UPLOAD_BYTES / 1024 / 1024} MB were skipped`,
      over > 0 && `at most ${MAX_UPLOADS} uploads per decision`,
    ].filter(Boolean)
    setNotice(problems.length ? `Some files were not added: ${problems.join('; ')}.` : null)
  }

  function openUpload(replaceKey: string | null) {
    const replaced = replaceKey ? edits.items.find((i) => i.key === replaceKey) : undefined
    // "Instead of @X, use this" is most often a better picture of X itself.
    const entity = replaced?.token ? (entityForToken(replaced.token)?.id ?? '') : ''
    pendingFile.current = { replaceKey, entity }
    setPicker(null)
    fileInput.current?.click()
  }

  const live = edits.items.filter((i) => !i.removed).length

  // Everything viewable in the lightbox, in on-screen order.
  const srcOf = (item: RefItem) =>
    item.origin === 'upload' ? item.path : item.path ? assetUrl(item.path) : null
  const viewable: (LightboxItem & { key: string })[] = [
    ...(plate?.path
      ? [{ key: 'plate', src: assetUrl(plate.path), title: plate.token, subtitle: 'likeness plate: compare only, not sent to the model' }]
      : []),
    ...edits.items.flatMap((item) => {
      const src = srcOf(item)
      if (!src || item.removed) return []
      const name = item.token
        ? entityForToken(item.token)?.name
        : edits.uploads.find((u) => u.id === item.uploadId)?.file.name
      return [{ key: item.key, src, title: item.token || 'New upload', subtitle: name }]
    }),
  ]
  const open = (key: string) => {
    const i = viewable.findIndex((v) => v.key === key)
    if (i >= 0) setViewing(i)
  }
  let position = 0

  return (
    <div
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        takeFiles(e.dataTransfer.files, null, '')
      }}
      className={cn(
        'lit relative rounded-xl border p-6 transition-colors duration-200',
        dragging ? 'border-fg/60 bg-white/[0.03]' : 'border-edge bg-panel/60',
      )}
    >
      <input
        ref={fileInput}
        type="file"
        accept={UPLOAD_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const { replaceKey, entity } = pendingFile.current
          takeFiles(e.target.files, replaceKey, entity)
          e.target.value = ''
        }}
      />

      <div className="mb-5 flex min-h-8 flex-wrap items-center gap-3">
        <span aria-hidden className="size-1.5 rounded-full bg-fg" />
        <span className="eyebrow text-fg/85">References</span>
        <span className="font-mono text-[11px] text-faint">{live} sent, in this order</span>
        {refsEditable && edits.changed && <Badge tone="accent">changed</Badge>}
        {(edits.changed || edits.uploads.length > 0) && (
          <Button type="button" size="sm" tone="ghost" onClick={edits.reset} className="ml-auto">
            <RotateCcw aria-hidden className="size-3.5" />
            Reset
          </Button>
        )}
      </div>

      {!refsEditable && (
        <p className="mb-5 max-w-2xl text-[13px] leading-relaxed text-muted">{lockedReason}</p>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          {plate?.path && (
            <button
              type="button"
              onClick={() => open('plate')}
              className="focus-ring group relative cursor-zoom-in overflow-hidden rounded-lg border border-dashed border-edge-strong bg-sunken text-left"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={assetUrl(plate.path)} alt={plate.token} className="checker aspect-4/3 w-full object-contain opacity-80" />
              <span className="absolute top-2 left-2 rounded-[4px] bg-black/80 px-1.5 py-1 text-[10px] leading-none text-muted">compare only</span>
              <span className="block truncate border-t border-dashed border-edge-strong px-3 py-2.5 font-mono text-[11px] text-muted">
                {plate.token}
              </span>
            </button>
          )}
          <AnimatePresence initial={false}>
            {edits.items.map((item) => (
              <motion.div
                key={item.key}
                layout
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.2, ease: EASE }}
              >
                <RefTile
                  item={item}
                  position={item.removed ? null : ++position}
                  editable={refsEditable}
                  onOpen={() => open(item.key)}
                  upload={edits.uploads.find((u) => u.id === item.uploadId)}
                  catalog={catalog}
                  onRemove={() => edits.remove(item.key)}
                  onRestore={() => edits.restore(item.key)}
                  onReplace={() => setPicker({ mode: 'ref', replaceKey: item.key })}
                />
              </motion.div>
            ))}
          </AnimatePresence>

          {refsEditable && (
          <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-edge-strong p-4">
            <Button type="button" size="sm" tone="outline" onClick={() => setPicker({ mode: 'ref', replaceKey: null })} className="w-full max-w-40">
              <Library aria-hidden className="size-3.5" />
              Add from index
            </Button>
            <Button type="button" size="sm" tone="ghost" onClick={() => openUpload(null)} className="w-full max-w-40">
              <Upload aria-hidden className="size-3.5" />
              Upload image
            </Button>
            <span className="mt-1 text-center text-[11px] text-faint">or drop images here</span>
          </div>
          )}
      </div>

      {!refsEditable && (
        <Button type="button" size="sm" tone="outline" onClick={() => openUpload(null)} className="mt-5">
          <Upload aria-hidden className="size-3.5" />
          Upload an image to file for later
        </Button>
      )}

      <Lightbox items={viewable} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />

      {notice && (
        <p className="mt-5 rounded-md border border-bad/35 bg-bad/8 px-3.5 py-2.5 text-xs leading-relaxed text-bad">{notice}</p>
      )}

      <AnimatePresence initial={false}>
        {edits.uploads.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="mt-6 space-y-4 border-t border-edge pt-6">
              <p className="text-[13px] leading-relaxed text-muted">
                New uploads &middot; the worker files each one into the index with a proper ID.
                These fields go into the registry, so write them in English.
              </p>
              {edits.uploads.map((u, i) => (
                <UploadCard
                  key={u.id}
                  index={i}
                  upload={u}
                  catalog={catalog}
                  refsEditable={refsEditable}
                  inUse={edits.items.some((it) => it.uploadId === u.id)}
                  onChange={(patch) => edits.updateUpload(u.id, patch)}
                  onDrop={() => edits.dropUpload(u.id)}
                  onToggleRef={(on) => edits.toggleUploadRef(u.id, on)}
                  onPickEntity={() => setPicker({ mode: 'entity', replaceKey: null, uploadId: u.id })}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <IndexPicker
        open={picker !== null}
        mode={picker?.mode ?? 'ref'}
        title={
          picker?.mode === 'entity'
            ? 'Which entity is this a new look of?'
            : picker?.replaceKey
              ? 'Replace reference with...'
              : 'Add a reference from the index'
        }
        catalog={catalog}
        onClose={() => setPicker(null)}
        onUpload={() => openUpload(picker?.replaceKey ?? null)}
        onPickRef={(token, path) => {
          edits.addToken(token, path, picker?.replaceKey ?? null)
          setPicker(null)
        }}
        onPickEntity={(e) => {
          if (picker?.uploadId) edits.updateUpload(picker.uploadId, { entity: e.id })
          setPicker(null)
        }}
      />
    </div>
  )
}

function RefTile({
  item,
  position,
  editable,
  onOpen,
  upload,
  catalog,
  onRemove,
  onRestore,
  onReplace,
}: {
  item: RefItem
  /** 1-based order the model receives it in; null when removed. */
  position: number | null
  editable: boolean
  onOpen: () => void
  upload?: UploadDraft
  catalog: CatalogEntity[]
  onRemove: () => void
  onRestore: () => void
  onReplace: () => void
}) {
  const { assetUrl } = useAssetUrls()
  const src = item.origin === 'upload' ? item.path : item.path ? assetUrl(item.path) : null
  const name = item.token ? catalog.find((e) => e.shortId === shortOf(item.token))?.name : undefined
  const label =
    item.origin === 'upload'
      ? `Upload ${upload ? upload.file.name : ''}`
      : item.token

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-lg border bg-sunken transition-colors duration-200',
        item.origin === 'job' ? 'border-edge hover:border-edge-strong' : 'border-fg/40',
      )}
    >
      {src ? (
        <button
          type="button"
          onClick={onOpen}
          disabled={item.removed}
          aria-label={'View ' + label}
          className="focus-ring block w-full cursor-zoom-in disabled:cursor-default"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={label}
            className={cn(
              'checker aspect-4/3 w-full object-contain transition-[filter,opacity] duration-200',
              item.removed && 'opacity-30 grayscale',
            )}
          />
        </button>
      ) : (
        <div className="checker grid aspect-4/3 w-full place-items-center">
          <ImageOff aria-hidden className="size-5 text-muted/60" />
        </div>
      )}

      <div className="border-t border-edge px-3 py-2.5">
        <div className={cn('truncate font-mono text-[11px] text-fg/90', item.removed && 'line-through opacity-50')}>
          {label}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted">
          {item.removed ? 'removed' : (name ?? (item.origin === 'upload' ? 'new upload' : 'reference'))}
        </div>
      </div>

      <div className="pointer-events-none absolute top-2 left-2 flex gap-1.5">
        {position !== null && (
          <span className="grid h-5 min-w-5 place-items-center rounded-[4px] bg-black/80 px-1.5 font-mono text-[10px] leading-none text-fg">
            {String(position).padStart(2, '0')}
          </span>
        )}
        {item.origin !== 'job' && !item.removed && (
          <span className="grid h-5 place-items-center rounded-[4px] bg-fg px-1.5 text-[10px] leading-none font-medium text-ink">
            {item.origin === 'upload' ? 'new upload' : 'added'}
          </span>
        )}
      </div>

      {!editable ? null : item.removed ? (
        <div className="absolute inset-x-0 top-0 grid aspect-4/3 place-items-center">
          <Button type="button" size="sm" tone="outline" onClick={onRestore} className="bg-ink">
            <Undo2 aria-hidden className="size-3.5" />
            Restore
          </Button>
        </div>
      ) : (
        <div className="absolute top-2 right-2 flex gap-1.5 opacity-100 transition-opacity duration-150 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          <IconButton label={`Replace ${label}`} onClick={onReplace}>
            <RefreshCw aria-hidden className="size-3.5" />
          </IconButton>
          <IconButton label={`Remove ${label}`} onClick={onRemove}>
            <X aria-hidden className="size-3.5" />
          </IconButton>
        </div>
      )}
    </div>
  )
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="focus-ring grid size-7 cursor-pointer place-items-center rounded-md bg-black/80 text-fg/80 transition-colors duration-150 hover:bg-black hover:text-fg"
    >
      {children}
    </button>
  )
}

export function UploadCard({
  index,
  upload: u,
  catalog,
  refsEditable,
  inUse,
  onChange,
  onDrop,
  onToggleRef,
  onPickEntity,
}: {
  index: number
  upload: UploadDraft
  catalog: CatalogEntity[]
  refsEditable: boolean
  inUse: boolean
  onChange: (patch: Partial<UploadDraft>) => void
  onDrop: () => void
  onToggleRef: (on: boolean) => void
  onPickEntity: () => void
}) {
  const entity = catalog.find((e) => e.id === u.entity)
  const slug = entitySlug(u.name)
  const clash = u.mode === 'new' && slug ? catalog.find((e) => e.slug === slug) : undefined
  const nonAscii = [u.name, u.description, u.descriptor].some((s) => s && !isAscii(s))

  return (
    <div className="flex flex-col gap-5 rounded-lg border border-edge bg-sunken p-4 sm:flex-row">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={u.preview}
        alt={u.file.name}
        className="checker aspect-4/3 w-full self-start rounded-md border border-edge object-contain sm:w-44"
      />

      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="eyebrow text-fg/85">Upload {String(index + 1).padStart(2, '0')}</span>
          <span className="truncate font-mono text-[11px] text-faint">{u.file.name}</span>
          <Button type="button" size="sm" tone="ghost" onClick={onDrop} className="ml-auto" aria-label={`Discard upload ${index + 1}`}>
            <Trash2 aria-hidden className="size-3.5" />
          </Button>
        </div>

        <div role="radiogroup" aria-label="File this upload as" className="flex flex-wrap gap-1.5">
          {([
            ['variant', 'New look of an existing entity'],
            ['new', 'A new entity'],
          ] as const).map(([mode, text]) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={u.mode === mode}
              onClick={() => onChange({ mode, role: mode === 'new' && u.kind === 'REF' ? 'BOARD' : u.role })}
              className={cn(
                'focus-ring h-8 cursor-pointer rounded-md border px-3 text-[13px] transition-colors duration-150',
                u.mode === mode
                  ? 'border-fg bg-fg text-ink'
                  : 'border-edge-strong text-muted hover:border-muted hover:text-fg',
              )}
            >
              {text}
            </button>
          ))}
        </div>

        {u.mode === 'variant' ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" tone="outline" onClick={onPickEntity}>
              <Library aria-hidden className="size-3.5" />
              {entity ? 'Change entity' : 'Choose entity'}
            </Button>
            {entity ? (
              <span className="text-xs text-muted">
                <span className="font-mono text-fg">{entity.shortId}</span> {entity.name} &middot; becomes V
                {String(entity.variants.reduce((m, v) => Math.max(m, parseInt(v.variant.slice(1), 10) || 0), 0) + 1).padStart(2, '0')}
              </span>
            ) : (
              <span className="text-xs text-bad">Pick which entity this is a picture of.</span>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <Field label="Kind">
              <Select
                value={u.kind}
                onChange={(e) =>
                  onChange({ kind: e.target.value, role: e.target.value === 'REF' ? 'BOARD' : u.role })
                }
              >
                <option value="">Choose...</option>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k} &middot; {KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Name (English)"
              hint={
                clash ? (
                  <span className="text-bad">
                    {clash.shortId} already has this name.{' '}
                    <button
                      type="button"
                      className="cursor-pointer underline"
                      onClick={() => onChange({ mode: 'variant', entity: clash.id })}
                    >
                      Attach as a new look of {clash.shortId}
                    </button>
                  </span>
                ) : slug && u.kind ? (
                  <span className="font-mono">
                    SHM-{u.kind}-###-{slug} &middot; the worker assigns the number
                  </span>
                ) : undefined
              }
            >
              <Input
                dir="ltr"
                value={u.name}
                onChange={(e) => onChange({ name: e.target.value })}
                placeholder="Iranian Banner"
              />
            </Field>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <Field
            label={
              <span className="inline-flex items-center gap-1.5">
                Role <RoleHelp />
              </span>
            }
          >
            <Select value={u.role} onChange={(e) => onChange({ role: e.target.value })}>
              {UPLOAD_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Short description (English, used in the filename)">
            <Input
              dir="ltr"
              value={u.descriptor}
              onChange={(e) => onChange({ descriptor: e.target.value })}
              placeholder="night facade from the courtyard"
            />
          </Field>
        </div>

        {u.mode === 'new' && (
          <Field label="What is it? (optional, English)">
            <Input
              dir="ltr"
              value={u.description}
              onChange={(e) => onChange({ description: e.target.value })}
              placeholder="Red and gold war standard carried by the Iranian delegation"
            />
          </Field>
        )}

        {nonAscii && (
          <p className="text-xs text-bad">
            Name and descriptions go into the index files, so use English letters there. Farsi is
            welcome in the note above.
          </p>
        )}

        {refsEditable && (
          <Checkbox
            checked={inUse}
            onChange={(e) => onToggleRef(e.target.checked)}
            label="Use as a reference in the regeneration"
          />
        )}
      </div>
    </div>
  )
}
