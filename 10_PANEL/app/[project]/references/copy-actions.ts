'use server'

import fs from 'node:fs/promises'
import path from 'node:path'
import { revalidatePath } from 'next/cache'
import { planCopy } from '@/lib/copy-assets'
import { gate, whoStamp } from '@/lib/actor'
import { safeResolve, toRelative } from '@/lib/paths'
import { requireProject } from '@/lib/projects'
import { getEntities, getLibrary } from '@/lib/store'
import { MACHINE } from '@/worker/lib/machine.mjs'

/**
 * Copy entities, with every look they have, from this project into another.
 *
 * It is the References page's "add" aimed at the other project: the pictures
 * are staged under the target's 09_OUTPUT/_uploads/<op-id>/ and one `add` is
 * appended to the target's INDEX_OPS.jsonl. The target's worker allocates the
 * numbers (KEL-CHR-001, not SHM-CHR-002), names the files and writes its
 * registries, so this adds no writer. The source is only read: it keeps every
 * entity and file, and the copy is a new, independent thing in the target.
 */

export interface CopyResult {
  ok: boolean
  error?: string
  /** How many entities were sent, and the ones left out with the reason. */
  copied?: number
  skipped?: { shortId: string; reason: string }[]
}

/** What another project holds, for the Import dialog's picker. Read-only. */
export async function listProjectEntities(slug: string): Promise<{ ok: boolean; error?: string; entities: { id: string; shortId: string; name: string; kind: string; looks: number }[] }> {
  try {
    const source = await requireProject(slug)
    const library = await getLibrary(source)
    return {
      ok: true,
      entities: library.entities
        .filter((e) => e.status !== 'RETIRED')
        .map((e) => ({ id: e.id, shortId: e.shortId, name: e.name, kind: e.kind, looks: e.looks.length })),
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message, entities: [] }
  }
}

export async function copyToProject(formData: FormData): Promise<CopyResult> {
  const source = await requireProject(formData.get('project'))
  const target = await requireProject(formData.get('target'))
  if (source.slug === target.slug) return { ok: false, error: 'Pick a different project to copy into.' }
  // Writing into the target is an add there; reading the source needs nothing more than being here.
  const g = await gate(target.slug, 'index.write')
  if (!g.ok) return { ok: false, error: g.error }

  let ids: string[]
  try {
    const v = JSON.parse(String(formData.get('entities') ?? ''))
    if (!Array.isArray(v) || v.length === 0) throw new Error()
    ids = v.map(String)
  } catch {
    return { ok: false, error: 'Select something first.' }
  }
  if (ids.length > 200) return { ok: false, error: 'Too many at once (200 max).' }

  const [library, targetEntities] = await Promise.all([getLibrary(source), getEntities(target)])
  const chosen = ids.map((id) => library.entities.find((e) => e.id === id || e.shortId === id))
  const missing = ids.filter((_, i) => !chosen[i])
  if (missing.length) return { ok: false, error: `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not in ${source.name}.` }

  const plan = planCopy(
    chosen as NonNullable<(typeof chosen)[number]>[],
    new Set(targetEntities.map((e) => e.slug)),
    source.code,
  )
  if (plan.batches.length === 0) {
    return { ok: false, error: `Nothing to copy: ${plan.skipped.map((s) => `${s.shortId} (${s.reason})`).join('; ')}.`, skipped: plan.skipped }
  }

  // Resolve and check every source file before anything is written.
  const from = new Map<string, string>()
  for (const [bi, b] of plan.batches.entries()) {
    for (const u of b.uploads) {
      const abs = safeResolve(source.root, u.from)
      if (!abs) return { ok: false, error: `${u.originalName}: its path is not inside ${source.name}.` }
      try { await fs.access(abs) } catch { return { ok: false, error: `${u.originalName} is missing on disk in ${source.name}, so nothing was copied.` } }
      from.set(`${bi}:${u.id}`, abs)
    }
  }

  const written: string[] = []
  try {
    for (const [bi, b] of plan.batches.entries()) {
      const id = `op_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      const dir = path.join(target.P.uploads, id)
      await fs.mkdir(dir, { recursive: true })
      written.push(dir)
      const uploads = []
      for (const u of b.uploads) {
        const dest = path.join(dir, `${u.id}${u.ext}`)
        await fs.copyFile(from.get(`${bi}:${u.id}`)!, dest)
        const { from: _from, ext: _ext, ...meta } = u
        uploads.push({ ...meta, file: toRelative(target.root, dest) })
      }
      // Files first, request second: the worker must never see a request whose file is missing.
      await fs.mkdir(path.dirname(target.P.indexOps), { recursive: true })
      const record = { id, ts: new Date().toISOString(), ...whoStamp(g.actor), type: 'add', uploads, machine: MACHINE }
      await fs.appendFile(target.P.indexOps, JSON.stringify(record) + '\n', 'utf8')
    }
  } catch (e) {
    // Nothing is half-sent: an op already appended is complete, so only a directory with no op is cleaned up.
    for (const dir of written) {
      const id = path.basename(dir)
      const sent = (await fs.readFile(target.P.indexOps, 'utf8').catch(() => '')).includes(`"id":"${id}"`)
      if (!sent) await fs.rm(dir, { recursive: true, force: true })
    }
    return { ok: false, error: `Could not copy: ${(e as Error).message}` }
  }

  revalidatePath(`/${target.slug}/references`)
  return { ok: true, copied: plan.batches.reduce((n, b) => n + b.entities.length, 0), skipped: plan.skipped }
}
