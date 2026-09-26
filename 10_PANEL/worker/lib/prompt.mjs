import { findEntity, resolveRef } from './project.mjs'

/**
 * The prompt a generation actually sends: the authored text, the reviewer's
 * revision notes, approved learnings, with every reference written the way
 * Higgsfield's own panel writes it.
 *
 * Kept apart from worker.mjs so it can be exercised against real queued jobs
 * without starting the worker (and without spending anything).
 */

/**
 * @-mentions of references, as written in notes and prompts. Mirrors
 * MENTION_RX in lib/mentions.ts (upload placeholders are swapped for real
 * tokens before a job is queued, so only index tokens reach this point).
 */
export const MENTION_RX = /@((?:CHR|GRP|LOC|PRP|CRT|COS|VEH|FX|REF)-\d{3}(?:\/V\d{2}(?:\/T\d{2})?)?)(?![\w/-])/g

/**
 * How Higgsfield's panel refers to an attached image inside a prompt. When
 * you type @ there and pick an upload, the stored prompt reads `<<<image_2>>>`
 * for the second attachment, 1-based, in attachment order (captured from the
 * account's own panel-made jobs, 2026-09-15). Saved Elements become
 * `<<<uuid>>>` instead, but the CLI does not take reference_elements, so the
 * worker only ever attaches images. Writing the same token means a job re-used
 * from the panel shows its references as references, not as stray text.
 */
export const imageToken = (n) => `<<<image_${n}>>>`

/**
 * Authored blocks end with "DESIGN NOTE — no reference image exists for these
 * yet, build them from the description above ...". That was true when the
 * block was written, but a review can attach an image of exactly one of those
 * things (the Iranian flag, PRP-016). Left as is, the prompt tells the model
 * to invent what the attached image already shows.
 */
const DESIGN_NOTE_RX = /no reference image exists for these yet, build them from the description above/

/**
 * Rewrite every @-mention to the attached image's token, so the text calls the
 * picture the way the panel does. `refs` is [{ path, entity, variant }] in
 * attachment order. A mention of something that is not attached keeps its
 * name, so the sentence still reads. Returns the positions it referenced.
 */
async function annotateMentions(text, refs, entities, assets) {
  const src = String(text ?? '')
  const matches = [...src.matchAll(MENTION_RX)]
  const used = new Set()
  if (matches.length === 0) return { text: src, used }
  let out = ''
  let last = 0
  for (const m of matches) {
    const r = await resolveRef(m[1], entities, assets)
    let label = m[0]
    if (r.ok) {
      const at = refs.findIndex((x) => x.path === r.path)
      if (at >= 0) { label = imageToken(at + 1); used.add(at) }
      else label = `${r.entity.short_id} ${r.variant}, ${r.entity.name}`
    } else {
      // A look that no longer resolves (archived, or never there): its entity by
      // name, never a raw @token the model cannot look at.
      const ent = findEntity(entities, m[1].split('/')[0])
      if (ent) label = `${ent.short_id}, ${ent.name}`
    }
    out += src.slice(last, m.index) + label
    last = m.index + m[0].length
  }
  return { text: out + src.slice(last), used }
}

/**
 * Returns { prompt, mentioned }. `mentioned` is true when any text called an attached image.
 *
 * With `frames`, the model takes its images as a start (and end) frame, not a
 * reference list (Kling, Veo, Wan 2.7): it has no `<<<image_N>>>` to point at, so
 * mentions keep their names and one sentence says what the frame shows.
 */
export async function buildPrompt(base, learnings, revisionNotes, refs, entities, assets, { frames = false } = {}) {
  const used = new Set()
  const annotate = async (s) => {
    const a = await annotateMentions(s, frames ? [] : refs, entities, assets)
    for (const i of a.used) used.add(i)
    return a.text
  }

  let body = (await annotate(base)).trim()
  if (refs.length) {
    body = body.replace(
      DESIGN_NOTE_RX,
      'no reference image was planned for these, so build them from the description above (but if one of them is called with an attached image in this prompt, match that image instead)',
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

  // An attached image the text never calls is one the model is free to ignore
  // (a reference added in review with a note like "use the new flag photo"
  // has no mention to hang a token on). Each such image gets one plain
  // sentence naming what it is, and nothing more: no list, no heading.
  if (frames && refs.length) {
    parts.push('')
    refs.forEach((r, i) => parts.push(r.entity
      ? `The attached ${i === 0 ? 'start' : 'end'} frame shows ${r.entity.name} (${r.entity.short_id} ${r.variant}).`
      : `Start from the attached ${i === 0 ? 'start' : 'end'} frame.`))
    return { prompt: parts.join('\n'), mentioned: false }
  }
  const unmentioned = refs.map((r, i) => ({ r, i })).filter(({ i }) => !used.has(i))
  if (unmentioned.length) {
    parts.push('')
    for (const { r, i } of unmentioned) {
      parts.push(r.entity
        ? `${imageToken(i + 1)} is ${r.entity.name} (${r.entity.short_id} ${r.variant}); match it wherever ${r.entity.name} appears.`
        : `${imageToken(i + 1)} is ${r.label ?? 'a reference picture'}; follow it.`)
    }
  }
  return { prompt: parts.join('\n'), mentioned: used.size > 0 }
}
