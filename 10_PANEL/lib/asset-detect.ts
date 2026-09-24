import { suggestRefs } from './ref-suggest.ts'
import type { CatalogEntity } from './types.ts'

/**
 * What a prompt is about, as things to put a picture of in front of the model:
 * this character, that location, a staff. The Prompts page turns each one into
 * a slot under Characters / Locations / Props, so references land where they
 * belong instead of in one pile.
 *
 * A detector only proposes. Nothing is attached, numbered or created from what
 * it says; a slot is a guide and the row can ignore it.
 *
 * Today the one detector reads words (keywordDetector, over lib/ref-suggest.ts),
 * so it only knows things already in the index. The interface is async and
 * carries `proposal` so a model-backed detector (docs/VISION-BATCH-ADD.md,
 * "Prompt asset extraction") can be dropped in later and also name things the
 * script mentions that the index does not have yet. Picking one is the
 * `detector` key in worker/config.json; an unknown or failing detector falls
 * back to keywords.
 */

export interface DetectedAsset {
  kind: string
  /** Short id of the index entity it is, when known. */
  entity: string | null
  /** The look to attach: a recent job's, else the main look. Null when the entity has no image yet. */
  token: string | null
  /** A thing the index does not have yet (a model-backed detector only). */
  proposal: { name: string; description?: string } | null
  /** Several entities could be meant ("staff"): pick one. */
  candidates: string[]
  /** The words that led here. */
  matched: string | null
}

export interface DetectContext {
  catalog: CatalogEntity[]
  /** Reference tokens from the latest queued jobs, newest first. */
  recent: string[]
}

export interface AssetDetector {
  id: string
  detect(prompt: string, ctx: DetectContext): Promise<DetectedAsset[]>
}

const idOf = (token: string) => token.replace(/^@/, '').split('/')[0]

/** Words only, synchronous underneath: cheap enough to run on every keystroke. */
export function detectByKeywords(prompt: string, ctx: DetectContext): DetectedAsset[] {
  if (!prompt.trim()) return []
  const s = suggestRefs(prompt, ctx.catalog, [], ctx.recent, { requireLook: false })
  const out: DetectedAsset[] = []
  for (const f of s.found) {
    out.push({
      kind: f.entity.kind,
      entity: f.entity.shortId,
      // A bare @CHR-001 with no look means there is nothing to send yet: an empty slot to fill or create.
      token: f.entity.variants.length ? f.token : null,
      proposal: null,
      candidates: [],
      matched: f.matched,
    })
  }
  for (const g of s.groups) {
    const kinds = [...new Set(g.options.map((o) => o.entity.kind))]
    out.push({
      kind: kinds.length === 1 ? kinds[0] : 'REF',
      entity: null,
      token: null,
      proposal: null,
      candidates: g.options.filter((o) => o.entity.variants.length).map((o) => o.token),
      matched: g.word,
    })
  }
  return out.filter((a) => a.entity || a.candidates.length)
}

export const keywordDetector: AssetDetector = {
  id: 'keyword',
  detect: async (prompt, ctx) => detectByKeywords(prompt, ctx),
}

const DETECTORS: Record<string, AssetDetector> = { keyword: keywordDetector }

/** Add a detector (a later Claude pass registers itself here). */
export function registerDetector(d: AssetDetector) {
  DETECTORS[d.id] = d
}

export function detectorFor(id: string | null | undefined): AssetDetector {
  return DETECTORS[String(id ?? '')] ?? keywordDetector
}

/** Run a detector, falling back to keywords when it throws: a detector is a help, never a gate. */
export async function detectAssets(prompt: string, ctx: DetectContext, id?: string | null): Promise<DetectedAsset[]> {
  const d = detectorFor(id)
  if (d === keywordDetector) return detectByKeywords(prompt, ctx)
  try { return await d.detect(prompt, ctx) } catch { return detectByKeywords(prompt, ctx) }
}

/** The entity a token names, by short id. */
export const tokenEntity = (token: string) => idOf(token)
