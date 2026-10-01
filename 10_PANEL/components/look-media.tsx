'use client'

import { AudioLines } from 'lucide-react'
import { useAssetUrls } from '@/components/project-context'
import { isAudio } from '@/lib/asset'
import { cn } from '@/lib/cn'

/**
 * One look of an entity: its picture, or -- for a voice (VOX), whose looks are
 * recordings -- a speaker mark with a player under it. A recording has no
 * thumbnail; asking the thumb route for one would only 404.
 *
 * `controls` false leaves the player out (a tile inside a button, where a
 * second interactive element would be invalid); the tile still says it is audio.
 */
export function LookMedia({
  path, alt = '', width = 480, fit = 'cover', controls = true, row = false, className,
}: {
  path: string
  alt?: string
  width?: number
  fit?: 'cover' | 'contain'
  controls?: boolean
  /** A recording laid out as a full-width row (a voice's card), not a 4:3 tile. */
  row?: boolean
  className?: string
}) {
  const { assetUrl, thumbUrl } = useAssetUrls()
  if (!isAudio(path)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={thumbUrl(path, width)} alt={alt} loading="lazy" className={cn('checker aspect-4/3 w-full', fit === 'cover' ? 'object-cover' : 'object-contain', className)} />
  }
  if (row) {
    return (
      // Left room for the card's look badge (V01 HERO), right room for the main-look star.
      <div className={cn('flex w-full items-center gap-3 bg-sunken py-3 pr-8 pl-[4.75rem]', className)}>
        <AudioLines aria-hidden strokeWidth={1.5} className="size-5 shrink-0 text-muted" />
        {controls && (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <audio src={assetUrl(path)} controls preload="none" aria-label={alt || 'recording'}
            onClick={(e) => e.stopPropagation()} className="h-9 min-w-0 flex-1" />
        )}
      </div>
    )
  }
  return (
    <div className={cn('flex aspect-4/3 w-full flex-col items-center justify-center gap-2 bg-sunken px-2', className)}>
      <AudioLines aria-hidden strokeWidth={1.5} className="size-7 text-muted" />
      <span className="max-w-full truncate font-mono text-[10px] text-faint">{path.split('/').pop()}</span>
      {controls && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio
          src={assetUrl(path)}
          controls
          preload="none"
          aria-label={alt || 'recording'}
          onClick={(e) => e.stopPropagation()}
          className="h-8 w-full max-w-[320px]"
        />
      )}
    </div>
  )
}
