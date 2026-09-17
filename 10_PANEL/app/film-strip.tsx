import type { Frame } from '@/lib/picker'
import { cn } from '@/lib/cn'

/**
 * A film's plates, hung in a strip of film.
 *
 * The house mark (components/logo.tsx) is a frame with sprockets punched down
 * both edges, so the picker builds its bands out of that same perforated strip
 * rather than inventing a container. The rails are one repeating SVG cell, ink
 * holes on a panel base, so they read as punched through to the page.
 *
 * Server component. The hover advance is a CSS transition on the group, which
 * means no JS and no state -- and the prefers-reduced-motion block in
 * globals.css already flattens it to nothing.
 */

/** Ink-coloured rounded holes on a transparent cell, repeated along both rails. */
const PERFS =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='16'%3E%3Crect x='6' y='5' width='10' height='6' rx='2' fill='%230a0a0a'/%3E%3C/svg%3E\")"

/**
 * Frame width drives everything: the strip advances by exactly one frame plus
 * one gutter on hover, so the pitch has to be a real length, not a percentage
 * of a row whose width changes with the frame count.
 */
const PITCH = { '--fw': 'clamp(104px, 13vw, 188px)' } as React.CSSProperties

function Rail({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('h-4 shrink-0 bg-panel', className)}
      style={{ backgroundImage: PERFS, backgroundRepeat: 'repeat-x', backgroundSize: '22px 16px' }}
    />
  )
}

export function FilmStrip({ frames, emptyNote }: { frames: Frame[]; emptyNote: string }) {
  const empty = frames.length === 0
  // Four show; the rest wait off the right edge for the advance to bring them in.
  const cells = empty ? Array.from({ length: 4 }, () => null) : frames

  return (
    <div
      style={PITCH}
      className={cn(
        'relative overflow-hidden',
        // The strip is film: it runs past the edge of the band rather than ending in it.
        'mask-[linear-gradient(to_right,#000_78%,transparent_100%)]',
      )}
    >
      <Rail />
      <div
        className={cn(
          'flex gap-0.75 bg-panel py-0.75',
          'transition-transform duration-450 ease-out-quint',
          // One frame and one gutter, the motion a strip has when it advances.
          // Negated inside the calc: a leading "-" on an arbitrary value does not negate a var().
          !empty && 'group-hover:translate-x-[calc((var(--fw)+3px)*-1)]',
        )}
      >
        {cells.map((frame, i) => (
          <div
            key={frame?.src ?? i}
            className={cn(
              'relative aspect-video w-(--fw) shrink-0 overflow-hidden',
              // The checkerboard is there to read a transparent PNG against. An
              // unexposed frame has nothing to read, so it stays plain.
              frame ? 'checker' : 'bg-sunken',
            )}
          >
            {frame && (
              <img
                src={frame.src}
                alt={frame.label}
                /* Only five small thumbs, and the fifth must be there the moment the strip advances. */
                loading="eager"
                decoding="async"
                className="size-full object-cover"
              />
            )}
          </div>
        ))}
      </div>
      <Rail />

      {empty && (
        <p className="eyebrow absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-faint">
          {emptyNote}
        </p>
      )}
    </div>
  )
}
