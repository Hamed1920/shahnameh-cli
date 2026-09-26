'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ImageOff, Search, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import { EASE } from '@/components/ui/motion-tokens'
import { cn } from '@/lib/cn'
import { useAssetUrls } from '@/components/project-context'
import { KIND_LABEL, type Kind } from '@/lib/indexing'
import type { CatalogEntity } from '@/lib/types'

export type PickerMode =
  /** Pick an image to reference: an entity AND one of its variants. */
  | 'ref'
  /** Pick which entity an upload belongs to. Variants are irrelevant. */
  | 'entity'

/**
 * Search the index and pick from it. Portalled to <body> for the same reason
 * as the reference lightbox: review cards sit inside a transformed Reveal,
 * which would trap `position: fixed`.
 */
export function IndexPicker({
  open,
  mode,
  title,
  catalog,
  onClose,
  onPickRef,
  onPickEntity,
  onUpload,
  initialKind = null,
}: {
  /** Open filtered to this kind (a Characters slot opens on CHR); the chips still switch. */
  initialKind?: string | null
  open: boolean
  mode: PickerMode
  title: string
  catalog: CatalogEntity[]
  onClose: () => void
  onPickRef?: (token: string, path: string) => void
  onPickEntity?: (entity: CatalogEntity) => void
  /** Offered in ref mode, so "replace with..." can also mean "replace with a new image". */
  onUpload?: () => void
}) {
  const { assetUrl } = useAssetUrls()
  const [mounted, setMounted] = useState(false)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const kinds = useMemo(() => [...new Set(catalog.map((e) => e.kind))], [catalog])
  // Set when the picker opens, not whenever `catalog` changes: a live refresh hands
  // in a new array every few seconds, and the kind chosen while browsing would jump back.
  useEffect(() => {
    if (open) setKind(initialKind && catalog.some((e) => e.kind === initialKind) ? initialKind : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialKind])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return catalog.filter((e) => {
      if (kind && e.kind !== kind) return false
      if (!q) return true
      return [e.id, e.shortId, e.name].some((s) => s.toLowerCase().includes(q))
    })
  }, [catalog, query, kind])

  function pickEntity(e: CatalogEntity) {
    if (mode === 'entity') {
      onPickEntity?.(e)
      return
    }
    if (e.variants.length === 0) return
    if (e.variants.length === 1) {
      const v = e.variants[0]
      onPickRef?.(`@${e.shortId}/${v.variant}`, v.path)
      return
    }
    setExpanded((cur) => (cur === e.id ? null : e.id))
  }

  if (!mounted) return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="picker"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: EASE }}
          className="overlay fixed inset-0 z-100 overflow-y-auto overscroll-contain"
        >
          <div className="flex min-h-full items-start justify-center p-4 sm:p-12" onClick={onClose}>
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 10 }}
              transition={{ duration: 0.22, ease: EASE }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-5xl overflow-hidden rounded-2xl border border-edge-strong bg-panel shadow-[0_24px_80px_-24px_rgba(0,0,0,0.9)]"
            >
              <div className="space-y-5 border-b border-edge px-6 pt-5 pb-5">
                <div className="flex items-center gap-3">
                  <h2 className="font-display text-[28px] leading-none text-fg">{title}</h2>
                  {mode === 'ref' && onUpload && (
                    <Button type="button" size="sm" tone="outline" onClick={onUpload} className="ml-auto">
                      <Upload aria-hidden className="size-3.5" />
                      Upload a new image instead
                    </Button>
                  )}
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className={cn(
                      'focus-ring grid size-8 cursor-pointer place-items-center rounded-md text-muted',
                      'transition-colors duration-150 hover:bg-white/[0.05] hover:text-fg',
                      !(mode === 'ref' && onUpload) && 'ml-auto',
                    )}
                  >
                    <X aria-hidden className="size-4" />
                  </button>
                </div>

                <div className="relative">
                  <Search
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted"
                  />
                  <Input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by ID or name: LOC-007, palace, Zahhak"
                    className="h-11 pl-10 text-[15px]"
                  />
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {[null, ...kinds].map((k) => (
                    <button
                      key={k ?? 'all'}
                      type="button"
                      aria-pressed={kind === k}
                      onClick={() => setKind(k)}
                      className={cn(
                        'focus-ring h-7 cursor-pointer rounded-md border px-3 text-xs transition-colors duration-150',
                        kind === k
                          ? 'border-fg bg-fg text-ink'
                          : 'border-edge-strong text-muted hover:border-muted hover:text-fg',
                      )}
                    >
                      {k ? (KIND_LABEL[k as Kind] ?? k) : 'All'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="scroll-pane max-h-[65vh] overflow-y-auto p-6">
                {shown.length === 0 ? (
                  <p className="py-12 text-center text-sm text-muted">Nothing in the index matches.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                    {shown.map((e) => (
                      <EntityTile
                        key={e.id}
                        entity={e}
                        mode={mode}
                        expanded={expanded === e.id}
                        onClick={() => pickEntity(e)}
                        onPickVariant={(v, p) => onPickRef?.(`@${e.shortId}/${v}`, p)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function EntityTile({
  entity: e,
  mode,
  expanded,
  onClick,
  onPickVariant,
}: {
  entity: CatalogEntity
  mode: PickerMode
  expanded: boolean
  onClick: () => void
  onPickVariant: (variant: string, path: string) => void
}) {
  const { thumbUrl } = useAssetUrls()
  const canonical = e.variants.find((v) => v.variant === e.canonical) ?? e.variants[0]
  const [hover, setHover] = useState<string | null>(null)
  const preview = e.variants.find((v) => v.variant === hover) ?? canonical
  const empty = e.variants.length === 0
  const disabled = mode === 'ref' && empty

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-sunken transition-colors duration-200',
        expanded ? 'border-fg/60' : 'border-edge hover:border-edge-strong',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-expanded={mode === 'ref' && e.variants.length > 1 ? expanded : undefined}
        className={cn(
          'focus-ring group block w-full text-left',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        )}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbUrl(preview.path, 480)}
            alt={e.name}
            loading="lazy"
            className="checker aspect-4/3 w-full object-contain transition-transform duration-300 ease-out-quint group-hover:scale-[1.03]"
          />
        ) : (
          <div className="checker grid aspect-4/3 w-full place-items-center">
            <ImageOff aria-hidden className="size-5 text-muted/60" />
          </div>
        )}
        <div className="border-t border-edge px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] font-medium text-fg">{e.shortId}</span>
            <span className="ml-auto font-mono text-[10.5px] text-faint">
              {empty ? 'no image' : `${e.variants.length} look${e.variants.length === 1 ? '' : 's'}`}
            </span>
          </div>
          <div className="mt-1 truncate text-[13px] text-muted">{e.name}</div>
        </div>
      </button>

      {mode === 'ref' && expanded && (
        <div className="flex flex-wrap gap-1.5 border-t border-edge px-3 py-2.5">
          {e.variants.map((v) => (
            <button
              key={v.variant}
              type="button"
              onClick={() => onPickVariant(v.variant, v.path)}
              onMouseEnter={() => setHover(v.variant)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(v.variant)}
              className="focus-ring h-7 cursor-pointer rounded-md border border-edge-strong px-2.5 font-mono text-[11px] text-fg transition-colors duration-150 hover:border-fg hover:bg-fg hover:text-ink"
            >
              {v.variant}
              {v.variant === e.canonical && <span className="ml-1">★</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
