#!/usr/bin/env node
/**
 * Add a generation job to the queue.
 *
 *   node worker/enqueue.mjs --target PRP-002 --prompt "..." [options]
 *
 * Options:
 *   --target   <id>       entity, short (PRP-002) or full (SHM-PRP-002-...)   [required]
 *   --prompt   <text>     the prompt                                          [required]
 *   --variant  <V01>      defaults to the entity's canonical variant
 *   --model    <name>     defaults to config.defaultImageModel
 *   --ref      <@token>   reference asset, repeatable (@CHR-001/V02)
 *   --param    k=v        extra CLI param, repeatable
 *
 * The worker allocates nothing here except the job id — entity numbers are
 * still owned by Ingest-Jobs.ps1, per INDEXING.md section 9.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { P, appendJsonl, findEntity, loadEntities } from './lib/project.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const cfg = JSON.parse(await fs.readFile(path.join(HERE, 'config.json'), 'utf8'))

function parseArgs(argv) {
  const out = { refs: [], params: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--target') out.target = next()
    else if (a === '--prompt') out.prompt = next()
    else if (a === '--variant') out.variant = next()
    else if (a === '--model') out.model = next()
    else if (a === '--ref') out.refs.push(next())
    else if (a === '--param') {
      const [k, ...rest] = next().split('=')
      out.params[k] = rest.join('=')
    }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
if (!args.target || !args.prompt) {
  console.error('Required: --target <entity-id> --prompt "<text>"')
  process.exit(2)
}

const entities = await loadEntities()
const entity = findEntity(entities, args.target)
if (!entity) {
  console.error(`Unknown entity '${args.target}'.`)
  console.error('Entities are never auto-created — register it first, then enqueue.')
  process.exit(2)
}

const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
const jobId = `J-${stamp}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`
const variant = args.variant || entity.canonical_variant || 'V01'

await appendJsonl(P.queue, {
  jobId,
  parentJobId: null,
  attempt: 1,
  target: entity.id,
  variant,
  model: args.model || cfg.defaultImageModel,
  prompt: args.prompt,
  basePrompt: args.prompt,
  params: args.params,
  refs: args.refs,
  revisionNotes: [],
  enqueuedAt: new Date().toISOString(),
  enqueuedBy: process.env.USERNAME || 'cli',
})

console.log(`Queued ${jobId}`)
console.log(`  target  ${entity.id} ${variant}`)
console.log(`  model   ${args.model || cfg.defaultImageModel}`)
if (args.refs.length) console.log(`  refs    ${args.refs.join(', ')}`)
console.log('\nStart the worker to run it:  npm run worker')
