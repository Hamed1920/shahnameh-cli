#!/usr/bin/env node
/**
 * Queue many generation jobs at once from a JSON file.
 *
 *   node worker/enqueue-batch.mjs <batch.json> [--dry-run]
 *
 * The batch file is a JSON array. Only `target` and `prompt` are required:
 *
 *   [
 *     { "target": "PRP-002", "prompt": "...", "variant": "V01",
 *       "model": "nano_banana_2", "refs": ["@CHR-001/V02"],
 *       "params": { "aspect_ratio": "16:9" }, "label": "staff turnaround" }
 *   ]
 *
 * Every target must ALREADY EXIST. This tool never allocates an entity number —
 * that stays with Ingest-Jobs.ps1 so there is exactly one allocator in the system
 * (INDEXING.md section 9). Register new entities first, then queue against them.
 *
 * Invalid rows are reported and skipped; valid rows still queue. A 200-prompt PDF
 * should not be blocked by one bad line.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { P, appendJsonl, findEntity, loadEntities, readCsv, resolveRef } from './lib/project.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const cfg = JSON.parse(await fs.readFile(path.join(HERE, 'config.json'), 'utf8'))

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const file = args.find((a) => !a.startsWith('--'))

if (!file) {
  console.error('Usage: node worker/enqueue-batch.mjs <batch.json> [--dry-run]')
  process.exit(2)
}

let batch
try {
  batch = JSON.parse(await fs.readFile(path.resolve(file), 'utf8'))
} catch (e) {
  console.error(`Cannot read batch file: ${e.message}`)
  process.exit(2)
}
if (!Array.isArray(batch)) {
  console.error('Batch file must contain a JSON array.')
  process.exit(2)
}

const entities = await loadEntities()
const { rows: assets } = await readCsv(P.manifest)

const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
const seen = new Set()
const ok = []
const bad = []

for (const [i, raw] of batch.entries()) {
  const at = raw.label ? `"${raw.label}"` : `#${i + 1}`

  if (!raw || typeof raw !== 'object') { bad.push([at, 'not an object']); continue }
  if (!raw.target) { bad.push([at, 'missing target']); continue }
  if (!raw.prompt || !String(raw.prompt).trim()) { bad.push([at, 'missing prompt']); continue }

  const entity = findEntity(entities, raw.target)
  if (!entity) {
    bad.push([at, `unknown target '${raw.target}' - register it first, never auto-created`])
    continue
  }

  const variant = raw.variant || entity.canonical_variant || 'V01'

  // Resolve refs now so a broken reference is caught before any credits are spent.
  let refErr = null
  for (const token of raw.refs ?? []) {
    const r = await resolveRef(token, entities, assets)
    if (!r.ok) { refErr = `unresolved ref ${token}: ${r.reason}`; break }
  }
  if (refErr) { bad.push([at, refErr]); continue }

  // Deduplicate within the batch: the same entity+variant+prompt twice is
  // almost always a copy-paste artefact in a long PDF, not an intentional pair.
  const key = `${entity.id}|${variant}|${String(raw.prompt).trim()}`
  if (seen.has(key)) { bad.push([at, 'duplicate of an earlier row in this batch']); continue }
  seen.add(key)

  ok.push({
    jobId: `J-${stamp}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
    parentJobId: null,
    attempt: 1,
    target: entity.id,
    variant,
    model: raw.model || cfg.defaultImageModel,
    prompt: String(raw.prompt).trim(),
    basePrompt: String(raw.prompt).trim(),
    params: raw.params ?? {},
    refs: raw.refs ?? [],
    revisionNotes: [],
    label: raw.label ?? null,
    enqueuedAt: new Date().toISOString(),
    enqueuedBy: process.env.USERNAME || 'batch',
  })
}

for (const [at, why] of bad) console.log(`  SKIP ${at}: ${why}`)
if (bad.length) console.log('')

if (DRY) {
  console.log(`DRY RUN - nothing queued.`)
  console.log(`  would queue : ${ok.length}`)
  console.log(`  skipped     : ${bad.length}`)
  for (const j of ok) console.log(`    ${j.target} ${j.variant}  ${j.model}  ${j.prompt.slice(0, 60)}...`)
  process.exit(bad.length ? 1 : 0)
}

for (const j of ok) await appendJsonl(P.queue, j)

console.log(`Queued ${ok.length} job(s), skipped ${bad.length}.`)
if (ok.length) {
  console.log('')
  console.log('Price them without spending:  npm run worker:dry')
  console.log('Then generate:                npm run worker')
}
process.exit(bad.length ? 1 : 0)
