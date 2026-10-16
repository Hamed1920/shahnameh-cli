/**
 * A note long enough to be a prompt, opening with a prompt heading: PLAN 08 | ..., P3, PROMPT 2.
 *
 * The worker applies the same test (worker/lib/note-shape.mjs -- keep the two in step) to a
 * denial's note, and uses such a note as the new prompt rather than as a line of fixes added
 * under the old one. The Review page uses it to say so before the decision is sent.
 */
export function looksLikeWholePrompt(text: string | null | undefined): boolean {
  const t = String(text ?? '').trim()
  return t.length >= 600 && /^(?:#{1,6}\s*)?(?:P|PLAN|PROMPT|BLOCK|پلان|پرامپت|بلاک)\s*[-–:.]?\s*[\d۰-۹]/i.test(t)
}
