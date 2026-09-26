'use client'

import { useEffect, useRef, useState } from 'react'
import { useAssetUrls } from '@/components/project-context'
import { isVideo } from '@/lib/asset'
import { cn } from '@/lib/cn'

/** Grid cards are at most ~600 device pixels wide; api/thumb's largest width covers them. */
export const CARD_THUMB = 720

/**
 * True once `ref`'s element comes within `margin` of the viewport, and stays true.
 * Lets a long page of cards mount their videos as they are scrolled to.
 */
export function useNear<T extends Element>(margin = '600px') {
  const ref = useRef<T>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || near) return
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return }
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) { setNear(true); io.disconnect() } },
      { rootMargin: margin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [near, margin])
  return [ref, near] as const
}

/**
 * A take on a card: Gallery, Decided, the Episodes pages, attempt history.
 *
 * A video mounts only once its card comes near the viewport, and then asks for
 * metadata with a `#t=0.1` fragment so the browser seeks a tenth of a second in
 * and paints that frame as the poster. `preload="none"` costs nothing but shows
 * a black box, and letting all ~50 takes load at once buries the server in
 * range requests before a single one is played.
 *
 * An image is a card-sized JPEG from api/thumb, not the several-MB original;
 * the lightbox and Review show the original.
 */
export function TakeMedia({
  file, alt, className, controls = true, at = 0.1,
}: {
  file: string
  alt: string
  /** Box classes: rounding, border. The aspect is always 16:9. */
  className?: string
  controls?: boolean
  /** Seconds into the video for the poster frame. */
  at?: number
}) {
  const { assetUrl, thumbUrl } = useAssetUrls()
  const [box, near] = useNear<HTMLDivElement>()
  const frame = cn('aspect-video w-full overflow-hidden', className ?? 'rounded-lg border border-edge')

  if (!isVideo(file)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={thumbUrl(file, CARD_THUMB)} alt={alt} loading="lazy" decoding="async" className={cn(frame, 'checker object-contain')} />
  }

  return (
    <div ref={box} className={cn(frame, 'bg-black')}>
      {near && (
        <video
          src={`${assetUrl(file)}#t=${at}`}
          className="size-full object-contain"
          controls={controls} muted={!controls} loop playsInline preload="metadata"
        />
      )}
    </div>
  )
}
