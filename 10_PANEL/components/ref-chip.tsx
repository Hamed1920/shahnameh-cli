'use client'

import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import { Lightbox } from '@/components/lightbox'
import { useAssetUrls } from '@/components/project-context'
import { cn } from '@/lib/cn'
import type { RefView } from '@/lib/types'

/**
 * One reference inside running text: its picture, its token and its name, so
 * "@CHR-002/V02" reads as the look it is. Click to see it large. One that no
 * longer resolves is red and says why on hover.
 */
export function RefChip({ r, className }: { r: RefView; className?: string }) {
  const { assetUrl, thumbUrl } = useAssetUrls()
  const [open, setOpen] = useState<number | null>(null)
  const label = r.token.replace(/^@/, '')

  if (!r.path) {
    return (
      <span
        title={r.stale ? `Not sent with the prompt: ${r.stale}` : 'Not in the index'}
        className={cn(
          'mx-0.5 inline-flex h-6 translate-y-[-1px] items-center gap-1.5 rounded-md border border-bad/35 bg-bad/8 pr-2 pl-1 align-middle text-[12px] leading-none text-bad',
          className,
        )}
      >
        <span className="grid size-4 place-items-center"><ImageOff aria-hidden className="size-3" /></span>
        <span className="font-mono">{label}</span>
      </span>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(0)}
        title={r.name ? `${r.name} · ${label}` : label}
        className={cn(
          'focus-ring mx-0.5 inline-flex h-6 translate-y-[-1px] cursor-zoom-in items-center gap-1.5 rounded-md border border-edge-strong bg-raise pr-2 pl-0.5 align-middle text-[12px] leading-none text-fg transition-colors duration-150 hover:border-muted',
          className,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumbUrl(r.path, 96)} alt="" loading="lazy" className="checker size-5 rounded-[4px] object-cover" />
        <span className="font-mono text-[11px] text-muted">{label}</span>
        {r.name && <span className="max-w-[16ch] truncate">{r.name}</span>}
      </button>
      <Lightbox
        items={[{ src: assetUrl(r.path), title: label, subtitle: r.name ?? undefined }]}
        index={open}
        onIndex={setOpen}
        onClose={() => setOpen(null)}
      />
    </>
  )
}
