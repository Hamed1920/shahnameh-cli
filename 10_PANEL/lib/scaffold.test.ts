import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/**
 * Creating a project from the panel. The registries it writes must match the
 * ones the worker and the PowerShell tools expect exactly -- a header typed one
 * column short here would only show up as a corrupt registry days later.
 */

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fmfd-scaffold-'))
process.env.SHM_PROJECTS = dir
const { ProjectInvalid, checkNew, createProject } = await import('./scaffold.ts')

const read = (slug: string, rel: string) => fs.readFile(path.join(dir, slug, rel), 'utf8')

const made = await createProject({
  name: 'The Silk Road', slug: 'silk-road', code: 'TSR', description: 'A caravan crossing.',
})

test('the project is readable back, with its code and name', () => {
  assert.equal(made.slug, 'silk-road')
  assert.equal(made.code, 'TSR')
  assert.equal(made.mark, 'T')
})

test('registry headers match the worker and the tools, byte for byte', async () => {
  assert.equal(
    (await read('silk-road', '00_PROJECT/registry/ENTITIES.csv')).trim(),
    'id,short_id,kind,number,slug,name,family,status,canonical_variant,variant_count,folder,related,flags,description',
  )
  assert.equal(
    (await read('silk-road', '00_PROJECT/registry/ASSET_MANIFEST.csv')).trim(),
    'filename,entity_id,variant,take,role,status,folder,source,original_filename,added,notes',
  )
  assert.equal((await read('silk-road', '00_PROJECT/registry/EPISODES.csv')).trim(), 'id,type,title,status,entities_used,notes')
  assert.equal(
    (await read('silk-road', '00_PROJECT/sync/JOB_LEDGER.csv')).trim(),
    'job_id,content_hash,author,type,target,resolved_target,variant,engine,state,ingested,source_file,parent_job_id,hf_job_id,attempt,cost',
  )
})

test('state.json is the full empty shape, and carries no BOM', async () => {
  const raw = await read('silk-road', '00_PROJECT/queue/state.json')
  assert.ok(!raw.startsWith('﻿'), 'a BOM would stop Node parsing it')
  assert.deepEqual(JSON.parse(raw), {
    processedJobs: [], processedDecisions: [], processedOps: [], processedRequests: [],
    failedDecisions: {}, held: {}, learnWatermark: '', spentCredits: 0,
  })
  assert.ok(!(await read('silk-road', 'project.json')).startsWith('﻿'))
})

test('every folder a project needs is there, and the queue files are empty', async () => {
  for (const folder of [
    '00_PROJECT', '01_CHARACTERS', '02_GROUPS', '03_LOCATIONS', '04_PROPS', '05_CREATURES',
    '06_COSTUMES', '07_EPISODES', '08_REFERENCE', '09_OUTPUT', '99_INBOX',
  ]) {
    assert.ok((await fs.stat(path.join(dir, 'silk-road', folder))).isDirectory(), `${folder} is missing`)
  }
  assert.equal((await read('silk-road', '00_PROJECT/queue/QUEUE.jsonl')).trim(), '')
  assert.equal((await read('silk-road', '00_PROJECT/review/REVIEW_LOG.jsonl')).trim(), '')
})

test('the placeholders are filled in, not left in the text', async () => {
  const log = await read('silk-road', '00_PROJECT/PROJECT_LOG.md')
  assert.match(log, /The Silk Road/)
  assert.match(log, /TSR/)
  assert.doesNotMatch(log, /\{\{/)
  assert.doesNotMatch(await read('silk-road', '07_EPISODES/_TEMPLATE/README.md'), /\{\{/)
})

test('a second project cannot take the same folder or the same code', async () => {
  await assert.rejects(() => checkNew({ name: 'Other', slug: 'silk-road', code: 'OTH' }), ProjectInvalid)
  await assert.rejects(() => checkNew({ name: 'Other', slug: 'other', code: 'TSR' }), ProjectInvalid)
  // Codes that would make an ID ambiguous, and folder names the panel uses.
  await assert.rejects(() => checkNew({ name: 'Other', slug: 'other', code: 'CHR' }), ProjectInvalid)
  await assert.rejects(() => checkNew({ name: 'Other', slug: 'other', code: 'toolong' }), ProjectInvalid)
  await assert.rejects(() => checkNew({ name: 'Other', slug: 'api', code: 'OTH' }), ProjectInvalid)
  await assert.rejects(() => checkNew({ name: 'Other', slug: '../escape', code: 'OTH' }), ProjectInvalid)
  await assert.rejects(() => checkNew({ name: '', slug: 'other', code: 'OTH' }), ProjectInvalid)
})

test('a new project opts itself into git, so it is not silently untracked', async () => {
  await fs.writeFile(path.join(dir, '.gitignore'), '/*\n!/silk-road/\n\n# The half-built folder\n/.new-*\n', 'utf8')
  await createProject({ name: 'Second Film', slug: 'second-film', code: 'SEF', description: '' })
  const gitignore = await fs.readFile(path.join(dir, '.gitignore'), 'utf8')
  assert.match(gitignore, /^!\/second-film\/$/m)
  // Added to the projects block, above the half-built-folder rule.
  assert.ok(gitignore.indexOf('!/second-film/') < gitignore.indexOf('# The half-built folder'))
})

test.after(() => fs.rm(dir, { recursive: true, force: true }))
