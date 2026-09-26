'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, FileVideo, LoaderCircle, Pencil, Plus, Search, TriangleAlert, Upload, X } from 'lucide-react'
import { assignToEpisode } from '@/app/[project]/shot-actions'
import { MenuNote } from '@/components/item-menu'
import { useAssetUrls, useProject } from '@/components/project-context'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/field'
import { Modal } from '@/components/ui/modal'
import { Segmented } from '@/components/ui/segmented'
import { Badge } from '@/components/ui/text'
import { cn } from '@/lib/cn'
import { shortEpisode } from '@/lib/episodes'
import { shotLabel } from './scene-card'
import { FOOTAGE_ACCEPT, FOOTAGE_EXT, MAX_FOOTAGE, MAX_FOOTAGE_BYTES } from '@/lib/indexing'
import type { AcceptedTake } from '@/lib/types'
import { addFootage, fileTakes, renameEpisode } from './actions'

/**
 * What an episode can be done to, from its own page.
 *
 * Everything here is a request, like everything else the panel writes: the
 * worker renames the folder, moves the footage and files the uploads, and the
 * header says "applying" until it has. Nothing here picks a scene number -- the
 * worker allocates every one.
 */

const MB = (n: number) => `${Math.round(n / 1024 / 1024)} MB`
const sizeOf = (n: number) => (n > 1024 * 1024 ? MB(n) : `${Math.max(1, Math.round(n / 1024))} KB`)

/** One file picked off disk, with the scene it is going to. */
interface Picked {
  id: string
  file: File
  /** 'next' for a new scene, or SCnnn to add a take to one this episode has. */
  scene: string
}

export function EpisodePanel({
  episode,
  title,
  /** Scenes the episode already has, so an uploaded file can be another take of one. */
  scenes,
  /** Every accepted shot in the film, for the picker. */
  accepted,
  /** True while the worker still has a request for this episode to apply. */
  applying,
}: {
  episode: string
  title: string
  scenes: { id: string; label: string }[]
  accepted: AcceptedTake[]
  applying: boolean
}) {
  const [renaming, setRenaming] = useState(false)
  const [adding, setAdding] = useState(false)
  const [note, setNote] = useState<{ id: number; text: string; bad?: boolean } | null>(null)
  const seq = useRef(0)

  const say = (text: string, bad?: boolean) => {
    const id = ++seq.current
    setNote({ id, text, bad })
    setTimeout(() => setNote((n) => (n?.id === id ? null : n)), bad ? 7000 : 3000)
  }
  // Every episode action re-renders the page in its own response (episodes/actions.ts).
  const done = say

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {applying && (
          <Badge tone="accent" className="gap-1.5">
            <LoaderCircle aria-hidden className="size-3 animate-spin" />
            the worker is applying a change
          </Badge>
        )}
        <Button type="button" size="sm" tone="outline" onClick={() => setRenaming(true)}>
          <Pencil aria-hidden className="size-3.5" /> Rename
        </Button>
        <Button type="button" size="sm" tone="accent" onClick={() => setAdding(true)}>
          <Plus aria-hidden className="size-3.5" /> Add outputs
        </Button>
      </div>

      <RenameDialog
        open={renaming}
        episode={episode}
        title={title}
        onClose={() => setRenaming(false)}
        onDone={done}
      />
      <AddOutputsDialog
        open={adding}
        episode={episode}
        accepted={accepted}
        scenes={scenes}
        onClose={() => setAdding(false)}
        onDone={done}
      />
      {note && <MenuNote text={note.text} bad={note.bad} />}
    </>
  )
}

function RenameDialog({
  open, episode, title, onClose, onDone,
}: {
  open: boolean
  episode: string
  title: string
  onClose: () => void
  onDone: (text: string, bad?: boolean) => void
}) {
  const project = useProject()
  const [name, setName] = useState(title)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (open) { setName(title); setError(null) } }, [open, title])

  async function save() {
    setBusy(true)
    const r = await renameEpisode(project.slug, episode, name).catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(false)
    if (!r.ok) { setError(r.error ?? 'That did not save.'); return }
    onClose()
    onDone(`Asked the worker to rename ${shortEpisode(episode)}. It renames the folder on its next pass.`)
  }

  return (
    <Modal
      open={open}
      title={`Rename ${shortEpisode(episode)}`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" tone="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" tone="accent" pending={busy} onClick={save}>Rename</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="Name"
          hint={
            <>
              The number never changes — only the wording. The folder becomes{' '}
              <code className="font-mono text-fg">{`${project.code}-${episode}`}</code>
              {name.trim() ? <code className="font-mono text-fg">-{name.trim().toUpperCase().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}</code> : null}
              . Every shot id in it carries the number, not the name, so nothing else moves.
            </>
          }
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Zahhak Entry" dir="auto" autoFocus />
        </Field>
        {error && <p className="rounded-md border border-bad/35 bg-bad/8 px-3 py-2 text-xs text-bad">{error}</p>}
      </div>
    </Modal>
  )
}

/**
 * What goes into an episode.
 *
 * Picking comes first, because nearly everything that belongs in an episode has
 * already been accepted and is sitting in the Gallery. Choosing it is a
 * `move-shot` — the same footage in a different part of the film, not a new
 * asset — so the worker carries the shot's takes across and gives it the next
 * scene number here.
 *
 * Uploading is the other way, for footage that was never generated in this
 * panel: a render from another tool, a plate, a cut someone else made.
 */
function AddOutputsDialog({
  open, episode, accepted, scenes, onClose, onDone,
}: {
  open: boolean
  episode: string
  accepted: AcceptedTake[]
  scenes: { id: string; label: string }[]
  onClose: () => void
  onDone: (text: string, bad?: boolean) => void
}) {
  const [mode, setMode] = useState<'pick' | 'upload'>('pick')
  useEffect(() => { if (open) setMode('pick') }, [open])

  return (
    <Modal
      open={open}
      size="xl"
      title={
        <span className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <span>Add to {shortEpisode(episode)}</span>
          <Segmented
            value={mode}
            onChange={setMode}
            aria-label="Where the footage comes from"
            options={[['pick', 'From accepted'], ['upload', 'Upload a file']] as const}
          />
        </span>
      }
      onClose={onClose}
    >
      {mode === 'pick' ? (
        <PickAccepted episode={episode} accepted={accepted} onClose={onClose} onDone={onDone} />
      ) : (
        <UploadFootage episode={episode} scenes={scenes} onClose={onClose} onDone={onDone} />
      )}
    </Modal>
  )
}

/**
 * A take's picture in the picker.
 *
 * api/thumb only makes JPEGs of images, and nearly every accepted take is a
 * video, so a video gets a real <video> asking for metadata with a `#t=0.1`
 * fragment -- the browser seeks a tenth of a second in and paints that frame.
 * It mounts only once its row is near the viewport: a list of eighty of these
 * all asking for metadata at once buries the server in range requests before
 * anything has been picked.
 */
function PickThumb({ file, isVideo }: { file: string; isVideo: boolean }) {
  const { assetUrl, thumbUrl } = useAssetUrls()
  const box = useRef<HTMLSpanElement>(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    const el = box.current
    if (!el || near) return
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return }
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) { setNear(true); io.disconnect() } },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [near])

  return (
    <span ref={box} className="checker grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border border-edge bg-black">
      {!near ? null : isVideo ? (
        <video src={`${assetUrl(file)}#t=0.1`} className="size-full object-cover" muted playsInline preload="metadata" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbUrl(file, 128)} alt="" className="size-full object-cover" />
      )}
    </span>
  )
}

/** Pick accepted footage and move it here. A shot travels with all of its takes. */
function PickAccepted({
  episode, accepted, onClose, onDone,
}: {
  episode: string
  accepted: AcceptedTake[]
  onClose: () => void
  onDone: (text: string, bad?: boolean) => void
}) {
  const project = useProject()
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const q = query.trim().toLowerCase()
  const rows = accepted.filter((t) => {
    if (t.episode === episode) return false
    if (!q) return true
    return `${t.shot} ${t.label} ${t.episode ?? ''}`.toLowerCase().includes(q)
  })

  /**
   * Two ways in, and the row says which it will be.
   *
   * Filed footage MOVES: the worker carries the shot and all of its takes. A
   * take that is accepted but never filed -- an approved 480p draft, which
   * lives in 09_OUTPUT/_drafts -- is COPIED in as a new shot instead, so it can
   * be used without waiting on a final that may never come. Neither is possible
   * for a design image filed under an entity: it has no shot id at all.
   */
  const howIn = (t: AcceptedTake): 'move' | 'file' | null => {
    if (t.movingTo) return null
    if (t.episode && t.filed) return 'move'
    if (t.file) return 'file'
    return null
  }
  const why = (t: AcceptedTake) =>
    t.movingTo ? `already on its way to ${shortEpisode(t.movingTo)}` : 'nothing on disk to file'

  const toggle = (shot: string) =>
    setPicked((was) => {
      const next = new Set(was)
      if (next.has(shot)) next.delete(shot)
      else next.add(shot)
      return next
    })

  async function send() {
    const chosen = rows.filter((t) => picked.has(t.shot))
    const toMove = chosen.filter((t) => howIn(t) === 'move').map((t) => t.shot)
    const toFile = chosen.filter((t) => howIn(t) === 'file').map((t) => t.shot)
    if (toMove.length + toFile.length === 0) { setError('Pick something first.'); return }
    setBusy(true)
    setError(null)

    // Two requests when the pick is mixed, because they are two operations.
    const said: string[] = []
    if (toMove.length) {
      const r = await assignToEpisode(project.slug, toMove, episode)
        .catch((e: Error) => ({ ok: false, error: e.message, moved: undefined }))
      if (!r.ok) { setBusy(false); setError(r.error ?? 'That did not save.'); return }
      said.push(`${r.moved?.length ?? toMove.length} moved`)
    }
    if (toFile.length) {
      const r = await fileTakes(project.slug, episode, toFile)
        .catch((e: Error) => ({ ok: false, error: e.message }))
      if (!r.ok) { setBusy(false); setError(r.error ?? 'That did not save.'); return }
      said.push(`${toFile.length} filed from ${toFile.length === 1 ? 'its draft' : 'their drafts'}`)
    }
    setBusy(false)
    onClose()
    onDone(`Asked the worker: ${said.join(', ')} into ${shortEpisode(episode)}. It does it on its next pass.`)
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-relaxed text-muted">
        Everything you have accepted that is not already in {shortEpisode(episode)}. Picking moves the footage
        here — with every take of it — and the worker gives it the next number here. Nothing is copied and
        nothing is generated again.
      </p>

      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-faint" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by shot, block or episode"
          className="pl-8.5"
          dir="auto"
          aria-label="Search accepted footage"
        />
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-edge px-3 py-6 text-center text-[13px] text-faint">
          {accepted.length === 0
            ? 'Nothing accepted yet. Takes you accept on Review land here.'
            : q
              ? 'Nothing matches that.'
              : `Everything accepted is already in ${shortEpisode(episode)}.`}
        </p>
      ) : (
        <ul className="scroll-pane grid max-h-[46vh] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {rows.map((t) => {
            const how = howIn(t)
            const can = how !== null
            const on = picked.has(t.shot)
            return (
              <li key={t.shot}>
                <button
                  type="button"
                  disabled={!can}
                  aria-pressed={on}
                  onClick={() => toggle(t.shot)}
                  className={cn(
                    'focus-ring flex w-full items-center gap-3 rounded-lg border p-2 text-left transition',
                    can ? 'cursor-pointer' : 'cursor-not-allowed opacity-45',
                    on ? 'border-accent bg-accent/[0.07]' : 'border-edge hover:border-edge-strong',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'grid size-5 shrink-0 place-items-center rounded-[4px] border transition-colors',
                      on ? 'border-accent bg-accent text-ink' : 'border-edge-strong text-transparent',
                    )}
                  >
                    <Check strokeWidth={3.5} className="size-3" />
                  </span>
                  {t.file ? (
                    <PickThumb file={t.file} isVideo={t.isVideo} />
                  ) : (
                    <span className="grid size-12 shrink-0 place-items-center rounded-md border border-dashed border-edge-strong text-[9px] text-faint">
                      none
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-fg">{t.label}</span>
                    <span className="mt-0.5 block truncate text-[10.5px] text-faint">
                      {t.episode ? `${shortEpisode(t.episode)}${t.scene ? ` · ${shotLabel(t.scene)}` : ''}` : t.shot}
                      {t.takes > 1 && ` · ${t.takes} takes`}
                    </span>
                    {how === 'file' && (
                      <span className="mt-0.5 block truncate text-[10.5px] text-muted">
                        draft — copied in, the original stays put
                      </span>
                    )}
                    {!can && <span className="mt-0.5 block truncate text-[10.5px] text-bad">{why(t)}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {error && (
        <p className="flex items-start gap-2 rounded-md border border-bad/35 bg-bad/8 px-3 py-2 text-xs leading-relaxed text-bad">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-edge pt-4">
        <span className="mr-auto text-[12px] text-faint">
          {picked.size > 0 && `${picked.size} shot${picked.size === 1 ? '' : 's'} picked`}
        </span>
        <Button type="button" tone="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" tone="accent" pending={busy} disabled={picked.size === 0} onClick={send}>
          <Check aria-hidden className="size-3.5" /> Add {picked.size || ''} here
        </Button>
      </div>
    </div>
  )
}

/** Footage that was never generated here: a render from another tool, a plate, a cut. */
function UploadFootage({
  episode, scenes, onClose, onDone,
}: {
  episode: string
  scenes: { id: string; label: string }[]
  onClose: () => void
  onDone: (text: string, bad?: boolean) => void
}) {
  const project = useProject()
  const [picked, setPicked] = useState<Picked[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  function take(files: FileList | File[] | null) {
    if (!files) return
    const rejected: string[] = []
    const next: Picked[] = []
    for (const file of [...files]) {
      const ext = (file.name.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase()
      if (!(FOOTAGE_EXT as readonly string[]).includes(ext)) { rejected.push(`${file.name} is not footage`); continue }
      if (file.size > MAX_FOOTAGE_BYTES) { rejected.push(`${file.name} is over ${MB(MAX_FOOTAGE_BYTES)}`); continue }
      next.push({ id: `u${++seq.current}`, file, scene: 'next' })
    }
    setPicked((was) => [...was, ...next].slice(0, MAX_FOOTAGE))
    setError(rejected.length ? rejected.join('; ') : null)
  }

  const drop = (id: string) => setPicked((was) => was.filter((p) => p.id !== id))
  const setScene = (id: string, scene: string) => setPicked((was) => was.map((p) => (p.id === id ? { ...p, scene } : p)))
  const bytes = picked.reduce((n, p) => n + p.file.size, 0)

  async function send() {
    if (picked.length === 0) { setError('Choose at least one file.'); return }
    setBusy(true)
    setError(null)
    const fd = new FormData()
    fd.set('project', project.slug)
    fd.set('episode', episode)
    fd.set('scenes', scenes.map((s) => s.id).join(','))
    fd.set('uploads', JSON.stringify(picked.map((p) => ({ id: p.id, scene: p.scene }))))
    for (const p of picked) fd.set(`file:${p.id}`, p.file)
    const r = await addFootage(fd).catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(false)
    if (!r.ok) { setError(r.error ?? 'That did not save.'); return }
    onClose()
    onDone(
      `${picked.length} file${picked.length === 1 ? '' : 's'} sent to the worker. It files ${picked.length === 1 ? 'it' : 'them'} into ${shortEpisode(episode)} on its next pass.`,
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-relaxed text-muted">
        Footage made anywhere else. Each file becomes a new shot of this episode, or another take of a shot it
        already has. The worker gives every new shot its number; nothing here picks one.
      </p>

      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files) }}
        className={cn(
          'grid place-items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors',
          over ? 'border-accent bg-accent/[0.06]' : 'border-edge-strong',
        )}
      >
        <FileVideo aria-hidden className="size-6 text-faint" />
        <p className="text-[13px] text-muted">Drop files here, or</p>
        <Button type="button" size="sm" tone="outline" onClick={() => input.current?.click()}>
          <Plus aria-hidden className="size-3.5" /> Choose files
        </Button>
        <p className="text-[11.5px] text-faint">
          PNG, JPG, WEBP, MP4 or MOV · up to {MAX_FOOTAGE} files, {MB(MAX_FOOTAGE_BYTES)} each
        </p>
        <input
          ref={input}
          type="file"
          multiple
          accept={FOOTAGE_ACCEPT}
          className="hidden"
          onChange={(e) => { take(e.target.files); e.target.value = '' }}
        />
      </div>

      {picked.length > 0 && (
        <ul className="space-y-2">
          {picked.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-md border border-edge px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-[13px] text-fg" title={p.file.name}>{p.file.name}</span>
              <span className="font-mono text-[11px] text-faint tabular-nums">{sizeOf(p.file.size)}</span>
              <Select
                value={p.scene}
                onChange={(e) => setScene(p.id, e.target.value)}
                className="h-8 w-auto"
                aria-label={`Where ${p.file.name} goes`}
              >
                <option value="next">A new shot</option>
                {scenes.map((s) => <option key={s.id} value={s.id}>Another take of {s.label}</option>)}
              </Select>
              <button
                type="button"
                onClick={() => drop(p.id)}
                aria-label={`Remove ${p.file.name}`}
                className="focus-ring grid size-6 cursor-pointer place-items-center rounded-md text-muted hover:text-fg"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="flex items-start gap-2 rounded-md border border-bad/35 bg-bad/8 px-3 py-2 text-xs leading-relaxed text-bad">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-edge pt-4">
        <span className="mr-auto text-[12px] text-faint">
          {picked.length > 0 && `${picked.length} file${picked.length === 1 ? '' : 's'} · ${sizeOf(bytes)}`}
        </span>
        <Button type="button" tone="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" tone="accent" pending={busy} pendingLabel="Uploading" disabled={picked.length === 0} onClick={send}>
          <Check aria-hidden className="size-3.5" /> Add {picked.length || ''}
        </Button>
      </div>
    </div>
  )
}
