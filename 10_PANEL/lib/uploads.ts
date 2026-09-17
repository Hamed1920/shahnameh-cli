import path from 'node:path'
import {
  KINDS, MAX_UPLOAD_BYTES, MAX_UPLOADS, UPLOAD_EXT, UPLOAD_ROLES, entitySlug, isAscii,
} from '@/lib/indexing'
import { toRelative } from '@/lib/paths'
import type { Project } from '@/lib/projects'
import { getEntities } from '@/lib/store'
import type { ReviewUpload } from '@/lib/types'

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

/** Validate every upload against the index. Nothing is written until all pass. */
export async function readUploads(pr: Project, formData: FormData, decisionId: string): Promise<PendingUpload[]> {
  const raw = parseJsonArray(formData, 'uploads') ?? []
  if (raw.length > MAX_UPLOADS) throw new Invalid(`At most ${MAX_UPLOADS} uploads per decision.`)
  if (raw.length === 0) return []

  const entities = await getEntities(pr)
  const slugs = new Set<string>()
  const ids = new Set<string>()
  const out: PendingUpload[] = []

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

    if (u.mode === 'variant') {
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
        throw new Invalid(`${label}: two uploads propose the same new entity '${slug}'.`)
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

