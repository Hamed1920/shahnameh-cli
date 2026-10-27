// A short readable line for an audit row's detail JSON. Pure.

const MAX = 140

function show(v: unknown): string {
  if (v === null || v === undefined) return '-'
  if (typeof v === 'string') return v.length > 40 ? `${v.slice(0, 40)}...` : v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `[${v.map(show).join(', ')}]`
  try { return JSON.stringify(v) } catch { return String(v) }
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

/** `{before:{a:1}, after:{a:2}}` reads "a: 1 -> 2"; any other object reads "key: value, ...". Capped. */
export function formatDetail(detail: unknown): string {
  if (detail === null || detail === undefined) return ''
  let out: string
  if (!isObj(detail)) {
    out = show(detail)
  } else {
    const b = detail.before
    const a = detail.after
    const parts: string[] = []
    if ('before' in detail && 'after' in detail) {
      if (isObj(b) && isObj(a)) {
        for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
          if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) parts.push(`${k}: ${show(b[k])} -> ${show(a[k])}`)
        }
      } else {
        parts.push(`${show(b)} -> ${show(a)}`)
      }
    }
    for (const [k, v] of Object.entries(detail)) {
      if (k === 'before' || k === 'after') continue
      parts.push(`${k}: ${show(v)}`)
    }
    out = parts.join(', ')
  }
  return out.length > MAX ? `${out.slice(0, MAX - 3)}...` : out
}
