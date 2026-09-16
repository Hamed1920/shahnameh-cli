'use client'

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { useRouter } from 'next/navigation'
import { Copy, FileText, ImageOff, Plus, Trash2, Upload, X } from 'lucide-react'
import { extractDocuments, submitBatch } from './actions'
import { IndexPicker } from '@/components/index-picker'
import { RowLabel, TargetCell } from '@/components/target-cell'
import { EASE } from '@/components/ui/motion-tokens'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Disclosure } from '@/components/ui/disclosure'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { Modal } from '@/components/ui/modal'
import { Badge, SectionHeading } from '@/components/ui/text'
import { SHOT_RX, checkRow, initialTarget, isVideoModel, rowModel, type DraftRow, type RowConfig } from '@/lib/batch-rules'
import { lookPath, suggestRefs, targetCandidates, type RefSuggestion } from '@/lib/ref-suggest'
import { thumbUrl } from '@/lib/asset'
import { previewScenes } from '@/lib/scenes'
import { cn } from '@/lib/cn'
import { DOCUMENT_ACCEPT, MAX_DOCUMENTS, TEXT_EXT } from '@/lib/document-types'
import { parsePromptDocument, type ParseResult, type SplitMode, type SplitOption } from '@/lib/prompt-parser'
import type { BatchDefaults, CatalogEntity } from '@/lib/types'

export interface IntakeConfig extends RowConfig {
  aspectRatios: string[]
  videoDurations: number[]
  /** What a draft and a final render at; shown on the quality toggle. */
  videoDraftResolution: string
  videoFinalResolution: string
  defaults: BatchDefaults
}

interface Doc {
  id: string
  name: string
  format: ParseResult['format']
  /** The text as parsed, kept so the document can be split again another way. */
  source: string
  split: SplitMode | null
  splitOptions: SplitOption[]
  /** The rows this document produced, so a re-split replaces only them. */
  rowKeys: string[]
  preamble: string | null
  /** Shown under "show text" for extracted docx / pdf, whose text order is worth checking. */
  text: string
  warnings: string[]
}

const SPLIT_LABEL: Record<SplitMode, string> = {
  none: 'One prompt',
  block: 'P01 / PROMPT headings',
  shot: 'SHOT headings',
  numbered: 'Numbered items',
  blank: 'Blank lines',
}

/** The same cuts as they read inside a sentence: "It also has 5 SHOT headings". */
const SPLIT_FOUND: Record<SplitMode, string> = {
  none: 'prompt',
  block: 'P01 / PROMPT headings',
  shot: 'SHOT headings',
  numbered: 'numbered items',
  blank: 'blank-line sections',
}

let seq = 0

/**
 * Paste or drop prompts, fix what each one is for, and hand the batch to the
 * worker. Everything on this page is checked as it is typed; nothing is
 * submitted while a row has a problem, and nothing is generated until the
 * priced batch is approved below.
 */
export function PromptIntake({ catalog, cfg, knownShots, recentRefs }: {
  catalog: CatalogEntity[]
  cfg: IntakeConfig
  knownShots: string[]
  /** Reference tokens of the latest queued jobs, newest first. */
  recentRefs: string[]
}) {
  const router = useRouter()
  const listId = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [docs, setDocs] = useState<Doc[]>([])
  const [rows, setRows] = useState<DraftRow[]>([])
  const [defaults, setDefaults] = useState<BatchDefaults>(cfg.defaults)
  const [name, setName] = useState('')
  const [prepend, setPrepend] = useState(false)
  const [picker, setPicker] = useState<{ key: string; mode: 'entity' | 'ref' } | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState<null | 'extract' | 'submit'>(null)
  const [error, setError] = useState<string | null>(null)
  const [serverErrors, setServerErrors] = useState<Record<string, string[]>>({})
  const [dragging, setDragging] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const preamble = docs.map((d) => d.preamble).filter(Boolean).join('\n\n')

  const problems = useMemo(() => {
    const out = new Map<string, string[]>()
    for (const r of rows) {
      const p = [...checkRow(r, catalog, rows, defaults, cfg), ...(serverErrors[r.key] ?? [])]
      if (p.length) out.set(r.key, [...new Set(p)])
    }
    return out
  }, [rows, catalog, defaults, cfg, serverErrors])

  const toDraftRows = useCallback((result: ParseResult, file: string | null): DraftRow[] => result.rows.map((r) => {
    const t = initialTarget(r, { file, catalog, defaultModel: defaults.model, knownShots })
    return {
      key: `r${++seq}`,
      label: r.label ?? '',
      ...t,
      newDescription: '',
      variant: r.variant ?? '',
      model: r.model ?? '',
      stage: r.stage ?? '',
      refs: r.refs,
      prompt: r.prompt,
      params: r.params,
      warnings: r.warnings,
    }
  }), [catalog, defaults.model, knownShots])

  const addDocument = useCallback((source: string, file: string | null, opts: { showText?: boolean } = {}) => {
    const result = parsePromptDocument(source, { file })
    const fresh = toDraftRows(result, file)
    setRows((all) => [...all, ...fresh])
    setDocs((all) => [...all, {
      id: `d${++seq}`, name: file ?? 'pasted text', format: result.format, source,
      split: result.split, splitOptions: result.splitOptions, rowKeys: fresh.map((r) => r.key),
      preamble: result.preamble, text: opts.showText ? source : '', warnings: result.warnings,
    }])
    setDone(null)
  }, [toDraftRows])

  /** Cut one document another way. Its rows are rebuilt in place, so edits made to them are replaced. */
  const resplit = (doc: Doc, split: SplitMode) => {
    const file = doc.name === 'pasted text' ? null : doc.name
    const result = parsePromptDocument(doc.source, { file, split })
    const fresh = toDraftRows(result, file)
    const old = new Set(doc.rowKeys)
    setRows((all) => {
      const at = all.findIndex((r) => old.has(r.key))
      const rest = all.filter((r) => !old.has(r.key))
      const pos = at === -1 ? rest.length : all.slice(0, at).filter((r) => !old.has(r.key)).length
      return [...rest.slice(0, pos), ...fresh, ...rest.slice(pos)]
    })
    setDocs((all) => all.map((d) => (d.id === doc.id
      ? { ...d, split: result.split, rowKeys: fresh.map((r) => r.key), preamble: result.preamble, warnings: result.warnings }
      : d)))
    setServerErrors((e) => {
      if (!doc.rowKeys.some((k) => e[k])) return e
      const n = { ...e }
      for (const k of doc.rowKeys) delete n[k]
      return n
    })
  }

  const parsePasted = () => {
    if (!text.trim()) return
    addDocument(text, null)
    setText('')
  }

  const takeFiles = async (list: FileList | null) => {
    const files = [...(list ?? [])]
    if (files.length === 0) return
    if (files.length > MAX_DOCUMENTS) { setError(`At most ${MAX_DOCUMENTS} files at once.`); return }
    setError(null)
    const toServer: File[] = []
    for (const f of files) {
      const ext = f.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? ''
      if ((TEXT_EXT as readonly string[]).includes(ext)) addDocument(await f.text(), f.name)
      else toServer.push(f)
    }
    if (toServer.length === 0) return
    setBusy('extract')
    const fd = new FormData()
    for (const f of toServer) fd.append('files', f, f.name)
    const r = await extractDocuments(fd).catch((e: Error) => ({ ok: false, error: e.message, files: undefined }))
    setBusy(null)
    if (!r.ok || !r.files) { setError(r.error ?? 'Could not read those files.'); return }
    for (const f of r.files) addDocument(f.text, f.name, { showText: true })
  }

  const update = (key: string, patch: Partial<DraftRow>) => {
    setRows((all) => all.map((r) => {
      if (r.key !== key) return r
      const next = { ...r, ...patch }
      // A shot id is not an entity and an entity id is not a shot: switching mode drops a target that does not fit.
      if (patch.targetMode && patch.target === undefined && SHOT_RX.test(next.target.trim()) !== (next.targetMode === 'shot')) next.target = ''
      // A design image with nowhere to go yet takes the entity its references point at,
      // once exactly one fits. Two or more: the row shows them and Hamed picks.
      if ((patch.refs || patch.targetMode) && next.targetMode === 'entity' && !next.target.trim()) {
        const fits = targetCandidates(next.prompt, next.refs, catalog)
        if (fits.length === 1) next.target = fits[0].id
      }
      return next
    }))
    setServerErrors((e) => { if (!e[key]) return e; const n = { ...e }; delete n[key]; return n })
  }
  const remove = (key: string) => setRows((all) => all.filter((r) => r.key !== key))
  const duplicate = (key: string) =>
    setRows((all) => all.flatMap((r) => (r.key === key ? [r, { ...r, key: `r${++seq}`, label: r.label ? `${r.label} copy` : '' }] : [r])))
  const addRow = () =>
    setRows((all) => [...all, {
      key: `r${++seq}`, label: '',
      ...initialTarget({ target: null, label: null, prompt: '', refs: [], model: null }, { file: null, catalog, defaultModel: defaults.model, knownShots }),
      newDescription: '', variant: '', model: '', stage: '', refs: [], prompt: '', params: {}, warnings: [],
    }])

  const scenePreviews = useMemo(
    () => previewScenes(
      rows.filter((r) => r.targetMode === 'shot').map((r) => ({ key: r.key, auto: r.sceneAuto, episode: r.episode.trim().toUpperCase(), shot: r.target.trim() })),
      knownShots,
    ),
    [rows, knownShots],
  )
  const clearAll = () => { setRows([]); setDocs([]); setServerErrors({}); setError(null) }

  const ready = rows.filter((r) => !problems.has(r.key)).length
  const bad = rows.length - ready
  const videos = rows.filter((r) => isVideoModel(rowModel(r, defaults))).length
  const newCount = rows.filter((r) => r.targetMode === 'new').length

  async function submit() {
    setBusy('submit')
    setError(null)
    const fd = new FormData()
    fd.set('payload', JSON.stringify({
      name,
      defaults,
      rows,
      prefix: prepend && preamble ? preamble : null,
      source: { kind: docs.some((d) => d.name !== 'pasted text') ? 'files' : 'paste', files: docs.map((d) => d.name) },
    }))
    const r = await submitBatch(fd).catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(null)
    setConfirm(false)
    if (!r.ok) {
      setError(r.error ?? 'Could not submit.')
      if ('rowErrors' in r && r.rowErrors) setServerErrors(r.rowErrors)
      return
    }
    clearAll()
    setName('')
    setDone(`Batch ${'batchId' in r ? r.batchId : ''} sent to the worker. It is priced below; nothing generates until you approve it.`)
    router.refresh()
  }

  const pickerRow = picker ? rows.find((r) => r.key === picker.key) : null

  return (
    <div className="space-y-12">
      {/* ------------------------------------------------ intake */}
      <section>
        <SectionHeading>Add prompts</SectionHeading>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card className="space-y-4 p-5">
            <Field label="Paste prompts, SHM-JOB blocks, or a batch JSON array">
              <Textarea
                dir="auto"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={8}
                className="min-h-48 font-mono text-[13px]"
                placeholder={'P01\ntarget: SHM-EP001-SC001-SH0010\nrefs: @CHR-001/V02; @LOC-009\nThe prompt text...\n\nP02\n...'}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" tone="accent" size="sm" disabled={!text.trim()} onClick={parsePasted}>
                <Plus aria-hidden className="size-3.5" /> Add these
              </Button>
              <span className="text-xs text-faint">Only P01 / PROMPT 2 headings split a document; anything else stays one prompt, and you can split it below. A leading target: / refs: line sets that row.</span>
            </div>
          </Card>

          <div
            onDragOver={(e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setDragging(true) } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false) }}
            onDrop={(e) => { e.preventDefault(); setDragging(false); void takeFiles(e.dataTransfer.files) }}
            className={cn('lit flex flex-col rounded-xl border p-5 transition-colors duration-200', dragging ? 'border-fg/60 bg-white/[0.03]' : 'border-edge bg-panel')}
          >
            <input ref={fileInput} type="file" accept={DOCUMENT_ACCEPT} multiple hidden onChange={(e) => { void takeFiles(e.target.files); e.target.value = '' }} />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="focus-ring flex flex-1 cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-edge-strong px-6 py-10 text-center text-muted transition-colors duration-150 hover:border-muted hover:text-fg"
            >
              <Upload aria-hidden strokeWidth={1.5} className="size-6" />
              <span className="text-sm">Drop files here, or click to choose</span>
              <span className="text-xs text-faint">.txt .md .json .docx .pdf · Persian documents: prefer .docx, PDF text order is unreliable</span>
            </button>
            {busy === 'extract' && <p className="mt-3 text-xs text-muted">Reading the document…</p>}
            {docs.length > 0 && (
              <ul className="mt-4 space-y-1.5 text-xs">
                {docs.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 text-muted">
                    <FileText aria-hidden className="size-3.5 shrink-0" />
                    <span className="text-fg" dir="auto">{d.name}</span>
                    <Badge tone="muted">{d.format}</Badge>
                    {d.splitOptions.length > 1 ? (
                      <Select
                        aria-label={`How to split ${d.name}`}
                        title="Changing this rebuilds this document's prompts; edits to them are replaced"
                        value={d.split ?? 'none'}
                        onChange={(e) => resplit(d, e.target.value as SplitMode)}
                        className="h-7 w-auto pr-8 text-xs"
                      >
                        {d.splitOptions.map((o) => (
                          <option key={o.mode} value={o.mode}>
                            {o.mode === 'none' ? SPLIT_LABEL.none : `${SPLIT_LABEL[o.mode]} · ${o.count} prompts`}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <span>{d.rowKeys.length} prompt{d.rowKeys.length === 1 ? '' : 's'}</span>
                    )}
                    {d.split === 'none' && d.splitOptions.length > 1 && (
                      <span className="text-faint">
                        · kept whole. It also has {d.splitOptions.slice(1).map((o) => `${o.count} ${SPLIT_FOUND[o.mode]}`).join(', ')}; split only if those are separate prompts
                      </span>
                    )}
                    {d.preamble && <span className="text-faint">· has an opening text before the first prompt</span>}
                    {d.warnings.map((w, n) => <span key={n} className="text-bad">· {w}</span>)}
                    {d.text && (
                      <Disclosure summary="show text" className="basis-full">
                        <pre className="scroll-pane max-h-64 rounded-md border border-edge bg-sunken p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-fg/80" dir="auto">{d.text}</pre>
                      </Disclosure>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        {error && <p className="mt-4 rounded-md border border-bad/35 bg-bad/8 px-3.5 py-2.5 text-[13px] leading-relaxed text-bad" dir="auto">{error}</p>}
        {done && <p className="mt-4 rounded-md border border-good/35 bg-good/8 px-3.5 py-2.5 text-[13px] leading-relaxed text-good">{done}</p>}
      </section>

      {rows.length > 0 && (
        <>
          {/* ------------------------------------------------ defaults */}
          <section>
            <SectionHeading>Batch settings</SectionHeading>
            <Card className="p-5">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
                <Field label="Batch name" className="lg:col-span-2">
                  <Input dir="auto" value={name} onChange={(e) => setName(e.target.value)} placeholder="EP001 blocks, wave 2" />
                </Field>
                <Field label="Model">
                  <Select value={defaults.model} onChange={(e) => setDefaults({ ...defaults, model: e.target.value })}>
                    <optgroup label="Video">{cfg.models.video.map((m) => <option key={m} value={m}>{m}</option>)}</optgroup>
                    <optgroup label="Image">{cfg.models.image.map((m) => <option key={m} value={m}>{m}</option>)}</optgroup>
                  </Select>
                </Field>
                <Field label="Aspect ratio">
                  <Select value={defaults.aspect_ratio} onChange={(e) => setDefaults({ ...defaults, aspect_ratio: e.target.value })}>
                    {cfg.aspectRatios.map((a) => <option key={a} value={a}>{a}</option>)}
                  </Select>
                </Field>
                {isVideoModel(defaults.model) && (
                  <>
                    <Field label="Duration">
                      <Select value={String(defaults.duration)} onChange={(e) => setDefaults({ ...defaults, duration: Number(e.target.value) })}>
                        {cfg.videoDurations.map((d) => <option key={d} value={d}>{d} s</option>)}
                      </Select>
                    </Field>
                    <Field label="First render" hint={defaults.stage === 'draft' ? 'Cheap 480p; approving it buys the 1080p final.' : 'Straight to 1080p. Costs more per take.'}>
                      <Select value={defaults.stage} onChange={(e) => setDefaults({ ...defaults, stage: e.target.value as 'draft' | 'final' })}>
                        <option value="draft">draft</option>
                        <option value="final">final</option>
                      </Select>
                    </Field>
                  </>
                )}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3">
                {isVideoModel(defaults.model) && (
                  <Checkbox checked={defaults.generate_audio} onChange={(e) => setDefaults({ ...defaults, generate_audio: e.target.checked })} label="Sound on every video" />
                )}
                {preamble && (
                  <Checkbox checked={prepend} onChange={(e) => setPrepend(e.target.checked)} label="Prepend the document's opening text (its rules) to every prompt" />
                )}
              </div>
              {preamble && prepend && (
                <Disclosure summary="The text that will be prepended" className="mt-3">
                  <pre className="scroll-pane max-h-56 rounded-md border border-edge bg-sunken p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-fg/80" dir="auto">{preamble}</pre>
                </Disclosure>
              )}
            </Card>
          </section>

          {/* ------------------------------------------------ rows */}
          <section>
            <SectionHeading count={rows.length}>Prompts</SectionHeading>
            <div className="space-y-4">
              {rows.map((row, i) => (
                <RowCard
                  key={row.key}
                  index={i}
                  row={row}
                  catalog={catalog}
                  cfg={cfg}
                  defaults={defaults}
                  knownShots={knownShots}
                  scenePreview={scenePreviews.get(row.key) ?? null}
                  recentRefs={recentRefs}
                  listId={listId}
                  problems={problems.get(row.key) ?? []}
                  onChange={(patch) => update(row.key, patch)}
                  onRemove={() => remove(row.key)}
                  onDuplicate={() => duplicate(row.key)}
                  onPickEntity={() => setPicker({ key: row.key, mode: 'entity' })}
                  onAddRef={() => setPicker({ key: row.key, mode: 'ref' })}
                />
              ))}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button type="button" size="sm" tone="outline" onClick={addRow}>
                <Plus aria-hidden className="size-3.5" /> Add a prompt
              </Button>
              <Button type="button" size="sm" tone="ghost" onClick={clearAll}>
                <Trash2 aria-hidden className="size-3.5" /> Clear all
              </Button>
              <span className="ml-auto text-[13px] text-muted">
                <span className="text-fg">{ready}</span> ready{bad > 0 && <>, <span className="text-bad">{bad}</span> need attention</>}
              </span>
              <Button type="button" tone="accent" disabled={rows.length === 0 || bad > 0} onClick={() => setConfirm(true)}>
                Submit {rows.length} prompt{rows.length === 1 ? '' : 's'}
              </Button>
            </div>
          </section>
        </>
      )}

      <IndexPicker
        open={picker !== null}
        mode={picker?.mode ?? 'entity'}
        title={picker?.mode === 'ref' ? `Add a reference to ${pickerRow?.label || pickerRow?.key || 'the prompt'}` : `What is ${pickerRow?.label || pickerRow?.key || 'this prompt'} for?`}
        catalog={catalog}
        onClose={() => setPicker(null)}
        onPickEntity={(e) => { if (picker) update(picker.key, { targetMode: 'entity', target: e.id }); setPicker(null) }}
        onPickRef={(token) => {
          if (picker && pickerRow && !pickerRow.refs.includes(token)) update(picker.key, { refs: [...pickerRow.refs, token] })
          setPicker(null)
        }}
      />

      <Modal
        open={confirm}
        title={`Submit ${rows.length} prompt${rows.length === 1 ? '' : 's'}?`}
        onClose={() => setConfirm(false)}
        footer={
          <>
            <Button type="button" tone="ghost" onClick={() => setConfirm(false)}>Back</Button>
            <Button type="button" tone="accent" pending={busy === 'submit'} pendingLabel="Sending" onClick={submit}>Send to the worker</Button>
          </>
        }
      >
        <div className="space-y-3 text-sm leading-relaxed text-muted">
          <p>
            {videos > 0 && <>{videos} video{videos === 1 ? '' : 's'} on <span className="font-mono text-fg">{defaults.model}</span>{defaults.generate_audio ? ' with sound' : ', silent'}, {defaults.stage} first. </>}
            {rows.length - videos > 0 && <>{rows.length - videos} image{rows.length - videos === 1 ? '' : 's'}. </>}
            {newCount > 0 && <>{newCount} new entit{newCount === 1 ? 'y' : 'ies'} will be numbered when you approve. </>}
          </p>
          <p>The worker checks every row and prices the batch. <span className="text-fg">Nothing generates until you approve the total.</span></p>
        </div>
      </Modal>
    </div>
  )
}

function RowCard({
  index, row, catalog, cfg, defaults, knownShots, scenePreview, recentRefs, listId, problems, onChange, onRemove, onDuplicate, onPickEntity, onAddRef,
}: {
  index: number
  row: DraftRow
  catalog: CatalogEntity[]
  cfg: IntakeConfig
  defaults: BatchDefaults
  knownShots: string[]
  scenePreview: string | null
  recentRefs: string[]
  listId: string
  problems: string[]
  onChange: (patch: Partial<DraftRow>) => void
  onRemove: () => void
  onDuplicate: () => void
  onPickEntity: () => void
  onAddRef: () => void
}) {
  const model = rowModel(row, defaults)
  const video = isVideoModel(model)
  const overrides = Object.entries(row.params)

  return (
    <Card className={cn('p-5', problems.length && 'border-bad/40')}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[11px] text-faint">{String(index + 1).padStart(2, '0')}</span>
        <Input dir="auto" value={row.label} onChange={(e) => onChange({ label: e.target.value })} placeholder="Label (P01)" className="h-8 w-44 text-[13px]" />
        <Badge tone={problems.length ? 'bad' : 'good'}>{problems.length ? `${problems.length} problem${problems.length === 1 ? '' : 's'}` : 'ready'}</Badge>
        {video && <Badge tone="muted">{row.stage || defaults.stage}</Badge>}
        <span className="font-mono text-[11px] text-faint">{model}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" size="sm" tone="ghost" onClick={onDuplicate} aria-label="Duplicate"><Copy aria-hidden className="size-3.5" /></Button>
          <Button type="button" size="sm" tone="ghost" onClick={onRemove} aria-label="Remove"><Trash2 aria-hidden className="size-3.5" /></Button>
        </div>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Where it goes and how it renders: one label column, so every control starts on the same line. */}
        <div className="space-y-3">
          <TargetCell row={row} catalog={catalog} knownShots={knownShots} scenePreview={scenePreview} listId={listId} onChange={onChange} onPickEntity={onPickEntity} />
          <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-x-4 gap-y-3">
            <RowLabel>Look</RowLabel>
            <div className="flex items-center gap-3">
              <Input dir="ltr" aria-label="Look" value={row.variant} onChange={(e) => onChange({ variant: e.target.value.toUpperCase() })} placeholder="V01" className="w-24 font-mono text-[13px]" />
              <span className="text-xs text-faint">{row.targetMode === 'shot' ? 'Blank = V01.' : "Blank = the entity's main look, or V01."}</span>
            </div>
            <RowLabel>Model</RowLabel>
            <div className="flex flex-wrap items-center gap-2">
              <Select aria-label="Model" value={row.model} onChange={(e) => onChange({ model: e.target.value })} className="w-auto min-w-44">
                <option value="">Batch default</option>
                <optgroup label="Video">{cfg.models.video.map((m) => <option key={m} value={m}>{m}</option>)}</optgroup>
                <optgroup label="Image">{cfg.models.image.map((m) => <option key={m} value={m}>{m}</option>)}</optgroup>
              </Select>
              {video && (
                <Select aria-label="First render" value={row.stage} onChange={(e) => onChange({ stage: e.target.value as DraftRow['stage'] })} className="w-auto min-w-36">
                  <option value="">Default render</option>
                  <option value="draft">Draft first</option>
                  <option value="final">Final</option>
                </Select>
              )}
            </div>
            {overrides.length > 0 && (
              <>
                <RowLabel>From the doc</RowLabel>
                <p className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  {overrides.map(([k, v]) => <span key={k} className="font-mono">{k}={v}</span>)}
                  <button type="button" className="cursor-pointer text-faint underline hover:text-fg" onClick={() => onChange({ params: {} })}>use batch settings</button>
                </p>
              </>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <Field label="Prompt (sent as written)">
            <Textarea dir="auto" value={row.prompt} onChange={(e) => onChange({ prompt: e.target.value })} rows={8} className="min-h-40 max-h-96 text-[13px]" />
          </Field>
          {problems.length > 0 && (
            <ul className="space-y-1 text-xs text-bad">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          {row.warnings.length > 0 && (
            <ul className="space-y-1 text-xs text-faint">
              {row.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
        </div>
      </div>

      {/* References get the full width: they are pictures, and there are often six or more. */}
      <div className="mt-6 space-y-4 border-t border-edge pt-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-[13px] text-fg">References</span>
          <span className="font-mono text-[11px] text-faint">{row.refs.length}</span>
          <span className="text-xs text-faint">in the order the model gets them</span>
          <Button type="button" size="sm" tone="outline" onClick={onAddRef} className="ml-auto">
            <Plus aria-hidden className="size-3.5" /> Add from the index
          </Button>
        </div>

        {row.refs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-edge-strong px-4 py-6 text-center text-xs text-faint">
            No references yet. Pick from the suggestions below, or add from the index.
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">
            {row.refs.map((t, n) => (
              <RefTile key={t} token={t} order={n + 1} catalog={catalog} onRemove={() => onChange({ refs: row.refs.filter((x) => x !== t) })} />
            ))}
          </div>
        )}

        <RefSuggestions row={row} catalog={catalog} recentRefs={recentRefs} onAdd={(token) => onChange({ refs: [...row.refs, token] })} />
      </div>
    </Card>
  )
}

/** An attached reference, large: the look itself, its position in the order, its token and name. */
function RefTile({ token, order, catalog, onRemove }: { token: string; order: number; catalog: CatalogEntity[]; onRemove: () => void }) {
  const path = lookPath(token, catalog)
  const [id] = token.replace(/^@/, '').split('/')
  const entity = catalog.find((e) => e.shortId === id || e.id === id)
  return (
    <div className="group relative overflow-hidden rounded-lg border border-edge-strong bg-sunken">
      <div className="checker aspect-square">
        {path ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbUrl(path, 480)} alt={entity?.name ?? token} loading="lazy" className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center"><ImageOff aria-hidden className="size-5 text-faint" /></div>
        )}
      </div>
      <span className="absolute top-2 left-2 grid h-5 min-w-5 place-items-center rounded-[4px] bg-ink/85 px-1 font-mono text-[10.5px] text-fg">{order}</span>
      <button
        type="button"
        aria-label={`Remove ${token}`}
        onClick={onRemove}
        className="focus-ring absolute top-2 right-2 grid size-6 cursor-pointer place-items-center rounded-[4px] bg-ink/85 text-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:text-fg focus-visible:opacity-100"
      >
        <X aria-hidden className="size-3.5" />
      </button>
      <div className="space-y-0.5 px-2.5 py-2">
        <div className="truncate font-mono text-[11.5px] text-fg">{token.replace(/^@/, '')}</div>
        <div className="truncate text-xs text-muted">{entity?.name ?? 'not in the index'}</div>
      </div>
    </div>
  )
}

/**
 * References the prompt seems to need, as chips. Nothing is attached until one
 * is clicked. Names and telling words first, then words that fit several
 * entities (pick one), then what the latest queued jobs used.
 */
function RefSuggestions({ row, catalog, recentRefs, onAdd }: {
  row: DraftRow
  catalog: CatalogEntity[]
  recentRefs: string[]
  onAdd: (token: string) => void
}) {
  const s = useMemo(() => suggestRefs(row.prompt, catalog, row.refs, recentRefs), [row.prompt, row.refs, catalog, recentRefs])
  if (s.found.length + s.groups.length + s.recent.length === 0) return null

  const lines: { label: ReactNode; items: RefSuggestion[]; why: (x: RefSuggestion) => string }[] = [
    ...(s.found.length ? [{ label: 'In the prompt', items: s.found, why: (x: RefSuggestion) => `the prompt says "${x.matched}"` }] : []),
    ...s.groups.map((g) => ({ label: <>&ldquo;{g.word}&rdquo; &middot; pick one</>, items: g.options, why: () => `the prompt says "${g.word}"` })),
    ...(s.recent.length ? [{ label: 'Used recently', items: s.recent, why: () => 'used in a recent queued job' }] : []),
  ]

  return (
    <div className="rounded-lg border border-edge bg-white/[0.015] p-4">
      <div className="eyebrow mb-3 text-faint">Suggested</div>
      <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-x-4 gap-y-2.5">
        {lines.map((line, i) => (
          <Fragment key={i}>
            <span className="flex h-9 items-center text-xs text-faint">{line.label}</span>
            <div className="flex flex-wrap gap-1.5">
              {line.items.map((x) => (
                <SuggestionChip key={x.token} suggestion={x} path={lookPath(x.token, catalog)} why={line.why(x)} onAdd={() => onAdd(x.token)} />
              ))}
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  )
}

/** A suggested reference. Hovering (or focusing) it shows the look at a size you can judge it by. */
function SuggestionChip({ suggestion, path, why, onAdd }: { suggestion: RefSuggestion; path: string | null; why: string; onAdd: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [at, setAt] = useState<DOMRect | null>(null)
  const enter = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setAt(ref.current?.getBoundingClientRect() ?? null), 120)
  }
  const leave = () => {
    if (timer.current) clearTimeout(timer.current)
    setAt(null)
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => { leave(); onAdd() }}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onFocus={enter}
        onBlur={leave}
        aria-label={`Add ${suggestion.token.replace(/^@/, '')} ${suggestion.entity.name}`}
        className="group focus-ring inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-dashed border-edge-strong py-1 pr-2.5 pl-1 text-[12px] text-muted transition-colors duration-150 hover:border-muted hover:bg-white/[0.03] hover:text-fg"
      >
        <LookThumb path={path} />
        <span className="font-mono text-[11.5px] text-fg/90">{suggestion.token.replace(/^@/, '')}</span>
        <span className="text-faint group-hover:text-muted">{suggestion.entity.name}</span>
        <Plus aria-hidden className="size-3 text-faint group-hover:text-fg" />
      </button>
      <LookPreview at={at} path={path} token={suggestion.token} name={suggestion.entity.name} why={why} />
    </>
  )
}

const PREVIEW = 256

/** The large hover card: above the chip when there is room, below when not, kept inside the window. */
function LookPreview({ at, path, token, name, why }: { at: DOMRect | null; path: string | null; token: string; name: string; why: string }) {
  if (typeof document === 'undefined') return null
  const h = PREVIEW + 64
  const above = at ? at.top > h + 16 : true
  const left = at ? Math.max(8, Math.min(at.left, window.innerWidth - PREVIEW - 24)) : 0
  return createPortal(
    <AnimatePresence>
      {at && (
        <motion.div
          role="tooltip"
          initial={{ opacity: 0, y: above ? 4 : -4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          transition={{ duration: 0.14, ease: EASE }}
          style={{ left, ...(above ? { bottom: window.innerHeight - at.top + 8 } : { top: at.bottom + 8 }) }}
          className="pointer-events-none fixed z-120 w-[272px] rounded-lg border border-edge-strong bg-raise p-2 shadow-[0_20px_48px_-12px_rgba(0,0,0,0.9)]"
        >
          <div className="checker grid size-[256px] place-items-center overflow-hidden rounded-md">
            {path ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbUrl(path, 480)} alt="" className="size-full object-contain" />
            ) : (
              <span className="text-xs text-faint">No image for this look</span>
            )}
          </div>
          <div className="px-1 pt-2 pb-0.5">
            <div className="font-mono text-[11.5px] text-fg">{token.replace(/^@/, '')} <span className="font-sans text-muted">{name}</span></div>
            <div className="mt-0.5 text-[11px] text-faint">Suggested because {why}</div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/** A look's picture at chip size; a quiet empty square when the look has no file. */
function LookThumb({ path }: { path: string | null }) {
  if (!path) return <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-[4px] bg-sunken"><ImageOff className="size-3 text-faint" /></span>
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={thumbUrl(path)} alt="" loading="lazy" className="size-7 shrink-0 rounded-[4px] bg-sunken object-cover" />
  )
}
