import Link from 'next/link'
import { Logo } from '@/components/logo'
import { Reveal } from '@/components/ui/reveal'
import { cn } from '@/lib/cn'
import { getPickerData, type AccountSpend, type FilmRow, type Frame } from '@/lib/picker'
import { FilmStrip } from './film-strip'
import { NewFilm } from './new-film'

export const dynamic = 'force-dynamic'

/**
 * The project picker: which film do you want to work on?
 *
 * A film is not a name in a list -- it is a strip of its own plates and the
 * handful of numbers that say whether it can work right now. With one or two
 * projects on this machine, a grid of cards reads as an accident; a band at
 * poster scale reads as deliberate. Everything below this page belongs to one
 * project, and the system is identical for all of them, so starting another is
 * typing a name.
 */

const n = (x: number) => Math.round(x).toLocaleString('en-US')

export default async function ProjectsPage() {
  const { films, spend, taken } = await getPickerData()

  return (
    <main className="scroll-pane flex-1">
      <div className="mx-auto max-w-[1500px] px-6 pb-24 lg:px-14">
        <Masthead spend={spend} count={films.length} />

        {films.map((film, i) => (
          <Reveal key={film.slug} index={i}>
            <Band film={film} />
          </Reveal>
        ))}

        <NewFilm taken={taken} alone={films.length === 0} />
      </div>
    </main>
  )
}

/**
 * The system, and the one number that governs it. The ceiling is a rolling
 * window across every project's ledger -- they all spend from one Higgsfield
 * account -- so it belongs here once, not on each band where it would read as
 * belonging to that film.
 */
function Masthead({ spend, count }: { spend: AccountSpend; count: number }) {
  const pct = spend.ceiling > 0 ? Math.min(spend.spent / spend.ceiling, 1) : 0

  return (
    <header className="flex flex-wrap items-end justify-between gap-6 border-b border-edge py-10">
      <div className="flex items-center gap-3.5">
        <Logo className="size-8 text-fg" title="Film Making for Dummies" />
        <div>
          <h1 className="font-display text-[26px] leading-none text-fg">Film Making for Dummies</h1>
          <p className="eyebrow mt-2 text-faint">
            {count === 0 ? 'No films yet' : `${count} film${count === 1 ? '' : 's'}`}
          </p>
        </div>
      </div>

      {spend.ceiling > 0 && (
        <div className="w-full max-w-[280px]">
          <p className="flex items-baseline justify-between font-mono text-[11px] tabular-nums">
            <span className={spend.over ? 'text-bad' : 'text-muted'}>
              {n(spend.spent)} / {n(spend.ceiling)} credits
            </span>
            <span className="text-faint">{spend.hours}h window</span>
          </p>
          <div
            role="meter"
            aria-valuenow={Math.round(spend.spent)}
            aria-valuemin={0}
            aria-valuemax={Math.round(spend.ceiling)}
            aria-label="Credits spent in the current window"
            className="mt-2.5 h-0.75 w-full overflow-hidden rounded-full bg-edge"
          >
            <div
              className={cn('h-full rounded-full transition-[width] duration-500', spend.over ? 'bg-bad' : 'bg-fg')}
              style={{ width: `${Math.max(pct * 100, pct > 0 ? 2 : 0)}%` }}
            />
          </div>
          {spend.over && <p className="mt-2 font-mono text-[11px] text-bad">Over the ceiling — new jobs will hold.</p>}
        </div>
      )}
    </header>
  )
}

function Band({ film }: { film: FilmRow }) {
  return (
    <Link
      href={`/${film.slug}`}
      className="focus-ring group relative isolate block overflow-hidden border-b border-edge py-12 lg:py-14"
    >
      <Backdrop frame={film.frames[0]} />

      {/*
        The film's own mark, as a watermark. Sized to sit inside the band rather
        than bleed out of it: a cropped round glyph still reads as a watermark,
        but a cropped Latin cap just reads as a grey slab.
      */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-1/2 left-[-0.06em] -z-10 -translate-y-1/2 select-none',
          'font-sans text-[clamp(110px,12vw,200px)] leading-none text-white/3',
        )}
      >
        {film.mark}
      </span>

      <div className="grid gap-x-12 gap-y-9 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
        <div className="min-w-0">
          <p className="eyebrow text-faint">
            {film.code}
            {film.since && ` · since ${film.since}`}
          </p>

          <h2 className="mt-4 font-display text-[clamp(38px,5vw,64px)] leading-[0.95] tracking-[-0.01em] text-fg">
            {film.name}
          </h2>

          {film.description && (
            <p className="mt-4 max-w-[46ch] text-[13.5px] leading-relaxed text-muted">{film.description}</p>
          )}

          <Vitals film={film} />

          <p className="eyebrow mt-7 flex items-center gap-2 text-faint transition-colors duration-150 group-hover:text-fg">
            Open
            <span aria-hidden className="transition-transform duration-150 group-hover:translate-x-0.5">
              &rarr;
            </span>
          </p>
        </div>

        <FilmStrip frames={film.frames} emptyNote="no plates yet" />
      </div>
    </Link>
  )
}

/**
 * The film's newest plate, thrown across its own band like light off the gate
 * of a projector.
 *
 * This is the only colour anywhere in the panel, and it is deliberately not
 * the panel's -- it comes off the film. That is the whole reason it is a plate
 * and not a decorative shape: a band with no plates gets no wash, because
 * there is nothing to throw.
 *
 * Blurred past recognition on purpose. The strip beside it is where the frames
 * are meant to be read; a legible second copy of the same image would only
 * compete with it. Masked to a soft pool over the strip so it never hardens
 * into a rectangle against the band's own borders, and held low enough that
 * muted text in front of it keeps its contrast.
 */
function Backdrop({ frame }: { frame: Frame | undefined }) {
  if (!frame) return null

  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 -z-20 overflow-hidden',
        // The gate opens a little as you reach for the film.
        'opacity-50 transition-opacity duration-500 ease-out-quint group-hover:opacity-[.68]',
        // Falls off on all four sides. An ellipse wider than it is tall, kept
        // well inside the band's height, is what stops the wash from reaching
        // the top and bottom rules and hardening into a slab.
        'mask-[radial-gradient(62%_56%_at_70%_50%,#000_0%,transparent_72%)]',
      )}
    >
      {/*
        Scaled past its box so the blur has material to bleed from -- at this
        radius an unscaled image thins out into a pale frame inside the band.

        Saturation is tripled for one reason: half the plates in a reference
        library are shot on white sweep, and a blurred white plate is just a
        grey slab -- the one thing a monochrome panel whose only accent is
        white cannot afford behind its own text. Pushing saturation first
        means a plate reaches the page as its colour, and a plate with no
        colour to give stays close to nothing.

        Decoration, so it loads last and never blocks a plate in the strip.
      */}
      <img
        src={frame.src}
        alt=""
        loading="lazy"
        decoding="async"
        className="size-full scale-125 object-cover blur-[72px] brightness-[.85] saturate-[3]"
      />
    </div>
  )
}

/** What this film is made of, and whether it can work right now. */
function Vitals({ film }: { film: FilmRow }) {
  const dot = film.held > 0 ? 'bg-bad' : film.running ? 'bg-good' : 'bg-faint'
  const worker = film.running ? 'running' : film.workerOff ? 'worker off' : 'stopped'

  return (
    <p className="mt-6 flex flex-wrap items-center gap-x-2.5 gap-y-2 font-mono text-[11px] tabular-nums text-faint">
      <Stat value={film.entities} unit="entities" />
      <Sep />
      <Stat value={film.looks} unit="looks" />
      {film.credits > 0 && (
        <>
          <Sep />
          <Stat value={film.credits} unit="credits" />
        </>
      )}
      {film.queued > 0 && (
        <>
          <Sep />
          <span className="text-fg">
            {n(film.queued)} queued
          </span>
        </>
      )}
      {film.held > 0 && (
        <>
          <Sep />
          <span className="text-bad">{n(film.held)} held</span>
        </>
      )}
      <Sep />
      <span className="flex items-center gap-1.5">
        <span aria-hidden className={cn('size-1.5 rounded-full', dot)} />
        {worker}
      </span>
    </p>
  )
}

const Sep = () => (
  <span aria-hidden className="text-edge-strong">
    ·
  </span>
)

const Stat = ({ value, unit }: { value: number; unit: string }) => (
  <span>
    {n(value)} {unit}
  </span>
)
