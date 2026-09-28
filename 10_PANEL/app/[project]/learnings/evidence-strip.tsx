'use client'

import { useState } from 'react'
import { ImageOff, Maximize2 } from 'lucide-react'
import { Lightbox } from '@/components/lightbox'
import { useAssetUrls } from '@/components/project-context'
import { RuleText } from '@/components/rule-text'
import { TakeMedia } from '@/components/take-media'
import { Badge } from '@/components/ui/text'
import { isVideo } from '@/lib/asset'
import { cn } from '@/lib/cn'
import type { EvidenceView, Verdict } from '@/lib/types'

const VERDICT: Record<Verdict, { text: string; tone: 'good' | 'bad' | 'muted' }> = {
  accepted: { text: 'accepted', tone: 'good' },
  denied: { text: 'denied', tone: 'bad' },
  discarded: { text: 'discarded', tone: 'muted' },
}

function useEvidenceLightbox(evidence: EvidenceView[]) {
  const { assetUrl } = useAssetUrls()
  const [open, setOpen] = useState<number | null>(null)
  const shown = evidence.filter((e) => e.file)
  const lightbox = (
    <Lightbox
      items={shown.map((e) => ({
        src: assetUrl(e.file!),
        title: e.title,
        subtitle: [e.where, e.verdict].filter(Boolean).join(' · '),
        video: isVideo(e.file!),
      }))}
      index={open}
      onIndex={setOpen}
      onClose={() => setOpen(null)}
    />
  )
  return { openAt: (e: EvidenceView) => setOpen(shown.indexOf(e)), lightbox }
}

/**
 * The takes a rule was learned from, each with what was said about it -- the
 * thing to look at before approving the rule. Scrolls sideways when there are many.
 */
export function EvidenceStrip({ evidence }: { evidence: EvidenceView[] }) {
  const { openAt, lightbox } = useEvidenceLightbox(evidence)
  return (
    <>
      <div className="scroll-pane-x -mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-2">
        {evidence.map((e) => (
          <article
            key={e.id}
            className="w-[min(340px,82vw)] shrink-0 snap-start overflow-hidden rounded-xl border border-edge bg-sunken"
          >
            <div className="relative">
              {e.file ? (
                <>
                  <TakeMedia file={e.file} alt={e.title} className="rounded-none border-0" />
                  <button
                    type="button"
                    onClick={() => openAt(e)}
                    aria-label={`Open ${e.title} large`}
                    className="focus-ring absolute top-2 right-2 grid size-8 cursor-pointer place-items-center rounded-md border border-white/15 bg-black/60 text-white/80 backdrop-blur transition-colors duration-150 hover:text-white"
                  >
                    <Maximize2 aria-hidden className="size-3.5" />
                  </button>
                </>
              ) : (
                <div className="grid aspect-video w-full place-items-center border-b border-dashed border-edge-strong px-6 text-center">
                  <span className="flex flex-col items-center gap-2 text-xs text-faint">
                    <ImageOff aria-hidden className="size-5" />
                    {e.missing ?? 'Not on disk.'}
                  </span>
                </div>
              )}
            </div>
            <div className="space-y-2.5 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-lg leading-none text-fg">{e.title}</span>
                {e.verdict && <Badge tone={VERDICT[e.verdict].tone}>{VERDICT[e.verdict].text}</Badge>}
              </div>
              {e.where && e.where !== e.title && <p className="font-mono text-[11px] text-faint">{e.where}</p>}
              {e.notes.length > 0 && <RuleText segments={e.notes} className="text-[13px] leading-relaxed text-fg/85" />}
              {e.notesEn && (
                <p className="border-l border-edge pl-3 text-[12px] leading-relaxed text-muted" dir="ltr">{e.notesEn}</p>
              )}
            </div>
          </article>
        ))}
      </div>
      {lightbox}
    </>
  )
}

/** The same takes, small: for a rule already in force, where the case is made. */
export function EvidenceThumbs({ evidence }: { evidence: EvidenceView[] }) {
  const { thumbUrl } = useAssetUrls()
  const { openAt, lightbox } = useEvidenceLightbox(evidence)
  return (
    <>
      <ul className="flex flex-wrap gap-2">
        {evidence.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              disabled={!e.file}
              onClick={() => openAt(e)}
              title={[e.title, e.where, e.verdict].filter(Boolean).join(' · ')}
              className={cn(
                'focus-ring relative block w-28 overflow-hidden rounded-md border transition-colors duration-150',
                e.file ? 'cursor-zoom-in border-edge hover:border-edge-strong' : 'cursor-default border-dashed border-edge-strong',
              )}
            >
              {e.file && !isVideo(e.file) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbUrl(e.file, 240)} alt={e.title} loading="lazy" className="checker aspect-video w-full object-cover" />
              ) : e.file ? (
                <TakeMedia file={e.file} alt={e.title} controls={false} className="rounded-none border-0" />
              ) : (
                <span className="grid aspect-video w-full place-items-center"><ImageOff aria-hidden className="size-4 text-faint" /></span>
              )}
              {e.verdict && (
                <span
                  aria-hidden
                  className={cn(
                    'absolute bottom-1 left-1 size-2 rounded-full ring-2 ring-black/60',
                    e.verdict === 'accepted' ? 'bg-good' : e.verdict === 'denied' ? 'bg-bad' : 'bg-faint',
                  )}
                />
              )}
            </button>
          </li>
        ))}
      </ul>
      {lightbox}
    </>
  )
}
