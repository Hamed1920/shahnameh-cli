'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ImageOff, Library, Loader2, RotateCcw, Sparkles, Upload, X } from 'lucide-react'
import { studioApprove, studioClose, studioPick, studioPrice, studioUpload } from '@/app/[project]/studio/actions'
import { ModelParamFields, extraFor } from '@/components/generation-settings'
import { IndexPicker } from '@/components/index-picker'
import { ModelPicker } from '@/components/model-picker'
import { useAssetUrls, useProject } from '@/components/project-context'
import { RoleHelp } from '@/components/role-help'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { Modal } from '@/components/ui/modal'
import { EASE } from '@/components/ui/motion-tokens'
import { Badge } from '@/components/ui/text'
import { cn } from '@/lib/cn'
import { KINDS, KIND_LABEL, UPLOAD_ACCEPT, UPLOAD_ROLES, entitySlug, isAscii } from '@/lib/indexing'
import { aspectRatiosFor, modelLabel, refLimit } from '@/lib/models'
import { lookPath } from '@/lib/ref-suggest'
import { newSessionId, newTryId, type StudioSession, type StudioTry } from '@/lib/studio'
import type { CatalogEntity, StudioProposal } from '@/lib/types'

export interface StudioConfig {
  pinned: string[]
  aspectRatios: string[]
  defaultImageModel: string
}

/** What the studio makes a picture of: an entity in the index, or a new thing. */
export type StudioTarget = { entity: string } | { proposal: StudioProposal } | null

const POLL_MS = 1500
const PRICE_AFTER_MS = 1100

/**
 * The reference studio. Describe a picture, give it references, pick an image
 * model (Nano Banana Pro unless you choose another), and generate. Each
 * Generate is priced first; the button shows the price and pressing it is the
 * approval. Results come back into this dialog: use one as a reference for the
 * next try, reuse its prompt, or pick it. A pick is filed into the index as a
 * new look of the entity, or as the new entity (numbered only then).
 *
 * Everything is a request the worker acts on (worker/lib/studio.mjs), and the
 * dialog reads the session back from the files (lib/studio.ts), so closing it
 * loses nothing: the session stays open on the References page.
 */
export function ReferenceStudio({
  open, onClose, catalog, cfg, target: initialTarget = null, sessionId: resumeId, initialPrompt = '', initialRefs = [], onPicked,
}: {
  open: boolean
  onClose: () => void
  catalog: CatalogEntity[]
  cfg: StudioConfig
  target?: StudioTarget
  /** Reopen a session left open earlier. */
  sessionId?: string | null
  initialPrompt?: string
  initialRefs?: string[]
  /** Each result filed from this dialog, as the token it now has (`@CHR-014/V01`). */
  onPicked?: (token: string) => void
}) {
  const project = useProject()
  const router = useRouter()
  const { thumbUrl } = useAssetUrls()
  const [sessionId, setSessionId] = useState<string>(() => resumeId || newSessionId())
  const [session, setSession] = useState<StudioSession | null>(null)

  const [entity, setEntity] = useState(() => (initialTarget && 'entity' in initialTarget ? initialTarget.entity : ''))
  const [kind, setKind] = useState(() => (initialTarget && 'proposal' in initialTarget ? initialTarget.proposal.kind : 'CHR'))
  const [name, setName] = useState(() => (initialTarget && 'proposal' in initialTarget ? initialTarget.proposal.name : ''))
  const [description, setDescription] = useState(() => (initialTarget && 'proposal' in initialTarget ? initialTarget.proposal.description ?? '' : ''))
  const [prompt, setPrompt] = useState(initialPrompt)
  const [refs, setRefs] = useState<string[]>(initialRefs)
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [model, setModel] = useState(cfg.defaultImageModel)
  const [aspect, setAspect] = useState(() => (aspectRatiosFor(cfg.defaultImageModel, cfg.aspectRatios).includes('1:1') ? '1:1' : aspectRatiosFor(cfg.defaultImageModel, cfg.aspectRatios)[0] ?? '1:1'))
  const [extra, setExtra] = useState<Record<string, string>>({})
  const [count, setCount] = useState(2)
  const [genId, setGenId] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const [picker, setPicker] = useState<null | 'ref' | 'target'>(null)
  const [pickFor, setPickFor] = useState<{ hfJobId: string; take: string } | null>(null)
  /** Picks sent and not yet filed by the worker, so one result is never sent twice. */
  const [filing, setFiling] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState<null | 'approve' | 'pick' | 'close' | 'upload'>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const seenPicks = useRef(new Set<string>())

  // A resumed session takes its target from what the worker recorded.
  useEffect(() => { if (resumeId) setSessionId(resumeId) }, [resumeId])

  // Poll the session while the dialog is open.
  useEffect(() => {
    if (!open) return
    let stop = false
    const tick = async () => {
      try {
        const r = await fetch(`/${project.slug}/api/studio?session=${sessionId}`, { cache: 'no-store' })
        if (r.ok && !stop) setSession(await r.json())
      } catch { /* the next tick tries again */ }
      if (!stop) setTimeout(tick, POLL_MS)
    }
    tick()
    return () => { stop = true }
  }, [open, project.slug, sessionId])

  // A resumed session: fill the form from its latest try, once.
  const resumed = useRef(false)
  useEffect(() => {
    if (!resumeId || resumed.current || !session || session.tries.length === 0) return
    resumed.current = true
    const last = session.tries[session.tries.length - 1]
    if (session.entity) setEntity(session.entity)
    if (session.proposal) { setKind(session.proposal.kind); setName(session.proposal.name); setDescription(session.proposal.description ?? '') }
    setPrompt(last.prompt); setRefs(last.refs); setModel(last.model); setCount(last.count)
    if (last.params.aspect_ratio) setAspect(String(last.params.aspect_ratio))
  }, [resumeId, session])

  // Hand each new pick to the caller (a Prompts slot fills itself with it).
  // A pick for a new thing makes it an entity, so the session now targets that
  // entity: the next try is another look of it, not the same "new" name again,
  // which would read as already taken and block every further try.
  useEffect(() => {
    for (const p of session?.picks ?? []) {
      const key = `${p.hfJobId}/${p.take}`
      if (seenPicks.current.has(key)) continue
      seenPicks.current.add(key)
      if (p.entity) setEntity((cur) => cur || p.entity)
      onPicked?.(p.token)
      router.refresh()
    }
  }, [session?.picks, onPicked, router])

  const ent = entity ? catalog.find((e) => e.id === entity || e.shortId === entity) ?? null : null
  const maxRefs = refLimit(model)
  const targetProblem = ent ? null
    : !name.trim() ? 'Name the new thing, or choose an entity from the index.'
      : !isAscii(name) || !isAscii(description) ? 'The name and description go into the registry, so they must be English.'
        : catalog.some((e) => e.slug === entitySlug(name)) ? `${entitySlug(name)} is already in the index; choose it instead.` : null
  const inputProblem = !prompt.trim() ? 'Describe the picture.' : refs.length > maxRefs ? `${modelLabel(model)} takes at most ${maxRefs} reference picture${maxRefs === 1 ? '' : 's'}.` : targetProblem

  // Price whatever is on the form once it settles. Each edit is a new try; only the newest is priced.
  const signature = JSON.stringify([entity, kind, name, description, prompt, refs, model, aspect, extra, count, nonce])
  useEffect(() => {
    if (!open || inputProblem) { setGenId(null); return }
    const t = setTimeout(async () => {
      const id = newTryId()
      const fd = new FormData()
      fd.set('project', project.slug)
      fd.set('sessionId', sessionId)
      fd.set('genId', id)
      fd.set('model', model)
      fd.set('aspect_ratio', aspect)
      const e = extraFor(model, extra)
      if (Object.keys(e).length) fd.set('extra', JSON.stringify(e))
      fd.set('prompt', prompt)
      fd.set('refs', JSON.stringify(refs))
      fd.set('count', String(count))
      if (ent) fd.set('entity', ent.id)
      else { fd.set('kind', kind); fd.set('name', name); fd.set('description', description) }
      const r = await studioPrice(fd).catch((err: Error) => ({ ok: false, error: err.message }))
      if (!r.ok) { setError(r.error ?? 'Could not price that.'); setGenId(null); return }
      setError(null)
      setGenId(id)
    }, PRICE_AFTER_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, signature, inputProblem])

  const current = session?.tries.find((t) => t.genId === genId) ?? null
  const ran = (session?.tries ?? []).filter((t) => t.jobIds.length > 0).slice().reverse()
  const running = ran.some((t) => t.status === 'queued' || t.status === 'generating')
  const unpicked = ran.reduce((n, t) => n + t.results.filter((r) => !r.picked).length, 0)

  async function generate() {
    if (!current || current.status !== 'priced') return
    setBusy('approve')
    const r = await studioApprove(project.slug, sessionId, current.genId, current.total).catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(null)
    if (!r.ok) { setError(r.error ?? 'Could not start it.'); return }
    // The same form can run again: price it afresh as a new try.
    setNonce((n) => n + 1)
  }

  async function addFiles(list: FileList | File[] | null) {
    const files = [...(list ?? [])].filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type))
    if (files.length === 0) return
    setBusy('upload')
    const fd = new FormData()
    fd.set('project', project.slug)
    fd.set('sessionId', sessionId)
    for (const f of files.slice(0, 8)) fd.append('files', f, f.name)
    const r = await studioUpload(fd).catch((e: Error) => ({ ok: false, error: e.message, tokens: undefined }))
    setBusy(null)
    if (!r.ok || !r.tokens) { setError(r.error ?? 'Could not add those.'); return }
    const urls: Record<string, string> = {}
    r.tokens.forEach((t, i) => { urls[t] = URL.createObjectURL(files[i]) })
    setPreviews((p) => ({ ...p, ...urls }))
    setRefs((cur) => [...cur, ...r.tokens!.filter((t) => !cur.includes(t))])
  }

  async function finish() {
    if (unpicked === 0 && ran.length === 0) { onClose(); return }
    setBusy('close')
    const r = await studioClose(project.slug, sessionId).catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(null)
    if (!r.ok) { setError(r.error ?? 'Could not close.'); return }
    onClose()
  }

  const pathOf = (token: string): string | null => {
    if (token.startsWith('studio:')) return session?.inputs?.[token] ?? null
    if (token.startsWith('staged:')) {
      const [hf, take] = token.slice(7).split('/')
      for (const t of session?.tries ?? []) for (const x of t.results) if (x.hfJobId === hf && x.take === take) return x.path
      return null
    }
    return lookPath(token, catalog)
  }
  const srcOf = (token: string) => previews[token] ?? (pathOf(token) ? thumbUrl(pathOf(token)!, 320) : null)

  // The worker on this machine prices and generates every try. When it is not
  // running, say so, instead of "Pricing..." that never ends.
  const w = session?.worker
  const workerNote = !w || w.running ? null
    : w.paused ? 'The workers are stopped (Queue page → Start workers), so nothing is priced or generated.'
      : w.stopRequested ? 'This project\'s worker is stopped (queue/worker.stop), so nothing is priced or generated.'
        : w.autostartOff ? `No worker runs on this machine (${w.autostartOff}), so nothing is priced or generated.`
          : 'The worker is starting…'

  const priceLabel = !current
    ? inputProblem ?? 'Pricing...'
    : current.status === 'priced'
      ? current.total != null ? `Generate ${current.count} · ${current.total} cr` : 'Could not be priced'
      : current.status === 'error' ? current.reason ?? 'Cannot run'
        : current.status === 'pricing' ? 'Pricing...' : 'Generate'

  return (
    <Modal
      open={open}
      size="xl"
      title={<span className="inline-flex items-center gap-2"><Sparkles aria-hidden className="size-4 text-accent" /> Create a reference</span>}
      onClose={onClose}
      onKeyGuard={() => picker === null && pickFor === null}
      footer={
        <>
          <span className="mr-auto text-xs text-faint">
            {session?.picks.length ? `${session.picks.length} filed. ` : ''}
            {unpicked ? `${unpicked} result${unpicked === 1 ? '' : 's'} not picked go to _rejected when you finish.` : 'Nothing is spent until you press Generate.'}
          </span>
          <Button type="button" tone="ghost" onClick={onClose}>Keep open for later</Button>
          <Button type="button" tone="outline" pending={busy === 'close'} pendingLabel="Closing" disabled={running} onClick={finish} title={running ? 'Wait for the tries that are still generating' : undefined}>
            Finish
          </Button>
        </>
      }
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        {/* ------------------------------------------------ the try */}
        <div className="space-y-4">
          <div className="space-y-2">
            <span className="block text-[12.5px] text-muted">A picture of</span>
            {ent ? (
              <div className="flex items-center gap-2 rounded-md border border-edge bg-sunken px-3 py-2">
                <span className="font-mono text-[12px] text-fg">{ent.shortId}</span>
                <span className="text-[13px] text-muted">{ent.name}</span>
                <span className="text-[11.5px] text-faint">· a new look</span>
                <Button type="button" size="sm" tone="ghost" className="ml-auto" onClick={() => setEntity('')}>A new thing</Button>
              </div>
            ) : (
              <div className="space-y-2.5 rounded-md border border-dashed border-edge-strong p-3">
                <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2">
                  <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
                    {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                  </Select>
                  <Input dir="ltr" value={name} onChange={(e) => setName(e.target.value)} placeholder="Kaveh the Blacksmith" aria-label="Name (English)" />
                </div>
                <Input dir="ltr" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What it is, in a sentence (optional, English)" aria-label="Description" />
                <div className="flex items-center gap-2 text-[11.5px] text-faint">
                  <span>New: numbered only when you pick a result.</span>
                  <Button type="button" size="sm" tone="ghost" className="ml-auto" onClick={() => setPicker('target')}>
                    <Library aria-hidden className="size-3.5" /> It is in the index
                  </Button>
                </div>
              </div>
            )}
          </div>

          <Field label="Describe the picture">
            <Textarea dir="auto" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={6} placeholder="Full-body character sheet, front and side, neutral grey backdrop..." className="text-[13px]" />
          </Field>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[12.5px] text-muted">References</span>
              <span className={cn('font-mono text-[11px]', refs.length > maxRefs ? 'text-bad' : 'text-faint')}>{refs.length} / {maxRefs}</span>
              <div className="ml-auto flex gap-1.5">
                <Button type="button" size="sm" tone="outline" onClick={() => setPicker('ref')}><Library aria-hidden className="size-3.5" /> Index</Button>
                <Button type="button" size="sm" tone="outline" pending={busy === 'upload'} pendingLabel="Adding" onClick={() => fileInput.current?.click()}><Upload aria-hidden className="size-3.5" /> Upload</Button>
                <input ref={fileInput} type="file" accept={UPLOAD_ACCEPT} multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
              </div>
            </div>
            <div
              onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }}
              onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
              className="flex min-h-20 flex-wrap gap-2 rounded-md border border-dashed border-edge-strong p-2"
            >
              {refs.length === 0 && <span className="m-auto text-[11.5px] text-faint">Drop pictures here, or add from the index</span>}
              {refs.map((t, n) => (
                <div key={t} className="group relative size-20 overflow-hidden rounded-md border border-edge bg-sunken">
                  {srcOf(t)
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={srcOf(t)!} alt={t} className="size-full object-cover" />
                    : <div className="grid size-full place-items-center"><ImageOff aria-hidden className="size-4 text-faint" /></div>}
                  <span className="absolute top-1 left-1 rounded-[3px] bg-ink/85 px-1 font-mono text-[10px] text-fg">{n + 1}</span>
                  <button type="button" aria-label={`Remove ${t}`} onClick={() => setRefs(refs.filter((x) => x !== t))} className="focus-ring absolute top-1 right-1 grid size-5 cursor-pointer place-items-center rounded-[3px] bg-ink/85 text-muted opacity-0 group-hover:opacity-100 hover:text-fg focus-visible:opacity-100">
                    <X aria-hidden className="size-3" />
                  </button>
                  <span className="absolute inset-x-0 bottom-0 truncate bg-ink/80 px-1 font-mono text-[9.5px] text-muted">
                    {t.startsWith('@') ? t.slice(1) : t.startsWith('staged:') ? 'earlier try' : 'your file'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Model">
              <ModelPicker value={model} kind="image" pinned={cfg.pinned} onChange={(m) => {
                const a = aspectRatiosFor(m, cfg.aspectRatios)
                setModel(m)
                if (!a.includes(aspect)) setAspect(a[0] ?? aspect)
                setExtra((x) => extraFor(m, x))
              }} />
            </Field>
            <Field label="Aspect ratio">
              <Select value={aspect} onChange={(e) => setAspect(e.target.value)}>
                {aspectRatiosFor(model, cfg.aspectRatios).map((a) => <option key={a} value={a}>{a}</option>)}
              </Select>
            </Field>
          </div>
          <ModelParamFields model={model} value={extra} onChange={setExtra} />
          <Field label="Results per try">
            <Select value={String(count)} onChange={(e) => setCount(Number(e.target.value))}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={String(n)}>{n}</option>)}
            </Select>
          </Field>

          <div className="space-y-2">
            <Button
              type="button"
              tone="accent"
              className="w-full"
              disabled={!current || current.status !== 'priced' || current.total == null}
              pending={busy === 'approve'}
              pendingLabel="Starting"
              onClick={generate}
            >
              <Sparkles aria-hidden className="size-4" /> {priceLabel}
            </Button>
            {error && <p className="text-xs text-bad">{error}</p>}
            {workerNote && <p className="text-xs text-bad">{workerNote}</p>}
            {current && current.status !== 'error' && current.reason && (
              // Why pricing is waiting (the CLI not signed in) or came back unknown.
              <p className="text-xs text-bad" dir="auto">{current.reason}</p>
            )}
            {session?.refused && <p className="text-xs text-bad">The worker refused: {session.refused}</p>}
          </div>
        </div>

        {/* ------------------------------------------------ results */}
        <div className="min-w-0 space-y-6">
          {ran.length === 0 && (
            <div className="grid min-h-64 place-items-center rounded-lg border border-dashed border-edge-strong text-center">
              <p className="max-w-sm px-6 text-sm leading-relaxed text-faint">
                Results appear here. Use one as a reference for the next try, reuse its prompt, or pick it to file it into the index.
              </p>
            </div>
          )}
          <AnimatePresence initial={false}>
            {ran.map((t) => (
              <motion.section
                key={t.genId}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: EASE }}
                className="space-y-2.5"
              >
                <TryHeader t={t} onReuse={() => { setPrompt(t.prompt); setRefs(t.refs); setModel(t.model); setCount(t.count) }} />
                <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
                  {t.results.map((x) => (
                    <div key={`${x.hfJobId}/${x.take}`} className={cn('overflow-hidden rounded-lg border bg-sunken', x.picked ? 'border-good/60' : 'border-edge-strong')}>
                      <div className="checker aspect-square">
                        {x.path
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={thumbUrl(x.path, 640)} alt="" className="size-full object-contain" />
                          : <div className="grid size-full place-items-center text-xs text-faint">filed</div>}
                      </div>
                      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5">
                        {!x.picked && filing.has(`${x.hfJobId}/${x.take}`) ? (
                          <span className="flex items-center gap-1.5 text-xs text-faint"><Loader2 aria-hidden className="size-3 animate-spin" /> Filing</span>
                        ) : x.picked ? (
                          <Badge tone="good"><Check aria-hidden className="size-3" /> {x.picked.replace(/^@/, '')}</Badge>
                        ) : (
                          <>
                            <Button type="button" size="sm" tone="ghost" onClick={() => {
                              const tok = `staged:${x.hfJobId}/${x.take}`
                              if (!refs.includes(tok)) setRefs([...refs, tok])
                            }}>Use as reference</Button>
                            <Button type="button" size="sm" tone="outline" className="ml-auto" onClick={() => setPickFor({ hfJobId: x.hfJobId, take: x.take })}>Pick</Button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  {(t.status === 'queued' || t.status === 'generating') && Array.from({ length: Math.max(0, t.count - t.results.length) }, (_, i) => (
                    <div key={`wait-${i}`} className="checker grid aspect-square place-items-center rounded-lg border border-dashed border-edge-strong">
                      <span className="flex items-center gap-2 text-xs text-faint">
                        <Loader2 aria-hidden className="size-3.5 animate-spin" /> {t.status === 'generating' ? 'Generating' : t.held ? 'Held' : 'Queued'}
                      </span>
                    </div>
                  ))}
                </div>
                {t.held && <p className="text-xs text-faint">Held: {t.held}</p>}
              </motion.section>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <IndexPicker
        open={picker !== null}
        mode={picker === 'target' ? 'entity' : 'ref'}
        title={picker === 'target' ? 'Which entity is this a new look of?' : 'Add a reference'}
        catalog={catalog}
        initialKind={picker === 'target' ? kind : null}
        onClose={() => setPicker(null)}
        onPickEntity={(e) => { setEntity(e.id); setPicker(null) }}
        onPickRef={(token) => { if (!refs.includes(token)) setRefs([...refs, token]); setPicker(null) }}
      />

      {pickFor && session && (
        <PickForm
          key={`${pickFor.hfJobId}/${pickFor.take}`}
          sessionId={sessionId}
          result={pickFor}
          entity={ent}
          proposal={ent ? null : { kind, name, description }}
          prompt={prompt}
          onClose={() => setPickFor(null)}
          onSent={() => setFiling((s) => new Set(s).add(`${pickFor.hfJobId}/${pickFor.take}`))}
          onError={setError}
        />
      )}
    </Modal>
  )
}

function TryHeader({ t, onReuse }: { t: StudioTry; onReuse: () => void }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-[12.5px] text-fg">{modelLabel(t.model)}</span>
      <span className="font-mono text-[11px] text-faint">{t.total != null ? `${t.total} cr` : ''}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted" dir="auto" title={t.prompt}>{t.prompt}</span>
      <button type="button" onClick={onReuse} className="focus-ring inline-flex cursor-pointer items-center gap-1 text-[11.5px] text-faint hover:text-fg">
        <RotateCcw aria-hidden className="size-3" /> Reuse this prompt
      </button>
      {t.status === 'failed' && <Badge tone="bad">failed</Badge>}
      {t.status === 'failed' && t.reason && <span className="w-full text-xs text-bad" dir="auto">{t.reason}</span>}
    </div>
  )
}

/** How a picked result is filed: a new look of the entity, or the new entity, with a role and a short description. */
function PickForm({
  sessionId, result, entity, proposal, prompt, onClose, onSent, onError,
}: {
  sessionId: string
  result: { hfJobId: string; take: string }
  entity: CatalogEntity | null
  proposal: StudioProposal | null
  prompt: string
  onClose: () => void
  onSent: () => void
  onError: (e: string | null) => void
}) {
  const project = useProject()
  const [role, setRole] = useState(entity && entity.variants.length ? 'PLATE' : 'HERO')
  const [descriptor, setDescriptor] = useState(() =>
    prompt.replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).slice(0, 5).join(' ').toLowerCase() || 'reference')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const nextLook = useMemo(() => entity
    ? `V${String(entity.variants.reduce((m, v) => Math.max(m, parseInt(v.variant.slice(1), 10) || 0), 0) + 1).padStart(2, '0')}`
    : 'V01', [entity])

  async function save() {
    setBusy(true)
    const fd = new FormData()
    fd.set('project', project.slug)
    fd.set('sessionId', sessionId)
    fd.set('hfJobId', result.hfJobId)
    fd.set('take', result.take)
    fd.set('role', role)
    fd.set('descriptor', descriptor)
    if (entity) fd.set('entity', entity.id)
    else if (proposal) { fd.set('kind', proposal.kind); fd.set('name', proposal.name); fd.set('description', proposal.description ?? '') }
    const r = await studioPick(fd).catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'Could not file it.'); return }
    onError(null)
    onSent()
    onClose()
  }

  return (
    <Modal
      open
      title="File this result"
      onClose={onClose}
      footer={
        <>
          <Button type="button" tone="ghost" onClick={onClose}>Back</Button>
          <Button type="button" tone="accent" pending={busy} pendingLabel="Filing" onClick={save}>File it</Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          {entity
            ? <>Becomes <span className="font-mono text-fg">{entity.shortId}/{nextLook}</span>, a new look of {entity.name}. A second pick from the same try becomes another take of that look.</>
            : <>Becomes a new {proposal?.kind} <span className="text-fg">{proposal?.name}</span>. The worker gives it its number now.</>}
        </p>
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <Field label={<span className="inline-flex items-center gap-1.5">Role <RoleHelp /></span>}>
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              {UPLOAD_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
          <Field label="Short description (English, used in the filename)">
            <Input dir="ltr" value={descriptor} onChange={(e) => setDescriptor(e.target.value)} />
          </Field>
        </div>
        {err && <p className="text-xs text-bad">{err}</p>}
      </div>
    </Modal>
  )
}
