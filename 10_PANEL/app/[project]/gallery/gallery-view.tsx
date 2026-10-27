'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Film, FolderOpen, GripVertical, Heart, LoaderCircle, Plus, Search, X } from 'lucide-react'
import { revealInFolder } from '@/app/[project]/reveal-action'
import { assignToEpisode } from '@/app/[project]/shot-actions'
import { MenuNote, isTextEntry } from '@/components/item-menu'
import { EpisodePicker } from '@/components/episode-picker'
import { MoveErrors } from '@/components/move-errors'
import { ContextMenu, type MenuEntry } from '@/components/ui/context-menu'
import { RegenerateButton, type RegenerateConfig } from '@/components/regenerate-button'
import { ShowInFolder } from '@/components/show-in-folder'
import { Card, EmptyState } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/field'
import { Badge, PageHeader, SectionHeading } from '@/components/ui/text'
import { TakeMedia } from '@/components/take-media'
import { isFiledShot } from '@/lib/asset'
import { useProject } from '@/components/project-context'
import { cn } from '@/lib/cn'
import {
  episodeLabel, episodesIn, groupByEpisode, shortEpisode, NO_EPISODE_LABEL,
  type EpisodeChoice, type EpisodeOption,
} from '@/lib/episodes'
import { MAX_TAG_LENGTH, cleanTag, moveWithin, tagKey, type GalleryState } from '@/lib/gallery'
import type { CatalogEntity, RegenerateSource, RegenerationView, ShotMoveFailure } from '@/lib/types'
import { setLike, setOrder, setTag } from './actions'

/** One accepted take, flattened by the page so this component touches no disk types. */
export interface GalleryTake {
  decisionId: string
  jobId: string
  title: string
  where: string
  /** EP001, or null for a design image filed under an entity. */
  episode: string | null
  target: string
  ts: string
  stage: 'draft' | 'final' | null
  attempt: number
  status: 'waiting' | 'applied' | 'failed'
  file: string | null
  missing: string | null
  notes: string
  isVideo: boolean
  canRegenerate: boolean
  credits: number | null
  source: RegenerateSource | null
  regenerations: RegenerationView[]
}

type Sort = 'order' | 'newest' | 'scene' | 'liked'

const SORTS: { value: Sort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'order', label: 'My order' },
  { value: 'scene', label: 'Episode & scene order' },
  { value: 'liked', label: 'Liked first' },
]

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function GalleryView({
  takes, state, tags: knownTags, catalog, cfg, prices, allEpisodes, nextEpisode, pendingMoves, moveErrors,
}: {
  takes: GalleryTake[]
  state: GalleryState
  tags: string[]
  catalog: CatalogEntity[]
  cfg: RegenerateConfig
  prices: Record<string, number>
  /**
   * Every episode the project has, titled or not, with or without accepted work
   * in it. The filters below are built from the takes instead -- an episode with
   * nothing accepted is not worth filtering to -- but footage can be moved to
   * any of them, and the next free number has to count them all.
   */
  allEpisodes: EpisodeOption[]
  /** The next free episode number, worked out by the server. Never in the browser. */
  nextEpisode: string
  /** Shot id -> the episode the worker has been asked to move it to, not yet applied. */
  pendingMoves: Record<string, string>
  /** Moves the worker refused in the last half hour. */
  moveErrors: ShotMoveFailure[]
}) {
  const project = useProject()
  const [error, setError] = useState<string | null>(null)
  const episodeTitles = useMemo(
    () => Object.fromEntries(allEpisodes.filter((e) => e.title).map((e) => [e.id, e.title])),
    [allEpisodes],
  )

  const [liked, setLiked] = useState(() => new Set(state.liked))
  const [tags, setTags] = useState<Record<string, string[]>>(state.tags)
  const [order, setLocalOrder] = useState<string[]>([])

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('newest')
  const [likedOnly, setLikedOnly] = useState(false)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [stageFilter, setStageFilter] = useState<'all' | 'final' | 'draft'>('all')
  /** '' is every episode; 'none' is everything that is not footage. */
  const [episodeFilter, setEpisodeFilter] = useState<string>('')

  const ids = takes.map((t) => t.decisionId)
  const signature = `${state.order.join(',')}|${ids.join(',')}`

  /**
   * The arrangement: what Hamed dragged, with anything he has not arranged yet
   * on top in newest-first order, so a take accepted this morning is the first
   * thing on the page instead of being buried at the end of an old sequence.
   */
  useEffect(() => {
    const present = new Set(ids)
    const arranged = state.order.filter((id) => present.has(id))
    const seen = new Set(arranged)
    setLocalOrder([...ids.filter((id) => !seen.has(id)), ...arranged])
    // `signature` covers both inputs; listing them would re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  useEffect(() => { setLiked(new Set(state.liked)) }, [state.liked])
  useEffect(() => { setTags(state.tags) }, [state.tags])

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, revert: () => void) {
    setError(null)
    const r = await fn().catch((e: Error) => ({ ok: false, error: e.message }))
    if (!r.ok) { revert(); setError(r.error ?? 'That did not save.'); return }
  }

  function toggleLike(id: string) {
    const on = !liked.has(id)
    const before = new Set(liked)
    setLiked((s) => { const next = new Set(s); if (on) next.add(id); else next.delete(id); return next })
    void run(() => setLike(project.slug, id, on), () => setLiked(before))
  }

  function addTag(id: string, raw: string) {
    const tag = cleanTag(raw)
    if (!tag) return
    const before = tags
    if ((tags[id] ?? []).some((t) => tagKey(t) === tagKey(tag))) return
    setTags((s) => ({ ...s, [id]: [...(s[id] ?? []), tag] }))
    void run(() => setTag(project.slug, id, tag, true), () => setTags(before))
  }

  function removeTag(id: string, tag: string) {
    const before = tags
    setTags((s) => ({ ...s, [id]: (s[id] ?? []).filter((t) => tagKey(t) !== tagKey(tag)) }))
    void run(() => setTag(project.slug, id, tag, false), () => setTags(before))
  }

  /**
   * The takes picked out to do something to, by decision id. Two takes of one
   * shot share a target, and a shot moves with all of its takes, so the thing
   * actually acted on is the set of their shot ids.
   */
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const lastPicked = useRef<string | null>(null)
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; entries: MenuEntry[] } | null>(null)
  const [note, setNote] = useState<{ id: number; text: string; bad?: boolean } | null>(null)
  const say = (text: string, bad?: boolean) => {
    const id = Date.now()
    setNote({ id, text, bad })
    setTimeout(() => setNote((n) => (n?.id === id ? null : n)), 2200)
  }
  const copy = (text: string) =>
    navigator.clipboard.writeText(text).then(() => say(`Copied ${text}`), () => say('Could not copy that.', true))
  const reveal = (path: string) =>
    void revealInFolder(project.slug, path).then((r) => { if (!r.ok) say(r.error ?? 'Could not open the folder.', true) })

  const dragging = useRef<string | null>(null)
  function onDragOver(overId: string) {
    const from = dragging.current
    if (!from || from === overId) return
    setLocalOrder((o) => moveWithin(o, from, overId))
  }
  /**
   * One save per drag. The card dropped on fires `drop` and the card being
   * dragged fires `dragend`, both of which land here, and both were appending
   * the same arrangement to GALLERY.jsonl.
   */
  function onDrop() {
    if (!dragging.current) return
    dragging.current = null
    const snapshot = order
    void run(() => setOrder(project.slug, snapshot), () => {})
  }

  const suggestions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const t of knownTags) seen.set(tagKey(t), t)
    for (const list of Object.values(tags)) for (const t of list) if (!seen.has(tagKey(t))) seen.set(tagKey(t), t)
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
  }, [knownTags, tags])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rank = new Map(order.map((id, i) => [i, id] as const).map(([i, id]) => [id, i]))
    let list = takes.filter((t) => {
      if (likedOnly && !liked.has(t.decisionId)) return false
      if (tagFilter && !(tags[t.decisionId] ?? []).some((x) => tagKey(x) === tagKey(tagFilter))) return false
      if (stageFilter === 'final' && t.stage === 'draft') return false
      if (stageFilter === 'draft' && t.stage !== 'draft') return false
      if (episodeFilter === 'none' ? t.episode !== null : episodeFilter && t.episode !== episodeFilter) return false
      if (q) {
        const hay = `${t.title} ${t.where} ${t.target} ${t.notes} ${(tags[t.decisionId] ?? []).join(' ')}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    if (sort === 'order') list = [...list].sort((a, b) => (rank.get(a.decisionId) ?? 0) - (rank.get(b.decisionId) ?? 0))
    else if (sort === 'newest') list = [...list].sort((a, b) => b.ts.localeCompare(a.ts))
    else if (sort === 'scene') list = [...list].sort((a, b) => a.target.localeCompare(b.target) || a.ts.localeCompare(b.ts))
    else list = [...list].sort((a, b) => Number(liked.has(b.decisionId)) - Number(liked.has(a.decisionId)) || b.ts.localeCompare(a.ts))
    return list
  }, [takes, order, query, sort, likedOnly, tagFilter, stageFilter, episodeFilter, liked, tags])

  /** Every episode with accepted work in it, for the filter. */
  const episodes = useMemo(() => episodesIn([], takes.map((t) => t.episode)), [takes])
  const looseTakes = takes.some((t) => t.episode === null)
  /**
   * In episode & scene order the page is read as the film runs, so it is cut
   * into episodes under their own headings. Every other sort is one list: a
   * drag in "My order" must not be fenced inside a heading it cannot leave.
   */
  const sections = sort === 'scene' ? groupByEpisode(visible, (t) => t.episode) : [{ episode: null, items: visible }]
  const headed = sort === 'scene' && (episodes.length > 1 || (episodes.length === 1 && looseTakes))

  const draggable = sort === 'order'

  // ---------------------------------------------------------------- selection

  /**
   * Click to pick one; shift-click to pick everything between, as a file list
   * does; ctrl- or cmd-click is a plain pick, which is what a Mac hand expects.
   *
   * The anchor is read here, in the handler, and only then moved. Reading it
   * inside the setState updater looked the same and was not: React runs the
   * updater at render time, by which point the anchor had already been moved to
   * this very card, so every shift-click picked one card and no range.
   */
  const pick = (id: string, shift: boolean) => {
    const ids = visible.map((t) => t.decisionId)
    const anchor = lastPicked.current
    const from = anchor ? ids.indexOf(anchor) : -1
    const to = ids.indexOf(id)
    const range = shift && from >= 0 && to >= 0

    setSelected((was) => {
      const next = new Set(was)
      if (range) {
        const [a, b] = from < to ? [from, to] : [to, from]
        for (const between of ids.slice(a, b + 1)) next.add(between)
      } else if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    // A run of shift-clicks all measure from the same card, so widening and
    // narrowing a range works; a plain click is what moves the anchor.
    if (!range) lastPicked.current = id
  }

  const selectAllShown = () => {
    setSelected((was) => new Set([...was, ...visible.map((t) => t.decisionId)]))
    lastPicked.current = visible[0]?.decisionId ?? null
  }
  const clearSelection = () => { setSelected(new Set()); lastPicked.current = null }

  /**
   * Only ever ids that are still on the page. A take decided away, or one the
   * worker has just moved, would otherwise sit in the count and in every "move
   * these N" for the rest of the session without showing anywhere.
   */
  useEffect(() => {
    const present = new Set(ids)
    setSelected((was) => {
      const kept = [...was].filter((id) => present.has(id))
      return kept.length === was.size ? was : new Set(kept)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  const selectedTakes = takes.filter((t) => selected.has(t.decisionId))
  /**
   * One shot moves once, however many of its takes are picked -- and only a shot
   * whose footage is filed in an episode. An approved draft has a file, in
   * 09_OUTPUT/_drafts, and there is nothing in the episode for the worker to
   * carry: offering one refused the whole batch it was picked with.
   */
  const shotsOf = (list: GalleryTake[]) =>
    [...new Set(list.filter((t) => t.episode && isFiledShot(t.file) && !pendingMoves[t.target]).map((t) => t.target))]
  const selectedShots = shotsOf(selectedTakes)
  /** Picked, but filtered off the page: said out loud rather than acted on silently. */
  const hiddenPicked = selected.size - visible.filter((t) => selected.has(t.decisionId)).length

  const assign = (shots: string[], choice: EpisodeChoice) => {
    void assignToEpisode(project.slug, shots, choice.id, choice.title).then((r) => {
      if (!r.ok) { say(r.error ?? 'That did not save.', true); return }
      const n = r.moved?.length ?? shots.length
      const extra = r.skipped?.length ? `, ${r.skipped.length} already there` : ''
      say(`Asked the worker to move ${n} shot${n === 1 ? '' : 's'} to ${shortEpisode(choice.id)}${extra}. It moves them on its next pass.`)
      clearSelection()
    })
  }

  /** What the episode picker is open for, once the menu that opened it has closed. */
  const [picking, setPicking] = useState<{ at: { x: number; y: number }; shots: string[]; from: string[]; label: string } | null>(null)
  const openPicker = (at: { x: number; y: number }, shots: string[], from: string[]) =>
    setPicking({ at, shots, from, label: shots.length === 1 ? 'Move it to' : `Move ${shots.length} shots to` })

  /**
   * The one row that offers the move. A row rather than a line of chips: a film
   * with a dozen episodes turns that line into a wall, and the picker it opens
   * searches by name, which is how an episode is actually remembered.
   */
  const assignEntry = (at: { x: number; y: number }, shots: string[], waiting: string[], from: string[]): MenuEntry[] => [
    ...(shots.length
      ? [{
          label: shots.length === 1 ? 'Move it to another episode…' : `Move these ${shots.length} to another episode…`,
          icon: <Film className="size-3.5" />,
          onSelect: () => openPicker(at, shots, from),
        } as MenuEntry]
      : []),
    // Said even when there is still something movable, so a count that looks
    // short -- three picked, two offered -- explains itself.
    ...(waiting.length
      ? [{
          label: waiting.length === 1
            ? `Moving to ${shortEpisode(pendingMoves[waiting[0]])}`
            : `${waiting.length} already on their way`,
          icon: <LoaderCircle className="size-3.5 animate-spin" />,
          disabled: true,
          hint: 'waiting',
          onSelect: () => {},
        } as MenuEntry]
      : []),
  ]

  /**
   * Right-click menu for the page: what is shown, in what order.
   *
   * These belong to the page, not to any one take, so they are only here --
   * right-click the bar at the top, or anywhere that is not a card. Having them
   * on every card as well made a card's own menu mostly about the page.
   */
  const pageMenu = (): MenuEntry[] => [
    { heading: `${visible.length} of ${takes.length} shown` },
    {
      caption: 'Show only',
      chips: [
        { label: 'All episodes', active: !episodeFilter, onSelect: () => setEpisodeFilter('') },
        ...episodes.map((e) => ({
          label: shortEpisode(e),
          active: episodeFilter === e,
          onSelect: () => setEpisodeFilter(episodeFilter === e ? '' : e),
        })),
        ...(looseTakes ? [{ label: 'No episode', active: episodeFilter === 'none', onSelect: () => setEpisodeFilter(episodeFilter === 'none' ? '' : 'none') }] : []),
      ],
    },
    {
      caption: 'Quality',
      chips: [
        { label: 'All', active: stageFilter === 'all', onSelect: () => setStageFilter('all') },
        { label: 'Finals', active: stageFilter === 'final', onSelect: () => setStageFilter('final') },
        { label: 'Drafts', active: stageFilter === 'draft', onSelect: () => setStageFilter('draft') },
      ],
    },
    {
      caption: 'Order',
      chips: SORTS.map((s) => ({ label: s.label, active: sort === s.value, onSelect: () => setSort(s.value) })),
    },
    { divider: true },
    ...(selected.size
      ? [{ label: `Clear the selection (${selected.size})`, icon: <X className="size-3.5" />, onSelect: clearSelection } as MenuEntry]
      : []),
    {
      label: `Select all ${visible.length} shown`,
      icon: <Check className="size-3.5" />,
      disabled: visible.length === 0,
      onSelect: selectAllShown,
    },
  ]

  const openPageMenu = (e: React.MouseEvent) => {
    if (isTextEntry(e.target)) return
    e.preventDefault()
    setMenu({ at: { x: e.clientX, y: e.clientY }, entries: pageMenu() })
  }

  /**
   * Right-click menu for one take: this take, or the selection it is part of.
   *
   * Only what belongs to the footage -- where it goes, whether it is picked,
   * liked, tagged, and how to get at its ids and its file. The page's own
   * filters and sort are not here; they are on the page (pageMenu above).
   *
   * `on` is what the menu acts on, which is not always what was right-clicked:
   * a right-click inside the selection acts on the selection, and one outside it
   * takes the selection over to that card first, the way a file list does. The
   * menu that then opens says which, so it is never a guess.
   */
  const menuFor = (t: GalleryTake, at: { x: number; y: number }, on: GalleryTake[], sel: Set<string>): MenuEntry[] => {
    const many = on.length > 1
    const shots = shotsOf(on)
    const waiting = [...new Set(on.filter((x) => pendingMoves[x.target]).map((x) => x.target))]
    // `sel` is the selection as it will be once this menu is open, which is not
    // always `selected`: right-clicking outside the selection takes it over.
    return [
    { heading: many ? `${on.length} selected` : `${t.title} · ${t.where}` },
    ...assignEntry(at, shots, waiting, many ? [] : t.episode ? [t.episode] : []),
    {
      label: sel.has(t.decisionId) ? 'Unselect' : 'Select',
      icon: <Check className="size-3.5" />,
      onSelect: () => pick(t.decisionId, false),
    },
    ...(sel.size
      ? [{ label: `Clear the selection (${sel.size})`, icon: <X className="size-3.5" />, onSelect: clearSelection } as MenuEntry]
      : []),
    { divider: true },
    {
      label: liked.has(t.decisionId) ? 'Unlike' : 'Like',
      icon: <Heart className={cn('size-3.5', liked.has(t.decisionId) && 'fill-current')} />,
      onSelect: () => toggleLike(t.decisionId),
    },
    ...(suggestions.length
      ? [{
          caption: 'Tags',
          chips: suggestions.map((tag) => {
            const on = (tags[t.decisionId] ?? []).some((x) => tagKey(x) === tagKey(tag))
            return { label: tag, active: on, onSelect: () => (on ? removeTag(t.decisionId, tag) : addTag(t.decisionId, tag)) }
          }),
        } as MenuEntry]
      : []),
    { divider: true },
    { label: 'Copy the shot id', icon: <Copy className="size-3.5" />, onSelect: () => void copy(t.target) },
    { label: 'Copy the job id', icon: <Copy className="size-3.5" />, onSelect: () => void copy(t.jobId) },
    { label: 'Show in folder', icon: <FolderOpen className="size-3.5" />, disabled: !t.file, onSelect: () => t.file && reveal(t.file) },
    ]
  }
  const openMenu = (e: React.MouseEvent, t: GalleryTake) => {
    // The tag box is a text field; the browser's own menu is the useful one there.
    if (isTextEntry(e.target)) return
    e.preventDefault()
    e.stopPropagation()
    const at = { x: e.clientX, y: e.clientY }
    const inSelection = selected.has(t.decisionId)
    // Right-clicking something outside the selection makes it the selection,
    // the way a file list does, so the menu never acts on cards out of sight.
    // Nothing picked at all stays nothing picked: a right-click is a look at
    // what this card offers, not always a pick.
    const sel = inSelection || selected.size === 0 ? selected : new Set([t.decisionId])
    if (!inSelection && selected.size) { setSelected(sel); lastPicked.current = t.decisionId }
    const on = sel.size > 1 ? takes.filter((x) => sel.has(x.decisionId)) : [t]
    setMenu({ at, entries: menuFor(t, at, on, sel) })
  }

  /** Escape drops the selection; ctrl/cmd-A takes everything on the page. */
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (isTextEntry(e.target)) return
      if (e.key === 'Escape' && selected.size) { setSelected(new Set()); lastPicked.current = null; return }
      if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setSelected(new Set(visible.map((t) => t.decisionId)))
        lastPicked.current = visible[0]?.decisionId ?? null
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [selected.size, visible])

  return (
    // The page's own menu, anywhere that is not a card: a card stops the event,
    // so a right-click on footage is about the footage and a right-click on the
    // bar, a heading or the space between cards is about the page.
    <div className="space-y-8" onContextMenu={openPageMenu}>
      <PageHeader
        title="Gallery"
        eyebrow="Accepted work"
        meta={`${takes.length} accepted · ${liked.size} liked`}
      >
        Everything you have accepted, arranged how you like it. Like the ones worth keeping, group them with
        tags, and drag them into the order you want to watch them in. An approved{' '}
        <span className="font-mono text-[13px] text-fg">draft</span> sits here too, badged, until its final renders.
      </PageHeader>

      <div className="bleed-x sticky top-0 z-20 space-y-3 border-b border-edge bg-ink/90 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search shots, notes, tags"
              className="pl-8"
              dir="auto"
              aria-label="Search accepted takes"
            />
          </div>

          <button
            type="button"
            aria-pressed={likedOnly}
            onClick={() => setLikedOnly((v) => !v)}
            className={cn(
              'focus-ring inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-[13px] transition',
              likedOnly ? 'border-accent bg-accent/8 text-fg' : 'border-edge text-muted hover:border-edge-strong',
            )}
          >
            <Heart aria-hidden className={cn('size-3.5', likedOnly && 'fill-current')} /> Liked
          </button>

          {(episodes.length > 1 || (episodes.length === 1 && looseTakes)) && (
            <Select value={episodeFilter} onChange={(e) => setEpisodeFilter(e.target.value)} className="h-9 w-auto" aria-label="Episode">
              <option value="">All episodes</option>
              {episodes.map((e) => <option key={e} value={e}>{episodeLabel(e, episodeTitles)}</option>)}
              {looseTakes && <option value="none">{NO_EPISODE_LABEL}</option>}
            </Select>
          )}

          <Select value={stageFilter} onChange={(e) => setStageFilter(e.target.value as typeof stageFilter)} className="h-9 w-auto" aria-label="Quality">
            <option value="all">All qualities</option>
            <option value="final">Finals only</option>
            <option value="draft">Approved drafts</option>
          </Select>

          <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-9 w-auto" aria-label="Sort">
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
        </div>

        {suggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {suggestions.map((t) => {
              const on = tagFilter != null && tagKey(t) === tagKey(tagFilter)
              return (
                <button
                  key={tagKey(t)}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setTagFilter(on ? null : t)}
                  className={cn(
                    'focus-ring h-6 cursor-pointer rounded-full border px-2.5 text-[11.5px] transition',
                    on ? 'border-accent bg-accent/8 text-fg' : 'border-edge text-muted hover:border-edge-strong',
                  )}
                >
                  {t}
                </button>
              )
            })}
            {tagFilter && (
              <button type="button" onClick={() => setTagFilter(null)} className="focus-ring h-6 cursor-pointer rounded-full px-2 text-[11.5px] text-faint hover:text-fg">
                clear
              </button>
            )}
          </div>
        )}

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-accent/40 bg-accent/[0.06] px-3 py-2 text-[13px]">
            <span className="text-fg">
              {selected.size} selected
              {selectedShots.length > 0 && selectedShots.length !== selected.size && (
                <span className="text-faint"> · {selectedShots.length} shot{selectedShots.length === 1 ? '' : 's'}</span>
              )}
              {hiddenPicked > 0 && <span className="text-faint"> · {hiddenPicked} hidden by the filters</span>}
            </span>
            {selectedShots.length > 0 ? (
              <button
                type="button"
                onClick={(e) => {
                  const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  openPicker({ x: box.left, y: box.bottom + 6 }, selectedShots, [])
                }}
                className="focus-ring inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-edge-strong px-2.5 text-[12px] text-muted transition hover:border-muted hover:text-fg"
              >
                <Film aria-hidden className="size-3.5" />
                Move to an episode…
              </button>
            ) : (
              <span className="text-faint">
                {selectedTakes.some((t) => pendingMoves[t.target])
                  ? 'These are already on their way to another episode.'
                  : 'Nothing picked is footage, so there is no episode to move it to.'}
              </span>
            )}
            <button
              type="button"
              onClick={selectAllShown}
              className="focus-ring ml-auto h-7 cursor-pointer px-1 text-[12px] text-muted underline-offset-2 hover:text-fg hover:underline"
            >
              Select all {visible.length} shown
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className="focus-ring h-7 cursor-pointer px-1 text-[12px] text-muted underline-offset-2 hover:text-fg hover:underline"
            >
              Clear
            </button>
          </div>
        )}

        <MoveErrors errors={moveErrors} />

        {error && <p className="rounded-md border border-bad/35 bg-bad/8 px-3 py-2 text-xs text-bad">{error}</p>}
      </div>

      {draggable && visible.length > 1 && (
        <p className="text-xs text-faint">Drag a card by its handle to arrange it. The order is saved as you drop.</p>
      )}

      {visible.length === 0 ? (
        <EmptyState>
          {takes.length === 0
            ? 'Nothing accepted yet. Takes you accept on Review land here.'
            : 'No accepted take matches those filters.'}
        </EmptyState>
      ) : (
        <div className="space-y-12">
          {sections.map((section) => (
            <section key={section.episode ?? 'none'}>
              {headed && (
                <SectionHeading count={section.items.length}>
                  {section.episode ? episodeLabel(section.episode, episodeTitles) : NO_EPISODE_LABEL}
                </SectionHeading>
              )}
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {section.items.map((t) => (
                  <TakeCard
                    key={t.decisionId}
                    take={t}
                    liked={liked.has(t.decisionId)}
                    tags={tags[t.decisionId] ?? []}
                    suggestions={suggestions}
                    draggable={draggable}
                    onToggleLike={() => toggleLike(t.decisionId)}
                    onAddTag={(raw) => addTag(t.decisionId, raw)}
                    onRemoveTag={(tag) => removeTag(t.decisionId, tag)}
                    onDragStart={() => { dragging.current = t.decisionId }}
                    onDragOver={() => onDragOver(t.decisionId)}
                    onDrop={onDrop}
                    onContextMenu={(e) => openMenu(e, t)}
                    selected={selected.has(t.decisionId)}
                    movingTo={pendingMoves[t.target] ?? null}
                    onPick={(shift) => pick(t.decisionId, shift)}
                    catalog={catalog}
                    cfg={cfg}
                    prices={prices}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <ContextMenu at={menu?.at ?? null} entries={menu?.entries ?? []} onClose={() => setMenu(null)} />
      <EpisodePicker
        at={picking?.at ?? null}
        title={picking?.label ?? ''}
        episodes={allEpisodes}
        next={nextEpisode}
        exclude={picking?.from ?? []}
        onPick={(choice) => { if (picking) assign(picking.shots, choice) }}
        onClose={() => setPicking(null)}
      />
      {note && <MenuNote text={note.text} bad={note.bad} />}
    </div>
  )
}

function TakeCard({
  take, liked, tags, suggestions, draggable, onToggleLike, onAddTag, onRemoveTag,
  onDragStart, onDragOver, onDrop, onContextMenu, selected, movingTo, onPick, catalog, cfg, prices,
}: {
  take: GalleryTake
  liked: boolean
  tags: string[]
  suggestions: string[]
  draggable: boolean
  onToggleLike: () => void
  onAddTag: (raw: string) => void
  onRemoveTag: (tag: string) => void
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
  onContextMenu: (e: React.MouseEvent) => void
  selected: boolean
  /** The episode the worker has been asked to move this shot to, and has not yet. */
  movingTo: string | null
  onPick: (shift: boolean) => void
  catalog: CatalogEntity[]
  cfg: RegenerateConfig
  prices: Record<string, number>
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const approvedDraft = take.stage === 'draft'
  const listId = `tags-${take.decisionId}`

  function commit() {
    onAddTag(draft)
    setDraft('')
    setAdding(false)
  }

  return (
    <Card
      interactive
      className={cn('flex flex-col gap-3.5 p-4', selected && 'border-accent ring-1 ring-accent/40')}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={(e: React.DragEvent) => { if (draggable) { e.preventDefault(); onDragOver() } }}
      onDragEnd={onDrop}
      onDrop={(e: React.DragEvent) => { e.preventDefault(); onDrop() }}
      onContextMenu={onContextMenu}
    >
      <div className="relative">
        {take.file ? (
          <TakeMedia file={take.file} alt={take.title} />
        ) : (
          <div className="grid aspect-video w-full place-items-center rounded-lg border border-dashed border-edge-strong p-4 text-center text-[13px] text-muted">
            {take.missing}
          </div>
        )}
        <button
          type="button"
          aria-pressed={selected}
          aria-label={selected ? `Unselect ${take.title}` : `Select ${take.title}`}
          title="Click to select; shift-click to select a run of them"
          onClick={(e) => onPick(e.shiftKey)}
          className={cn(
            'focus-ring absolute top-2 left-2 grid size-6 cursor-pointer place-items-center rounded-md border backdrop-blur transition',
            selected ? 'border-accent bg-accent text-ink' : 'border-edge-strong bg-ink/70 text-transparent hover:text-muted',
          )}
        >
          <Check aria-hidden className="size-3.5" />
        </button>
      </div>

      <div className="flex items-start gap-2">
        {draggable && (
          <span className="mt-0.5 cursor-grab text-faint active:cursor-grabbing" aria-hidden title="Drag to arrange">
            <GripVertical className="size-4" />
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-display text-lg leading-none text-fg">{take.title}</span>
            <span className="font-mono text-[11px] text-muted">{take.where}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={approvedDraft ? 'muted' : 'good'}>{approvedDraft ? 'draft approved' : 'final'}</Badge>
            {take.attempt > 1 && <Badge tone="muted">attempt {take.attempt}</Badge>}
            {take.status === 'waiting' && <Badge tone="accent">waiting for the worker</Badge>}
            {take.status === 'failed' && <Badge tone="bad">not applied</Badge>}
            {movingTo && <Badge tone="accent">moving to {shortEpisode(movingTo)}</Badge>}
            <span suppressHydrationWarning className="ml-auto font-mono text-[10.5px] text-faint tabular-nums">{when(take.ts)}</span>
          </div>
        </div>
        <button
          type="button"
          aria-pressed={liked}
          aria-label={liked ? `Unlike ${take.title}` : `Like ${take.title}`}
          onClick={onToggleLike}
          className={cn(
            'focus-ring grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg border transition',
            liked ? 'border-accent bg-accent/8 text-fg' : 'border-edge text-muted hover:border-edge-strong hover:text-fg',
          )}
        >
          <Heart aria-hidden className={cn('size-6', liked && 'fill-current')} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <span key={tagKey(t)} className="inline-flex h-6 items-center gap-1 rounded-full border border-edge-strong pr-1 pl-2.5 text-[11.5px] text-fg">
            {t}
            <button
              type="button"
              aria-label={`Remove tag ${t}`}
              onClick={() => onRemoveTag(t)}
              className="focus-ring grid size-4 cursor-pointer place-items-center rounded-full text-muted hover:text-fg"
            >
              <X aria-hidden className="size-2.5" />
            </button>
          </span>
        ))}
        {adding ? (
          <>
            <Input
              autoFocus
              list={listId}
              value={draft}
              maxLength={MAX_TAG_LENGTH}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commit() }
                if (e.key === 'Escape') { setDraft(''); setAdding(false) }
              }}
              placeholder="Tag or collection"
              className="h-6 w-40 px-2 text-[11.5px]"
              dir="auto"
              aria-label={`Add a tag to ${take.title}`}
            />
            <datalist id={listId}>
              {suggestions.map((s) => <option key={tagKey(s)} value={s} />)}
            </datalist>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="focus-ring inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border border-dashed border-edge-strong px-2.5 text-[11.5px] text-muted hover:text-fg"
          >
            <Plus aria-hidden className="size-3" /> Tag
          </button>
        )}
      </div>

      {take.notes && (
        <p className="line-clamp-3 text-[12.5px] leading-relaxed text-fg/80" dir="auto" title={take.notes}>
          {take.notes}
        </p>
      )}

      <div className="mt-auto space-y-2.5">
        {take.file && <ShowInFolder path={take.file} />}
        {take.canRegenerate && (
          <RegenerateButton
            jobId={take.jobId}
            decisionId={take.decisionId}
            credits={take.credits}
            source={take.source}
            catalog={catalog}
            cfg={cfg}
            regenerations={take.regenerations}
            prices={prices}
          />
        )}
      </div>
    </Card>
  )
}

