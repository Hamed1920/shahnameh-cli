/**
 * A note long enough to be a prompt, opening the way a prompt does: a heading with or without a
 * number (PLAN 08 | ..., P3, PROMPT 2, PLAN — THE LIFT, a markdown heading), or a sentence that
 * orders a video ("Create one 15-second ...").
 *
 * The worker applies the same test (worker/lib/note-shape.mjs -- keep the two in step) to a
 * denial's note, and uses such a note as the new prompt rather than as a line of fixes added
 * under the old one. The Review page uses it to say so before the decision is sent.
 */
export function looksLikeWholePrompt(text: string | null | undefined): boolean {
  const t = String(text ?? '').trim()
  if (t.length < 600) return false
  const heading = /^(?:#{1,6}\s*)?(?:P|PLAN|PROMPT|BLOCK|پلان|پرامپت|بلاک)(?![\p{L}])\s*(?:[-–—:.|]|[\d۰-۹]|$|\r?\n)/iu
  const order = /^(?:create|generate|make|produce|render)\s+(?:one|a|an|the)\s/i
  return heading.test(t) || order.test(t) || /^#{1,6}\s+\S/.test(t)
}
