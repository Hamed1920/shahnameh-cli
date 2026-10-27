/** A post-login destination: a path on this panel only. Anything else becomes '/'. */
export function safeNext(next: string | string[] | undefined): string {
  const n = Array.isArray(next) ? next[0] : next
  if (!n || !n.startsWith('/') || n.startsWith('//') || n.includes(String.fromCharCode(92))) return '/'
  return n
}
