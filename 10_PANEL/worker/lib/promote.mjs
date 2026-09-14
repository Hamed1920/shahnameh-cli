import fs from 'node:fs/promises'
import path from 'node:path'
import {
  P, ROOT, appendJsonl, archivedVariants, findEntity, isShotId, loadEntities, log, readCsv, readText, rel,
  restoreText, shotFolder, writeCsv,
} from './project.mjs'
import { parseCsv } from './csv.mjs'

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

/** Mirrors $FOLDER_FOR in Ingest-Jobs.ps1. */
export const FOLDER_FOR = {
  CHR: '01_CHARACTERS', GRP: '02_GROUPS', LOC: '03_LOCATIONS', PRP: '04_PROPS',
  CRT: '05_CREATURES', COS: '06_COSTUMES', VEH: '04_PROPS', FX: '08_REFERENCE', REF: '08_REFERENCE',
}
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

function uploadSource(upload) {
  const src = path.resolve(ROOT, String(upload.file || ''))
  if (!src.startsWith(P.uploads + path.sep)) {
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
export async function checkUploads(uploads, alreadyFiled = new Set()) {
  const entities = await loadEntities()
  const claimed = new Set()
  const plan = []
  for (const u of uploads) {
    if (alreadyFiled.has(u.id)) continue
    const { src } = uploadSource(u)
    try { await fs.access(src) } catch { throw new FilingError(`${u.id}: uploaded file is missing (${u.file})`) }
    if (!UPLOAD_ROLES.includes(u.role)) throw new FilingError(`${u.id}: unknown role '${u.role}'`)
    if (!ASCII.test(u.descriptor || '')) throw new FilingError(`${u.id}: description must be English`)

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
 * File one reviewer upload into the index: a new variant of an existing entity,
 * or a brand-new entity. Returns the @-token that now resolves to it.
 *
 * Numbers are allocated here with the same rule as Ingest-Jobs.ps1 -- max of
 * every row of that kind, RETIRED included, plus one -- so they are never reused.
 */
export async function fileUpload(upload, decision) {
  const { src, ext } = uploadSource(upload)
  // Snapshot both registries as text: if anything below fails half-way, they
  // are put back byte for byte and the copied file removed, so a retry starts
  // from exactly the state this one did.
  const [entitiesText, manifestText] = await Promise.all([readText(P.entities), readText(P.manifest)])
  const { header: eHeader, rows: eRows } = parseCsv(entitiesText)
  const { header: mHeaderIn, rows: assets } = parseCsv(manifestText)
  const mHeader = mHeaderIn.length ? mHeaderIn : MANIFEST_HEADER

  let ent
  let variant
  if (upload.mode === 'variant') {
    ent = findEntity(eRows, upload.entity)
    if (!ent) throw new FilingError(`${upload.id}: unknown entity '${upload.entity}'`)
    variant = nextVariant(assets, ent.id, await archivedVariants(ent.short_id))
  } else {
    const kind = upload.kind
    const slug = entitySlug(upload.name)
    const clash = eRows.find((e) => e.slug === slug)
    if (clash) throw new FilingError(`${upload.id}: slug '${slug}' already exists as ${clash.id}`)
    const used = eRows.filter((e) => e.kind === kind).map((e) => parseInt(e.number, 10))
      .filter((n) => Number.isFinite(n))
    const nnn = String(used.length ? Math.max(...used) + 1 : 1).padStart(3, '0')
    ent = {
      id: `SHM-${kind}-${nnn}-${slug}`,
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
    eRows.push(ent)
    variant = 'V01'
  }

  const filename = `${ent.id}_${variant}_${descriptorSlug(upload.descriptor)}${ext}`
  const destDir = path.join(ROOT, ent.folder)
  const dest = path.join(destDir, filename)

  let copied = false
  if (await exists(dest)) {
    // A registered file with this name is a real clash. An unregistered one
    // with identical bytes is this same upload left behind by an interrupted
    // filing (before rollback existed) -- adopt it instead of failing forever.
    const registered = assets.some((a) => a.folder === ent.folder && a.filename === filename)
    if (registered || !(await sameBytes(src, dest))) {
      throw new FilingError(`${upload.id}: ${filename} already exists`)
    }
    await log(`ADOPTING unregistered ${ent.folder}/${filename} left by an interrupted filing`)
  } else {
    await fs.mkdir(destDir, { recursive: true })
    await fs.copyFile(src, dest)
    copied = true
  }

  try {
    await registerUpload()
  } catch (e) {
    await log(`ROLLBACK upload ${decision.id}/${upload.id}: ${e.message}`)
    if (copied) await fs.rm(dest, { force: true }).catch(() => {})
    await restoreText(P.manifest, manifestText).catch((r) => log(`ROLLBACK manifest failed: ${r.message}`))
    await restoreText(P.entities, entitiesText).catch((r) => log(`ROLLBACK entities failed: ${r.message}`))
    throw e
  }
  await fs.rm(src, { force: true })

  const token = `@${ent.short_id}/${variant}`
  await log(`FILED upload ${decision.id}/${upload.id} -> ${ent.folder}/${filename} (${token})`)
  return { token, entity: ent.id, filename: `${ent.folder}/${filename}` }

  // Both registry writes, as one unit that the caller can roll back.
  async function registerUpload() {
    assets.push({
      filename,
      entity_id: ent.id,
      variant,
      take: 'T01',
      role: upload.role,
      status: 'CONCEPT',
      folder: ent.folder,
      source: 'upload',
      original_filename: String(upload.originalName || path.basename(src)),
      added: new Date().toISOString().slice(0, 10),
      notes: `Uploaded by ${decision.reviewer} on ${decision.id}`,
    })
    await writeCsv(P.manifest, assets, mHeader)

    syncEntityRow(eRows.find((r) => r.id === ent.id), assets, variant)
    await writeCsv(P.entities, eRows, eHeader)
  }
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
