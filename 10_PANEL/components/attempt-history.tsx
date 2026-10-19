'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Columns2, Copy, GitBranch, History, TriangleAlert } from 'lucide-react'
import { RegenerateButton, type RegenerateConfig } from '@/components/regenerate-button'
import { Button } from '@/components/ui/button'
import { ContextMenu, type MenuEntry } from '@/components/ui/context-menu'
import { Badge } from '@/components/ui/text'
import { TakeMedia } from '@/components/take-media'
import { cn } from '@/lib/cn'
import type { AttemptEntry, CatalogEntity } from '@/lib/types'

// A fixed locale: with the default, the server (Node's locale) and the browser could
// write the same date differently, and React would redraw the whole list to reconcile.
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null

/**
 * An attempt's note, three lines tall: with the heading above it, about the
 * height of the preview (sm:w-48, 16:9 = 108px), so a note that carries a whole
 * revision prompt does not make one row a page long. When it runs over, it
 * fades out and "Show all" opens the rest. Tags and references stay in view.
 */
const NOTE_H = 68

function ClampedNote({ text }: { text: string }) {
  const body = useRef<HTMLParagraphElement>(null)
  const [open, setOpen] = useState(false)
  const [over, setOver] = useState(false)

  useLayoutEffect(() => {
    const el = body.current
    if (!el) return
    const check = () => setOver(el.scrollHeight > NOTE_H + 2)
    check()
    // The stage mounts hidden (display: none) until it is the one on screen; measure again when it shows.
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div>
      <p
        ref={body}
        dir="auto"
        style={open ? undefined : { maxHeight: NOTE_H }}
        className={cn(
          'overflow-hidden text-start text-sm leading-relaxed whitespace-pre-line text-fg/90',
          !open && over && '[mask-image:linear-gradient(to_bottom,black_45%,transparent)]',
        )}
      >
        {text}
      </p>
      {over && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="focus-ring mt-1.5 inline-flex cursor-pointer items-center gap-1 rounded text-xs text-muted transition-colors duration-150 hover:text-fg"
        >
          <ChevronDown aria-hidden className={cn('size-3.5 transition-transform duration-200', open && 'rotate-180')} />
          {open ? 'Show less' : 'Show all'}
        </button>
      )}
    </div>
  )
}

/** Copies one attempt's prompt (with its notes), and says so for a moment. */
function CopyPrompt({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  async function copy() {
    let ok = false
    try {
      await navigator.clipboard.writeText(text)
      ok = true
    } catch {
      // No clipboard permission (an address that is not localhost, say): the old way still works from a click.
      const ghost = document.createElement('textarea')
      ghost.value = text
      ghost.style.position = 'fixed'
      ghost.style.opacity = '0'
      document.body.appendChild(ghost)
      ghost.select()
      try { ok = document.execCommand('copy') } catch { ok = false }
      document.body.removeChild(ghost)
    }
    setState(ok ? 'copied' : 'failed')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 2000)
  }

  return (
    <Button type="button" size="sm" tone="outline" onClick={copy} className="h-7" title="Copy the prompt this attempt was sent with, its revision notes included">
      {state === 'copied' ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Could not copy' : 'Copy prompt'}
    </Button>
  )
}

/**
 * Every other attempt at this shot, oldest first, in two lists around the take on screen: the video,
 * what was decided, and the note that sent it back. A revision makes no sense without knowing what
 * it was meant to fix. A job that made no video is listed as failed, with no number.
 */
export function AttemptHistory({
  history,
  later = [],
  comparing,
  onCompare,
  catalog,
  cfg,
  prices,
}: {
  /** Made before the take on screen. */
  history: AttemptEntry[]
  /** Made after it. */
  later?: AttemptEntry[]
  /** The key of the attempt being compared. */
  comparing: string | null
  onCompare: (entry: AttemptEntry | null) => void
  catalog: CatalogEntity[]
  /** What the "Continue from here" panel offers. */
  cfg: RegenerateConfig
  prices: Record<string, number>
}) {
  // Right-click an attempt, or use its button: "Continue from here" opens the panel that fills in that
  // attempt's prompt, references and settings. Nothing is queued until Generate is pressed inside it.
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; entries: MenuEntry[] } | null>(null)
  const [continuing, setContinuing] = useState<AttemptEntry | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  if (history.length === 0 && later.length === 0) return null

  const menuFor = (h: AttemptEntry): MenuEntry[] => [
    { heading: h.failed ? 'Failed job' : `Attempt ${h.number}` },
    {
      label: 'Continue from here',
      icon: <GitBranch className="size-3.5" />,
      onSelect: () => setContinuing(h),
      ...(h.source ? {} : { disabled: true as const }),
    },
    {
      label: 'Copy prompt',
      icon: <Copy className="size-3.5" />,
      onSelect: () => {
        navigator.clipboard.writeText(h.effectivePrompt).then(() => { setCopied(h.key); setTimeout(() => setCopied(null), 1500) }, () => {})
      },
      ...(h.effectivePrompt ? {} : { disabled: true as const }),
    },
    ...(h.video
      ? [{ label: comparing === h.key ? 'Stop comparing' : 'Compare with the current video', icon: <Columns2 className="size-3.5" />, onSelect: () => onCompare(comparing === h.key ? null : h) }]
      : []),
  ]

  const group = (title: string, entries: AttemptEntry[]) => entries.length === 0 ? null : (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <History aria-hidden strokeWidth={1.75} className="size-3.5 text-fg/85" />
        <span className="eyebrow text-fg/85">{title}</span>
        <span className="font-mono text-[11px] leading-none text-faint">{entries.length}</span>
        <span aria-hidden className="h-px flex-1 bg-edge" />
      </div>

      <ol className="space-y-3">
          {entries.map((h) => {
            const on = comparing === h.key
            return (
              <li
                key={h.key}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ at: { x: e.clientX, y: e.clientY }, entries: menuFor(h) })
                }}
                className={cn(
                  'lit flex flex-col gap-5 rounded-xl border bg-panel p-4 transition-colors duration-200 sm:flex-row',
                  on ? 'border-fg/60' : 'border-edge',
                )}
              >
                {h.video ? (
                  <button
                    type="button"
                    onClick={() => onCompare(on ? null : h)}
                    aria-label={`Compare attempt ${h.number} with the current video`}
                    className="focus-ring shrink-0 cursor-pointer overflow-hidden rounded-lg border border-edge transition-colors duration-150 hover:border-edge-strong sm:w-48"
                  >
                    <TakeMedia file={h.video} alt={`Attempt ${h.number}`} controls={false} at={1} className="" />
                  </button>
                ) : (
                  <div className="grid aspect-video shrink-0 place-items-center rounded-lg border border-dashed border-edge-strong text-[11px] text-faint sm:w-48">
                    {h.failed ? 'no video made' : 'video not on disk'}
                  </div>
                )}
  
                <div className="min-w-0 flex-1 space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-display text-xl leading-none text-fg">{h.failed ? 'Failed job' : `Attempt ${h.number}`}</span>
                    {h.failed && <Badge tone="bad"><TriangleAlert aria-hidden className="mr-1 inline size-3" />failed, nothing made</Badge>}
                    {h.from !== null && <Badge tone="accent">branched from attempt {h.from}</Badge>}
                    {h.stage && <span className="ml-1 font-mono text-[11px] text-muted">{h.stage}</span>}
                    {h.verdict === 'denied' && <Badge tone="bad">denied</Badge>}
                    {h.verdict === 'accepted' && <Badge tone="good">{h.stage === 'draft' ? 'draft approved' : 'accepted'}</Badge>}
                    {h.verdict === 'discarded' && <Badge tone="muted">discarded</Badge>}
                    {!h.verdict && !h.failed && <Badge tone="muted">not reviewed</Badge>}
                    {h.failed && <span className="font-mono text-[11px] text-faint">{h.jobId}</span>}
                    {when(h.decidedAt) && <span suppressHydrationWarning className="font-mono text-[11px] text-faint">{when(h.decidedAt)}</span>}
                    <span className="ml-auto flex items-center gap-1.5">
                      {h.effectivePrompt && <CopyPrompt text={h.effectivePrompt} />}
                      {h.source && (
                        <Button type="button" size="sm" tone="outline" onClick={() => setContinuing(h)} className="h-7" title="Start the next attempt from this one: its prompt, references and settings, to look over first">
                          <GitBranch aria-hidden className="size-3.5" />
                          Continue from here
                        </Button>
                      )}
                      {h.video && (
                        <Button type="button" size="sm" tone={on ? 'accent' : 'outline'} onClick={() => onCompare(on ? null : h)} className="h-7">
                          <Columns2 aria-hidden className="size-3.5" />
                          {on ? 'Comparing' : 'Compare'}
                        </Button>
                      )}
                    </span>
                  </div>
                  {h.notes ? (
                    <ClampedNote text={h.notes} />
                  ) : (
                    <p className="text-xs text-faint">{h.failed ? (h.failReason || 'The job ended without a video.') : 'No note.'}</p>
                  )}
                  {(h.tags.length > 0 || h.refs.length > 0) && (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {h.tags.map((t) => (
                        <Badge key={`t-${t}`} tone="muted">{t}</Badge>
                      ))}
                      {h.refs.map((r) => (
                        <span key={`r-${r}`} className="inline-flex h-5 items-center rounded-[5px] bg-white/[0.06] px-1.5 font-mono text-[10.5px] text-muted">
                          {r}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
    </div>
  )

  return (
    <section className="space-y-10">
      {group('Earlier attempts', history)}
      {group('Later attempts', later)}

      <ContextMenu at={menu?.at ?? null} entries={menu?.entries ?? []} onClose={() => setMenu(null)} />

      {/* The panel where everything is confirmed. It starts from the attempt chosen; only its Generate button queues anything. */}
      {continuing && (
        <RegenerateButton
          key={continuing.key}
          from="history"
          hideTrigger
          open
          onOpenChange={(o) => { if (!o) setContinuing(null) }}
          title={continuing.failed ? 'Continue from the failed job' : `Continue from attempt ${continuing.number}`}
          jobId={continuing.jobId}
          decisionId={continuing.decisionId}
          credits={null}
          source={continuing.source}
          catalog={catalog}
          cfg={cfg}
          regenerations={[]}
          prices={prices}
        />
      )}
      {copied && <span className="sr-only" role="status">Prompt copied</span>}
    </section>
  )
}
