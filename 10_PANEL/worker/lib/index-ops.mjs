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
 * any error every recorded file move is reversed, every rewritten sidecar put
 * back, and the CSVs restored.
 */
async function transaction(fn) {
  const [entitiesText, manifestText] = await Promise.all([readText(P.entities), readText(P.manifest)])
  const e = parseCsv(entitiesText)
  const m = parseCsv(manifestText)
  const moves = []
  const rewrites = []
  const tx = {
    entities: e.rows,
    assets: m.rows,
    async move(src, dest) {
      if (await exists(dest)) fail(`${rel(dest)} already exists`)
      await moveFile(src, dest)
      moves.push([src, dest])
    },
    async rewrite(file, original, next) {
      await restoreText(file, next)
      rewrites.push([file, original])
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
    for (const [file, text] of rewrites.reverse()) {
      await restoreText(file, text).catch((r) => log(`ROLLBACK ${rel(file)} failed: ${r.message}`))
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

// "P12 SHM-EP001-SC012-SH0010", or the job id when there is no shot label
const jobName = (x) => (x.label ? `${x.label} ${x.target}` : `${x.jobId} (${x.target})`)

/**
 * Generated results waiting for review, or for their decision to be applied,
 * with each reference resolved against the registries as they are now. Call it
 * before changing anything. A decided batch keeps its job.json in _staging but
 * its files have moved on, so only batches with a file left count.
 */
async function waitingForReview(tx) {
  const dirs = await fs.readdir(P.staging, { withFileTypes: true }).catch(() => [])
  const out = []
  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const file = path.join(P.staging, d.name, 'job.json')
    let text
    let sidecar
    try { text = await fs.readFile(file, 'utf8'); sidecar = JSON.parse(text) } catch { continue }
    let waiting = false
    for (const c of sidecar.candidates ?? []) {
      if (await exists(path.join(P.staging, d.name, c.file))) { waiting = true; break }
    }
    if (!waiting) continue
    const refs = []
    for (const token of sidecar.refs ?? []) {
      const r = await resolveRef(token, tx.entities, tx.assets)
      refs.push({ token, path: r.ok ? path.resolve(r.path) : null })
    }
    out.push({ file, text, sidecar, refs })
  }
  return out
}

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A video waiting for review keeps the references it was made with, and a redo
 * or final reuses them. When a look it names is archived or moved, point it at
 * what that look became, so the reviewer's next click still works.
 *
 * `swap(ref, video)` returns undefined to keep a reference, or
 * `{ to, mention }`: the replacement token (null drops it) and the text that
 * replaces it where the notes mention it. Returns one line per changed video.
 */
async function retargetWaiting(tx, waiting, swap) {
  const notes = []
  for (const w of waiting) {
    const changes = []
    const refs = []
    for (const ref of w.refs) {
      const s = ref.path ? swap(ref, w) : undefined
      if (!s || s.to === ref.token) { if (!refs.includes(ref.token)) refs.push(ref.token); continue }
      changes.push({ from: ref.token, ...s })
      if (s.to && !refs.includes(s.to)) refs.push(s.to)
    }
    if (changes.length === 0) continue
    const inText = (text) => changes.reduce(
      (acc, c) => acc.replace(new RegExp(`${escapeRx(c.from)}(?![\\w/-])`, 'g'), c.mention),
      String(text),
    )
    const next = {
      ...w.sidecar,
      refs,
      ...(w.sidecar.basePrompt != null && { basePrompt: inText(w.sidecar.basePrompt) }),
      ...(Array.isArray(w.sidecar.revisionNotes) && { revisionNotes: w.sidecar.revisionNotes.map(inText) }),
    }
    await tx.rewrite(w.file, w.text, JSON.stringify(next, null, 2))
    const what = changes.map((c) => (c.to ? `uses ${c.to} instead of ${c.from}` : `no longer uses ${c.from}`)).join(', and ')
    notes.push(`${w.sidecar.label ?? w.sidecar.jobId} (waiting for review) ${what}`)
  }
  return notes
}

const withNotes = (summary, notes) => (notes.length ? `${summary}. ${notes.join('; ')}` : summary)

/**
 * Refuse to pull a file out from under a queued or generating job, or a
 * decision the worker has not applied yet: either would fail later, after the
 * reviewer has moved on. (Videos waiting for review are retargeted instead.)
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

  const users = [
    ...pendingJobs.map((j) => ({ x: j, refs: j.refs, what: `${jobName(j)}, which is queued or generating`, then: 'Try again once it has finished.' })),
    ...pendingDecisions.map((d) => ({ x: d, refs: d.refs, what: 'a decision the worker is still applying', then: 'Try again in a moment.' })),
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
      const waiting = (await waitingForReview(tx)).filter((w) => w.text.includes(oldId))

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
      // Results waiting for review store the full target id; promoting one looks it up.
      for (const w of waiting) {
        const retarget = (s) => (typeof s === 'string' ? s.split(oldId).join(newId) : s)
        const next = { ...w.sidecar, target: retarget(w.sidecar.target), refs: (w.sidecar.refs ?? []).map(retarget) }
        await tx.rewrite(w.file, w.text, JSON.stringify(next, null, 2))
      }
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
    const waiting = await waitingForReview(tx)
    const leaving = new Set(plan.map(({ r }) => path.resolve(ROOT, r.folder, r.filename)))

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

    // A waiting video that used an archived look falls back to that entity's main look,
    // or to nothing if another of its references already covers the entity.
    const entityOfRef = (x) => findEntity(tx.entities, ((x) => x.token.replace(/^@/, '').split('/')[0])(x))
    const notes = await retargetWaiting(tx, waiting, (ref, w) => {
      if (!leaving.has(ref.path)) return undefined
      const ent = entityOfRef(ref)
      if (!ent) return { to: null, mention: ref.token }
      const other = w.refs.find((x) => x !== ref && x.path && !leaving.has(x.path) && entityOfRef(x)?.id === ent.id)
      if (other) return { to: null, mention: other.token }
      if (tx.assets.some((a) => a.entity_id === ent.id)) return { to: `@${ent.short_id}`, mention: `@${ent.short_id}` }
      return { to: null, mention: ent.name }
    })
    return {
      summary: withNotes(
        `archived ${plan.map(({ ent, r }) => `${ent.short_id}/${r.variant}${r.take !== 'T01' ? '/' + r.take : ''}`).join(', ')}`
          + (already.length ? ` (${already.join(', ')} already archived)` : ''),
        notes,
      ),
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
    const waiting = await waitingForReview(tx)

    const moved = []
    const sources = new Map()
    const movedTo = new Map() // old file -> the look it became
    for (const p of plan) {
      const variant = nextVariant(tx.assets, target.id, await archivedVariants(target.short_id))
      for (const r of p.rows) {
        const { desc, ext } = partsOf(r.filename, p.ent.id)
        const filename = fileName(target.id, variant, r.take, desc, ext)
        movedTo.set(path.resolve(ROOT, r.folder, r.filename), { base: `@${target.short_id}/${variant}`, take: r.take })
        await tx.move(path.join(ROOT, r.folder, r.filename), path.join(ROOT, target.folder, filename))
        Object.assign(r, { filename, entity_id: target.id, variant, folder: target.folder })
      }
      sources.set(p.ent.id, p.ent)
      moved.push(`${p.ent.short_id}/${p.variant} -> ${target.short_id}/${variant}`)
    }
    sources.forEach((ent) => tidyEntity(tx, ent))
    syncEntityRow(tx.entities.find((r) => r.id === target.id), tx.assets, target.canonical_variant || 'V01')

    // A waiting video follows a moved look to its new name. A plain @KIND-NNN means the
    // entity itself, so it stays unless the entity has nothing left.
    const notes = await retargetWaiting(tx, waiting, (ref) => {
      const m = movedTo.get(ref.path)
      if (!m) return undefined
      const parts = ref.token.replace(/^@/, '').split('/')
      if (parts.length === 1) {
        const ent = findEntity(tx.entities, parts[0])
        if (ent && tx.assets.some((a) => a.entity_id === ent.id)) return undefined
      }
      const to = parts.length > 2 ? `${m.base}/${m.take}` : m.base
      return { to, mention: to }
    })
    return withNotes(`moved ${moved.join(', ')}`, notes)
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
