import { KIND_LABEL, type Kind } from './indexing.ts'
import { MENTION_RX } from './mentions.ts'
import type {
  CatalogEntity, EvidenceView, Learning, LearningView, RefView, ResolvedReference, ReviewDecision, ScopeView, TextSegment,
} from './types.ts'

/**
 * The pure half of the Learnings page's loader (lib/learnings-view.ts): given
 * the learnings, the catalog, a reference resolver and the decided takes, work
 * out what each rule shows. Kept free of the store so it runs under node --test.
 */

/** What the page needs about the take a decision was about (from lib/decided.ts). */
export interface DecidedTake {
  decision: ReviewDecision
  title: string
  where: string
  file: string | null
  missing: string | null
  notes: string
}

const kindLabel = (kind: string) => KIND_LABEL[kind as Kind] ?? kind

export function scopeOf(scope: Learning['scope'], catalog: CatalogEntity[]): ScopeView {
  if (scope.entity) {
    const ent = catalog.find((e) => e.id === scope.entity || e.shortId === scope.entity)
    if (!ent) return { level: 'entity', key: scope.entity, label: scope.entity, sublabel: 'not in the index any more', path: null }
    const look = ent.variants.find((v) => v.variant === ent.canonical) ?? ent.variants[0]
    return { level: 'entity', key: ent.id, label: ent.name, sublabel: `${ent.shortId} · ${kindLabel(ent.kind)}`, path: look?.path ?? null }
  }
  if (scope.family) return { level: 'family', key: `family:${scope.family}`, label: `The ${scope.family} family`, sublabel: 'every entity in it', path: null }
  if (scope.kind) return { level: 'kind', key: `kind:${scope.kind}`, label: `Every ${kindLabel(scope.kind).toLowerCase()}`, sublabel: scope.kind, path: null }
  return { level: 'global', key: 'global', label: 'Every prompt', sublabel: null, path: null }
}

type Resolve = (token: string) => Promise<RefView>

/** Split text at each @-reference. Upload placeholders stay text: they are not pictures in the index. */
async function segmentsOf(text: string, resolve: Resolve): Promise<TextSegment[]> {
  const out: TextSegment[] = []
  let at = 0
  for (const m of String(text ?? '').matchAll(MENTION_RX)) {
    if (m[1].startsWith('upload:')) continue
    if (m.index > at) out.push({ text: text.slice(at, m.index) })
    out.push({ ref: await resolve(`@${m[1]}`) })
    at = m.index + m[0].length
  }
  if (at < text.length) out.push({ text: text.slice(at) })
  return out
}

export async function shapeLearnings({
  learnings, catalog, resolver, decided,
}: {
  learnings: Learning[]
  catalog: CatalogEntity[]
  resolver: (token: string) => Promise<ResolvedReference>
  decided: Map<string, DecidedTake>
}): Promise<LearningView[]> {
  const memo = new Map<string, Promise<RefView>>()
  const resolve: Resolve = (token) => {
    if (!memo.has(token)) {
      memo.set(token, resolver(token).then((r) => {
        const short = token.replace(/^@/, '').split('/')[0]
        const ent = catalog.find((e) => e.shortId === short || e.id === short)
        return { token, path: r.path, name: ent?.name ?? null, kind: ent?.kind ?? null, ...(r.stale && { stale: r.stale }) }
      }))
    }
    return memo.get(token)!
  }

  return Promise.all(learnings.map(async (l): Promise<LearningView> => {
    const segments = await segmentsOf(l.rule, resolve)
    const refs: RefView[] = []
    for (const s of segments) if ('ref' in s && !refs.some((r) => r.token === s.ref.token)) refs.push(s.ref)

    const evidence = await Promise.all(l.evidence.map(async (id): Promise<EvidenceView> => {
      const e = decided.get(id)
      if (!e) {
        return { id, found: false, verdict: null, title: id, where: '', file: null, missing: 'This decision is no longer in the review log.', notes: [], notesEn: null, ts: null }
      }
      return {
        id,
        found: true,
        verdict: e.decision.verdict,
        title: e.title,
        where: e.where,
        file: e.file,
        missing: e.missing,
        notes: await segmentsOf(e.notes, resolve),
        notesEn: e.decision.notesEn ?? null,
        ts: e.decision.ts,
      }
    }))

    return {
      id: l.id,
      status: l.status,
      rule: l.rule,
      segments,
      refs,
      scope: scopeOf(l.scope, catalog),
      evidence,
      created: l.created,
      decidedAt: l.decidedAt ?? null,
    }
  }))
}
