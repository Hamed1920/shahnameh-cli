import fs from 'node:fs/promises'
import path from 'node:path'
import {
  CODE, P, ROOT, RX, appendJsonl, archivedVariants, findEntity, log, readJsonl, readState, resolveRef,
  shotFolder, usedShotIds,
} from './project.mjs'
import { episodeFolderName } from './ids.mjs'
import { entityId as fullEntityId } from './ids.mjs'
import {
  FilingError, checkUploads, entitySlug, fileUploadInto, nextVariant, syncEntityRow,
} from './promote.mjs'
import { MANIFEST_HEADER, OpError, exists, fail, moveFile, rel, transaction } from './tx.mjs'

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

const ROLES = ['HERO', 'TURNAROUND', 'PLATE', 'DETAIL', 'BOARD', 'RENDER']
/** Mirrors MAX_ADD_UPLOADS in lib/indexing.ts; the worker never trusts the panel's cap. */
const MAX_ADD_UPLOADS = 40
const SETTABLE_STATUS = ['CONCEPT', 'APPROVED', 'LOCKED']
const ASCII = /^[\x20-\x7E]*$/
const ARCHIVE_INDEX = () => path.join(P.archive, 'index.jsonl')

// ---------------------------------------------------------------- helpers

/** Exactly what RX_SHOT_FILE in tools/Validate-Project.ps1 allows. */
const SHOT_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.mov']

/** The EPnnn an op names, checked. */
function episodeOf(op) {
  const episode = String(op.episode ?? '').trim().toUpperCase()
  if (!/^EP\d{3}$/.test(episode)) fail(`'${op.episode}' is not an episode; it looks like EP002`)
  return episode
}

/** The folder this episode has under 07_EPISODES, matched by its CODE-EPnnn prefix, or null. */
async function episodeDir(episode) {
  const prefix = `${CODE}-${episode}`
  const names = await fs.readdir(path.join(ROOT, '07_EPISODES'), { withFileTypes: true }).catch(() => [])
  return names
    .filter((e) => e.isDirectory() && (e.name === prefix || e.name.startsWith(`${prefix}-`)))
    .map((e) => e.name)
    .sort()[0] ?? null
}

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

// "P12 SHM-EP001-SC012-SH0010" (any project code), or the job id when there is no shot label
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
  /**
   * Upload new looks or new entities -- the same filing as a review upload,
   * but the whole batch is one unit: the References page sends up to forty at
   * a time, and forty either all land or none of them do.
   *
   * It has to be a unit for two reasons. A group (several files of one new
   * thing) would otherwise be able to leave an entity half made. And a throw
   * that is not a FilingError -- a locked file, an EBUSY, routine at this size
   * -- leaves the op unprocessed and retried, by which point the uploads that
   * did land have had their sources moved away, so the retry would fail on a
   * missing file and record a misleading refusal over a half-filed index.
   */
  add: (op) => transaction(async (tx) => {
    const uploads = op.uploads ?? []
    if (uploads.length === 0) fail('nothing to add')
    if (uploads.length > MAX_ADD_UPLOADS) fail(`too many files at once (${MAX_ADD_UPLOADS} max)`)
    try {
      await checkUploads(uploads, new Set(), { allowGroups: true })
      // What each upload was filed as, so a file that is another look of
      // something new can be given the entity its leader has just created.
      // checkUploads proved every groupOf points strictly earlier, so the
      // leader is always in here by the time it is asked for.
      const byUpload = new Map()
      const filed = []
      for (const u of uploads) {
        const r = await fileUploadInto(tx, u, { id: op.id, reviewer: op.reviewer },
          { resolveGroup: (id) => byUpload.get(id) })
        byUpload.set(u.id, r.entity)
        filed.push(r.token)
      }
      return {
        summary: `added ${filed.join(', ')}`,
        // Only once both registries are committed: until then the sources are
        // what a rollback puts the batch back to.
        after: () => fs.rm(path.join(P.uploads, op.id), { recursive: true, force: true }),
      }
    } catch (e) {
      if (e instanceof FilingError) fail(e.message)
      throw e
    }
  }),

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
    const newId = fullEntityId(CODE, row.kind, row.number, slug)

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

  /**
   * Start an episode.
   *
   * An episode is normally born the moment the worker files its first accepted
   * take, which means one cannot be planned before there is anything in it.
   * This makes the folder, and nothing else: the number becomes real, shows on
   * the Episodes page, and can be prompted or moved into. Numbers are never
   * reused, so an episode that already exists is left exactly as it is rather
   * than renamed -- the name it was given when it started is the one it keeps.
   */
  'new-episode': (op) => transaction(async () => {
    const episode = episodeOf(op)
    const title = String(op.title ?? '')
    const existing = await episodeDir(episode)
    if (existing) return `${CODE}-${episode} already exists as ${existing}`
    const dir = episodeFolderName(CODE, episode, title)
    await fs.mkdir(path.join(ROOT, '07_EPISODES', dir, 'shots'), { recursive: true })
    return `started ${dir}`
  }),

  /**
   * Rename an episode: its wording, never its number.
   *
   * Only the folder moves. Every shot id in it carries the episode number and
   * not the title (docs/INDEXING.md section 7), and the worker finds an episode
   * folder by its CODE-EPnnn prefix, so nothing that names a shot has to change
   * -- which is the whole reason the title is only ever a suffix.
   */
  'rename-episode': (op) => transaction(async (tx) => {
    const episode = episodeOf(op)
    const from = await episodeDir(episode)
    if (!from) fail(`${CODE}-${episode} has no folder yet, so there is nothing to rename`)
    const to = episodeFolderName(CODE, episode, String(op.title ?? ''))
    if (to === from) return `${from} is already called that`
    await tx.move(path.join(ROOT, '07_EPISODES', from), path.join(ROOT, '07_EPISODES', to))
    return `renamed ${from} -> ${to}`
  }),

  /**
   * Put footage into an episode by hand.
   *
   * A render made somewhere else, a plate, a cut of someone else's. Each file
   * is filed as a new scene of the episode -- the next free number, past every
   * scene that episode has ever used -- or as another take of a scene it
   * already has. Scene numbers are allocated here and nowhere else, exactly as
   * they are for a generated shot (CLAUDE.md), so the panel asks for 'next' and
   * never for a number.
   *
   * Shots are not in ASSET_MANIFEST.csv: that registry indexes reusable
   * entities, and a shot belongs to exactly one episode (see promoteShot).
   */
  'add-shot': (op, ctx) => transaction(async (tx) => {
    const episode = episodeOf(op)
    // Two sources, filed the same way but not carried the same way. An upload
    // is a temp file under 09_OUTPUT/_uploads and is MOVED. A take is a render
    // that already exists -- an approved 480p draft, say -- and is COPIED: the
    // file where it is is what the Decided page resolves, and taking it away
    // would leave that page pointing at nothing.
    const uploads = (Array.isArray(op.uploads) ? op.uploads : []).map((u) => ({ ...u, carry: 'move' }))
    const takes = (Array.isArray(op.takes) ? op.takes : []).map((t) => ({ ...t, carry: 'copy' }))
    const sources = [...uploads, ...takes]
    if (sources.length === 0) fail('no footage was given')
    if (sources.length > 50) fail('too many files at once (50 max)')

    const used = await usedShotIds()
    const mine = new Set()
    let last = 0
    for (const id of used) {
      const m = String(id).match(RX.sceneAnywhere)
      if (m && m[1] === episode) { mine.add(m[2]); last = Math.max(last, Number(m[2])) }
    }

    const destFolder = await shotFolder(`${CODE}-${episode}`, String(op.episodeTitle ?? ''))
    const destDir = path.join(ROOT, destFolder)
    const plan = []
    for (const u of sources) {
      const src = path.join(ROOT, String(u.file ?? ''))
      // Both live under 09_OUTPUT: uploads in _uploads, renders in _drafts,
      // _staging or _rejected. Nothing outside it can be filed this way, and an
      // episode's own shots folder is never a source -- that is a move.
      const allowed = u.carry === 'move' ? ['09_OUTPUT/_uploads/'] : ['09_OUTPUT/']
      if (!allowed.some((p) => rel(src).startsWith(p))) fail(`${u.file} is not somewhere this can file from`)
      if (!(await exists(src))) fail(`${u.file} is not there any more`)
      const ext = path.extname(src).toLowerCase()
      if (!SHOT_EXT.includes(ext)) fail(`${ext || 'that file'} is not footage the index allows`)

      const asked = String(u.scene ?? 'next').toUpperCase()
      let scene
      if (asked === 'NEXT') {
        scene = `SC${String(++last).padStart(3, '0')}`
      } else {
        const m = /^SC(\d{3})$/.exec(asked)
        // Never invent a scene number from what was typed: it is either one the
        // episode already uses, or the next free one. See CLAUDE.md.
        if (!m || !mine.has(m[1])) fail(`${asked} is not a scene of ${episode}; file it as a new scene instead`)
        scene = asked
      }
      plan.push({ shot: `${CODE}-${episode}-${scene}-SH0010`, src, ext, carry: u.carry, name: String(u.originalName ?? '') })
    }

    await assertNotInUse(tx, ctx, { ids: plan.map((p) => p.shot) })
    await fs.mkdir(destDir, { recursive: true })

    const filed = []
    for (const p of plan) {
      // The variant every shot on disk carries; a take beyond the first gets _Tnn.
      const stem = `${p.shot}_V01`
      let filename = `${stem}${p.ext}`
      for (let n = 2; await exists(path.join(destDir, filename)); n++) {
        filename = `${stem}_T${String(n).padStart(2, '0')}${p.ext}`
      }
      if (p.carry === 'copy') await tx.copy(p.src, path.join(destDir, filename))
      else await tx.move(p.src, path.join(destDir, filename))
      filed.push(`${p.name || path.basename(p.src)} -> ${filename}`)
    }
    return `filed into ${destFolder}: ${filed.join(', ')}`
  }),

  /**
   * Take a shot out of an episode.
   *
   * Not a delete. Nothing is deleted here (CLAUDE.md): the files move to
   * 09_OUTPUT/_archive with a record beside them, exactly as an archived look
   * does, so the shot can be put back. Its number stays spent -- a gap where a
   * shot used to be is the correct record of one having been there -- and
   * because the number is never handed out again, restoring it later always
   * finds its place free.
   */
  'archive-shot': (op, ctx) => transaction(async (tx) => {
    const shots = [...new Set((op.shots ?? []).map((s) => String(s).trim().toUpperCase()))]
    if (shots.length === 0) fail('no footage was chosen')

    const plan = []
    const already = []
    for (const shot of shots) {
      if (!RX.shotFileStart.test(shot)) fail(`'${shot}' is not a shot id; it looks like ${CODE}-EP001-SC004-SH0010`)
      const folder = await shotFolder(shot)
      const names = (await fs.readdir(path.join(ROOT, folder)).catch(() => []))
        .filter((f) => f.startsWith(`${shot}_`))
      // Already out: the same click sent twice is not an error.
      if (names.length === 0) { already.push(shot); continue }
      await assertNotInUse(tx, ctx, { ids: [shot] })
      plan.push({ shot, folder, names })
    }
    if (plan.length === 0) fail(`nothing to take out: ${already.join(', ')} ${already.length === 1 ? 'is' : 'are'} not in an episode`)

    const records = []
    const out = []
    for (const p of plan) {
      const archiveId = `arc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      const files = []
      for (const name of p.names) {
        const dest = path.join(P.archive, archiveId, name)
        await tx.move(path.join(ROOT, p.folder, name), dest)
        files.push({ from: `${p.folder}/${name}`, to: rel(dest) })
      }
      records.push({ archiveId, kind: 'shot', shot: p.shot, folder: p.folder, files, by: op.reviewer, ts: new Date().toISOString() })
      out.push(`${p.shot} (${files.length} take${files.length === 1 ? '' : 's'})`)
    }
    return {
      summary: `took ${out.join(', ')} out of the episode` + (already.length ? `; ${already.join(', ')} already out` : ''),
      after: async () => { for (const r of records) await appendJsonl(ARCHIVE_INDEX(), r) },
    }
  }),

  /** Put an archived shot back where it came from. Its number was never reissued. */
  'restore-shot': (op) => transaction(async (tx) => {
    const all = await readJsonl(ARCHIVE_INDEX())
    const restored = new Set(all.filter((x) => x.restored).map((x) => x.archiveId))
    const done = []
    for (const archiveId of op.archiveIds ?? []) {
      const rec = all.find((x) => x.archiveId === archiveId && x.kind === 'shot' && !x.restored)
      if (!rec || restored.has(archiveId)) fail(`archive entry ${archiveId} not found or already restored`)
      // Where it goes now, not where it was: the episode may have been renamed.
      const folder = await shotFolder(rec.shot)
      for (const f of rec.files ?? []) {
        await tx.move(path.join(ROOT, f.to), path.join(ROOT, folder, path.basename(f.to)))
      }
      done.push({ archiveId, shot: rec.shot })
    }
    if (done.length === 0) fail('nothing to restore')
    return {
      summary: `put ${done.map((d) => d.shot).join(', ')} back`,
      after: async () => {
        for (const d of done) await appendJsonl(ARCHIVE_INDEX(), { archiveId: d.archiveId, restored: true, ts: new Date().toISOString() })
      },
    }
  }),

  /**
   * Drop an empty episode's folder.
   *
   * Only the folder, and only when there is nothing in it -- footage is taken
   * out one shot at a time, on purpose, so that nothing is ever removed in bulk
   * by accident. The NUMBER is not given back: it stays spent for good, like
   * every other number here, and starting an episode with it again is refused.
   */
  'remove-episode': (op) => transaction(async () => {
    const episode = episodeOf(op)
    const dir = await episodeDir(episode)
    if (!dir) return `${CODE}-${episode} has no folder`
    const shots = await fs.readdir(path.join(ROOT, '07_EPISODES', dir, 'shots')).catch(() => [])
    const kept = shots.filter((f) => !f.startsWith('.'))
    if (kept.length) fail(`${dir} still holds ${kept.length} file${kept.length === 1 ? '' : 's'}; take those out first`)
    await fs.rm(path.join(ROOT, '07_EPISODES', dir), { recursive: true, force: true })
    return `removed the folder ${dir}. ${episode} stays spent and is never handed out again`
  }),

  /**
   * Move footage to another episode.
   *
   * A shot takes its whole stack of takes with it and lands on the next free
   * scene of the episode it moves to. The number it leaves behind is burned for
   * good, like every other number here (docs/INDEXING.md section 9) -- a gap in
   * EP001 is the correct record of a scene that used to be there.
   *
   * Nothing that already names the old id is rewritten: QUEUE.jsonl and
   * REVIEW_LOG.jsonl are append-only history, and rewriting them is how two
   * machines end up disagreeing. The move is recorded in SHOT_MOVES.jsonl
   * instead, and the panel reads an old id forward through it.
   *
   * A shot with nothing to move is skipped, not failed: one already in the
   * episode asked for, and one with no footage filed (an approved 480p draft
   * lives in 09_OUTPUT/_drafts, not in the episode). Both are no-ops, the op log
   * is append-only so the same request can arrive twice, and refusing fourteen
   * good moves because of one such row is the wrong answer to "put these in
   * EP013". Every one that is skipped is named in the summary, so it is never
   * silent. A malformed id is still a refusal -- that is a mistake, not a no-op.
   */
  'move-shot': (op, ctx) => transaction(async (tx) => {
    const episode = String(op.episode ?? '').trim().toUpperCase()
    if (!/^EP\d{3}$/.test(episode)) fail(`'${op.episode}' is not an episode; it looks like EP002`)

    // Only ever names an episode that has no folder yet; see shotFolder.
    const title = String(op.episodeTitle ?? '')

    const shots = [...new Set((op.shots ?? []).map((s) => String(s).trim().toUpperCase()))]
    if (shots.length === 0) fail('no footage was chosen')

    // Everything is checked before anything moves, so a batch of ten either all
    // lands or none of it does and the reviewer is told why.
    const waiting = await waitingForReview(tx)
    const plan = []
    const already = []
    const nothing = []
    for (const shot of shots) {
      const parts = shot.match(RX.shotParts)
      if (!parts || !parts[2] || !parts[3]) fail(`'${shot}' is not a shot id; it looks like ${CODE}-EP001-SC004-SH0010`)
      if (parts[1] === episode) { already.push(shot); continue }

      const folder = await shotFolder(shot)
      const names = (await fs.readdir(path.join(ROOT, folder)).catch(() => []))
        .filter((f) => f.startsWith(`${shot}_`))
      if (names.length === 0) { nothing.push(shot); continue }

      const undecided = waiting.find((w) => String(w.sidecar.target ?? '').toUpperCase() === shot)
      if (undecided) fail(`${shot} has a take waiting for review. Decide it first, then move the shot.`)
      await assertNotInUse(tx, ctx, { ids: [shot] })

      plan.push({ shot, tail: parts[3], folder, names })
    }
    if (plan.length === 0) {
      const why = [
        already.length && `${already.join(', ')} already in ${episode}`,
        nothing.length && `${nothing.join(', ')} with no footage filed`,
      ].filter(Boolean).join('; ')
      return `nothing to move: ${why}`
    }

    // Past every scene the target episode has ever used: queued targets and
    // files on disk, the same two sources that number a new scene.
    const used = await usedShotIds()
    let last = 0
    for (const id of used) {
      const m = String(id).match(RX.sceneAnywhere)
      if (m && m[1] === episode) last = Math.max(last, Number(m[2]))
    }

    const moved = []
    const records = []
    for (const p of plan) {
      const scene = `SC${String(++last).padStart(3, '0')}`
      const to = `${CODE}-${episode}-${scene}-${p.tail}`
      const destFolder = await shotFolder(to, title)
      const files = []
      for (const name of p.names) {
        const next = `${to}${name.slice(p.shot.length)}`
        await tx.move(path.join(ROOT, p.folder, name), path.join(ROOT, destFolder, next))
        files.push({ from: `${p.folder}/${name}`, to: `${destFolder}/${next}` })
      }
      moved.push(`${p.shot} -> ${to} (${files.length} take${files.length === 1 ? '' : 's'})`)
      records.push({ opId: op.id, from: p.shot, to, files, ts: new Date().toISOString() })
    }

    return {
      summary: `moved ${moved.join(', ')}`
        + (already.length ? `; ${already.join(', ')} already in ${episode}` : '')
        + (nothing.length ? `; skipped ${nothing.join(', ')} (no footage filed)` : ''),
      // Only once the move has committed: a record of a move that was rolled
      // back would send the panel looking for a file that never left.
      after: async () => { for (const r of records) await appendJsonl(P.shotMoves, r) },
    }
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
    if (dry) {
      // An add carries the whole batch, so say what each file would become:
      // it makes --dry-run a real check of forty rows and their groups before
      // anything is filed. checkUploads only reads.
      if (op.type === 'add') {
        try {
          for (const line of await checkUploads(op.uploads ?? [], new Set(), { allowGroups: true })) {
            await log(`DRY-RUN would file ${line}`)
          }
        } catch (e) {
          await log(`DRY-RUN would refuse index op ${op.id}: ${e.message}`)
        }
      }
      await log(`DRY-RUN would apply index op ${op.id} (${op.type})`)
      continue
    }
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
