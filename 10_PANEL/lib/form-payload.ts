/**
 * A FormData as plain JSON and back, so an action that takes a form can wait in the approvals inbox.
 * Pure. A file cannot be stored, so a form that carries one is refused (null).
 */
export type FormFields = Record<string, string[]>

export function formToFields(fd: FormData): FormFields | null {
  const out: FormFields = {}
  for (const [k, v] of fd.entries()) {
    if (typeof v !== 'string') {
      if (v.size > 0) return null
      continue
    }
    if (!out[k]) out[k] = []
    out[k].push(v)
  }
  return out
}

export function fieldsToForm(fields: FormFields): FormData {
  const fd = new FormData()
  for (const [k, vs] of Object.entries(fields)) for (const v of vs) fd.append(k, v)
  return fd
}
