'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { decide, type ActionResult } from './actions'
import type { Candidate } from '@/lib/types'

function assetUrl(rel: string) {
  return `/api/asset?path=${encodeURIComponent(rel)}`
}

const isVideo = (p: string) => /\.(mp4|mov|webm)$/i.test(p)

/** Renders a candidate or reference, picking the right element for its type. */
function Media({ path, alt, dim }: { path: string; alt: string; dim?: boolean }) {
  const cls = `checker w-full rounded border border-[var(--color-edge)] object-contain${dim ? ' opacity-90' : ''}`
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
  const bg = tone === 'good' ? 'var(--color-good)' : 'var(--color-bad)'
  return (
    <button
      type="submit"
      disabled={pending}
      style={{ backgroundColor: bg }}
      className="rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
    >
      {pending ? 'Saving…' : label}
    </button>
  )
}

export function ReviewCard({
  candidate,
  referencePath,
}: {
  candidate: Candidate
  referencePath: string | null
}) {
  const [verdict, setVerdict] = useState<'accepted' | 'denied' | null>(null)
  const [result, formAction] = useActionState<ActionResult | null, FormData>(decide, null)
  const s = candidate.sidecar

  return (
    <article className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)]">
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs uppercase tracking-wide text-[var(--color-muted)]">
            Candidate · {candidate.take}
          </p>
          <Media
            path={candidate.path}
            alt={`${s.target} ${s.variant} ${candidate.take}`}
          />
        </div>
        <div>
          <p className="mb-2 text-xs uppercase tracking-wide text-[var(--color-muted)]">
            Reference {referencePath ? '' : '— none on file'}
          </p>
          {referencePath ? (
            <Media path={referencePath} alt="reference" dim />
          ) : (
            <div className="flex h-48 items-center justify-center rounded border border-dashed border-[var(--color-edge)] p-4 text-center text-sm text-[var(--color-muted)]">
              {s.refs?.length
                ? `Generated from ${s.refs.length} reference${s.refs.length > 1 ? 's' : ''}: ${s.refs.join(', ')}`
                : 'No reference on file'}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-[var(--color-edge)] px-4 py-3 text-sm">
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[var(--color-muted)]">
          <span className="font-mono text-white">{s.target}</span>
          <span>{s.variant}</span>
          {s.stage && (
            <span
              className={
                s.stage === 'draft'
                  ? 'rounded bg-[var(--color-accent)]/20 px-2 py-0.5 text-xs font-medium text-[var(--color-accent)]'
                  : 'rounded bg-[var(--color-good)]/20 px-2 py-0.5 text-xs font-medium text-[var(--color-good)]'
              }
            >
              {s.stage === 'draft' ? 'DRAFT — approving buys the 1080p final' : 'FINAL'}
            </span>
          )}
          <span>model {s.model}</span>
          <span>job {s.jobId}</span>
          {s.attempt > 1 && (
            <span className="text-[var(--color-accent)]">attempt {s.attempt}</span>
          )}
        </div>
        <details className="mb-3">
          <summary className="cursor-pointer text-[var(--color-muted)]">Prompt</summary>
          <pre className="mt-2 whitespace-pre-wrap rounded bg-black/40 p-3 text-xs leading-relaxed">
            {s.prompt}
          </pre>
        </details>

        <form action={formAction} className="space-y-3">
          <input type="hidden" name="candidate" value={candidate.path} />
          <input type="hidden" name="verdict" value={verdict ?? ''} />

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setVerdict('accepted')}
              className={`rounded border px-3 py-1.5 text-sm ${
                verdict === 'accepted'
                  ? 'border-[var(--color-good)] bg-[var(--color-good)]/20 text-white'
                  : 'border-[var(--color-edge)] text-[var(--color-muted)]'
              }`}
            >
              Accept
            </button>
            <button
              type="button"
              onClick={() => setVerdict('denied')}
              className={`rounded border px-3 py-1.5 text-sm ${
                verdict === 'denied'
                  ? 'border-[var(--color-bad)] bg-[var(--color-bad)]/20 text-white'
                  : 'border-[var(--color-edge)] text-[var(--color-muted)]'
              }`}
            >
              Deny
            </button>
          </div>

          {verdict && (
            <>
              <label className="block">
                <span className="text-xs text-[var(--color-muted)]">
                  {verdict === 'denied'
                    ? 'What is wrong? (required — this becomes the fix)'
                    : 'Why did this one work? (optional, but it is how the system learns)'}
                </span>
                <textarea
                  name="notes"
                  rows={3}
                  required={verdict === 'denied'}
                  className="mt-1 w-full rounded border border-[var(--color-edge)] bg-black/40 p-2 text-sm"
                  placeholder={
                    verdict === 'denied'
                      ? 'e.g. road reads modern, tyre tracks visible'
                      : 'e.g. the mask silhouette and crown height are exactly right'
                  }
                />
              </label>

              <label className="block">
                <span className="text-xs text-[var(--color-muted)]">Tags (comma separated)</span>
                <input
                  name="tags"
                  className="mt-1 w-full rounded border border-[var(--color-edge)] bg-black/40 p-2 text-sm"
                  placeholder="anachronism, lighting, silhouette"
                />
              </label>

              {verdict === 'denied' && (
                <label className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
                  <input type="checkbox" name="requeue" defaultChecked />
                  Regenerate with this note applied
                </label>
              )}

              {result?.error && (
                <p className="rounded border border-[var(--color-bad)] bg-[var(--color-bad)]/10 p-2 text-sm text-[var(--color-bad)]">
                  {result.error}
                </p>
              )}

              <Submit
                label={verdict === 'accepted' ? 'Accept' : 'Deny'}
                tone={verdict === 'accepted' ? 'good' : 'bad'}
              />
            </>
          )}
        </form>
      </div>
    </article>
  )
}
