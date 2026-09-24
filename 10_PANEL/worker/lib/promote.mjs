import fs from 'node:fs/promises'
import path from 'node:path'
import {
  CODE, P, ROOT, appendJsonl, archivedVariants, findEntity, isShotId, loadEntities, log, readCsv, rel,
  shotFolder, writeCsv,
} from './project.mjs'
import { FOLDER_FOR, entityId as fullEntityId } from './ids.mjs'
import { transaction } from './tx.mjs'

/**
 * Acting on a review verdict. The worker is the ONLY process that moves asset
 * files or writes the CSV registries — the panel just appends its decision to
 * REVIEW_LOG.jsonl and lets this run.
 */

const MANIFEST_HEADER = [
  'filename', 'entity_id', 'variant', 'take', 'role', 'status', 'folder',
  'source', 'original_filename', 'added', 'notes',
]

const slugify = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) ||
  'take'

/** Next free take for an entity+variant, across the manifest. */
function nextTake(assets, entityId, variant) {
  const used = assets
    .filter((a) => a.entity_id === entityId && a.variant === variant)
    .map((a) => parseInt(String(a.take).replace(/^T/i, ''), 10))
    .filter((n) => Number.isFinite(n))
  const n = used.length ? Math.max(...used) + 1 : 1
  return 'T' + String(n).padStart(2, '0')
}

/**
 * A shot renders into the episode, not into an entity folder, and is not
 * tracked in ASSET_MANIFEST.csv — that registry indexes reusable entities, and
 * a shot belongs to exactly one episode. Its provenance lives in JOB_LEDGER.csv
 * and the review log instead.
 */
async function promoteShot(decision, sidecar) {
  const folder = sidecar?.outputFolder ?? (await shotFolder(decision.target))
  const destDir = path.join(ROOT, folder)
  await fs.mkdir(destDir, { recursive: true })

  const src = path.join(ROOT, decision.candidate)
  const ext = path.extname(src).toLowerCase()
  // Another accepted final of the same shot and variant is a re-roll: it takes
  // the next free _Tnn (T01 is implicit). It used to reuse decision.take -- the
  // Higgsfield output index, nearly always T01 -- and copy over the accepted
  // render already there. A byte-identical file is this same candidate from an
  // interrupted earlier attempt, so it is reused rather than filed twice.
  const stem = `${decision.target}_${decision.variant || 'V01'}`
  let filename = `${stem}${ext}`
  let copy = true
  for (let n = 2; await exists(path.join(destDir, filename)); n++) {
    if (await sameBytes(src, path.join(destDir, filename))) { copy = false; break }
    filename = `${stem}_T${String(n).padStart(2, '0')}${ext}`
  }
  const dest = path.join(destDir, filename)

  if (copy) await fs.copyFile(src, dest)
  await fs.rm(src, { force: true })
  await log(`PROMOTED ${decision.candidate} -> ${folder}/${filename}`)
  return rel(dest)
}

export async function promote(decision, sidecar) {
  if (isShotId(decision.target)) return promoteShot(decision, sidecar)

  const entities = await loadEntities()
  const ent = findEntity(entities, decision.target)
  if (!ent) throw new Error(`promote: unknown entity ${decision.target}`)

  const { header: mHeader, rows: assets } = await readCsv(P.manifest)
  const header = mHeader.length ? mHeader : MANIFEST_HEADER

  const variant = decision.variant || ent.canonical_variant || 'V01'
  const take = nextTake(assets, ent.id, variant)
  const src = path.join(ROOT, decision.candidate)
  const ext = path.extname(src).toLowerCase()

  // Descriptor comes from the PROMPT, not the review note: notes are sentences
  // and make unreadable filenames, while the prompt's opening words describe
  // what is actually in the frame.
  const source = sidecar?.basePrompt ?? sidecar?.prompt ?? 'render'
  const desc = slugify(source.split(/[.,\n]/)[0].split(/\s+/).slice(0, 5).join(' '))
  // T01 is implicit in the filename grammar; only later takes carry _T.
  const takePart = take === 'T01' ? '' : `_${take}`
  const filename = `${ent.id}_${variant}${takePart}_${desc}${ext}`
  const destDir = path.join(ROOT, ent.folder)
  const dest = path.join(destDir, filename)

  await fs.mkdir(destDir, { recursive: true })
  await fs.copyFile(src, dest)
  await fs.rm(src, { force: true })

  assets.push({
    filename,
    entity_id: ent.id,
    variant,
    take,
    role: 'RENDER',
    status: 'APPROVED',
    folder: ent.folder,
    source: 'higgsfield',
    original_filename: `${sidecar?.hfJobId ?? 'unknown'}/${path.basename(src)}`,
    added: new Date().toISOString().slice(0, 10),
    notes: decision.notes || '',
  })
  await writeCsv(P.manifest, assets, header)

  const { header: eHeader, rows: eRows } = await readCsv(P.entities)
  const row = eRows.find((r) => r.id === ent.id)
  if (row) {
    syncEntityRow(row, assets, variant)
    await writeCsv(P.entities, eRows, eHeader)
  }

  await log(`PROMOTED ${decision.candidate} -> ${ent.folder}/${filename}`)
  return rel(dest)
}

/** Keep an entity row honest after an asset lands: variant_count, a canonical if it had none. */
export function syncEntityRow(row, assets, variant) {
  const variants = new Set(assets.filter((a) => a.entity_id === row.id).map((a) => a.variant))
  row.variant_count = String(variants.size)
  if (!row.canonical_variant) row.canonical_variant = variant
  if (row.status === 'RESERVED') row.status = 'CONCEPT'
  row.flags = (row.flags || '')
    .split(';').map((f) => f.trim())
    .filter((f) => f && f !== 'NO-ASSET' && f !== 'NEEDS-HERO-SHEET')
    .join(';')
}

// ---------------------------------------------------------------- uploads

export { FOLDER_FOR }
const UPLOAD_ROLES = ['HERO', 'TURNAROUND', 'PLATE', 'DETAIL', 'BOARD']
const UPLOAD_EXT = ['.png', '.jpg', '.jpeg', '.webp']
const ASCII = /^[\x20-\x7E]*$/

export const entitySlug = (s) =>
  String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40).replace(/-+$/, '')
export const descriptorSlug = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 48).replace(/-+$/, '') || 'upload'

/**
 * A reviewer's upload failed a rule. Distinct from an I/O error: retrying a
 * rule failure can never succeed, so the decision is marked failed instead.
 */
export class FilingError extends Error {}

/** Next free look number. `reserved` holds variants still in the archive (see archivedVariants). */
export function nextVariant(assets, entityId, reserved = []) {
  const used = [...assets.filter((a) => a.entity_id === entityId).map((a) => a.variant), ...reserved]
    .map((v) => parseInt(String(v).replace(/^V/i, ''), 10))
    .filter((n) => Number.isFinite(n))
  return 'V' + String(used.length ? Math.max(...used) + 1 : 1).padStart(2, '0')
}

function uploadSource(upload, { allowStaging = false } = {}) {
  const src = path.resolve(ROOT, String(upload.file || ''))
  // A reference-studio pick files a generated try straight from _staging.
  const inStaging = allowStaging && src.startsWith(P.staging + path.sep)
  if (!src.startsWith(P.uploads + path.sep) && !inStaging) {
    throw new FilingError(`${upload.id}: file is not inside 09_OUTPUT/_uploads`)
  }
  const ext = path.extname(src).toLowerCase()
  if (!UPLOAD_EXT.includes(ext)) throw new FilingError(`${upload.id}: unsupported type ${ext}`)
  return { src, ext }
}

/**
 * Check every upload on a decision against the registries without touching
 * anything, so a decision with one bad upload files none of them.
 */
export async function checkUploads(uploads, alreadyFiled = new Set(), { allowGroups = false } = {}) {
  const entities = await loadEntities()
  const claimed = new Set()
  const plan = []
  for (const u of uploads) {
    if (alreadyFiled.has(u.id)) continue
    const { src } = uploadSource(u)
    try { await fs.access(src) } catch { throw new FilingError(`${u.id}: uploaded file is missing (${u.file})`) }
    if (!UPLOAD_ROLES.includes(u.role)) throw new FilingError(`${u.id}: unknown role '${u.role}'`)
    if (!ASCII.test(u.descriptor || '')) throw new FilingError(`${u.id}: description must be English`)

    if (u.groupOf) {
      // Another look of the new entity an earlier upload proposes. Nothing is
      // auto-created to make this succeed (CLAUDE.md): the target is made in
      // this same op by a sibling upload Hamed confirmed on screen.
      //
      // "Strictly earlier in the array" plus "the leader is not itself grouped"
      // makes a cycle unrepresentable, so there is nothing to traverse.
      if (!allowGroups) throw new FilingError(`${u.id}: grouped uploads are only allowed on a References add`)
      if (u.mode !== 'variant') throw new FilingError(`${u.id}: a grouped upload is a new look, not a new entity`)
      if (u.entity) throw new FilingError(`${u.id}: a grouped upload names no entity; it uses the one ${u.groupOf} creates`)
      const lead = uploads.slice(0, uploads.indexOf(u)).find((x) => x.id === u.groupOf)
      if (!lead) throw new FilingError(`${u.id}: ${u.groupOf} is not an earlier upload in this request`)
      if (lead.mode !== 'new') throw new FilingError(`${u.id}: ${u.groupOf} is not a new entity`)
      if (lead.groupOf) throw new FilingError(`${u.id}: ${u.groupOf} is itself grouped; groups are one level deep`)
      plan.push(`${u.id} -> another look of the new entity from ${u.groupOf}`)
      continue
    }

    if (u.mode === 'variant') {
      const ent = findEntity(entities, u.entity || '')
      // Never create a missing target to make an upload succeed.
      if (!ent) throw new FilingError(`${u.id}: unknown entity '${u.entity}'`)
      if (ent.status === 'RETIRED') throw new FilingError(`${u.id}: ${ent.id} is RETIRED`)
      plan.push(`${u.id} -> new look of ${ent.id}`)
    } else if (u.mode === 'new') {
      if (!FOLDER_FOR[u.kind]) throw new FilingError(`${u.id}: unknown kind '${u.kind}'`)
      if (!ASCII.test(u.name || '') || !ASCII.test(u.description || '')) {
        throw new FilingError(`${u.id}: entity name and description must be English`)
      }
      const slug = entitySlug(u.name)
      if (!slug) throw new FilingError(`${u.id}: entity name has no usable letters`)
      const clash = entities.find((e) => e.slug === slug)
      if (clash) throw new FilingError(`${u.id}: slug '${slug}' already exists as ${clash.id}`)
      if (claimed.has(slug)) throw new FilingError(`${u.id}: slug '${slug}' used twice in one decision`)
      claimed.add(slug)
      plan.push(`${u.id} -> new ${u.kind} '${slug}'`)
    } else {
      throw new FilingError(`${u.id}: unknown mode '${u.mode}'`)
    }
  }
  return plan
}

/**
 * Next free entity number for a kind: max of every row of that kind, RETIRED
 * included, plus one -- the same rule as Ingest-Jobs.ps1, so numbers are never
 * reused. The only allocators in the system are that script, fileUpload below,
 * and the batch approver (worker/lib/job-requests.mjs); all three call this.
 */
export function nextEntityNumber(rows, kind) {
  const used = rows.filter((e) => e.kind === kind).map((e) => parseInt(e.number, 10)).filter((n) => Number.isFinite(n))
  return String(used.length ? Math.max(...used) + 1 : 1).padStart(3, '0')
}

/**
 * Reserve a number for a NEW/KIND/SLUG proposal: pushes a row shaped exactly
 * like the one Ingest-Jobs.ps1 writes (RESERVED, NO-ASSET, no look yet) and
 * returns it. The caller writes the CSV.
 */
export function reserveEntity(rows, { kind, slug, name, description, by }) {
  const nnn = nextEntityNumber(rows, kind)
  const row = {
    id: fullEntityId(CODE, kind, nnn, slug),
    short_id: `${kind}-${nnn}`,
    kind,
    number: nnn,
    slug,
    name: String(name || '').trim() || slug.replace(/-/g, ' '),
    family: slug.split('-')[0],
    status: 'RESERVED',
    canonical_variant: '',
    variant_count: '0',
    folder: FOLDER_FOR[kind],
    related: '',
    flags: 'NO-ASSET',
    description: String(description || '').trim() || `Reserved by ${by}. Description pending.`,
  }
  rows.push(row)
  return row
}

/**
 * File one reviewer upload into the index -- a new look of an existing entity,
 * or a brand-new entity -- against the IN-MEMORY registries of a transaction
 * the caller owns. Returns the @-token that now resolves to it.
 *
 * The caller owns the transaction so that a batch can be one unit: the
 * References page files up to forty at a time, and forty either all land or
 * none of them do. `fileUpload` below is this same work for a single upload.
 *
 * Numbers are allocated with nextEntityNumber, the same rule as Ingest-Jobs.ps1,
 * and reading them from `tx.entities` is what makes two new entities in one op
 * take 012 then 013: the first one's row is already in the array.
 *
 * `resolveGroup` maps an upload id to the entity a sibling upload in this same
 * op has just created, for a file that is another look of something new. A
 * caller that passes none refuses `groupOf` outright -- only a References batch
 * add groups, and a Review decision must never be able to.
 */
export async function fileUploadInto(tx, upload, decision, {
  resolveGroup = null,
  /** 'higgsfield' for a reference-studio pick: a generation, filed like an upload. */
  source = 'upload',
  allowStaging = false,
  /** File as the next take of this look instead of a new look: a second pick from the same studio try. */
  takeOf = null,
  notes = null,
} = {}) {
  const { src, ext } = uploadSource(upload, { allowStaging })

  let ent
  let variant
  let take = 'T01'
  if (takeOf) {
    ent = findEntity(tx.entities, takeOf.entity)
    if (!ent) throw new FilingError(`${upload.id}: unknown entity '${takeOf.entity}'`)
    variant = takeOf.variant
    take = nextTake(tx.assets, ent.id, variant)
  } else if (upload.groupOf) {
    if (!resolveGroup) throw new FilingError(`${upload.id}: grouped uploads are not allowed here`)
    ent = findEntity(tx.entities, resolveGroup(upload.groupOf) || '')
    if (!ent) throw new FilingError(`${upload.id}: ${upload.groupOf} was not filed`)
    variant = nextVariant(tx.assets, ent.id, await archivedVariants(ent.short_id))
  } else if (upload.mode === 'variant') {
    ent = findEntity(tx.entities, upload.entity)
    if (!ent) throw new FilingError(`${upload.id}: unknown entity '${upload.entity}'`)
    variant = nextVariant(tx.assets, ent.id, await archivedVariants(ent.short_id))
  } else {
    const kind = upload.kind
    const slug = entitySlug(upload.name)
    const clash = tx.entities.find((e) => e.slug === slug)
    if (clash) throw new FilingError(`${upload.id}: slug '${slug}' already exists as ${clash.id}`)
    const nnn = nextEntityNumber(tx.entities, kind)
    ent = {
      id: fullEntityId(CODE, kind, nnn, slug),
      short_id: `${kind}-${nnn}`,
      kind,
      number: nnn,
      slug,
      name: String(upload.name).trim(),
      family: slug.split('-')[0],
      status: 'CONCEPT',
      canonical_variant: '',
      variant_count: '0',
      folder: FOLDER_FOR[kind],
      related: '',
      flags: '',
      description: String(upload.description || '').trim()
        || `Uploaded by ${decision.reviewer} on ${decision.id}.`,
    }
    tx.entities.push(ent)
    variant = 'V01'
  }

  // T01 is implicit in the filename grammar; only later takes carry _T.
  const filename = `${ent.id}_${variant}${take === 'T01' ? '' : `_${take}`}_${descriptorSlug(upload.descriptor)}${ext}`
  const dest = path.join(ROOT, ent.folder, filename)

  if (await exists(dest)) {
    // A registered file with this name is a real clash. An unregistered one
    // with identical bytes is this same upload left behind by an interrupted
    // filing -- adopt it instead of failing forever. Checked here rather than
    // left to tx.move, which refuses an occupied destination outright.
    const registered = tx.assets.some((a) => a.folder === ent.folder && a.filename === filename)
    if (registered || !(await sameBytes(src, dest))) {
      throw new FilingError(`${upload.id}: ${filename} already exists`)
    }
    await log(`ADOPTING unregistered ${ent.folder}/${filename} left by an interrupted filing`)
  } else {
    // A move, not a copy: it reverses itself if anything later in the batch
    // throws, so the upload is back in _uploads for the retry.
    await tx.move(src, dest)
  }

  tx.assets.push({
    filename,
    entity_id: ent.id,
    variant,
    take,
    role: upload.role,
    status: 'CONCEPT',
    folder: ent.folder,
    source,
    original_filename: String(upload.originalName || path.basename(src)),
    added: new Date().toISOString().slice(0, 10),
    notes: notes ?? `Uploaded by ${decision.reviewer} on ${decision.id}`,
  })
  syncEntityRow(tx.entities.find((r) => r.id === ent.id), tx.assets, variant)

  const token = `@${ent.short_id}/${variant}${take === 'T01' ? '' : `/${take}`}`
  await log(`FILED ${source === 'upload' ? 'upload' : source} ${decision.id}/${upload.id} -> ${ent.folder}/${filename} (${token})`)
  return { token, entity: ent.id, filename: `${ent.folder}/${filename}` }
}

/**
 * One upload, in a transaction of its own. What a review decision and a
 * regenerate request use; neither may group.
 */
export async function fileUpload(upload, decision) {
  const { src } = uploadSource(upload)
  return transaction(async (tx) => ({
    summary: await fileUploadInto(tx, upload, decision),
    // Once the registries are committed the source has no reader left. The
    // move above already took it; this is for the adopted-orphan case.
    after: () => fs.rm(src, { force: true }),
  }))
}

async function exists(p) {
  try { await fs.access(p); return true } catch { return false }
}

async function sameBytes(a, b) {
  const [x, y] = await Promise.all([fs.readFile(a), fs.readFile(b)])
  return x.equals(y)
}

export async function reject(decision) {
  const src = path.join(ROOT, decision.candidate)
  const destDir = path.join(P.rejected, decision.hfJobId)
  await fs.mkdir(destDir, { recursive: true })
  const dest = path.join(destDir, path.basename(src))
  try {
    await fs.copyFile(src, dest)
    await fs.rm(src, { force: true })
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }
  // Rejected candidates are kept, not deleted: they are the negative half of
  // the training signal that /learn distills rules from.
  await appendJsonl(path.join(P.rejected, 'index.jsonl'), {
    ...decision, rejectedTo: rel(dest),
  })
  await log(`REJECTED ${decision.candidate} -> ${rel(dest)}`)
  return rel(dest)
}
