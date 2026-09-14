import { resolveRef } from './project.mjs'

/**
 * The prompt a generation actually sends: the authored text, the reviewer's
 * revision notes, approved learnings, and a key to the attached images.
 *
 * Kept apart from worker.mjs so it can be exercised against real queued jobs
 * without starting the worker (and without spending anything).
 */

/**
 * @-mentions of references, as written in notes and prompts. Mirrors
 * MENTION_RX in lib/mentions.ts (upload placeholders are swapped for real
 * tokens before a job is queued, so only index tokens reach this point).
 */
const MENTION_RX = /@((?:CHR|GRP|LOC|PRP|CRT|COS|VEH|FX|REF)-\d{3}(?:\/V\d{2}(?:\/T\d{2})?)?)(?![\w/-])/g
export const REF_KEY_HEADING = 'Reference images, in the order they are attached:'

/**
 * Authored blocks end with "DESIGN NOTE — no reference image exists for these
 * yet, build them from the description above ...". That was true when the
 * block was written, but a review can attach an image of exactly one of those
 * things (the Iranian flag, PRP-016). Left as is, the prompt tells the model
 * to invent what the attached image already shows.
 */
const DESIGN_NOTE_RX = /no reference image exists for these yet, build them from the description above/

/**
 * Seedance receives references as an ordered list of images plus a prompt; a
 * bare "@LOC-007" means nothing to it. Rewrite every mention to the attached
 * image's position AND its name, so the model can tie the words to the picture
 * whichever way it reads them. `refs` is [{ path, entity, variant }] in
 * attachment order.
 */
async function annotateMentions(text, refs, entities, assets) {
  const src = String(text ?? '')
  const matches = [...src.matchAll(MENTION_RX)]
  if (matches.length === 0) return { text: src, used: false }
  let out = ''
  let last = 0
  for (const m of matches) {
    const r = await resolveRef(m[1], entities, assets)
    let label = m[0]
    if (r.ok) {
      const name = `${r.entity.short_id} ${r.variant}, ${r.entity.name}`
      const at = refs.findIndex((x) => x.path === r.path)
      label = at >= 0 ? `@Image${at + 1} (${name})` : name
    }
    out += src.slice(last, m.index) + label
    last = m.index + m[0].length
  }
  return { text: out + src.slice(last), used: true }
}

/** Returns { prompt, mentioned }. */
export async function buildPrompt(base, learnings, revisionNotes, refs, entities, assets) {
  let mentioned = false
  const annotate = async (s) => {
    const a = await annotateMentions(s, refs, entities, assets)
    mentioned ||= a.used
    return a.text
  }

  let body = (await annotate(base)).trim()
  if (refs.length) {
    body = body.replace(
      DESIGN_NOTE_RX,
      'no reference image was planned for these, so build them from the description above (but if the reference key at the end names an attached image of one of them, match that image instead)',
    )
  }
  const parts = [body]

  if (revisionNotes?.length) {
    parts.push(
      '',
      revisionNotes.length > 1
        ? 'Revision — earlier attempts were rejected for these reasons, oldest first. Fix all of them; where two notes disagree, the later note wins:'
        : 'Revision — the previous attempt was rejected for these reasons. Fix them:',
    )
    for (const n of revisionNotes) parts.push(`- ${await annotate(n)}`)
  }
  if (learnings.length) {
    parts.push('', 'Established requirements for this subject:')
    for (const l of learnings) parts.push(`- ${await annotate(l)}`)
  }

  // Always, not only when a note mentions one: an image the text never names is
  // an image the model is free to ignore. A reference added in review with a
  // note like "use the new flag photo" has no mention to hang a key on.
  if (refs.length) {
    parts.push(
      '',
      REF_KEY_HEADING,
      ...refs.map((r, i) => `- @Image${i + 1}: ${r.entity.short_id} ${r.variant}, ${r.entity.name}`),
      'Each attached image is binding. Wherever its subject appears, match the image exactly, even where the text above describes it differently.',
    )
  }
  return { prompt: parts.join('\n'), mentioned }
}
