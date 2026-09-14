/**
 * @-mentions of references inside review notes.
 *
 *   @LOC-007          canonical variant of LOC-007
 *   @LOC-007/V02      a specific look
 *   @upload:u3        an image uploaded on this same decision (not filed yet)
 *
 * Mirrors MENTION_RX in worker/worker.mjs, which turns each mention into the
 * attached image's position when it builds the prompt.
 */
import type { CatalogEntity } from './types'

export const MENTION_RX =
  /@((?:CHR|GRP|LOC|PRP|CRT|COS|VEH|FX|REF)-\d{3}(?:\/V\d{2}(?:\/T\d{2})?)?|upload:u\d{1,3})(?![\w/-])/g

/** Every distinct mention in the texts, as written (with the leading @). */
export function parseMentions(...texts: string[]): string[] {
  const out: string[] = []
  for (const text of texts) {
    for (const m of String(text ?? '').matchAll(MENTION_RX)) {
      const token = `@${m[1]}`
      if (!out.includes(token)) out.push(token)
    }
  }
  return out
}

/**
 * `SHORT/Vnn` for a token, filling the canonical variant in, so `@LOC-007` and
 * `@LOC-007/V01` compare equal when V01 is canonical. Null if not in the index.
 */
export function refKey(token: string, catalog: CatalogEntity[]): string | null {
  const [ref, variantIn] = token.replace(/^@/, '').split('/')
  const ent = catalog.find((e) => e.shortId === ref || e.id === ref)
  if (!ent) return null
  const variant = (variantIn || ent.canonical || '').toUpperCase()
  return variant ? `${ent.shortId}/${variant}` : null
}
