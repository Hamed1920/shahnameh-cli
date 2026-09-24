'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useRouter } from 'next/navigation'
import { Copy, FileText, Plus, Trash2, Upload, X } from 'lucide-react'
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
import { ContextMenu, type MenuEntry } from '@/components/ui/context-menu'
import { MenuNote } from '@/components/item-menu'
import { Badge, SectionHeading } from '@/components/ui/text'
import { checkRow, initialTarget, isVideoModel, rowModel, shotRx, type DraftRow, type RowConfig, type RowUpload } from '@/lib/batch-rules'
import { UploadCard, type UploadDraft } from '@/components/reference-editor'
import { detectByKeywords } from '@/lib/asset-detect'
import { mergeDetected, placeDocRefs, placeToken, refsOf, removeToken, type RefSlot } from '@/lib/ref-slots'
import { RowReferences, type PageUpload, type SlotsChange } from './ref-slots'
import { ReferenceStudio, type StudioTarget } from '@/components/reference-studio'
import { groupOf, type Place } from '@/lib/ref-slots'
import { ModelPicker } from '@/components/model-picker'
import { ModelParamFields, extraFor } from '@/components/generation-settings'
import { aspectRatiosFor, durationsFor, hasDraft, hasSound, modelInfo, modelLabel, refLimit, stageResolutionFor } from '@/lib/models'
import { targetCandidates } from '@/lib/ref-suggest'
import { useAssetUrls, useProject } from '@/components/project-context'
import { episodeLabel, shortEpisode, type EpisodeInfo } from '@/lib/episodes'
import { latestEpisode, previewScenes } from '@/lib/scenes'
import { cn } from '@/lib/cn'
import { DOCUMENT_ACCEPT, MAX_DOCUMENTS, TEXT_EXT } from '@/lib/document-types'
import { parsePromptDocument, type ParseResult, type SplitMode, type SplitOption } from '@/lib/prompt-parser'
import type { BatchDefaults, CatalogEntity } from '@/lib/types'

export interface IntakeConfig extends RowConfig {
  /** The reference studio's model unless another is chosen (worker/config.json defaultImageModel). */
  defaultImageModel: string
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
export function PromptIntake({ catalog, cfg, knownShots, recentRefs, episodes }: {
  catalog: CatalogEntity[]
  cfg: IntakeConfig
  knownShots: string[]
  /** Reference tokens of the latest queued jobs, newest first. */
  recentRefs: string[]
  /** Every episode, in order, the next free number last. */
  episodes: EpisodeInfo[]
}) {
  const project = useProject()
  const router = useRouter()
  const listId = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [docs, setDocs] = useState<Doc[]>([])
  const [rows, setRows] = useState<DraftRow[]>([])
  const [defaults, setDefaults] = useState<BatchDefaults>(cfg.defaults)
  /**
   * The episode this batch's footage belongs to. Every row asking for the next
   * free scene files into it, so a wave of EP002 prompts cannot quietly land in
   * EP001 -- which is what happened while the episode was only ever guessed from
   * whichever one had the most recent shot.
   */
  const [episode, setEpisode] = useState(() => latestEpisode(knownShots, cfg.code))
  const [name, setName] = useState('')
  const [prepend, setPrepend] = useState(false)
  /**
   * The index picker, for a row's target (entity), a reference (ref: into a
   * slot, or the tray when slot is null), or the entity an upload is a look of.
   */
  /** The reference studio, opened from a slot's Create: what it makes, and where the pick goes. */
  const [studio, setStudio] = useState<{ rowKey: string; slotKey: string; target: StudioTarget; prompt: string; refs: string[] } | null>(null)
  const [picker, setPicker] = useState<{ key: string; mode: 'entity' | 'ref'; slot?: string | null; kind?: string | null; upload?: string } | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState<null | 'extract' | 'submit'>(null)
  const [error, setError] = useState<string | null>(null)
  const [serverErrors, setServerErrors] = useState<Record<string, string[]>>({})
  const [dragging, setDragging] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; entries: MenuEntry[] } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const preamble = docs.map((d) => d.preamble).filter(Boolean).join('\n\n')

  /** Files added on this page, by upload id. Rows hold only how each is to be filed. */
  const files = useRef(new Map<string, { file: File; preview: string }>())
  const uploadSeq = useRef(0)
  useEffect(() => {
    const m = files.current
    return () => m.forEach((f) => URL.revokeObjectURL(f.preview))
  }, [])

  /** Read the prompt again and fold what it names into the row's slots (lib/asset-detect.ts). */
  const detect = useCallback(
    (prompt: string, slots: RefSlot[], loose: string[]) =>
      mergeDetected(slots, loose, detectByKeywords(prompt, { catalog, recent: recentRefs }), catalog),
    [catalog, recentRefs],
  )
  /** A new row's references: what the document named, each in its slot, then what the prompt names. */
  const arrangedFor = useCallback((prompt: string, docRefs: string[]) => {
    const placed = placeDocRefs(docRefs, catalog)
    const a = detect(prompt, placed.slots, placed.loose)
    return { slots: a.slots, loose: a.loose, refs: refsOf(a.slots, a.loose) }
  }, [catalog, detect])

  const problems = useMemo(() => {
    const out = new Map<string, string[]>()
    for (const r of rows) {
      const p = [...checkRow(r, catalog, rows, defaults, cfg), ...(serverErrors[r.key] ?? [])]
      if (p.length) out.set(r.key, [...new Set(p)])
    }
    return out
  }, [rows, catalog, defaults, cfg, serverErrors])

  const toDraftRows = useCallback((result: ParseResult, file: string | null): DraftRow[] => result.rows.map((r) => {
    const t = initialTarget(r, { file, catalog, defaultModel: defaults.model, knownShots, code: cfg.code, episode })
    return {
      key: `r${++seq}`,
      label: r.label ?? '',
      ...t,
      newDescription: '',
      variant: r.variant ?? '',
      model: r.model ?? '',
      stage: r.stage ?? '',
      ...arrangedFor(r.prompt, r.refs),
      uploads: [],
      prompt: r.prompt,
      params: r.params,
      warnings: r.warnings,
    }
  }), [catalog, defaults.model, knownShots, cfg.code, episode, arrangedFor])

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
      // A new prompt text is read again; what Hamed placed stays where he put it.
      if (patch.prompt !== undefined && patch.slots === undefined) {
        const a = detect(next.prompt, next.slots, next.loose)
        next.slots = a.slots
        next.loose = a.loose
      }
      if (patch.prompt !== undefined || patch.slots !== undefined || patch.loose !== undefined) {
        next.refs = refsOf(next.slots, next.loose)
        // A file no longer used anywhere in the row is not sent.
        if (patch.uploads === undefined) next.uploads = next.uploads.filter((u) => next.refs.includes(`upload:${u.id}`))
      }
      // A shot id is not an entity and an entity id is not a shot: switching mode drops a target that does not fit.
      if (patch.targetMode && patch.target === undefined && shotRx(cfg.code).test(next.target.trim()) !== (next.targetMode === 'shot')) next.target = ''
      // A design image with nowhere to go yet takes the entity its references point at,
      // once exactly one fits. Two or more: the row shows them and Hamed picks.
      if ((patch.refs || patch.slots || patch.loose || patch.targetMode) && next.targetMode === 'entity' && !next.target.trim()) {
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
      ...initialTarget({ target: null, label: null, prompt: '', refs: [], model: null }, { file: null, catalog, defaultModel: defaults.model, knownShots, code: cfg.code, episode }),
      newDescription: '', variant: '', model: '', stage: '', refs: [], slots: [], loose: [], uploads: [], prompt: '', params: {}, warnings: [],
    }])

  /**
   * Files from the computer, into a slot (the first file) or the tray. Each is
   * filed into the index by the worker when the batch is sent: a new look of the
   * slot's entity, the slot's new entity, or whatever Hamed says below the row.
   */
  const addFiles = (key: string, list: File[], slotKey: string | null) => {
    const row = rows.find((x) => x.key === key)
    if (!row) return
    const slot = slotKey ? row.slots.find((x) => x.key === slotKey) ?? null : null
    const entity = slot?.entity ? catalog.find((e) => e.shortId === slot.entity) ?? null : null
    const images = list.filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type)).slice(0, slot ? 1 : 12)
    if (images.length === 0) { setError('Only PNG, JPG or WEBP images.'); return }
    const fresh: RowUpload[] = images.map((file) => {
      const id = `u${++uploadSeq.current}`
      files.current.set(id, { file, preview: URL.createObjectURL(file) })
      return {
        id,
        originalName: file.name,
        mode: !entity && slot?.proposal ? 'new' : 'variant',
        entity: entity?.id ?? '',
        kind: slot?.proposal ? slot.kind : '',
        name: slot?.proposal?.name ?? '',
        description: slot?.proposal?.description ?? '',
        // The first picture of something is its hero; later ones are plates.
        role: entity && entity.variants.length ? 'PLATE' : 'HERO',
        descriptor: descriptorFrom(file.name),
      }
    })
    let arranged: SlotsChange = { slots: row.slots, loose: row.loose }
    fresh.forEach((u, i) => {
      arranged = placeToken(arranged.slots, arranged.loose, `upload:${u.id}`, i === 0 && slotKey ? { slot: slotKey } : { tray: arranged.loose.length })
    })
    update(key, { ...arranged, uploads: [...row.uploads, ...fresh] })
  }
  const changeUpload = (key: string, id: string, patch: Partial<RowUpload>) => {
    const row = rows.find((x) => x.key === key)
    if (row) update(key, { uploads: row.uploads.map((u) => (u.id === id ? { ...u, ...patch } : u)) })
  }
  const dropUpload = (key: string, id: string) => {
    const row = rows.find((x) => x.key === key)
    if (!row) return
    const left = removeToken(row.slots, row.loose, `upload:${id}`)
    update(key, { ...left, uploads: row.uploads.filter((u) => u.id !== id) })
  }
  /** Put a token into a row as it is now (a studio pick can land long after the dialog opened). */
  const placeInRow = (rowKey: string, token: string, to: Place) => setRows((all) => all.map((r) => {
    if (r.key !== rowKey) return r
    const next = placeToken(r.slots, r.loose, token, to)
    return { ...r, ...next, refs: refsOf(next.slots, next.loose) }
  }))
  const openStudio = (row: DraftRow, slot: RefSlot) => {
    const ent = slot.entity ? catalog.find((e) => e.shortId === slot.entity) : null
    const thing = ent?.name ?? slot.proposal?.name ?? `the ${groupOf(slot.kind).one.toLowerCase()}`
    setStudio({
      rowKey: row.key,
      slotKey: slot.key,
      target: ent ? { entity: ent.id } : { proposal: { kind: slot.kind, name: slot.proposal?.name ?? '', description: slot.proposal?.description } },
      prompt: `A reference picture of ${thing}. `,
      refs: slot.token?.startsWith('@') ? [slot.token] : [],
    })
  }
  const pageUploadsOf = (row: DraftRow): PageUpload[] =>
    row.uploads.map((u) => ({ id: u.id, preview: files.current.get(u.id)?.preview ?? '', name: u.originalName }))
  const draftsOf = (row: DraftRow): UploadDraft[] => row.uploads.flatMap((u) => {
    const f = files.current.get(u.id)
    return f ? [{ ...u, file: f.file, preview: f.preview, groupOf: '' }] : []
  })

  /**
   * Move the batch to another episode, and with it every row that was still
   * filing into the one being left. A row the document sent somewhere else --
   * `target: NEXT/EP002`, or a shot id of its own -- keeps where it was put.
   */
  const changeEpisode = (next: string) => {
    setRows((all) => all.map((r) => (r.targetMode === 'shot' && r.sceneAuto && r.episode === episode ? { ...r, episode: next } : r)))
    setEpisode(next)
  }

  const episodeIds = useMemo(() => episodes.map((e) => e.id), [episodes])
  const episodeTitles = useMemo(
    () => Object.fromEntries(episodes.filter((e) => e.title).map((e) => [e.id, e.title])),
    [episodes],
  )
  /** The chosen episode as the server knows it. Missing means it is the next free number. */
  const chosenEpisode = episodes.find((e) => e.id === episode)
  const startingEpisode = !chosenEpisode?.dir && !chosenEpisode?.shots
  const footageRows = rows.filter((r) => r.targetMode === 'shot' && r.sceneAuto && r.episode === episode).length

  const scenePreviews = useMemo(
    () => previewScenes(
      rows.filter((r) => r.targetMode === 'shot').map((r) => ({ key: r.key, auto: r.sceneAuto, episode: r.episode.trim().toUpperCase(), shot: r.target.trim() })),
      knownShots,
      cfg.code,
    ),
    [rows, knownShots, cfg.code],
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
    fd.set('project', project.slug)
    // Every file the rows use, once, beside the rows that name them.
    const sent = new Map<string, RowUpload>()
    for (const r of rows) for (const u of r.uploads) sent.set(u.id, u)
    if (sent.size) {
      fd.set('uploads', JSON.stringify([...sent.values()].map(({ originalName: _, ...u }) => u)))
      for (const id of sent.keys()) {
        const f = files.current.get(id)
        if (f) fd.set(`file:${id}`, f.file, f.file.name)
      }
    }
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

  /** Right-click one prompt: where it files, and the row's own three verbs. */
  const menuForRow = (row: DraftRow, index: number): MenuEntry[] => {
    const entries: MenuEntry[] = [{ heading: row.label || `Prompt ${String(index + 1).padStart(2, '0')}` }]
    if (row.targetMode === 'shot' && row.sceneAuto) {
      entries.push({
        caption: 'File under',
        chips: episodeIds.map((e) => ({
          label: shortEpisode(e),
          active: row.episode === e,
          onSelect: () => update(row.key, { episode: e }),
        })),
      })
    } else {
      entries.push({
        label: 'Send it to the next free scene',
        icon: <Plus className="size-3.5" />,
        onSelect: () => update(row.key, { targetMode: 'shot', sceneAuto: true, episode }),
      })
    }
    entries.push({ divider: true })
    entries.push({ label: 'Duplicate', icon: <Copy className="size-3.5" />, onSelect: () => duplicate(row.key) })
    entries.push({
      label: 'Copy the prompt',
      icon: <Copy className="size-3.5" />,
      onSelect: () => {
        navigator.clipboard.writeText(row.prompt).then(
          () => { setCopied('Prompt copied'); setTimeout(() => setCopied(null), 2200) },
          () => { setCopied('Could not copy that.'); setTimeout(() => setCopied(null), 2200) },
        )
      },
    })
    entries.push({ label: 'Remove', icon: <Trash2 className="size-3.5" />, tone: 'bad', onSelect: () => remove(row.key) })
    return entries
  }
  const openRowMenu = (ev: React.MouseEvent, row: DraftRow, index: number) => {
    ev.preventDefault()
    ev.stopPropagation()
    setMenu({ at: { x: ev.clientX, y: ev.clientY }, entries: menuForRow(row, index) })
  }

  const pickerRow = picker ? rows.find((r) => r.key === picker.key) : null

  return (
    <div className="space-y-12">
      {/* ------------------------------------------------ intake */}
      <section>
        <SectionHeading>Add prompts</SectionHeading>

        {/* Which episode this wave of footage is for, decided once for the batch. */}
        <Card className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
          <span className="text-[12.5px] text-muted">Footage in this batch belongs to</span>
          <Select
            aria-label="Episode"
            value={episode}
            onChange={(e) => changeEpisode(e.target.value)}
            className="h-9 w-auto"
          >
            {episodes.map((e) => (
              <option key={e.id} value={e.id}>
                {episodeLabel(e.id, episodeTitles)}
                {e.shots > 0 ? ` — ${e.shots} scene${e.shots === 1 ? '' : 's'}` : e.dir ? ' — no footage yet' : ' — start a new episode'}
              </option>
            ))}
          </Select>
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-faint">
            {startingEpisode ? (
              <>
                <span className="font-mono text-muted">{shortEpisode(episode)}</span> is new. Its folder is made when
                the worker files the first accepted take, so nothing is written until then.
              </>
            ) : (
              <>
                Every prompt asking for the next free scene files here. A row can still be sent somewhere else
                below{footageRows > 0 && <>, and <span className="text-muted">{footageRows}</span> of them {footageRows === 1 ? 'is' : 'are'} following this</>}.
              </>
            )}
          </p>
        </Card>

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
                  <Input dir="auto" value={name} onChange={(e) => setName(e.target.value)} placeholder={`${shortEpisode(episode)} blocks, wave 2`} />
                </Field>
                <Field label="Model">
                  <ModelPicker
                    value={defaults.model}
                    pinned={cfg.pinned}
                    onChange={(m) => {
                      const a = aspectRatiosFor(m, cfg.aspectRatios)
                      const d = durationsFor(m, cfg.videoDurations)
                      setDefaults({
                        ...defaults,
                        model: m,
                        aspect_ratio: a.includes(defaults.aspect_ratio) ? defaults.aspect_ratio : a[0] ?? defaults.aspect_ratio,
                        duration: !d || d.includes(defaults.duration) ? defaults.duration : d[d.length - 1],
                        extra: extraFor(m, defaults.extra ?? {}),
                      })
                    }}
                  />
                </Field>
                <Field label="Aspect ratio">
                  <Select value={defaults.aspect_ratio} onChange={(e) => setDefaults({ ...defaults, aspect_ratio: e.target.value })}>
                    {aspectRatiosFor(defaults.model, cfg.aspectRatios).map((a) => <option key={a} value={a}>{a}</option>)}
                  </Select>
                </Field>
                {isVideoModel(defaults.model) && (
                  <>
                    {durationsFor(defaults.model, cfg.videoDurations) && (
                      <Field label="Duration">
                        <Select value={String(defaults.duration)} onChange={(e) => setDefaults({ ...defaults, duration: Number(e.target.value) })}>
                          {durationsFor(defaults.model, cfg.videoDurations)!.map((d) => <option key={d} value={d}>{d} s</option>)}
                        </Select>
                      </Field>
                    )}
                    {hasDraft(defaults.model) && (
                    <Field label="First render" hint={defaults.stage === 'draft'
                      ? `Cheap ${stageResolutionFor(defaults.model, 'draft', cfg)}; approving it buys the ${stageResolutionFor(defaults.model, 'final', cfg)} final.`
                      : `Straight to ${stageResolutionFor(defaults.model, 'final', cfg)}. Costs more per take.`}>
                      <Select value={defaults.stage} onChange={(e) => setDefaults({ ...defaults, stage: e.target.value as 'draft' | 'final' })}>
                        <option value="draft">draft</option>
                        <option value="final">final</option>
                      </Select>
                    </Field>
                    )}
                  </>
                )}
              </div>
              <div className="mt-4">
                <ModelParamFields model={defaults.model} value={defaults.extra ?? {}} onChange={(extra) => setDefaults({ ...defaults, extra })} />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3">
                {hasSound(defaults.model) && (
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
                  episodes={episodeIds}
                  episodeTitles={episodeTitles}
                  scenePreview={scenePreviews.get(row.key) ?? null}
                  recentRefs={recentRefs}
                  listId={listId}
                  problems={problems.get(row.key) ?? []}
                  onChange={(patch) => update(row.key, patch)}
                  onRemove={() => remove(row.key)}
                  onDuplicate={() => duplicate(row.key)}
                  onPickEntity={() => setPicker({ key: row.key, mode: 'entity' })}
                  onPick={(slot, kind) => setPicker({ key: row.key, mode: 'ref', slot, kind })}
                  uploads={pageUploadsOf(row)}
                  drafts={draftsOf(row)}
                  onFiles={(list, slot) => addFiles(row.key, list, slot)}
                  onUploadChange={(id, patch) => changeUpload(row.key, id, patch)}
                  onUploadDrop={(id) => dropUpload(row.key, id)}
                  onUploadEntity={(id) => setPicker({ key: row.key, mode: 'entity', upload: id })}
                  onCreate={(slot) => openStudio(row, slot)}
                  onContextMenu={(ev) => openRowMenu(ev, row, i)}
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

      {studio && (
        <ReferenceStudio
          key={studio.slotKey}
          open
          onClose={() => setStudio(null)}
          catalog={catalog}
          cfg={{ pinned: cfg.pinned, aspectRatios: cfg.aspectRatios, defaultImageModel: cfg.defaultImageModel }}
          target={studio.target}
          initialPrompt={studio.prompt}
          initialRefs={studio.refs}
          onPicked={(token) => placeInRow(studio.rowKey, token, { slot: studio.slotKey })}
        />
      )}

      <ContextMenu at={menu?.at ?? null} entries={menu?.entries ?? []} onClose={() => setMenu(null)} />
      {copied && <MenuNote text={copied} bad={copied.startsWith('Could not')} />}

      <IndexPicker
        open={picker !== null}
        mode={picker?.mode ?? 'entity'}
        title={picker?.upload
          ? 'Which entity is this picture of?'
          : picker?.mode === 'ref'
            ? `Add a reference to ${pickerRow?.label || pickerRow?.key || 'the prompt'}`
            : `What is ${pickerRow?.label || pickerRow?.key || 'this prompt'} for?`}
        catalog={catalog}
        initialKind={picker?.kind ?? null}
        onClose={() => setPicker(null)}
        onPickEntity={(e) => {
          if (picker?.upload) changeUpload(picker.key, picker.upload, { mode: 'variant', entity: e.id })
          else if (picker) update(picker.key, { targetMode: 'entity', target: e.id })
          setPicker(null)
        }}
        onPickRef={(token) => {
          if (picker && pickerRow) {
            update(picker.key, placeToken(pickerRow.slots, pickerRow.loose, token, picker.slot ? { slot: picker.slot } : { tray: pickerRow.loose.length }))
          }
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
  index, row, catalog, cfg, defaults, knownShots, episodes, episodeTitles, scenePreview, recentRefs, listId, problems, onChange, onRemove, onDuplicate,
  onPickEntity, onPick, uploads, drafts, onFiles, onUploadChange, onUploadDrop, onUploadEntity, onCreate, onContextMenu,
}: {
  index: number
  row: DraftRow
  catalog: CatalogEntity[]
  cfg: IntakeConfig
  defaults: BatchDefaults
  knownShots: string[]
  episodes: string[]
  episodeTitles: Record<string, string>
  scenePreview: string | null
  recentRefs: string[]
  listId: string
  problems: string[]
  onChange: (patch: Partial<DraftRow>) => void
  onRemove: () => void
  onDuplicate: () => void
  onPickEntity: () => void
  onPick: (slot: string | null, kind: string | null) => void
  uploads: PageUpload[]
  drafts: UploadDraft[]
  onFiles: (files: File[], slot: string | null) => void
  onUploadChange: (id: string, patch: Partial<RowUpload>) => void
  onUploadDrop: (id: string) => void
  onUploadEntity: (id: string) => void
  /** Open the reference studio for a slot. */
  onCreate?: (slot: RefSlot) => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const model = rowModel(row, defaults)
  const video = isVideoModel(model)
  const overrides = Object.entries(row.params)
  // What recent jobs used, for things this row has no picture of yet.
  const recent = useMemo(() => {
    const have = new Set(row.refs.map((t) => t.replace(/^@/, '').split('/')[0]))
    const out: string[] = []
    for (const t of recentRefs) {
      const id = t.replace(/^@/, '').split('/')[0]
      if (have.has(id)) continue
      have.add(id)
      out.push(t.startsWith('@') ? t : `@${t}`)
      if (out.length === 6) break
    }
    return out
  }, [row.refs, recentRefs])

  return (
    <Card className={cn('p-5', problems.length && 'border-bad/40')} onContextMenu={onContextMenu}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[11px] text-faint">{String(index + 1).padStart(2, '0')}</span>
        <Input dir="auto" value={row.label} onChange={(e) => onChange({ label: e.target.value })} placeholder="Label (P01)" className="h-8 w-44 text-[13px]" />
        <Badge tone={problems.length ? 'bad' : 'good'}>{problems.length ? `${problems.length} problem${problems.length === 1 ? '' : 's'}` : 'ready'}</Badge>
        {video && hasDraft(model) && <Badge tone="muted">{row.stage || defaults.stage}</Badge>}
        <span className="text-[11.5px] text-faint">{modelLabel(model)}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" size="sm" tone="ghost" onClick={onDuplicate} aria-label="Duplicate"><Copy aria-hidden className="size-3.5" /></Button>
          <Button type="button" size="sm" tone="ghost" onClick={onRemove} aria-label="Remove"><Trash2 aria-hidden className="size-3.5" /></Button>
        </div>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Where it goes and how it renders: one label column, so every control starts on the same line. */}
        <div className="space-y-3">
          <TargetCell
            row={row}
            catalog={catalog}
            knownShots={knownShots}
            episodes={episodes}
            episodeTitles={episodeTitles}
            scenePreview={scenePreview}
            listId={listId}
            onChange={onChange}
            onPickEntity={onPickEntity}
          />
          <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-x-4 gap-y-3">
            <RowLabel>Look</RowLabel>
            <div className="flex items-center gap-3">
              <Input dir="ltr" aria-label="Look" value={row.variant} onChange={(e) => onChange({ variant: e.target.value.toUpperCase() })} placeholder="V01" className="w-24 font-mono text-[13px]" />
              <span className="text-xs text-faint">{row.targetMode === 'shot' ? 'Blank = V01.' : "Blank = the entity's main look, or V01."}</span>
            </div>
            <RowLabel>Model</RowLabel>
            <div className="flex flex-wrap items-center gap-2">
              <ModelPicker
                aria-label="Model"
                value={row.model}
                pinned={cfg.pinned}
                allowDefault={`Batch default (${modelLabel(defaults.model)})`}
                onChange={(m) => onChange({ model: m })}
                className="w-auto min-w-44"
              />
              {video && hasDraft(model) && (
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
      <div className="mt-6 space-y-5 border-t border-edge pt-5">
        <RowReferences
          slots={row.slots}
          loose={row.loose}
          catalog={catalog}
          uploads={uploads}
          recent={recent}
          maxRefs={modelInfo(model) ? refLimit(model) : 12}
          onChange={(next) => onChange(next)}
          onPick={onPick}
          onFiles={onFiles}
          onCreate={onCreate}
        />
        {drafts.length > 0 && (
          <div className="space-y-3">
            <div className="eyebrow text-faint">Files added here: filed into the index when the batch is sent</div>
            {drafts.map((u, n) => (
              <UploadCard
                key={u.id}
                index={n}
                upload={u}
                catalog={catalog}
                refsEditable={false}
                inUse
                onChange={(patch) => onUploadChange(u.id, patch)}
                onDrop={() => onUploadDrop(u.id)}
                onToggleRef={() => {}}
                onPickEntity={() => onUploadEntity(u.id)}
              />
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

/** A filename as an English description: "Man_walking-02.jpeg" -> "man walking 02". */
function descriptorFrom(name: string): string {
  const d = name.replace(/\.[a-z0-9]+$/i, '').replace(/[^A-Za-z0-9]+/g, ' ').trim().toLowerCase().slice(0, 40).trim()
  return d || 'reference'
}
