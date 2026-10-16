/** A note long enough to be a prompt, opening with a prompt heading: PLAN 08 | ..., P3, PROMPT 2, BLOCK 4. */
export function looksLikeWholePrompt(text) {
  const t = String(text ?? '').trim()
  return t.length >= 600 && /^(?:#{1,6}\s*)?(?:P|PLAN|PROMPT|BLOCK|پلان|پرامپت|بلاک)\s*[-–:.]?\s*[\d۰-۹]/i.test(t)
}
