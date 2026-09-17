'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { FilmStrip } from './film-strip'
import { cn } from '@/lib/cn'
import { codeProblem, slugProblem, suggestCode, suggestSlug } from '../worker/lib/ids.mjs'
import { newProject } from './project-actions'

/**
 * Starting a film: type its name.
 *
 * Everything else was always derived -- the folder, the ID prefix every filename
 * begins with, the badge letter -- so the old four-field form was mostly showing
 * its own homework and asking to have it approved. Here the derived values are a
 * caption under the name instead. Each one can still be overridden, because all
 * three are permanent once a file is written with them, but none has to be.
 */

type Part = 'slug' | 'code' | 'mark'

/** Mirrors defaultMark in lib/projects.ts, which is server-only. */
function firstLetter(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? ''
}

/** suggestCode already skips taken codes; slugs have no such guard, so they get one here. */
function freeSlug(base: string, taken: string[]): string {
  if (!base || !taken.includes(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`.slice(0, 40)
    if (!taken.includes(candidate)) return candidate
  }
}

function problem(part: Part, value: string): string | null {
  if (part === 'slug') return slugProblem(value)
  if (part === 'code') return codeProblem(value)
  return value ? null : 'The badge needs a letter.'
}

export function NewFilm({ taken, alone }: { taken: { slugs: string[]; codes: string[] }; alone: boolean }) {
  const [name, setName] = useState('')
  const [derived, setDerived] = useState({ slug: '', code: '', mark: '' })
  // Once a part is typed by hand the name stops overwriting it.
  const [held, setHeld] = useState<Record<Part, boolean>>({ slug: false, code: false, mark: false })
  const [editing, setEditing] = useState<Part | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function onName(value: string) {
    setName(value)
    setError(null)
    setDerived((d) => ({
      slug: held.slug ? d.slug : freeSlug(suggestSlug(value), taken.slugs),
      code: held.code ? d.code : suggestCode(value, taken.codes),
      mark: held.mark ? d.mark : firstLetter(value),
    }))
  }

  function commit(part: Part, value: string) {
    const clean = part === 'code' ? value.trim().toUpperCase() : part === 'slug' ? value.trim().toLowerCase() : value.trim()
    const why = problem(part, clean)
    if (why) {
      setError(why)
      return
    }
    setError(null)
    setDerived((d) => ({ ...d, [part]: clean }))
    setHeld((h) => ({ ...h, [part]: true }))
    setEditing(null)
  }

  function submit(formData: FormData) {
    setError(null)
    start(async () => {
      // A success redirects and never returns; only a problem comes back.
      const r = await newProject(formData)
      if (r && !r.ok) setError(r.error)
    })
  }

  const ready = name.trim().length > 0

  return (
    <section className={cn('py-14 lg:py-16', alone && 'flex min-h-[60vh] flex-col justify-center')}>
      <form action={submit} className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
        <input type="hidden" name="slug" value={derived.slug} />
        <input type="hidden" name="code" value={derived.code} />
        <input type="hidden" name="mark" value={derived.mark} />

        <div className="min-w-0">
          <p className="eyebrow text-faint">{alone ? 'Your first film' : 'New film'}</p>

          <label className="mt-5 block">
            <span className="sr-only">What is the film called?</span>
            <input
              name="name"
              value={name}
              onChange={(e) => onName(e.target.value)}
              required
              maxLength={80}
              autoComplete="off"
              placeholder="Name it"
              className={cn(
                'w-full border-0 border-b border-edge bg-transparent pb-3',
                'font-display text-[clamp(34px,4.6vw,60px)] leading-[1.05] text-fg',
                'placeholder:text-white/15',
                'transition-colors duration-150 outline-none hover:border-edge-strong focus:border-fg/45',
              )}
            />
          </label>

          {/* The caption: what the name became. Present from the first keystroke, never in the way. */}
          <div
            className={cn(
              'mt-4 flex flex-wrap items-center gap-x-2 gap-y-2 font-mono text-[12px]',
              'transition-opacity duration-200',
              ready ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
          >
            {(['slug', 'code', 'mark'] as Part[]).map((part, i) => (
              <span key={part} className="flex items-center gap-2">
                {i > 0 && <span className="text-edge-strong">·</span>}
                {editing === part ? (
                  <input
                    autoFocus
                    defaultValue={derived[part]}
                    size={Math.max(derived[part].length + 1, 4)}
                    maxLength={part === 'slug' ? 40 : part === 'code' ? 4 : 2}
                    onBlur={(e) => commit(part, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commit(part, e.currentTarget.value) }
                      if (e.key === 'Escape') { e.preventDefault(); setEditing(null); setError(null) }
                    }}
                    className={cn(
                      'rounded-sm border border-fg/45 bg-transparent px-1.5 py-0.5',
                      'font-mono text-[12px] text-fg outline-none',
                      part === 'code' && 'uppercase',
                    )}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditing(part)}
                    title={LABEL[part]}
                    className={cn(
                      'focus-ring rounded-sm px-1.5 py-0.5 text-faint',
                      'transition-colors duration-150 hover:bg-white/6 hover:text-fg',
                    )}
                  >
                    {derived[part] || '—'}
                  </button>
                )}
              </span>
            ))}
            <span className="text-faint/60">— click to change</span>
          </div>

          <div className="mt-7 flex min-h-10 items-center gap-4">
            <div className={cn('transition-opacity duration-200', ready ? 'opacity-100' : 'pointer-events-none opacity-0')}>
              <Button type="submit" tone="accent" pending={pending} pendingLabel="Creating">
                Start the film
              </Button>
            </div>
            {error && <p className="text-[13px] text-bad">{error}</p>}
          </div>
        </div>

        <div aria-hidden className="hidden lg:block">
          <FilmStrip frames={[]} emptyNote="unexposed" />
        </div>
      </form>
    </section>
  )
}

const LABEL: Record<Part, string> = {
  slug: 'The folder on disk, and the web address',
  code: 'The prefix every ID in this film begins with',
  mark: 'The badge letter',
}

