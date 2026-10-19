/**
 * A note long enough to be a prompt, opening the way a prompt does: a heading with or without a
 * number (PLAN 08 | ..., P3, PROMPT 2, PLAN — THE LIFT, a markdown heading), or a sentence that
 * orders a video ("Create one 15-second ..."). An ordinary long fix note in prose
 * ("The lighting is wrong ...") opens with neither and stays a note.
 * lib/note-shape.ts has the same test for the Review page -- keep the two in step.
 */
export function looksLikeWholePrompt(text) {
  const t = String(text ?? '').trim()
  if (t.length < 600) return false
  // A heading word on its own (not the start of "Planning" or "Pleasing"), then a number, a dash or colon, or the end of the line.
  const heading = /^(?:#{1,6}\s*)?(?:P|PLAN|PROMPT|BLOCK|پلان|پرامپت|بلاک)(?![\p{L}])\s*(?:[-–—:.|]|[\d۰-۹]|$|\r?\n)/iu
  const order = /^(?:create|generate|make|produce|render)\s+(?:one|a|an|the)\s/i
  return heading.test(t) || order.test(t) || /^#{1,6}\s+\S/.test(t)
}

/** The line that opens the revision section of a prompt. buildPrompt (prompt.mjs) uses it too. */
export function revisionHeading(count) {
  return count > 1
    ? 'Revision — earlier attempts were rejected for these reasons, oldest first. Fix all of them; where two notes disagree, the later note wins:'
    : 'Revision — the previous attempt was rejected for these reasons. Fix them:'
}

/**
 * The prompt as one text with its revision notes under it, laid out the way buildPrompt writes that
 * section, but without the approved learnings. What an attempt was actually told, short of the rules
 * added after the fact: what Copy prompt copies and what "Continue from here" starts from.
 */
export function withRevisionNotes(base, revisionNotes) {
  const body = String(base ?? '').trim()
  const notes = (revisionNotes ?? []).map((n) => String(n ?? '').trim()).filter(Boolean)
  if (!notes.length) return body
  return [body, '', revisionHeading(notes.length), ...notes.map((n) => `- ${n}`)].join('\n')
}
