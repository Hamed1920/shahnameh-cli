'use server'

import fs from 'node:fs/promises'
import path from 'node:path'
import { revalidatePath } from 'next/cache'
import { entitySlug, isAscii } from '@/lib/indexing'
import { requireProject } from '@/lib/projects'
import { getAssets, getEntities } from '@/lib/store'
import { Invalid, readUploads } from '@/lib/uploads'
import type { Entity, IndexOpType } from '@/lib/types'

/**
 * Write side of the References page: one append to INDEX_OPS.jsonl per request
 * (plus the raw files of an "add"). The worker applies it and records the
 * outcome. Requests are checked here so a mistake shows immediately; the worker
 * checks everything again when it applies them.
 */

const REVIEWER = process.env.SHM_REVIEWER || 'hamed'
const ROLES = ['HERO', 'TURNAROUND', 'PLATE', 'DETAIL', 'BOARD', 'RENDER']
const STATUSES = ['CONCEPT', 'APPROVED', 'LOCKED']
const TYPES: IndexOpType[] = ['add', 'retire', 'restore', 'status', 'canonical', 'role', 'rename', 'archive', 'unarchive', 'move']

export interface OpRequestResult {
  ok: boolean
  error?: string
  id?: string
}

type Look = { entity: string; variant: string }

export async function requestIndexOp(formData: FormData): Promise<OpRequestResult> {
  const pr = await requireProject(formData.get('project'))
  let op: Record<string, unknown>
  try {
    op = JSON.parse(String(formData.get('op') ?? ''))
  } catch {
    return { ok: false, error: 'Malformed request.' }
  }
  const type = op.type as IndexOpType
  if (!TYPES.includes(type)) return { ok: false, error: `Unknown action '${String(op.type)}'.` }

  const id = `op_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const [entities, assets] = await Promise.all([getEntities(pr), getAssets(pr)])
  const find = (ref: unknown): Entity => {
    const e = entities.find((x) => x.id === ref || x.short_id === ref)
    if (!e) throw new Invalid(`${String(ref)} is not in the index.`)
    return e
  }
  const list = (key: string): unknown[] => {
    const v = op[key]
    if (!Array.isArray(v) || v.length === 0) throw new Invalid('Select something first.')
    if (v.length > 200) throw new Invalid('Too many at once (200 max).')
    return v
  }
  const looks = (): Look[] =>
    list('looks').map((l) => {
      const { entity, variant } = (l ?? {}) as Look
      const e = find(entity)
      if (!assets.some((a) => a.entity_id === e.id && a.variant === variant)) {
        throw new Invalid(`${e.short_id} has no look ${String(variant)}.`)
      }
      return { entity: e.id, variant }
    })

  const record: Record<string, unknown> = { id, ts: new Date().toISOString(), reviewer: REVIEWER, type }
  let files: { rel: string; bytes: Buffer }[] = []

  try {
    switch (type) {
      case 'retire':
      case 'restore':
        record.entities = list('entities').map((r) => find(r).id)
        break
      case 'status':
        if (!STATUSES.includes(String(op.status))) throw new Invalid('Choose Concept, Approved or Locked.')
        record.entities = list('entities').map((r) => find(r).id)
        record.status = op.status
        break
      case 'canonical': {
        const e = find(op.entity)
        if (!assets.some((a) => a.entity_id === e.id && a.variant === op.variant)) throw new Invalid(`${e.short_id} has no look ${String(op.variant)}.`)
        Object.assign(record, { entity: e.id, variant: op.variant })
        break
      }
      case 'role':
        if (!ROLES.includes(String(op.role))) throw new Invalid('Choose a role.')
        Object.assign(record, { looks: looks(), role: op.role })
        break
      case 'archive':
        record.looks = looks()
        break
      case 'unarchive':
        record.archiveIds = list('archiveIds').map(String)
        break
      case 'move': {
        const to = find(op.to)
        if (to.status === 'RETIRED') throw new Invalid(`${to.short_id} is retired.`)
        const ls = looks()
        if (ls.some((l) => l.entity === to.id)) throw new Invalid(`Some of those looks are already in ${to.short_id}.`)
        Object.assign(record, { looks: ls, to: to.id })
        break
      }
      case 'rename': {
        const e = find(op.entity)
        const name = String(op.name ?? '').trim()
        const description = String(op.description ?? '').trim()
        const slug = entitySlug(String(op.slug ?? e.slug))
        if (!name) throw new Invalid('The name cannot be empty.')
        if (!isAscii(name) || !isAscii(description)) throw new Invalid('Name and description go into the registry, so they must be English.')
        if (!slug) throw new Invalid('The ID wording needs at least one English letter or digit.')
        const clash = entities.find((x) => x.slug === slug && x.id !== e.id)
        if (clash) throw new Invalid(`'${slug}' is already used by ${clash.short_id}.`)
        Object.assign(record, { entity: e.id, name, description, slug })
        break
      }
      case 'add': {
        const uploads = await readUploads(pr, formData, id)
        if (uploads.length === 0) throw new Invalid('Add at least one image.')
        record.uploads = uploads.map((u) => u.meta)
        files = uploads.map((u) => ({ rel: u.meta.file, bytes: u.bytes }))
        break
      }
    }
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message }
    throw e
  }

  // Files first, request second: the worker must never see a request whose file is missing.
  const dir = path.join(pr.P.uploads, id)
  try {
    if (files.length) {
      await fs.mkdir(dir, { recursive: true })
      for (const f of files) await fs.writeFile(path.join(pr.root, f.rel), f.bytes)
    }
    await fs.mkdir(path.dirname(pr.P.indexOps), { recursive: true })
    await fs.appendFile(pr.P.indexOps, JSON.stringify(record) + '\n', 'utf8')
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true })
    return { ok: false, error: `Could not save the request: ${(e as Error).message}` }
  }

  revalidatePath(`/${pr.slug}/references`)
  return { ok: true, id }
}
