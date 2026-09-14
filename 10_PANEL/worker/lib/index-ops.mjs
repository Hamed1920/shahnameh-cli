import fs from 'node:fs/promises'
import path from 'node:path'
import {
  P, ROOT, appendJsonl, archivedVariants, findEntity, log, readJsonl, readState, readText, resolveRef,
  restoreText, writeCsv,
} from './project.mjs'
import { parseCsv } from './csv.mjs'
import {
  FilingError, checkUploads, entitySlug, fileUpload, nextVariant, syncEntityRow,
} from './promote.mjs'

/**
 * Index management requested from the panel's References page.
 *
 * The panel appends a request to INDEX_OPS.jsonl; this is the only code that
 * acts on one. Every op is validated in full, then applied as a unit: file
 * moves are recorded and both registries snapshotted, so a failure part-way
 * puts everything back exactly as it was.
 *
 * Nothing is ever deleted. Retiring keeps an entity's number and files;
 * archiving a look moves its file to 09_OUTPUT/_archive with its registry row
 * saved beside it, so it can be restored.
 */

const MANIFEST_HEADER = [
  'filename', 'entity_id', 'variant', 'take', 'role', 'status', 'folder',
  'source', 'original_filename', 'added', 'notes',
]
const ROLES = ['HERO', 'TURNAROUND', 'PLATE', 'DETAIL', 'BOARD', 'RENDER']
const SETTABLE_STATUS = ['CONCEPT', 'APPROVED', 'LOCKED']
const ASCII = /^[\x20-\x7E]*$/
const ARCHIVE_INDEX = () => path.join(P.archive, 'index.jsonl')

/** A request that breaks a rule. Retrying cannot help, so it is recorded as failed. */
export class OpError extends Error {}

const fail = (msg) => { throw new OpError(msg) }

// ---------------------------------------------------------------- transaction

async function moveFile(src, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true })
  try {
    await fs.rename(src, dest)
  } catch (e) {
    if (e.code !== 'EXDEV') throw e
    await fs.copyFile(src, dest)
    await fs.rm(src, { force: true })
  }
}

async function exists(p) {
  try { await fs.access(p); return true } catch { return false }
}

/**
 * Run `fn` against in-memory registries. On success both CSVs are written; on
 * any error every recorded file move is reversed and the CSVs restored.
 */
async function transaction(fn) {
  const [entitiesText, manifestText] = await Promise.all([readText(P.entities), readText(P.manifest)])
  const e = parseCsv(entitiesText)
  const m = parseCsv(manifestText)
  const moves = []
  const tx = {
    entities: e.rows,
    assets: m.rows,
    async move(src, dest) {
      if (await exists(dest)) fail(`${rel(dest)} already exists`)
      await moveFile(src, dest)
      moves.push([src, dest])
    },
  }
  try {
    const result = await fn(tx)
    await writeCsv(P.manifest, tx.assets, m.header.length ? m.header : MANIFEST_HEADER)
    await writeCsv(P.entities, tx.entities, e.header)
    // Side records (the archive index) only once the registries are committed.
    if (typeof result === 'object' && result.after) await result.after()
    return typeof result === 'object' ? result.summary : result
  } catch (err) {
    for (const [src, dest] of moves.reverse()) {
      await moveFile(dest, src).catch((r) => log(`ROLLBACK move failed ${rel(dest)}: ${r.message}`))
    }
    await restoreText(P.manifest, manifestText).catch((r) => log(`ROLLBACK manifest failed: ${r.message}`))
    await restoreText(P.entities, entitiesText).catch((r) => log(`ROLLBACK entities failed: ${r.message}`))
    throw err
  }
}

const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/')

// ---------------------------------------------------------------- helpers

function entityOf(tx, ref) {
  return findEntity(tx.entities, ref) ?? fail(`unknown entity '${ref}'`)
}

function looksOf(tx, ent, variant, take) {
  const rows = tx.assets.filter((a) => a.entity_id === ent.id && a.variant === variant && (!take || a.take === take))
  if (rows.length === 0) fail(`${ent.short_id} has no look ${variant}${take ? '/' + take : ''}`)
  return rows
}

/** `<id>_<Vnn>[_Tnn]_<descriptor>.<ext>` -> its descriptor and extension. */
function partsOf(filename, entityId) {
  const m = filename.slice(entityId.length).match(/^_V\d{2}(?:_T\d{2})?_(.+)(\.[a-z0-9]+)$/i)
  return m ? { desc: m[1], ext: m[2].toLowerCase() } : { desc: 'look', ext: path.extname(filename).toLowerCase() }
}

const fileName = (entityId, variant, take, desc, ext) =>
  `${entityId}_${variant}${take && take !== 'T01' ? `_${take}` : ''}_${desc}${ext}`

/** After looks leave an entity: keep canonical pointing at something that exists. */
function tidyEntity(tx, ent) {
  const row = tx.entities.find((r) => r.id === ent.id)
  const variants = [...new Set(tx.assets.filter((a) => a.entity_id === ent.id).map((a) => a.variant))].sort()
  if (!variants.includes(row.canonical_variant)) row.canonical_variant = variants[0] ?? ''
  row.variant_count = String(variants.length)
  if (variants.length === 0) {
    row.flags = [...new Set([...(row.flags || '').split(';').filter(Boolean), 'NO-ASSET'])].join(';')
  } else {
    syncEntityRow(row, tx.assets, row.canonical_variant)
  }
}

/**
 * Generated results waiting for review, or for their decision to be applied.
 * A decided batch keeps its job.json in _staging but its files have moved on
 * (promoted, rejected or kept as a draft), so only batches with a file left count.
 */
async function waitingForReview() {
  const dirs = await fs.readdir(P.staging, { withFileTypes: true }).catch(() => [])
  const out = []
  for (const d of dirs) {
    if (!d.isDirectory()) continue
    let sidecar
    try { sidecar = JSON.parse(await fs.readFile(path.join(P.staging, d.name, 'job.json'), 'utf8')) } catch { continue }
    for (const c of sidecar.candidates ?? []) {
      if (await exists(path.join(P.staging, d.name, c.file))) { out.push(sidecar); break }
    }
  }
  return out
}

/**
 * Refuse to pull a file out from under anything that will still read it: a
 * queued or generating job, a decision the worker has not applied yet, or a
 * video waiting for review (its revision or final reuses the same references).
 * Each would fail later, after the reviewer has moved on.
 *
 * `ctx.state` is the worker's live state. Read from disk it could miss a job
 * that finished a moment ago, or count one that is still generating as done.
 */
async function assertNotInUse(tx, ctx, { files = [], ids = [] }) {
  const state = ctx?.state ?? await readState()
  const done = new Set(state.processedJobs)
  const pendingJobs = (await readJsonl(P.queue)).filter((j) => !done.has(j.jobId))
  const decided = new Set(state.processedDecisions)
  const pendingDecisions = (await readJsonl(P.reviewLog)).filter((d) => !decided.has(d.id))
  const staged = await waitingForReview()
  // "P12 SHM-EP001-SC012-SH0010", or the job id when there is no shot label
  const name = (x) => (x.label ? `${x.label} ${x.target}` : `${x.jobId} (${x.target})`)

  const users = [
    ...pendingJobs.map((j) => ({ x: j, refs: j.refs, what: `queued job ${name(j)}`, then: 'Wait until it has generated.' })),
    ...pendingDecisions.map((d) => ({ x: d, refs: d.refs, what: 'a decision the worker is still applying', then: 'Try again in a moment.' })),
    ...staged.map((s) => ({ x: s, refs: s.refs, what: `${name(s)}, which is waiting for review`, then: 'Decide it first (you can swap that reference when you do).' })),
  ]

  const watched = new Set(files.map((f) => path.resolve(f)))
  if (watched.size) {
    for (const u of users) {
      for (const token of u.refs ?? []) {
        if (!String(token).startsWith('@')) continue
        const r = await resolveRef(token, tx.entities, tx.assets)
        if (r.ok && watched.has(path.resolve(r.path))) fail(`${token} is used by ${u.what}. ${u.then}`)
      }
    }
  }
  for (const id of ids) {
    const hit = users.find((u) => JSON.stringify(u.x).includes(id))
    if (hit) fail(`${id} is named in ${hit.what}. ${hit.then}`)
  }
}

// ---------------------------------------------------------------- operations

const OPS = {
  /** Upload new looks or new entities -- same filing as review uploads. */
  async add(op) {
    const uploads = op.uploads ?? []
    if (uploads.length === 0) fail('nothing to add')
    try {
      await checkUploads(uploads)
      const filed = []
      for (const u of uploads) filed.push((await fileUpload(u, { id: op.id, reviewer: op.reviewer })).token)
      return `added ${filed.join(', ')}`
    } catch (e) {
      if (e instanceof FilingError) fail(e.message)
      throw e
    }
  },

  retire: (op) => transaction(async (tx) => {
    const names = []
    for (const ref of op.entities ?? []) {
      const row = entityOf(tx, ref)
      if (row.status === 'RETIRED') continue
      row.status = 'RETIRED'
      names.push(row.short_id)
    }
    return `retired ${names.join(', ') || 'nothing (already retired)'}`
  }),

  restore: (op) => transaction(async (tx) => {
    const status = op.status ?? 'CONCEPT'
    if (!SETTABLE_STATUS.includes(status)) fail(`cannot restore to '${status}'`)
    const names = []
    for (const ref of op.entities ?? []) {
      const row = entityOf(tx, ref)
      if (row.status !== 'RETIRED') continue
      row.status = status
      names.push(row.short_id)
    }
    return `restored ${names.join(', ') || 'nothing (none were retired)'}`
  }),

  status: (op) => transaction(async (tx) => {
    if (!SETTABLE_STATUS.includes(op.status)) fail(`status must be one of ${SETTABLE_STATUS.join(', ')}`)
    const rows = (op.entities ?? []).map((ref) => entityOf(tx, ref))
    const retired = rows.find((r) => r.status === 'RETIRED')
    if (retired) fail(`${retired.short_id} is retired. Restore it first.`)
    rows.forEach((r) => { r.status = op.status })
    return `${rows.map((r) => r.short_id).join(', ')} -> ${op.status}`
  }),

  canonical: (op) => transaction(async (tx) => {
    const row = entityOf(tx, op.entity)
    looksOf(tx, row, op.variant)
    row.canonical_variant = op.variant
    return `${row.short_id} main look -> ${op.variant}`
  }),

  role: (op) => transaction(async (tx) => {
    if (!ROLES.includes(op.role)) fail(`unknown role '${op.role}'`)
    let n = 0
    for (const l of op.looks ?? []) {
      for (const r of looksOf(tx, entityOf(tx, l.entity), l.variant, l.take)) { r.role = op.role; n++ }
    }
    return `role ${op.role} on ${n} file(s)`
  }),

  rename: (op, ctx) => transaction(async (tx) => {
    const row = entityOf(tx, op.entity)
    const name = String(op.name ?? row.name).trim()
    const description = op.description === undefined ? row.description : String(op.description).trim()
    if (!name) fail('the name cannot be empty')
    if (!ASCII.test(name) || !ASCII.test(description)) fail('name and description must be English (they go into the registry)')

    const slug = op.slug === undefined ? row.slug : entitySlug(op.slug)
    if (!slug) fail('the ID wording needs at least one English letter or digit')
    const oldId = row.id
    const newId = `SHM-${row.kind}-${row.number}-${slug}`

    if (newId !== oldId) {
      const clash = tx.entities.find((e) => e.slug === slug && e.id !== oldId)
      if (clash) fail(`'${slug}' is already used by ${clash.short_id}`)
      await assertNotInUse(tx, ctx, { ids: [oldId] })

      for (const a of tx.assets.filter((x) => x.entity_id === oldId)) {
        const newName = `${newId}${a.filename.slice(oldId.length)}`
        await tx.move(path.join(ROOT, a.folder, a.filename), path.join(ROOT, a.folder, newName))
        a.filename = newName
        a.entity_id = newId
      }
      for (const e of tx.entities) {
        if (!e.related) continue
        e.related = e.related.split(';').map((r) => (r === oldId ? newId : r)).join(';')
      }
      row.id = newId
      row.slug = slug
      if (row.family && !slug.startsWith(row.family)) row.family = slug.split('-')[0]
    }
    row.name = name
    row.description = description
    return newId !== oldId ? `renamed ${oldId} -> ${newId}` : `updated ${row.short_id}`
  }),

  archive: (op, ctx) => transaction(async (tx) => {
    const touched = new Map()
    const plan = []
    // A look archived by an earlier request (the same click sent twice, say) is
    // already where this one wants it: note it rather than refuse the rest.
    const already = []
    for (const l of op.looks ?? []) {
      const ent = entityOf(tx, l.entity)
      const present = tx.assets.some((a) => a.entity_id === ent.id && a.variant === l.variant && (!l.take || a.take === l.take))
      if (!present && (await archivedVariants(ent.short_id)).includes(l.variant)) {
        already.push(`${ent.short_id}/${l.variant}`)
        continue
      }
      for (const r of looksOf(tx, ent, l.variant, l.take)) plan.push({ ent, r })
    }
    if (plan.length === 0) return `nothing to archive: ${already.join(', ')} already archived`
    await assertNotInUse(tx, ctx, { files: plan.map(({ r }) => path.join(ROOT, r.folder, r.filename)) })

    const records = []
    for (const { ent, r } of plan) {
      const archiveId = `arc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      const dest = path.join(P.archive, archiveId, r.filename)
      await tx.move(path.join(ROOT, r.folder, r.filename), dest)
      tx.assets.splice(tx.assets.indexOf(r), 1)
      records.push({ archiveId, short_id: ent.short_id, entity_id: ent.id, row: { ...r }, file: rel(dest), by: op.reviewer, ts: new Date().toISOString() })
      touched.set(ent.id, ent)
    }
    touched.forEach((ent) => tidyEntity(tx, ent))
    return {
      summary: `archived ${plan.map(({ ent, r }) => `${ent.short_id}/${r.variant}${r.take !== 'T01' ? '/' + r.take : ''}`).join(', ')}`
        + (already.length ? ` (${already.join(', ')} already archived)` : ''),
      after: async () => { for (const rec of records) await appendJsonl(ARCHIVE_INDEX(), rec) },
    }
  }),

  unarchive: (op) => transaction(async (tx) => {
    const all = await readJsonl(ARCHIVE_INDEX())
    const restored = new Set(all.filter((x) => x.restored).map((x) => x.archiveId))
    const done = []
    for (const archiveId of op.archiveIds ?? []) {
      const rec = all.find((x) => x.archiveId === archiveId && !x.restored)
      if (!rec || restored.has(archiveId)) fail(`archive entry ${archiveId} not found or already restored`)
      // By short id: the entity may have been renamed since.
      const ent = entityOf(tx, rec.short_id)
      const { desc, ext } = partsOf(rec.row.filename, rec.entity_id)
      const taken = tx.assets.some((a) => a.entity_id === ent.id && a.variant === rec.row.variant && a.take === rec.row.take)
      const variant = taken ? nextVariant(tx.assets, ent.id, await archivedVariants(ent.short_id)) : rec.row.variant
      const take = taken ? 'T01' : rec.row.take
      const filename = fileName(ent.id, variant, take, desc, ext)
      await tx.move(path.join(ROOT, rec.file), path.join(ROOT, ent.folder, filename))
      tx.assets.push({ ...rec.row, filename, entity_id: ent.id, variant, take, folder: ent.folder })
      syncEntityRow(tx.entities.find((r) => r.id === ent.id), tx.assets, variant)
      done.push({ rec, token: `${ent.short_id}/${variant}` })
    }
    return {
      summary: `restored ${done.map((d) => d.token).join(', ')}`,
      after: async () => {
        for (const { rec } of done) await appendJsonl(ARCHIVE_INDEX(), { archiveId: rec.archiveId, restored: true, ts: new Date().toISOString() })
      },
    }
  }),

  move: (op, ctx) => transaction(async (tx) => {
    const target = entityOf(tx, op.to)
    if (target.status === 'RETIRED') fail(`${target.short_id} is retired`)
    const plan = []
    for (const l of op.looks ?? []) {
      const ent = entityOf(tx, l.entity)
      if (ent.id === target.id) fail(`${ent.short_id}/${l.variant} is already in ${target.short_id}`)
      plan.push({ ent, variant: l.variant, rows: looksOf(tx, ent, l.variant) })
    }
    await assertNotInUse(tx, ctx, { files: plan.flatMap((p) => p.rows.map((r) => path.join(ROOT, r.folder, r.filename))) })

    const moved = []
    const sources = new Map()
    for (const p of plan) {
      const variant = nextVariant(tx.assets, target.id, await archivedVariants(target.short_id))
      for (const r of p.rows) {
        const { desc, ext } = partsOf(r.filename, p.ent.id)
        const filename = fileName(target.id, variant, r.take, desc, ext)
        await tx.move(path.join(ROOT, r.folder, r.filename), path.join(ROOT, target.folder, filename))
        Object.assign(r, { filename, entity_id: target.id, variant, folder: target.folder })
      }
      sources.set(p.ent.id, p.ent)
      moved.push(`${p.ent.short_id}/${p.variant} -> ${target.short_id}/${variant}`)
    }
    sources.forEach((ent) => tidyEntity(tx, ent))
    syncEntityRow(tx.entities.find((r) => r.id === target.id), tx.assets, target.canonical_variant || 'V01')
    return `moved ${moved.join(', ')}`
  }),
}

// Last retryable error per op, so a file that stays locked is logged once, not every few seconds.
const retrying = new Map()

/**
 * Apply every index op the panel has requested and the worker has not seen.
 * `state` must be the worker's live state object: the in-use checks read it.
 */
export async function runIndexOps(state, { dry = false } = {}) {
  const ops = await readJsonl(P.indexOps)
  state.processedOps ??= []
  const seen = new Set(state.processedOps)
  let count = 0
  for (const op of ops.filter((o) => !seen.has(o.id))) {
    const handler = OPS[op.type]
    if (dry) { await log(`DRY-RUN would apply index op ${op.id} (${op.type})`); continue }
    try {
      if (!handler) fail(`unknown operation '${op.type}'`)
      const summary = await handler(op, { state })
      await appendJsonl(P.indexOpResults, { opId: op.id, ok: true, summary, ts: new Date().toISOString() })
      await log(`INDEX OP ${op.id} ${op.type}: ${summary}`)
      state.processedOps.push(op.id)
      retrying.delete(op.id)
      count++
    } catch (e) {
      if (!(e instanceof OpError)) {
        // I/O trouble (a locked file, say): everything was rolled back; try again shortly.
        if (retrying.get(op.id) !== e.message) await log(`ERROR index op ${op.id} (${op.type}), will retry: ${e.message}`)
        retrying.set(op.id, e.message)
        continue
      }
      retrying.delete(op.id)
      await appendJsonl(P.indexOpResults, { opId: op.id, ok: false, reason: e.message, ts: new Date().toISOString() })
      await log(`INDEX OP ${op.id} ${op.type} refused: ${e.message}`)
      state.processedOps.push(op.id)
      count++
    }
  }
  return count
}
