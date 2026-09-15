'use client'

import { useCallback, useId, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, FileText, Plus, Trash2, Upload, X } from 'lucide-react'
import { extractDocuments, submitBatch } from './actions'
import { IndexPicker } from '@/components/index-picker'
import { TargetCell } from '@/components/target-cell'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Disclosure } from '@/components/ui/disclosure'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { Modal } from '@/components/ui/modal'
import { Badge, SectionHeading } from '@/components/ui/text'
import { checkRow, isVideoModel, rowModel, targetModeOf, type DraftRow, type RowConfig } from '@/lib/batch-rules'
import { cn } from '@/lib/cn'
import { DOCUMENT_ACCEPT, MAX_DOCUMENTS, TEXT_EXT } from '@/lib/document-types'
import { parsePromptDocument, type ParseResult } from '@/lib/prompt-parser'
import type { BatchDefaults, CatalogEntity } from '@/lib/types'

export interface IntakeConfig extends RowConfig {
  aspectRatios: string[]
  videoDurations: number[]
  defaults: BatchDefaults
}

interface Doc {
  name: string
  format: ParseResult['format']
  rows: number
  preamble: string | null
  text: string
  warnings: string[]
}

let seq = 0

/**
 * Paste or drop prompts, fix what each one is for, and hand the batch to the
 * worker. Everything on this page is checked as it is typed; nothing is
 * submitted while a row has a problem, and nothing is generated until the
 * priced batch is approved below.
 */
export function PromptIntake({ catalog, cfg, knownShots }: { catalog: CatalogEntity[]; cfg: IntakeConfig; knownShots: string[] }) {
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

  const addParsed = useCallback((result: ParseResult, file: string | null) => {
    const fresh: DraftRow[] = result.rows.map((r) => {
      const t = targetModeOf(r.target, catalog)
      return {
        key: `r${++seq}`,
        label: r.label ?? '',
        targetMode: t.mode,
        target: t.target,
        newKind: t.newKind,
        newName: t.newName,
        newDescription: '',
        variant: r.variant ?? '',
        model: r.model ?? '',
        stage: r.stage ?? '',
        refs: r.refs,
        prompt: r.prompt,
        params: r.params,
        warnings: r.warnings,
      }
    })
    setRows((all) => [...all, ...fresh])
    setDocs((all) => [...all, { name: file ?? 'pasted text', format: result.format, rows: fresh.length, preamble: result.preamble, text: '', warnings: result.warnings }])
    setDone(null)
  }, [catalog])

  const parsePasted = () => {
    if (!text.trim()) return
    addParsed(parsePromptDocument(text), null)
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
      if ((TEXT_EXT as readonly string[]).includes(ext)) addParsed(parsePromptDocument(await f.text()), f.name)
      else toServer.push(f)
    }
    if (toServer.length === 0) return
    setBusy('extract')
    const fd = new FormData()
    for (const f of toServer) fd.append('files', f, f.name)
    const r = await extractDocuments(fd).catch((e: Error) => ({ ok: false, error: e.message, files: undefined }))
    setBusy(null)
    if (!r.ok || !r.files) { setError(r.error ?? 'Could not read those files.'); return }
    for (const f of r.files) {
      addParsed(parsePromptDocument(f.text, { file: f.name }), f.name)
      setDocs((all) => all.map((d) => (d.name === f.name && !d.text ? { ...d, text: f.text } : d)))
    }
  }

  const update = (key: string, patch: Partial<DraftRow>) => {
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)))
    setServerErrors((e) => { if (!e[key]) return e; const n = { ...e }; delete n[key]; return n })
  }
  const remove = (key: string) => setRows((all) => all.filter((r) => r.key !== key))
  const duplicate = (key: string) =>
    setRows((all) => all.flatMap((r) => (r.key === key ? [r, { ...r, key: `r${++seq}`, label: r.label ? `${r.label} copy` : '' }] : [r])))
  const addRow = () =>
    setRows((all) => [...all, {
      key: `r${++seq}`, label: '', targetMode: 'entity', target: '', newKind: '', newName: '', newDescription: '',
      variant: '', model: '', stage: '', refs: [], prompt: '', params: {}, warnings: [],
    }])
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
              <span className="text-xs text-faint">Blocks split on P01 / PROMPT 2 headings, then blank lines. A leading target: / refs: line sets that row.</span>
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
                {docs.map((d, i) => (
                  <li key={`${d.name}-${i}`} className="flex flex-wrap items-center gap-2 text-muted">
                    <FileText aria-hidden className="size-3.5 shrink-0" />
                    <span className="text-fg" dir="auto">{d.name}</span>
                    <Badge tone="muted">{d.format}</Badge>
                    <span>{d.rows} prompt{d.rows === 1 ? '' : 's'}</span>
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
  index, row, catalog, cfg, defaults, knownShots, listId, problems, onChange, onRemove, onDuplicate, onPickEntity, onAddRef,
}: {
  index: number
  row: DraftRow
  catalog: CatalogEntity[]
  cfg: IntakeConfig
  defaults: BatchDefaults
  knownShots: string[]
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
  const refName = (token: string) => {
    const [id, v] = token.replace(/^@/, '').split('/')
    const e = catalog.find((x) => x.id === id || x.shortId === id)
    return e ? `${e.shortId}${v ? '/' + v : ''} ${e.name}` : token
  }

  return (
    <Card className={cn('space-y-5 p-5', problems.length && 'border-bad/40')}>
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

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <TargetCell row={row} catalog={catalog} knownShots={knownShots} listId={listId} onChange={onChange} onPickEntity={onPickEntity} />

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Look" hint="Blank = the entity's main look, or V01.">
              <Input dir="ltr" value={row.variant} onChange={(e) => onChange({ variant: e.target.value.toUpperCase() })} placeholder="V01" className="font-mono" />
            </Field>
            <Field label="Model">
              <Select value={row.model} onChange={(e) => onChange({ model: e.target.value })}>
                <option value="">batch default</option>
                <optgroup label="Video">{cfg.models.video.map((m) => <option key={m} value={m}>{m}</option>)}</optgroup>
                <optgroup label="Image">{cfg.models.image.map((m) => <option key={m} value={m}>{m}</option>)}</optgroup>
              </Select>
            </Field>
            {video && (
              <Field label="First render">
                <Select value={row.stage} onChange={(e) => onChange({ stage: e.target.value as DraftRow['stage'] })}>
                  <option value="">batch default</option>
                  <option value="draft">draft</option>
                  <option value="final">final</option>
                </Select>
              </Field>
            )}
          </div>

          <div className="space-y-2">
            <span className="block text-[12.5px] text-muted">References, in the order the model gets them</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {row.refs.map((t, n) => (
                <span key={t} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-edge-strong pl-2.5 pr-1 font-mono text-[11.5px] text-fg">
                  <span className="text-faint">{n + 1}</span> {refName(t)}
                  <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange({ refs: row.refs.filter((x) => x !== t) })} className="focus-ring grid size-5 cursor-pointer place-items-center rounded text-muted hover:text-fg">
                    <X aria-hidden className="size-3" />
                  </button>
                </span>
              ))}
              <Button type="button" size="sm" tone="outline" onClick={onAddRef}>
                <Plus aria-hidden className="size-3.5" /> Add
              </Button>
            </div>
          </div>

          {overrides.length > 0 && (
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="eyebrow text-faint">from the document</span>
              {overrides.map(([k, v]) => <span key={k} className="font-mono">{k}={v}</span>)}
              <button type="button" className="cursor-pointer underline" onClick={() => onChange({ params: {} })}>use batch settings</button>
            </p>
          )}
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
    </Card>
  )
}
