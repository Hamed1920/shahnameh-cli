/**
 * Mentions as people read them.
 *
 * A reference is written to the worker as `@CHR-007/V02`: an id and a look. Nobody
 * keeps those in their head, so the note box shows `@Armayel (look 2)` instead and
 * turns it back into the id on the way out. The worker, the queue and every file
 * keep seeing the id; only what is on screen is the name.
 *
 *   @CHR-007         <->  @Armayel
 *   @CHR-007/V02     <->  @Armayel (look 2)
 *   @upload:u3       <->  @Upload 3
 *
 * A mention that is not one of the references attached to the job, or that names a
 * take (`/T02`), or whose name two references share, is left as the id: showing a
 * name that could mean two things would be worse than showing the id.
 */
import { MENTION_RX } from './mentions.ts'

export interface NamedOption {
  /** What the worker reads: @CHR-007/V02 or @upload:u3. */
  token: string
  /** What a person reads: Armayel, Upload 3. */
  title: string
}

/** CHR-007 or upload:u3: the part of a token that says which reference it is. */
const baseOf = (token: string) => token.replace(/^@/, '').split('/')[0]
const lookOf = (token: string) => /\/V(\d{2})(?:\/|$)/.exec(token)?.[1] ?? null

/** Names two different references share: those cannot be told apart by name. */
function ambiguousTitles(options: NamedOption[]): Set<string> {
  const seen = new Map<string, string>()
  const out = new Set<string>()
  for (const o of options) {
    const base = baseOf(o.token)
    const was = seen.get(o.title)
    if (was !== undefined && was !== base) out.add(o.title)
    seen.set(o.title, base)
  }
  return out
}

/** How one reference is written on screen: `@Armayel (look 2)`. */
export function displayOf(option: NamedOption, token = option.token): string {
  const look = lookOf(token)
  return `@${option.title}${look ? ` (look ${Number(look)})` : ''}`
}

/** The text with every attached reference's id swapped for its name. */
export function toDisplay<O extends NamedOption>(
  text: string,
  options: O[],
  sameRef: (mention: string, option: O) => boolean,
): string {
  const ambiguous = ambiguousTitles(options)
  return String(text ?? '').replace(new RegExp(MENTION_RX.source, 'g'), (whole, body: string) => {
    if (/\/T\d{2}$/.test(body)) return whole
    const token = `@${body}`
    const option = options.find((o) => sameRef(token, o))
    if (!option || !option.title || ambiguous.has(option.title)) return whole
    return displayOf(option, token)
  })
}

const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The text with every name written as `@Armayel (look 2)` swapped back for its id. */
export function toToken<O extends NamedOption>(text: string, options: O[]): string {
  const ambiguous = ambiguousTitles(options)
  const byTitle = new Map<string, string>()
  for (const o of options) if (o.title && !ambiguous.has(o.title) && !byTitle.has(o.title)) byTitle.set(o.title, baseOf(o.token))
  if (byTitle.size === 0) return String(text ?? '')
  // Longest first, so "Armayel Cook" is not read as "Armayel" followed by a word.
  const names = [...byTitle.keys()].sort((a, b) => b.length - a.length).map(escapeRx).join('|')
  const rx = new RegExp(`@(${names})(?: \\(look (\\d{1,2})\\))?(?![\\p{L}\\p{N}_])`, 'gu')
  return String(text ?? '').replace(rx, (whole, name: string, look: string | undefined) => {
    const base = byTitle.get(name)!
    if (base.startsWith('upload:')) return look ? whole : `@${base}`
    return `@${base}${look ? `/V${String(Number(look)).padStart(2, '0')}` : ''}`
  })
}
