import path from 'node:path'
import {
  FOOTAGE_EXT, KINDS, MAX_FOOTAGE, MAX_FOOTAGE_BYTES, MAX_UPLOAD_BYTES, MAX_UPLOADS, UPLOAD_EXT, UPLOAD_ROLES,
  entitySlug, isAscii,
} from '@/lib/indexing'
import { toRelative } from '@/lib/paths'
import type { Project } from '@/lib/projects'
import { getEntities } from '@/lib/store'
import type { FootageUpload, ReviewUpload } from '@/lib/types'

/**
 * Validating reviewer uploads, shared by the Review page's decisions and the
 * References page's "add". Server-only and not a 'use server' module: these
 * helpers must never become callable endpoints of their own.
 */

/** A reviewer-fixable problem. Anything else is a bug and is allowed to throw. */
export class Invalid extends Error {}

export function parseJsonArray(formData: FormData, name: string): unknown[] | null {
  const raw = formData.get(name)
  if (raw == null || raw === '') return null
  try {
    const v = JSON.parse(String(raw))
    if (!Array.isArray(v)) throw new Error()
    return v
  } catch {
    throw new Invalid(`Malformed ${name}.`)
  }
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** The extension says image; the first bytes have to agree. */
function sniffImage(buf: Buffer): '.png' | '.jpg' | '.webp' | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_MAGIC)) return '.png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg'
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return '.webp'
  }
  return null
}

export interface PendingUpload {
  meta: ReviewUpload
  bytes: Buffer
}

/**
 * Validate every upload against the index. Nothing is written until all pass.
 *
 * `max` and `allowGroups` are what separate a Review decision (a handful of
 * images beside a note) from a References batch add (a folder of them, where
 * several files may be looks of one new thing). The worker checks all of this
 * again in worker/lib/promote.mjs before anything is filed.
 */
export async function readUploads(
  pr: Project,
  formData: FormData,
  decisionId: string,
  { max = MAX_UPLOADS, maxTotalBytes = 0, allowGroups = false } = {},
): Promise<PendingUpload[]> {
  const raw = parseJsonArray(formData, 'uploads') ?? []
  if (raw.length > max) {
    throw new Invalid(allowGroups ? `At most ${max} images at a time.` : `At most ${max} uploads per decision.`)
  }
  if (raw.length === 0) return []

  const entities = await getEntities(pr)
  const slugs = new Set<string>()
  const ids = new Set<string>()
  const out: PendingUpload[] = []
  let total = 0

  for (const item of raw) {
    const u = (item ?? {}) as Record<string, unknown>
    const id = String(u.id ?? '')
    const label = `Upload ${out.length + 1}`
    if (!/^u\d{1,3}$/.test(id) || ids.has(id)) throw new Invalid(`${label}: bad id.`)
    ids.add(id)

    const file = formData.get(`file:${id}`)
    if (!(file instanceof File) || file.size === 0) {
      throw new Invalid(`${label}: the image did not arrive. Pick it again.`)
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Invalid(`${label}: larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`)
    }
    total += file.size
    if (maxTotalBytes && total > maxTotalBytes) {
      // The whole multipart body has a hard ceiling (next.config.ts). Past it
      // Next refuses the action with nothing useful to show, and the drop is
      // lost -- so say it here, while the dialog can still act on it.
      throw new Invalid(
        `That is more than ${Math.round(maxTotalBytes / 1024 / 1024)} MB in all. Take a few out and add them in a second batch.`,
      )
    }
    const ext = path.extname(file.name).toLowerCase()
    if (!(UPLOAD_EXT as readonly string[]).includes(ext)) {
      throw new Invalid(`${label}: only PNG, JPG or WEBP images.`)
    }
    const bytes = Buffer.from(await file.arrayBuffer())
    const sniffed = sniffImage(bytes)
    if (!sniffed) throw new Invalid(`${label}: that file is not a PNG, JPG or WEBP image.`)

    const role = String(u.role ?? '')
    if (!(UPLOAD_ROLES as readonly string[]).includes(role)) {
      throw new Invalid(`${label}: choose a role.`)
    }
    const descriptor = String(u.descriptor ?? '').trim()
    if (!descriptor) throw new Invalid(`${label}: add a short English description.`)
    if (!isAscii(descriptor)) {
      throw new Invalid(`${label}: the description becomes the filename, so it must be English.`)
    }

    const meta: ReviewUpload = {
      id,
      file: toRelative(pr.root, path.join(pr.P.uploads, decisionId, `${id}${sniffed}`)),
      originalName: file.name.slice(0, 200),
      mode: u.mode === 'new' ? 'new' : 'variant',
      role,
      descriptor,
    }

    const groupOf = String(u.groupOf ?? '')
    if (groupOf) {
      // Another look of the new entity an earlier image proposes. The panel
      // allocates nothing: the worker makes that entity and gives this its next
      // look. `out` is built in order, so finding it there is the "strictly
      // earlier" check, and a cycle cannot be written down.
      if (!allowGroups) throw new Invalid(`${label}: grouped images are not allowed here.`)
      if (u.mode !== 'variant' || u.entity) {
        throw new Invalid(`${label}: a grouped image is a new look of the new entity that ${groupOf} creates.`)
      }
      const lead = out.find((p) => p.meta.id === groupOf)
      if (!lead) throw new Invalid(`${label}: it is grouped with an image that is not earlier in this batch.`)
      if (lead.meta.mode !== 'new') throw new Invalid(`${label}: ${groupOf} is not a new entity.`)
      if (lead.meta.groupOf) throw new Invalid(`${label}: groups are one level deep.`)
      meta.groupOf = groupOf
    } else if (u.mode === 'variant') {
      const ref = String(u.entity ?? '')
      const ent = entities.find((e) => e.id === ref || e.short_id === ref)
      if (!ent) throw new Invalid(`${label}: choose which entity this is a new look of.`)
      if (ent.status === 'RETIRED') throw new Invalid(`${label}: ${ent.short_id} is retired.`)
      meta.entity = ent.id
    } else if (u.mode === 'new') {
      const kind = String(u.kind ?? '')
      if (!(KINDS as readonly string[]).includes(kind)) {
        throw new Invalid(`${label}: choose a kind for the new entity.`)
      }
      const name = String(u.name ?? '').trim()
      const description = String(u.description ?? '').trim()
      if (!name) throw new Invalid(`${label}: name the new entity.`)
      if (!isAscii(name) || !isAscii(description)) {
        throw new Invalid(
          `${label}: the entity name and description go into the registry, so they must be English.`,
        )
      }
      const slug = entitySlug(name)
      if (!slug) throw new Invalid(`${label}: the name needs at least one English letter or digit.`)
      const clash = entities.find((e) => e.slug === slug)
      if (clash) {
        throw new Invalid(
          `${label}: '${slug}' already exists as ${clash.short_id}. Attach it as a new look of ${clash.short_id} instead.`,
        )
      }
      if (slugs.has(slug)) {
        // Load-bearing: this is what makes two looks of one new thing go
        // through grouping, where the worker allocates a single number, rather
        // than through two rows that would each ask for one.
        throw new Invalid(
          `${label}: two images propose the same new entity '${slug}'. If they are two looks of one thing, group them.`,
        )
      }
      slugs.add(slug)
      Object.assign(meta, { kind, name, description: description.slice(0, 300) })
    } else {
      throw new Invalid(`${label}: choose "new look" or "new entity".`)
    }
    out.push({ meta, bytes })
  }
  return out
}


/**
 * mp4 and mov both carry an `ftyp` box near the front. Not a full container
 * parse -- just enough that a renamed .exe cannot reach the shots folder.
 */
function sniffVideo(buf: Buffer): boolean {
  return buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp'
}

export interface PendingFootage {
  meta: FootageUpload
  bytes: Buffer
}

/**
 * Footage being put into an episode by hand: a render from elsewhere, a plate,
 * a cut someone else made.
 *
 * Only the extensions the validator's shot-file grammar allows, and the bytes
 * have to agree with the extension. The scene is either `next` or one the
 * episode already uses -- a number is never read off what was typed, because
 * only the worker allocates one (CLAUDE.md).
 */
export async function readFootage(
  formData: FormData,
  pr: Project,
  opId: string,
  /** Scenes this episode already has, so "another take of SC004" can be checked here too. */
  scenes: Set<string>,
): Promise<PendingFootage[]> {
  const raw = parseJsonArray(formData, 'uploads') ?? []
  if (raw.length > MAX_FOOTAGE) throw new Invalid(`At most ${MAX_FOOTAGE} files at a time.`)
  if (raw.length === 0) return []

  const ids = new Set<string>()
  const out: PendingFootage[] = []
  for (const item of raw) {
    const u = (item ?? {}) as Record<string, unknown>
    const id = String(u.id ?? '')
    const label = `File ${out.length + 1}`
    if (!/^u\d{1,3}$/.test(id) || ids.has(id)) throw new Invalid(`${label}: bad id.`)
    ids.add(id)

    const file = formData.get(`file:${id}`)
    if (!(file instanceof File) || file.size === 0) {
      throw new Invalid(`${label}: the file did not arrive. Pick it again.`)
    }
    if (file.size > MAX_FOOTAGE_BYTES) {
      throw new Invalid(`${label}: larger than ${Math.round(MAX_FOOTAGE_BYTES / 1024 / 1024)} MB.`)
    }
    const ext = path.extname(file.name).toLowerCase()
    if (!(FOOTAGE_EXT as readonly string[]).includes(ext)) {
      throw new Invalid(`${label}: episodes hold PNG, JPG, WEBP, MP4 or MOV.`)
    }
    const bytes = Buffer.from(await file.arrayBuffer())
    const video = ext === '.mp4' || ext === '.mov'
    if (video ? !sniffVideo(bytes) : !sniffImage(bytes)) {
      throw new Invalid(`${label}: the file is not really ${ext.slice(1).toUpperCase()}.`)
    }

    const asked = String(u.scene ?? 'next').toUpperCase()
    const scene = asked === 'NEXT' ? 'next' : asked
    if (scene !== 'next' && !scenes.has(scene)) {
      throw new Invalid(`${label}: ${asked} is not a scene of this episode. File it as a new scene.`)
    }

    out.push({
      meta: {
        id,
        file: toRelative(pr.root, path.join(pr.P.uploads, opId, `${id}${ext}`)),
        originalName: file.name.slice(0, 200),
        scene,
      },
      bytes,
    })
  }
  return out
}
