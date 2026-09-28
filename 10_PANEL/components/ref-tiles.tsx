'use client'

import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import { Lightbox } from '@/components/lightbox'
import { useAssetUrls } from '@/components/project-context'
import { KIND_LABEL, type Kind } from '@/lib/indexing'
import type { RefView } from '@/lib/types'

/**
 * The references a rule names, as the pictures a prompt under it is sent. A
 * broken one says why, so it can be pointed at a look that exists.
 */
export function RefTiles({ refs }: { refs: RefView[] }) {
  const { assetUrl, thumbUrl } = useAssetUrls()
  const [open, setOpen] = useState<number | null>(null)
  const live = refs.filter((r) => r.path)

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {refs.map((r) => {
          const label = r.token.replace(/^@/, '')
          const kind = r.kind ? (KIND_LABEL[r.kind as Kind] ?? r.kind) : null
          return (
            <li key={r.token}>
              {r.path ? (
                <button
                  type="button"
                  onClick={() => setOpen(live.indexOf(r))}
                  className="focus-ring group block w-full cursor-zoom-in overflow-hidden rounded-lg border border-edge bg-sunken text-left transition-colors duration-150 hover:border-edge-strong"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumbUrl(r.path, 480)}
                    alt={r.name ?? label}
                    loading="lazy"
                    className="checker aspect-[4/3] w-full object-contain transition-transform duration-300 group-hover:scale-[1.02]"
                  />
                  <span className="block border-t border-edge px-3 py-2">
                    <span className="block truncate text-[13px] text-fg">{r.name ?? label}</span>
                    <span className="block truncate font-mono text-[11px] text-faint">{label}{kind && ` · ${kind}`}</span>
                  </span>
                </button>
              ) : (
                <div className="overflow-hidden rounded-lg border border-bad/35 bg-bad/5">
                  <div className="grid aspect-[4/3] w-full place-items-center">
                    <ImageOff aria-hidden className="size-6 text-bad/70" />
                  </div>
                  <div className="border-t border-bad/25 px-3 py-2">
                    <span className="block truncate font-mono text-[11px] text-bad">{label}</span>
                    <span className="block text-[11px] leading-snug text-bad/80">
                      Not sent: {r.stale ?? 'not in the index'}.
                    </span>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <Lightbox
        items={live.map((r) => ({ src: assetUrl(r.path!), title: r.token.replace(/^@/, ''), subtitle: r.name ?? undefined }))}
        index={open}
        onIndex={setOpen}
        onClose={() => setOpen(null)}
      />
    </>
  )
}
