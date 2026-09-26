'use client'

import { useState } from 'react'
import { Coins, RotateCcw } from 'lucide-react'
import { requestRegenerate } from '@/app/[project]/decided/actions'
import { useProject } from '@/components/project-context'
import { GenerationSettings, setExtra, settingsFrom, type GenerationConfig, type GenerationSettingsValue } from '@/components/generation-settings'
import { MentionTextarea } from '@/components/mention-textarea'
import { ReferenceEditor, useMentionOptions, sameRefFor, useReferenceEdits } from '@/components/reference-editor'
import { Button } from '@/components/ui/button'
import { Disclosure } from '@/components/ui/disclosure'
import { Field } from '@/components/ui/field'
import { Modal } from '@/components/ui/modal'
import { Badge } from '@/components/ui/text'
import { isVideoModel } from '@/lib/batch-rules'
import { plainReason } from '@/lib/plain'
import type { CatalogEntity, RegenerateSource, RegenerationView } from '@/lib/types'

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export type RegenerateConfig = GenerationConfig

/** Settings as the source job carries them; the references live in the editor, not here. */
const startSettings = (source: RegenerateSource | null, cfg: RegenerateConfig) =>
  settingsFrom(source && { ...source, refs: source.refs.map((r) => r.token) }, cfg)

/**
 * Run an accepted take's job again, with anything changed. Laid out like the
 * Review panel: the references as numbered thumbnails (replace, remove,
 * add from the index, upload), prompt and note with @ pointing at them, and
 * the full prompt the take was sent with. One click is the approval; the
 * price is on the button while the settings that decide it are unchanged.
 */
export function RegenerateButton({
  jobId, decisionId, credits, source, catalog, cfg, regenerations, prices,
}: {
  jobId: string
  decisionId: string
  credits: number | null
  source: RegenerateSource | null
  catalog: CatalogEntity[]
  cfg: RegenerateConfig
  regenerations: RegenerationView[]
  /** Last real price per priceKey, so the quality toggle can price both sides. */
  prices?: Record<string, number>
}) {
  const project = useProject()
  const [open, setOpen] = useState(false)
  const [overlay, setOverlay] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [prompt, setPrompt] = useState(source?.prompt ?? '')
  const [settings, setSettings] = useState<GenerationSettingsValue>(() => startSettings(source, cfg))
  const [note, setNote] = useState('')
  const edits = useReferenceEdits(source?.refs ?? [])
  const { model, stage, duration, sound } = settings

  const mentionOptions = useMentionOptions(edits, catalog)
  const sameRef = sameRefFor(catalog)

  const video = isVideoModel(model)
  const wasSilent = String(source?.params.generate_audio) === 'false'
  const priceStillValid = source
    && model === source.model
    && (!video || (stage === (source.stage ?? 'draft') && String(duration) === String(source.params.duration ?? '') && sound === !wasSilent))

  function reset() {
    setPrompt(source?.prompt ?? '')
    setSettings(startSettings(source, cfg))
    setNote('')
    setError(null)
    edits.reset()
  }

  async function send() {
    setBusy(true)
    setError(null)
    const fd = new FormData()
    fd.set('project', project.slug)
    fd.set('jobId', jobId)
    fd.set('decisionId', decisionId)
    fd.set('prompt', prompt)
    edits.serialize(fd, true)
    // The whole list, always: the worker replaces the job's references with it.
    fd.set('refs', JSON.stringify(edits.refs))
    fd.set('model', model)
    fd.set('variant', settings.variant)
    fd.set('aspect_ratio', settings.aspect)
    if (video) {
      fd.set('stage', stage)
      fd.set('duration', duration)
      if (sound) fd.set('sound', 'on')
    }
    setExtra(fd, model, settings.extra)
    fd.set('note', note)
    const r = await requestRegenerate(fd).catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(false)
    if (!r.ok) { setError(r.error ?? 'Could not send that.'); return }
    setOpen(false)
    reset()
  }

  return (
    <div className="space-y-2.5">
      {regenerations.length > 0 && (
        <ul className="space-y-1 text-xs text-muted">
          {regenerations.map((r) => (
            <li key={r.reqId} className="flex flex-wrap items-center gap-2">
              <RotateCcw aria-hidden className="size-3 text-faint" />
              <span suppressHydrationWarning>Regenerated {when(r.ts)}</span>
              {r.state === 'queued' && <Badge tone="good">queued{r.jobId ? ` · ${r.jobId}` : ''}</Badge>}
              {r.state === 'waiting' && <Badge tone="accent">waiting for the worker</Badge>}
              {r.state === 'rejected' && <Badge tone="bad">not queued: {plainReason(r.reason)}</Badge>}
              {r.note && <span className="text-faint" dir="auto">“{r.note}”</span>}
            </li>
          ))}
        </ul>
      )}
      <Button type="button" size="sm" tone="outline" disabled={!source} onClick={() => { reset(); setOpen(true) }} title={source ? undefined : 'The queue record for this job is missing'}>
        <RotateCcw aria-hidden className="size-3.5" /> Regenerate
      </Button>
      {!source && <span className="text-xs text-faint">Can’t regenerate from here: this job’s queue record is missing.</span>}

      <Modal
        open={open}
        size="xl"
        title="Regenerate this take"
        onClose={() => setOpen(false)}
        onKeyGuard={() => !overlay}
        clip={false}
        footer={
          <>
            {edits.stale.length > 0 || !prompt.trim() ? (
              // Regenerate is off: say why, where the price would be.
              <span className="mr-auto self-center text-xs text-bad">
                {edits.stale.length > 0 ? 'Fix the references that no longer resolve first.' : 'Write a prompt first.'}
              </span>
            ) : (
              <span className="mr-auto flex items-center gap-1.5 self-center text-xs text-faint">
                <Coins aria-hidden className="size-3.5" />
                {priceStillValid && credits != null ? `≈ ${credits} credits` : 'priced by the worker before it runs'}
              </span>
            )}
            <Button type="button" tone="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              type="button"
              tone="accent"
              pending={busy}
              pendingLabel="Sending"
              disabled={!prompt.trim() || edits.stale.length > 0}
              title={edits.stale.length > 0 ? 'Fix the references that no longer resolve first' : undefined}
              onClick={send}
            >
              <RotateCcw aria-hidden className="size-3.5" /> Regenerate
            </Button>
          </>
        }
      >
        {source && (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="min-w-0 space-y-6">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                {source.stage && (
                  <Badge tone={source.stage === 'draft' ? 'accent' : 'good'}>{source.stage === 'draft' ? 'draft' : 'final'}</Badge>
                )}
                {source.attempt > 1 && <Badge>attempt {source.attempt}</Badge>}
                {isVideoModel(source.model) && wasSilent && <Badge tone="muted">silent</Badge>}
                <span className="ml-1 font-mono text-muted">{source.model}</span>
                <span className="text-faint">·</span>
                <span className="font-mono text-faint">{source.jobId}</span>
              </div>

              <ReferenceEditor
                edits={edits}
                catalog={catalog}
                refsEditable
                lockedReason=""
                onOverlayChange={setOverlay}
              />

              <Field label="Prompt (sent as written; type @ to point at a reference)">
                <MentionTextarea
                  dir="auto"
                  rows={12}
                  value={prompt}
                  onChange={setPrompt}
                  options={mentionOptions}
                  sameRef={sameRef}
                  className="min-h-56 max-h-[50vh] text-start text-[13px]"
                />
              </Field>

              {source.revisionNotes.length > 0 && (
                <div className="space-y-1.5 text-xs text-muted">
                  <span className="block text-[12.5px]">Notes from earlier attempts, still applied</span>
                  <ul className="space-y-1 border-l border-edge pl-3">
                    {source.revisionNotes.map((n, i) => <li key={i} dir="auto">{n}</li>)}
                  </ul>
                </div>
              )}

              <Field label="Anything else to change? (optional, Farsi or English)">
                <MentionTextarea
                  dir="auto"
                  rows={3}
                  value={note}
                  onChange={setNote}
                  options={mentionOptions}
                  sameRef={sameRef}
                  className="min-h-20 text-start text-[13px]"
                  placeholder="Added to the prompt as a revision note. Type @ to point at a reference."
                />
              </Field>

              <Disclosure summary="Full prompt this take was sent with">
                <pre className="scroll-pane max-h-80 rounded-xl border border-edge bg-sunken p-5 font-mono text-xs leading-[1.7] whitespace-pre-wrap text-fg/80">
                  {source.sentPrompt}
                </pre>
              </Disclosure>
            </div>

            <div className="space-y-4">
              <GenerationSettings
                value={settings}
                onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
                catalog={catalog}
                cfg={cfg}
                picker={false}
                onPicker={() => {}}
                prices={prices}
                showRefs={false}
              />
              {error && <p className="rounded-md border border-bad/35 bg-bad/8 px-3 py-2 text-xs leading-relaxed text-bad" dir="auto">{error}</p>}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
