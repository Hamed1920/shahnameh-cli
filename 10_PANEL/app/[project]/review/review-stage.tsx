'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Coins, Pause, Play, RotateCcw, X } from 'lucide-react'
import { decide, type ActionResult } from '../actions'
import { AttemptHistory } from '@/components/attempt-history'
import { MentionTextarea } from '@/components/mention-textarea'
import { ReferenceEditor, useMentionOptions, sameRefFor, useReferenceEdits } from '@/components/reference-editor'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Disclosure } from '@/components/ui/disclosure'
import { Field, Input } from '@/components/ui/field'
import { EASE, SPRING_SNAPPY } from '@/components/ui/motion-tokens'
import { Badge } from '@/components/ui/text'
import { isVideo } from '@/lib/asset'
import { hasSound } from '@/lib/models'
import { useAssetUrls, useProject } from '@/components/project-context'
import { cn } from '@/lib/cn'
import type { AttemptEntry, CatalogEntity, ReviewItem, Verdict } from '@/lib/types'

export interface QueuedDecision {
  path: string
  title: string
  verdict: Verdict
  regenerates: boolean
  /** Actually records the decision. Resolves with the server's answer. */
  commit: () => Promise<ActionResult>
  /**
   * The same decision as a form, for sending with navigator.sendBeacon when the
   * page is closed or reloaded inside the Undo window (review-workspace.tsx).
   */
  form: FormData
  /** Carries uploaded files: may be too big for a beacon, so leaving still warns. */
  hasUploads: boolean
}

/** True while the reviewer is typing, so single-key shortcuts stay out of the way. */
export function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null
  return Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))
}

export function Kbd({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <kbd
      className={cn(
        'inline-grid h-[18px] min-w-[18px] place-items-center rounded-[4px] border border-edge-strong px-1 font-mono text-[10px] leading-none text-muted',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

function Player({ path, label, videoRef }: { path: string; label?: string; videoRef?: React.Ref<HTMLVideoElement> }) {
  const { assetUrl } = useAssetUrls()
  const cls = 'max-h-[66vh] w-full rounded-xl border border-edge object-contain'
  return (
    <figure className="min-w-0">
      {label && <figcaption className="eyebrow mb-3 text-muted">{label}</figcaption>}
      {isVideo(path) ? (
        <video ref={videoRef} src={assetUrl(path)} className={cn(cls, 'bg-black')} controls loop playsInline preload="metadata" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={assetUrl(path)} alt={label ?? ''} className={cn(cls, 'checker')} />
      )}
    </figure>
  )
}

/**
 * One candidate under review: the video large, its references as one numbered
 * row, the history of earlier attempts, and the decision panel pinned beside
 * it so the submit button never scrolls away.
 */
export function ReviewStage({
  item,
  catalog,
  active,
  near = false,
  onQueue,
}: {
  item: ReviewItem
  catalog: CatalogEntity[]
  active: boolean
  /** Next to the active one on the strip: load its video now, so moving to it is instant. */
  near?: boolean
  onQueue: (d: QueuedDecision) => void
}) {
  // Every stage stays mounted so what was typed survives moving around, but a
  // video loads only once its stage is on screen or next to it, not all at once.
  const [seen, setSeen] = useState(active || near)
  if ((active || near) && !seen) setSeen(true)
  const project = useProject()
  const { assetUrl } = useAssetUrls()
  const { candidate, context: ctx } = item
  const s = candidate.sidecar
  const root = useRef<HTMLDivElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const pillId = useId()

  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [notes, setNotes] = useState('')
  const [tags, setTags] = useState('')
  const [requeue, setRequeue] = useState(true)
  // Sound is on by default for whatever this decision queues, whatever this take had.
  const [sound, setSound] = useState(true)
  const [error, setError] = useState<string | null>(candidate.failedDecision?.reason ?? null)
  // A video model with a sound setting: the only kind where "silent" and the Sound choice mean anything.
  const isVideoJob = hasSound(s.model)
  const wasSilent = String(s.params?.generate_audio) === 'false'
  const [checking, setChecking] = useState(false)
  const [comparing, setComparing] = useState<AttemptEntry | null>(null)
  const edits = useReferenceEdits(item.editable)

  const title = ctx.label ?? ctx.scene ?? s.target
  const regenerates = verdict === 'denied' ? requeue : s.stage === 'draft'
  // Before a verdict, assume the list may still matter.
  const refsEditable = verdict === null ? true : regenerates
  const lockedReason =
    verdict === 'denied'
      ? 'Nothing is regenerated, so the references stay as they are. An uploaded image is still filed for later.'
      : 'This is a final render, so nothing else is generated. An uploaded image is filed for later.'

  // What "@" offers: exactly the references in use, in the order the model gets them.
  const mentionOptions = useMentionOptions(edits, catalog)
  const sameRef = sameRefFor(catalog)

  const choose = useCallback((v: Verdict) => {
    setVerdict(v)
    requestAnimationFrame(() => root.current?.querySelector<HTMLTextAreaElement>('textarea[name=notes]')?.focus())
  }, [])

  const submit = useCallback(async () => {
    if (!verdict || checking || !form.current) return
    if (verdict === 'denied' && !notes.trim()) {
      setError('A denial needs a note saying what is wrong — that note is what drives the fix.')
      return
    }
    setError(null)
    setChecking(true)
    const fd = new FormData(form.current)
    edits.serialize(fd, regenerates)
    const check = new FormData()
    for (const [k, v] of fd.entries()) check.append(k, v)
    check.set('validateOnly', '1')
    check.set('project', project.slug)
    const r = await decide(null, check)
    setChecking(false)
    if (!r.ok) {
      setError(r.error ?? 'Could not check this decision.')
      return
    }
    fd.set('project', project.slug)
    onQueue({
      path: candidate.path,
      title,
      verdict,
      regenerates,
      form: fd,
      hasUploads: [...fd.values()].some((v) => typeof v !== 'string' && v.size > 0),
      commit: async () => {
        const res = await decide(null, fd)
        if (!res.ok) setError(res.error ?? 'Could not save this decision.')
        return res
      },
    })
  }, [verdict, checking, notes, edits, regenerates, onQueue, candidate.path, title])

  // Shortcuts belong to the visible stage only.
  useEffect(() => {
    if (!active) return
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || document.querySelector('[role=dialog]')) return
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        submit()
        return
      }
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'a' || e.key === 'A') { e.preventDefault(); choose('accepted') }
      if (e.key === 'd' || e.key === 'D') { e.preventDefault(); choose('denied') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, submit, choose])

  // A stage that is not on screen must not keep playing.
  useEffect(() => {
    if (!active) root.current?.querySelectorAll('video').forEach((v) => v.pause())
  }, [active])

  // Compare: both players driven together.
  const left = useRef<HTMLVideoElement>(null)
  const right = useRef<HTMLVideoElement>(null)
  const both = (fn: (v: HTMLVideoElement) => void) => [left.current, right.current].forEach((v) => v && fn(v))

  const costLine = (() => {
    if (!verdict) return null
    if (verdict === 'denied' && !requeue) return 'Nothing is generated. No credits.'
    if (verdict === 'denied') {
      const c = ctx.cost.regenerate
      return `Regenerates this ${s.stage ?? 'job'} · ${c != null ? `≈ ${c} credits` : 'priced by the worker before it runs'}`
    }
    if (s.stage === 'draft') {
      const c = ctx.cost.final
      return `Buys the full-quality final · ${c != null ? `≈ ${c} credits` : 'priced by the worker before it runs'}`
    }
    return 'Files the shot. No credits.'
  })()

  return (
    <div ref={root} className={cn('grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px] xl:gap-12', !active && 'hidden')}>
      {/* ------------------------------------------------ what is being judged */}
      <div className="min-w-0 space-y-10">
        <header>
          <div className="eyebrow text-faint">
            {[ctx.episode, ctx.scene, ctx.shot, s.variant].filter(Boolean).join('  /  ') || s.target}
          </div>
          <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <h2 className="font-display text-[52px] leading-[0.95] text-fg">{title}</h2>
            {ctx.beats.length > 0 && (
              <p className="text-[15px] text-muted">
                {ctx.beats.map((b, n) => (
                  <span key={n}>
                    {n > 0 && <span className="px-2.5 text-faint">→</span>}
                    {b}
                  </span>
                ))}
              </p>
            )}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-muted">
            {s.stage && (
              <Badge tone={s.stage === 'draft' ? 'accent' : 'good'}>{s.stage === 'draft' ? 'draft' : 'final'}</Badge>
            )}
            {s.attempt > 1 && <Badge>attempt {s.attempt}</Badge>}
            {isVideoJob && wasSilent && <Badge tone="muted">silent</Badge>}
            <span className="ml-1 font-mono text-muted">{s.model}</span>
            <span className="text-faint">·</span>
            <span className="font-mono text-faint">{s.jobId}</span>
          </div>
        </header>

        {comparing?.video ? (
          <div>
            <div className="grid gap-3 md:grid-cols-2">
              <Player path={comparing.video} videoRef={left} label={`Attempt ${comparing.attempt} · ${comparing.verdict ?? 'not reviewed'}`} />
              <Player path={candidate.path} videoRef={right} label={`Attempt ${s.attempt} · now`} />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" tone="outline" onClick={() => both((v) => { v.currentTime = 0; void v.play() })}>
                <Play aria-hidden className="size-3.5" /> Play both from start
              </Button>
              <Button type="button" size="sm" tone="outline" onClick={() => both((v) => v.pause())}>
                <Pause aria-hidden className="size-3.5" /> Pause both
              </Button>
              <Button type="button" size="sm" tone="ghost" onClick={() => setComparing(null)} className="ml-auto">
                <X aria-hidden className="size-3.5" /> Close compare
              </Button>
            </div>
          </div>
        ) : seen ? (
          <Player path={candidate.path} />
        ) : (
          <div className="aspect-video w-full rounded-xl border border-edge bg-black" />
        )}

        <ReferenceEditor
          edits={edits}
          catalog={catalog}
          refsEditable={refsEditable}
          lockedReason={lockedReason}
          plate={item.plate}
        />

        <AttemptHistory history={ctx.history} comparing={comparing?.jobId ?? null} onCompare={setComparing} />

        <Disclosure summary="Full prompt sent to the model">
          <pre className="scroll-pane max-h-80 rounded-xl border border-edge bg-sunken p-5 font-mono text-xs leading-[1.7] whitespace-pre-wrap text-fg/80">
            {s.prompt}
          </pre>
        </Disclosure>
      </div>

      {/* ------------------------------------------------ the decision */}
      <aside className="lg:sticky lg:top-40 lg:self-start">
        <Card className="p-6">
          <div className="mb-5 flex items-center justify-between">
            <span className="eyebrow text-muted">Verdict</span>
            <span className="font-mono text-[11px] text-faint">{s.stage === 'final' ? 'final render' : 'draft'}</span>
          </div>
          <form
            ref={form}
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <input type="hidden" name="candidate" value={candidate.path} />
            <input type="hidden" name="verdict" value={verdict ?? ''} />

            <div className="grid grid-cols-2 gap-2">
              {(['accepted', 'denied'] as const).map((v) => {
                const on = verdict === v
                return (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={on}
                    onClick={() => choose(v)}
                    className={cn(
                      'focus-ring relative flex h-12 cursor-pointer items-center justify-center gap-2.5 rounded-lg border text-sm font-medium transition-colors duration-150',
                      on
                        ? v === 'accepted' ? 'border-fg text-ink' : 'border-bad/50 text-bad'
                        : 'border-edge-strong text-fg/80 hover:border-[#505050] hover:bg-white/[0.04] hover:text-fg',
                    )}
                  >
                    {on && (
                      <motion.span
                        aria-hidden
                        layoutId={pillId}
                        transition={SPRING_SNAPPY}
                        className={cn('absolute inset-0 rounded-[7px]', v === 'accepted' ? 'bg-fg' : 'bg-bad/12')}
                      />
                    )}
                    <span className="relative">{v === 'accepted' ? 'Accept' : 'Deny'}</span>
                    <span className="relative">
                      <Kbd className={cn(on && (v === 'accepted' ? 'border-ink/20 text-ink/55' : 'border-bad/30 text-bad/70'))}>
                        {v === 'accepted' ? 'A' : 'D'}
                      </Kbd>
                    </span>
                  </button>
                )
              })}
            </div>

            <AnimatePresence initial={false}>
              {verdict ? (
                <motion.div
                  key="fields"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: EASE }}
                >
                  <div className="space-y-5 pt-6">
                    <Field label={verdict === 'denied' ? 'What is wrong? This becomes the fix.' : 'Why did this one work? (optional)'}>
                      <MentionTextarea
                        name="notes"
                        rows={5}
                        dir="auto"
                        value={notes}
                        onChange={setNotes}
                        options={mentionOptions}
                        sameRef={sameRef}
                        className="text-start"
                        placeholder={
                          verdict === 'denied'
                            ? 'Farsi or English. Type @ to point at a reference.'
                            : 'Optional. Farsi or English. Type @ to point at a reference.'
                        }
                      />
                    </Field>

                    <Field label="Tags">
                      <Input name="tags" dir="auto" value={tags} onChange={(e) => setTags(e.target.value)} className="text-start" placeholder="lighting, wrong location, silhouette" />
                    </Field>

                    {verdict === 'denied' && (
                      <Checkbox name="requeue" checked={requeue} onChange={(e) => setRequeue(e.target.checked)} label="Regenerate with this note applied" />
                    )}

                    {isVideoJob && regenerates && (
                      <div className="space-y-1.5">
                        <Checkbox
                          name="sound"
                          checked={sound}
                          onChange={(e) => setSound(e.target.checked)}
                          label={verdict === 'denied' ? 'Sound on the regeneration' : 'Sound on the final'}
                        />
                        <p className="text-xs text-faint">
                          {wasSilent ? 'This take was generated silent.' : 'This take was generated with sound.'}
                        </p>
                      </div>
                    )}

                    {costLine && (
                      <p className="flex items-start gap-2.5 border-t border-edge pt-4 text-xs leading-relaxed text-muted">
                        <Coins aria-hidden strokeWidth={1.75} className="mt-px size-3.5 shrink-0 text-fg/70" />
                        {costLine}
                      </p>
                    )}
                  </div>
                </motion.div>
              ) : (
                <motion.p
                  key="hint"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="pt-6 pb-1 text-center font-display text-xl text-muted italic"
                >
                  Watch it, then choose.
                </motion.p>
              )}
            </AnimatePresence>

            {error && (
              <p className="mt-5 rounded-md border border-bad/35 bg-bad/8 px-3.5 py-2.5 text-[13px] leading-relaxed text-bad" dir="auto">
                {error}
              </p>
            )}

            <Button
              type="submit"
              tone={verdict === 'accepted' ? 'good' : verdict === 'denied' ? 'bad' : 'outline'}
              disabled={!verdict}
              pending={checking}
              pendingLabel="Checking"
              className="mt-6 h-11 w-full"
            >
              {verdict === 'accepted' ? 'Accept' : verdict === 'denied' ? 'Deny' : 'Choose Accept or Deny'}
              {verdict && (
                <Kbd className={cn('ml-1.5', verdict === 'accepted' ? 'border-ink/20 text-ink/55' : 'border-bad/30 text-bad/70')}>
                  Ctrl ↵
                </Kbd>
              )}
            </Button>

            {(verdict || notes || tags || edits.changed || edits.uploads.length > 0) && (
              <button
                type="button"
                onClick={() => { setVerdict(null); setNotes(''); setTags(''); setRequeue(true); setSound(true); setError(null); edits.reset() }}
                className="focus-ring mx-auto mt-4 flex cursor-pointer items-center gap-1.5 rounded text-xs text-faint transition-colors duration-150 hover:text-fg"
              >
                <RotateCcw aria-hidden className="size-3" /> Start over
              </button>
            )}
          </form>
        </Card>

        <p className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] text-faint">
          <span><Kbd>A</Kbd> accept</span>
          <span><Kbd>D</Kbd> deny</span>
          <span><Kbd>J</Kbd> <Kbd>K</Kbd> next / previous</span>
          <span><Kbd>Ctrl ↵</Kbd> submit</span>
        </p>
      </aside>
    </div>
  )
}
