'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronLeft, ChevronRight, Expand, ImageOff, X } from 'lucide-react'
import { EASE } from '@/components/ui/motion-tokens'
import { assetUrl, isVideo } from '@/lib/asset'
import { cn } from '@/lib/cn'
import type { ResolvedReference } from '@/lib/types'

function Frame({ path, alt, className }: { path: string; alt: string; className?: string }) {
  if (isVideo(path)) {
    return (
      <video
        src={assetUrl(path)}
        className={className}
        controls
        loop
        muted
        playsInline
        preload="metadata"
      />
    )
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={assetUrl(path)} alt={alt} className={className} />
}

/**
 * Every reference the prompt was generated from, as a grid, with a lightbox
 * over the whole screen on click.
 *
 * The overlay is portalled to <body> deliberately. Review cards are wrapped in
 * a motion component that applies a transform, and a transformed ancestor
 * makes `position: fixed` resolve against it instead of the viewport -- the
 * lightbox would be trapped inside the card.
 */
export function ReferenceGallery({ references }: { references: ResolvedReference[] }) {
  const openable = references.filter((r): r is ResolvedReference & { path: string } =>
    Boolean(r.path),
  )
  const [open, setOpen] = useState<number | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const close = useCallback(() => setOpen(null), [])
  const step = useCallback(
    (by: number) =>
      setOpen((i) => (i === null ? i : (i + by + openable.length) % openable.length)),
    [openable.length],
  )

  useEffect(() => {
    if (open === null) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowRight') step(1)
      if (e.key === 'ArrowLeft') step(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close, step])

  if (references.length === 0) {
    return (
      <div className="flex h-full min-h-48 items-center justify-center rounded-xl border border-dashed border-edge bg-panel/25 p-6 text-center text-sm text-muted">
        No reference on file
      </div>
    )
  }

  const cols =
    references.length === 1 ? 'grid-cols-1' : references.length <= 4 ? 'grid-cols-2' : 'grid-cols-3'
  const current = open === null ? null : openable[open]

  return (
    <>
      <div className={cn('grid gap-3', cols)}>
        {references.map((r) => {
          const at = r.path ? openable.findIndex((o) => o.path === r.path) : -1

          if (!r.path) {
            return (
              <div
                key={r.token}
                className="flex aspect-4/3 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-edge bg-panel/25 p-3 text-center"
              >
                <ImageOff aria-hidden className="size-5 text-muted/60" />
                <span className="font-mono text-[10px] break-all text-muted">{r.token}</span>
                <span className="text-[10px] text-muted/60">not on file</span>
              </div>
            )
          }

          return (
            <button
              key={r.token}
              type="button"
              onClick={() => setOpen(at)}
              aria-label={`Open reference ${r.token}`}
              className={cn(
                'focus-ring group relative block cursor-zoom-in overflow-hidden rounded-xl',
                'border border-edge bg-sunken/60 transition-colors duration-200',
                'hover:border-accent/50',
              )}
            >
              <Frame
                path={r.path}
                alt={r.token}
                className={cn(
                  'checker aspect-4/3 w-full object-contain',
                  'transition-transform duration-300 ease-out-quint group-hover:scale-[1.04]',
                )}
              />

              {/* Caption plate. Always shows the token; the expand cue fades in. */}
              <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-2 bg-linear-to-t from-ink/90 to-transparent px-2.5 pt-6 pb-2">
                <span className="truncate font-mono text-[10px] text-fg/90">{r.token}</span>
                <Expand
                  aria-hidden
                  className="ml-auto size-3.5 shrink-0 text-accent opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                />
              </span>
            </button>
          )
        })}
      </div>

      {mounted &&
        createPortal(
          <AnimatePresence>
            {current && (
              <motion.div
                key="lightbox"
                role="dialog"
                aria-modal="true"
                aria-label={`Reference ${current.token}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: EASE }}
                // overscroll-contain stops a wheel over the overlay from
                // scrolling the page behind it, without touching any
                // element's overflow -- so nothing reflows on open.
                className="glass-deep fixed inset-0 z-100 overflow-y-auto overscroll-contain"
              >
                <div
                  className="flex min-h-full items-center justify-center p-6 sm:p-10"
                  onClick={close}
                >
                  <motion.figure
                    initial={{ opacity: 0, scale: 0.97, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97, y: 10 }}
                    transition={{ duration: 0.22, ease: EASE }}
                    onClick={(e) => e.stopPropagation()}
                    className="glass w-full max-w-5xl overflow-hidden rounded-2xl border border-edge shadow-2xl shadow-black/60"
                  >
                    <Frame
                      path={current.path}
                      alt={current.token}
                      className="checker max-h-[72vh] w-full object-contain"
                    />
                    <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-edge px-5 py-3.5">
                      <span className="font-mono text-sm text-fg">{current.token}</span>
                      <span className="font-mono text-xs break-all text-muted">
                        {current.path}
                      </span>
                      {openable.length > 1 && (
                        <span className="ml-auto text-xs tabular-nums text-muted">
                          {open! + 1} / {openable.length}
                        </span>
                      )}
                    </figcaption>
                  </motion.figure>
                </div>

                <button
                  type="button"
                  onClick={close}
                  aria-label="Close"
                  autoFocus
                  className="focus-ring glass fixed top-5 right-5 grid size-10 cursor-pointer place-items-center rounded-full border border-edge text-muted transition-colors duration-150 hover:border-edge-strong hover:text-fg"
                >
                  <X aria-hidden className="size-4.5" />
                </button>

                {openable.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => step(-1)}
                      aria-label="Previous reference"
                      className="focus-ring glass fixed top-1/2 left-5 grid size-10 -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-edge text-muted transition-colors duration-150 hover:border-edge-strong hover:text-fg"
                    >
                      <ChevronLeft aria-hidden className="size-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => step(1)}
                      aria-label="Next reference"
                      className="focus-ring glass fixed top-1/2 right-5 grid size-10 -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-edge text-muted transition-colors duration-150 hover:border-edge-strong hover:text-fg"
                    >
                      <ChevronRight aria-hidden className="size-5" />
                    </button>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  )
}
