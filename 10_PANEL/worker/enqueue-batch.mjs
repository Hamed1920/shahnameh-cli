#!/usr/bin/env node
/**
 * Queue many generation jobs at once from a JSON file.
 *
 *   node worker/enqueue-batch.mjs --project <slug> <batch.json> [--dry-run]
 *
 * The batch file is a JSON array. Only `target` and `prompt` are required:
 *
 *   [
 *     { "target": "PRP-002", "prompt": "...", "variant": "V01",
 *       "model": "nano_banana_2", "refs": ["@CHR-001/V02"],
 *       "params": { "aspect_ratio": "16:9" }, "label": "staff turnaround" }
 *   ]
 *
 * Every target must ALREADY EXIST. This tool never allocates an entity number -
 * that stays with Ingest-Jobs.ps1 and with the worker at batch approval (the
 * Prompts page), so the list of allocators is short and known (INDEXING.md
 * section 9). Register new entities first, then queue against them.
 *
 * Invalid rows are reported and skipped; valid rows still queue. A 200-prompt PDF
 * should not be blocked by one bad line.
 *
 * The rules live in worker/lib/batch.mjs, shared with the worker.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { P, appendJsonl, loadEntities, readCsv } from './lib/project.mjs'
import { checkBatch, makeJob, newJobId } from './lib/batch.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const cfg = JSON.parse(await fs.readFile(path.join(HERE, 'config.json'), 'utf8'))

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
// The value after --project is the project's folder name, not the batch file.
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--project')

if (!file) {
  console.error('Usage: node worker/enqueue-batch.mjs --project <slug> <batch.json> [--dry-run]')
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
const { ok: rows, bad } = await checkBatch(batch, { entities, assets, cfg, allowNew: false })
const ok = rows.map((row) => makeJob(row, { jobId: newJobId(), enqueuedBy: process.env.USERNAME || 'batch' }))

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
