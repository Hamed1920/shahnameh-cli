'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { GripVertical, Heart, Plus, Search, X } from 'lucide-react'
import { RegenerateButton, type RegenerateConfig } from '@/components/regenerate-button'
import { ShowInFolder } from '@/components/show-in-folder'
import { Card, EmptyState } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/field'
import { Badge, PageHeader } from '@/components/ui/text'
import { assetUrl, isVideo as isVideoFile } from '@/lib/asset'
import { cn } from '@/lib/cn'
import { MAX_TAG_LENGTH, cleanTag, moveWithin, tagKey, type GalleryState } from '@/lib/gallery'
import type { CatalogEntity, RegenerateSource, RegenerationView } from '@/lib/types'
import { setLike, setOrder, setTag } from './actions'

/** One accepted take, flattened by the page so this component touches no disk types. */
export interface GalleryTake {
  decisionId: string
  jobId: string
  title: string
  where: string
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
  { value: 'order', label: 'My order' },
  { value: 'newest', label: 'Newest first' },
  { value: 'scene', label: 'Scene order' },
  { value: 'liked', label: 'Liked first' },
]

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * A take's picture.
 *
 * A video mounts only once its card comes near the viewport, and then asks for
 * metadata with a `#t=0.1` fragment so the browser seeks a tenth of a second in
 * and paints that frame as the poster. `preload="none"` costs nothing but shows
 * a black box, and letting all ~50 takes load at once buries the server in
 * range requests before a single one is played.
 */
function Thumbnail({ file, alt }: { file: string; alt: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    const el = box.current
    if (!el || near) return
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return }
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) { setNear(true); io.disconnect() } },
      { rootMargin: '600px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [near])

  if (!isVideoFile(file)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={assetUrl(file)} alt={alt} loading="lazy" className="checker aspect-video w-full rounded-lg border border-edge object-contain" />
  }

  return (
    <div ref={box} className="aspect-video w-full overflow-hidden rounded-lg border border-edge bg-black">
      {near && (
        <video
          src={`${assetUrl(file)}#t=0.1`}
          className="size-full object-contain"
          controls loop playsInline preload="metadata"
        />
      )}
    </div>
  )
}

export function GalleryView({
  takes, state, tags: knownTags, catalog, cfg, prices,
}: {
  takes: GalleryTake[]
  state: GalleryState
  tags: string[]
  catalog: CatalogEntity[]
  cfg: RegenerateConfig
  prices: Record<string, number>
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  const [liked, setLiked] = useState(() => new Set(state.liked))
  const [tags, setTags] = useState<Record<string, string[]>>(state.tags)
  const [order, setLocalOrder] = useState<string[]>([])

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('order')
  const [likedOnly, setLikedOnly] = useState(false)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [stageFilter, setStageFilter] = useState<'all' | 'final' | 'draft'>('all')

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
    router.refresh()
  }

  function toggleLike(id: string) {
    const on = !liked.has(id)
    const before = new Set(liked)
    setLiked((s) => { const next = new Set(s); if (on) next.add(id); else next.delete(id); return next })
    void run(() => setLike(id, on), () => setLiked(before))
  }

  function addTag(id: string, raw: string) {
    const tag = cleanTag(raw)
    if (!tag) return
    const before = tags
    if ((tags[id] ?? []).some((t) => tagKey(t) === tagKey(tag))) return
    setTags((s) => ({ ...s, [id]: [...(s[id] ?? []), tag] }))
    void run(() => setTag(id, tag, true), () => setTags(before))
  }

  function removeTag(id: string, tag: string) {
    const before = tags
    setTags((s) => ({ ...s, [id]: (s[id] ?? []).filter((t) => tagKey(t) !== tagKey(tag)) }))
    void run(() => setTag(id, tag, false), () => setTags(before))
  }

  const dragging = useRef<string | null>(null)
  function onDragOver(overId: string) {
    const from = dragging.current
    if (!from || from === overId) return
    setLocalOrder((o) => moveWithin(o, from, overId))
  }
  function onDrop() {
    dragging.current = null
    const snapshot = order
    void run(() => setOrder(snapshot), () => {})
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
  }, [takes, order, query, sort, likedOnly, tagFilter, stageFilter, liked, tags])

  const draggable = sort === 'order'

  return (
    <div className="space-y-8">
      <PageHeader
        title="Gallery"
        eyebrow="Accepted work"
        meta={`${takes.length} accepted · ${liked.size} liked`}
      >
        Everything you have accepted, arranged how you like it. Like the ones worth keeping, group them with
        tags, and drag them into the order you want to watch them in. An approved{' '}
        <span className="font-mono text-[13px] text-fg">draft</span> sits here too, badged, until its final renders.
      </PageHeader>

      <div className="sticky top-0 z-20 -mx-1 space-y-3 bg-ink/85 px-1 py-3 backdrop-blur">
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
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((t) => (
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
              catalog={catalog}
              cfg={cfg}
              prices={prices}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TakeCard({
  take, liked, tags, suggestions, draggable, onToggleLike, onAddTag, onRemoveTag,
  onDragStart, onDragOver, onDrop, catalog, cfg, prices,
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
      className="flex flex-col gap-3.5 p-4"
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={(e: React.DragEvent) => { if (draggable) { e.preventDefault(); onDragOver() } }}
      onDragEnd={onDrop}
      onDrop={(e: React.DragEvent) => { e.preventDefault(); onDrop() }}
    >
      {take.file ? (
        <Thumbnail file={take.file} alt={take.title} />
      ) : (
        <div className="grid aspect-video w-full place-items-center rounded-lg border border-dashed border-edge-strong p-4 text-center text-[13px] text-muted">
          {take.missing}
        </div>
      )}

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
            <span className="ml-auto font-mono text-[10.5px] text-faint tabular-nums">{when(take.ts)}</span>
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

