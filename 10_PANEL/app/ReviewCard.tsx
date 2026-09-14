'use client'

import { useActionState, useId, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { decide, type ActionResult } from './actions'
import { ReferenceGallery } from '@/components/reference-gallery'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Disclosure } from '@/components/ui/disclosure'
import { Field, Input, Textarea } from '@/components/ui/field'
import { EASE, SPRING_SNAPPY } from '@/components/ui/motion-tokens'
import { Badge } from '@/components/ui/text'
import { assetUrl, isVideo } from '@/lib/asset'
import { cn } from '@/lib/cn'
import type { Candidate, ResolvedReference } from '@/lib/types'

function PaneLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-[11px] font-medium tracking-[0.1em] text-muted uppercase">{children}</p>
  )
}

/** Renders the candidate, picking the right element for its type. */
function Media({ path, alt }: { path: string; alt: string }) {
  const cls = 'checker w-full rounded-xl border border-edge object-contain'
  if (isVideo(path)) {
    return (
      <video
        src={assetUrl(path)}
        className={cls}
        controls
        loop
        muted
        playsInline
        preload="metadata"
      />
    )
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={assetUrl(path)} alt={alt} className={cls} />
}

function Submit({ label, tone }: { label: string; tone: 'good' | 'bad' }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" tone={tone} pending={pending}>
      {label}
    </Button>
  )
}

export function ReviewCard({
  candidate,
  references,
}: {
  candidate: Candidate
  references: ResolvedReference[]
}) {
  const [verdict, setVerdict] = useState<'accepted' | 'denied' | null>(null)
  const [result, formAction] = useActionState<ActionResult | null, FormData>(decide, null)
  // Scoped per card, so one card's sliding pill never chases another's.
  const pillId = useId()
  const s = candidate.sidecar

  return (
    <Card className="overflow-hidden transition-colors duration-200 hover:border-edge-strong">
      <div className="grid gap-6 p-5 lg:grid-cols-2">
        <div>
          <PaneLabel>Candidate &middot; {candidate.take}</PaneLabel>
          <Media path={candidate.path} alt={`${s.target} ${s.variant} ${candidate.take}`} />
        </div>
        <div>
          <PaneLabel>
            References
            {references.length > 0 && <> &middot; {references.length}</>}
          </PaneLabel>
          <ReferenceGallery references={references} />
        </div>
      </div>

      <div className="border-t border-edge px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted">
          <span className="font-mono text-fg">{s.target}</span>
          <span>{s.variant}</span>
          {s.stage && (
            <Badge tone={s.stage === 'draft' ? 'accent' : 'good'}>
              {s.stage === 'draft'
                ? 'DRAFT — approving buys the 1080p final'
                : 'FINAL'}
            </Badge>
          )}
          <span className="text-xs">model {s.model}</span>
          <span className="text-xs">job {s.jobId}</span>
          {s.attempt > 1 && <Badge tone="accent">attempt {s.attempt}</Badge>}
        </div>

        <Disclosure summary="Prompt" className="mt-4">
          <pre className="scroll-pane max-h-64 rounded-xl border border-edge bg-sunken/70 p-4 text-xs leading-relaxed whitespace-pre-wrap">
            {s.prompt}
          </pre>
        </Disclosure>

        <form action={formAction} className="mt-5">
          <input type="hidden" name="candidate" value={candidate.path} />
          <input type="hidden" name="verdict" value={verdict ?? ''} />

          <div className="flex gap-2.5">
            {(['accepted', 'denied'] as const).map((v) => {
              const on = verdict === v
              return (
                <button
                  key={v}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setVerdict(v)}
                  className={cn(
                    'focus-ring relative h-10 cursor-pointer rounded-lg border px-5 text-sm font-medium',
                    'transition-colors duration-150',
                    on
                      ? cn('text-fg', v === 'accepted' ? 'border-good/60' : 'border-bad/60')
                      : 'border-edge bg-white/[0.03] text-muted hover:border-edge-strong hover:bg-white/[0.07] hover:text-fg',
                  )}
                >
                  {on && (
                    <motion.span
                      aria-hidden
                      layoutId={pillId}
                      transition={SPRING_SNAPPY}
                      className={cn(
                        'absolute inset-0 rounded-lg',
                        v === 'accepted' ? 'bg-good/20' : 'bg-bad/20',
                      )}
                    />
                  )}
                  <span className="relative">{v === 'accepted' ? 'Accept' : 'Deny'}</span>
                </button>
              )
            })}
          </div>

          <AnimatePresence initial={false}>
            {verdict && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: EASE }}
                className="overflow-hidden"
              >
                <div className="space-y-5 pt-5">
                  <Field
                    label={
                      verdict === 'denied'
                        ? 'What is wrong? (required — this becomes the fix)'
                        : 'Why did this one work? (optional, but it is how the system learns)'
                    }
                  >
                    <Textarea
                      name="notes"
                      rows={3}
                      required={verdict === 'denied'}
                      placeholder={
                        verdict === 'denied'
                          ? 'e.g. road reads modern, tyre tracks visible'
                          : 'e.g. the mask silhouette and crown height are exactly right'
                      }
                    />
                  </Field>

                  <Field label="Tags (comma separated)">
                    <Input name="tags" placeholder="anachronism, lighting, silhouette" />
                  </Field>

                  {verdict === 'denied' && (
                    <Checkbox
                      name="requeue"
                      defaultChecked
                      label="Regenerate with this note applied"
                    />
                  )}

                  {result?.error && (
                    <p className="rounded-lg border border-bad/50 bg-bad/10 px-4 py-3 text-sm text-bad">
                      {result.error}
                    </p>
                  )}

                  <div className="flex pt-1">
                    <Submit
                      label={verdict === 'accepted' ? 'Accept' : 'Deny'}
                      tone={verdict === 'accepted' ? 'good' : 'bad'}
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </form>
      </div>
    </Card>
  )
}
