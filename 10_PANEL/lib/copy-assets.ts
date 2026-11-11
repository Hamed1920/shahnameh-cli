import path from 'node:path'
import { MAX_ADD_UPLOADS, UPLOAD_ROLES, descriptorSlug, entitySlug, isAscii } from './indexing.ts'
import type { LibraryEntity } from './types.ts'

/**
 * Planning a copy of entities from one project into another. Pure: no disk, no
 * registry. The server action (app/[project]/references/copy-actions.ts) reads
 * the files and appends the result to the target's INDEX_OPS.jsonl, and the
 * target's worker numbers, names and files everything -- this only decides what
 * to ask it for. Nothing in the source project changes.
 */

export interface CopyUpload {
  id: string
  /** Project-relative path in the SOURCE project. */
  from: string
  ext: string
  originalName: string
  mode: 'new' | 'variant'
  groupOf?: string
  kind?: string
  name?: string
  description: string
  role: string
  descriptor: string
}

export interface CopyBatch {
  uploads: CopyUpload[]
  /** Source short ids this batch carries, for the summary. */
  entities: string[]
}

export interface CopyPlan {
  batches: CopyBatch[]
  /** Source entities left out, with the reason. */
  skipped: { shortId: string; reason: string }[]
}

/** The descriptor after `_V02` (and an optional `_T03`) in a filed look's name; '' when there is none. */
export function descriptorOf(filename: string): string {
  const m = path.basename(filename, path.extname(filename)).match(/_V\d+(?:_T\d+)?_(.+)$/)
  return m ? m[1] : ''
}

function ascii(s: string, fallback: string): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t && isAscii(t) ? t : fallback
}

/**
 * `entities` are the chosen source entities, `targetSlugs` the slugs already in
 * the target. An entity the target already has (same slug) is skipped, never
 * duplicated: the same thing in two places under one name is how nobody knows
 * which is right. Retired entities, entities with no look, and names that are
 * not English (they become the registry name and the ID wording) are skipped
 * too, each with a sentence saying why.
 */
export function planCopy(entities: LibraryEntity[], targetSlugs: Set<string>, sourceCode: string): CopyPlan {
  const skipped: CopyPlan['skipped'] = []
  const batches: CopyBatch[] = []
  let current: CopyBatch = { uploads: [], entities: [] }
  const claimed = new Set<string>()

  for (const e of entities) {
    if (e.status === 'RETIRED') { skipped.push({ shortId: e.shortId, reason: 'it is retired' }); continue }
    if (e.looks.length === 0) { skipped.push({ shortId: e.shortId, reason: 'it has no look to copy' }); continue }
    if (!isAscii(e.name) || !entitySlug(e.name)) {
      skipped.push({ shortId: e.shortId, reason: 'its name is not English, so it cannot become a registry name; rename it first' })
      continue
    }
    const slug = entitySlug(e.name)
    if (targetSlugs.has(slug) || claimed.has(slug)) {
      skipped.push({ shortId: e.shortId, reason: `the target already has an entity called "${e.name}"` })
      continue
    }
    if (e.looks.length > MAX_ADD_UPLOADS) {
      skipped.push({ shortId: e.shortId, reason: `it has more than ${MAX_ADD_UPLOADS} looks` })
      continue
    }
    claimed.add(slug)

    // The main look leads (it becomes V01); the rest follow in order.
    const looks = [...e.looks].sort((a, b) => Number(b.variant === e.canonical) - Number(a.variant === e.canonical) || a.variant.localeCompare(b.variant))
    if (current.uploads.length + looks.length > MAX_ADD_UPLOADS) {
      batches.push(current)
      current = { uploads: [], entities: [] }
    }
    const description = `${ascii(e.description, e.name)} (copied from ${sourceCode} ${e.shortId})`.slice(0, 400)
    let leadId = ''
    for (const look of looks) {
      const id = `u${current.uploads.length + 1}`
      const role = (UPLOAD_ROLES as readonly string[]).includes(look.role) ? look.role : 'PLATE'
      const up: CopyUpload = {
        id,
        from: look.path,
        ext: path.extname(look.path).toLowerCase(),
        originalName: look.filename || path.basename(look.path),
        mode: leadId ? 'variant' : 'new',
        description,
        role,
        descriptor: descriptorOf(look.filename || look.path) ? descriptorSlug(descriptorOf(look.filename || look.path)) : 'copied',
      }
      if (leadId) up.groupOf = leadId
      else { up.kind = e.kind; up.name = e.name; leadId = id }
      current.uploads.push(up)
    }
    current.entities.push(e.shortId)
  }
  if (current.uploads.length) batches.push(current)
  return { batches, skipped }
}
