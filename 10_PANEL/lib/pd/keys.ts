// Database keys for sequences and blocks. The same project code can exist in two projects (a copied
// folder, a leftover test project), so a row's primary key is `<project slug>:<display id>`, never
// the display id alone. People and URLs only ever see the display id (PD-S01, PD-S01-B003).
// Pure: no database.

/** The primary key of a sequence or block of this project. */
export const scopedKey = (project: string, displayId: string): string => `${project}:${displayId}`

/** The display id inside a key. A project slug never contains ":" (slugProblem), so the first one splits. */
export function displayOf(key: string): string {
  const i = key.indexOf(':')
  return i < 0 ? key : key.slice(i + 1)
}

/** The project slug a key belongs to, or null when the key has none. */
export function projectOf(key: string): string | null {
  const i = key.indexOf(':')
  return i < 0 ? null : key.slice(0, i)
}
