import fs from 'node:fs/promises'
import path from 'node:path'
import {
  P, ROOT, appendJsonl, findEntity, loadEntities, log, readCsv, rel, writeCsv,
} from './project.mjs'

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

export async function promote(decision, sidecar) {
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

  // Keep the entity row honest: variant_count, and a canonical if it had none.
  const { header: eHeader, rows: eRows } = await readCsv(P.entities)
  const row = eRows.find((r) => r.id === ent.id)
  if (row) {
    const variants = new Set(
      assets.filter((a) => a.entity_id === ent.id).map((a) => a.variant),
    )
    row.variant_count = String(variants.size)
    if (!row.canonical_variant) row.canonical_variant = variant
    if (row.status === 'RESERVED') row.status = 'CONCEPT'
    row.flags = (row.flags || '')
      .split(';').map((f) => f.trim())
      .filter((f) => f && f !== 'NO-ASSET' && f !== 'NEEDS-HERO-SHEET')
      .join(';')
    await writeCsv(P.entities, eRows, eHeader)
  }

  await log(`PROMOTED ${decision.candidate} -> ${ent.folder}/${filename}`)
  return rel(dest)
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
