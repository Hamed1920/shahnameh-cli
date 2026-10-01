import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * The worker's money-safety rules, against a throwaway project and a fake CLI
 * that refuses to price the way CLI 1.1.26 does with no workspace selected.
 * project.mjs reads SHM_ROOT when it is imported, so everything is imported
 * dynamically once the folder exists.
 */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fmfd-worker-'))
const ROOT = path.join(TMP, 'tst')
const CLI = path.join(TMP, 'fake-cli.cjs')

let lib = {}

before(async () => {
  for (const d of ['00_PROJECT/queue', '00_PROJECT/review', '00_PROJECT/registry', '00_PROJECT/sync', '09_OUTPUT/_archive']) {
    fs.mkdirSync(path.join(ROOT, d), { recursive: true })
  }
  fs.writeFileSync(path.join(ROOT, 'project.json'), JSON.stringify({ schema: 1, name: 'Test', slug: 'tst', code: 'TST', description: '', created: '2026-09-26' }))
  fs.writeFileSync(path.join(ROOT, '00_PROJECT/registry/ENTITIES.csv'), 'id,short_id,kind,number,slug,name,family,status,canonical_variant,variant_count,folder,related,flags,description\n')
  fs.writeFileSync(path.join(ROOT, '00_PROJECT/registry/ASSET_MANIFEST.csv'), 'filename,entity_id,variant,take,role,status,folder,source,original_name,added,notes\n')
  fs.writeFileSync(CLI, [
    "const [cmd, sub] = process.argv.slice(2)",
    "if (cmd === 'auth' && sub === 'token') { process.stdout.write('tok'); process.exit(0) }",
    "if (cmd === 'workspace') { process.stdout.write('Private'); process.exit(0) }",
    "process.stderr.write('Error: No workspace selected.\\nHint: Run: hf workspace set <workspace_id>\\n'); process.exit(4)",
  ].join('\n'))
  process.env.SHM_ROOT = ROOT
  process.env.SHM_PROJECTS = TMP
  process.env.SHM_HIGGSFIELD_JS = CLI
  process.env.SHM_MACHINE = 'test-a'
  // The throwaway project is not a git clone; keep the pull-first check from asking anyway.
  process.env.SHM_GIT_GUARD = 'off'
  lib = {
    locks: await import('./lib/locks.mjs'),
    hf: await import('./lib/hf.mjs'),
    spend: await import('./lib/spend.mjs'),
    project: await import('./lib/project.mjs'),
    requests: await import('./lib/job-requests.mjs'),
    promote: await import('./lib/promote.mjs'),
  }
})

after(() => fs.rmSync(TMP, { recursive: true, force: true }))

test('a lock held by a dead pid is reclaimed; one this process holds is kept', async () => {
  const { acquireFileLock, releaseFileLock, readLock } = lib.locks
  const file = path.join(TMP, 'a.lock')
  fs.writeFileSync(file, '999999999 someone\nstarted=1 heartbeat=30\n')
  assert.equal(await acquireFileLock(file), true)
  const held = await readLock(file)
  assert.equal(held.pid, process.pid)
  assert.equal(held.heartbeat, true)
  assert.equal(await acquireFileLock(file), true, 're-entrant for its holder')
  await releaseFileLock(file)
  assert.equal(fs.existsSync(file), false)
})

test('a heartbeat lock nobody touched for minutes is stale even when its pid is alive', async () => {
  const { lockIsStale, readLock, STALE_MS } = lib.locks
  const file = path.join(TMP, 'b.lock')
  // process.pid is alive: only the missed heartbeat can make this stale.
  fs.writeFileSync(file, `${process.pid}\nstarted=1 heartbeat=30\n`)
  const old = new Date(Date.now() - STALE_MS - 60_000)
  fs.utimesSync(file, old, old)
  assert.equal(lockIsStale(await readLock(file)), true)
  // The same age without the heartbeat line (older code) is judged by the pid alone.
  fs.writeFileSync(file, `${process.pid}\n`)
  fs.utimesSync(file, old, old)
  assert.equal(lockIsStale(await readLock(file)), false)
})

test('the start time comes from the lock, not its mtime (the heartbeat moves the mtime)', async () => {
  const file = path.join(TMP, 'c.lock')
  fs.writeFileSync(file, `${process.pid}\nstarted=1700000000000 heartbeat=30\n`)
  assert.equal((await lib.locks.readLock(file)).startedMs, 1700000000000)
})

test('CLI failures read as something a person can act on', () => {
  const { cliProblem, CLI_MISSING } = lib.hf
  assert.match(cliProblem('Error: No workspace selected.'), /workspace set/)
  assert.match(cliProblem(CLI_MISSING), /npm i -g @higgsfield\/cli/)
  assert.match(cliProblem('Error: 401 Unauthorized'), /auth login/)
  assert.match(cliProblem('Error: Not authenticated.'), /auth login/)
  assert.equal(cliProblem('Error: model foo does not exist\nmore'), 'Error: model foo does not exist')
})

test('a price the CLI refuses comes back null, with the reason', async () => {
  const r = await lib.hf.estimateCost('seedance_2_5', { duration: 5 })
  assert.equal(r.credits, null)
  assert.match(r.error, /workspace/)
})

test('the spend window counts what may have been charged, not what the CLI refused', () => {
  const now = Date.parse('2026-09-26T12:00:00Z')
  const at = '2026-09-26T11:00:00Z'
  const rows = [
    { state: 'GENERATED', cost: '10', ingested: at },
    { state: 'NO_RESULT', cost: '20', ingested: at },
    { state: 'TIMED_OUT', cost: '40', ingested: at },
    { state: 'FAILED', cost: '80', ingested: at },
  ]
  assert.equal(lib.spend.spentInWindow(rows, 24, now), 70)
})

test('an ended batch is not reopened by a late price, and old errors clear', () => {
  const { foldBatch } = lib.requests
  const B = 'B-1'
  const ev = (event, extra = {}) => ({ batchId: B, event, ...extra })
  const discarded = foldBatch([ev('validated', { jobs: [] }), ev('discarded'), ev('price', { key: 'r1', credits: 5 }), ev('priced', { total: 5, unpriced: 0 })], B)
  assert.equal(discarded.status, 'discarded')
  const cleared = foldBatch([ev('validated', { jobs: [] }), ev('error', { reason: 'not signed in' }), ev('priced', { total: 5, unpriced: 0 })], B)
  assert.equal(cleared.status, 'priced')
  assert.equal(cleared.message, null)
  const why = foldBatch([ev('validated', { jobs: [] }), ev('price', { key: 'r1', credits: null, reason: 'no workspace' })], B)
  assert.equal(why.priceErrors.r1, 'no workspace')
})

test('a batch with an unpriced row cannot be approved', async () => {
  const { P, appendJsonl } = lib.project
  const { configure, runJobRequests } = lib.requests
  configure({ costCeilingCredits: 1000, costWindowHours: 24 })
  await appendJsonl(P.jobRequests, { id: 'jr_submit01', type: 'batch.submit', batchId: 'B-2', jobs: [], machine: 'test-a' })
  await appendJsonl(P.jobRequestResults, { batchId: 'B-2', event: 'validated', jobs: [{ key: 'r1', ok: true, target: 'x', jobId: 'J-1' }], newEntities: [] })
  await appendJsonl(P.jobRequestResults, { batchId: 'B-2', event: 'price', key: 'r1', credits: null, reason: 'no workspace' })
  await appendJsonl(P.jobRequestResults, { batchId: 'B-2', event: 'priced', total: 0, unpriced: 1 })
  await appendJsonl(P.jobRequests, { id: 'jr_approve01', type: 'batch.approve', batchId: 'B-2', expectedTotal: 0, machine: 'test-a' })
  const state = { processedRequests: ['jr_submit01'], processedJobs: [] }
  await runJobRequests(state)
  const results = fs.readFileSync(P.jobRequestResults, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const refused = results.find((e) => e.reqId === 'jr_approve01' && e.event === 'rejected')
  assert.ok(refused, 'the approve is refused')
  assert.match(refused.reason, /could not be priced/)
  assert.equal(fs.existsSync(P.queue) ? fs.readFileSync(P.queue, 'utf8').trim() : '', '', 'nothing was queued')
})

test('scene numbers already given out stay taken: moved and archived shots count', async () => {
  const { P, appendJsonl, usedShotIds } = lib.project
  await appendJsonl(P.shotMoves, { from: 'TST-EP001-SC001-SH0010', to: 'TST-EP002-SC005-SH0010', files: [] })
  await appendJsonl(path.join(P.archive, 'index.jsonl'), { kind: 'shot', shot: 'TST-EP002-SC007-SH0010', archiveId: 'a1', files: [] })
  const used = await usedShotIds()
  assert.ok(used.includes('TST-EP002-SC005-SH0010'))
  assert.ok(used.includes('TST-EP002-SC007-SH0010'))
})

test('a reference an approved learning names is attached; one that no longer resolves is named in words', async () => {
  const { P, appendJsonl } = lib.project
  const REAL = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'MODEL_CATALOG.json')
  fs.copyFileSync(REAL, path.join(TMP, '.model-catalog.json'))
  fs.mkdirSync(path.join(ROOT, '08_REFERENCE'), { recursive: true })
  fs.writeFileSync(path.join(ROOT, '08_REFERENCE', 'TST-REF-001-BOARD_V01_board.png'), 'png')
  fs.writeFileSync(P.entities, 'id,short_id,kind,number,slug,name,family,status,canonical_variant,variant_count,folder,related,flags,description\n'
    + 'TST-REF-001-BOARD,REF-001,REF,001,BOARD,Caste Board,BOARD,CONCEPT,V01,1,08_REFERENCE,,,\n')
  fs.writeFileSync(P.manifest, 'filename,entity_id,variant,take,role,status,folder,source,original_name,added,notes\n'
    + 'TST-REF-001-BOARD_V01_board.png,TST-REF-001-BOARD,V01,T01,BOARD,CONCEPT,08_REFERENCE,upload,board.png,2026-09-26,\n')
  await appendJsonl(P.learnings, { id: 'L-1', status: 'approved', scope: {}, rule: 'Masks as in @REF-001/V01. Castes as in @REF-001/V02.' })
  const { planJob } = await import('./lib/plan.mjs')
  const { loadEntities, readCsv } = lib.project
  const job = { jobId: 'J-T', target: 'TST-REF-001-BOARD', model: 'nano_banana_pro', prompt: 'A board.', params: {}, refs: [] }
  const plan = await planJob(job, await loadEntities(), (await readCsv(P.manifest)).rows, { cfg: { defaultImageModel: 'nano_banana_pro' }, priceOnly: true })
  assert.equal(plan.skip, undefined, plan.skip)
  assert.equal(plan.refPaths.length, 1, 'the learning\'s picture is attached')
  assert.match(plan.prompt, /Masks as in <<<image_1>>>/)
  assert.doesNotMatch(plan.prompt, /@REF-001\/V02/, 'no raw token for a look that is gone')
  assert.match(plan.prompt, /Castes as in REF-001, Caste Board/)
})
test('a worker acts only on its own machine\'s requests; an untagged new one is skipped, never guessed at', async () => {
  const { P, appendJsonl } = lib.project
  const { runJobRequests } = lib.requests
  await appendJsonl(P.jobRequests, { id: 'jr_other01', type: 'models.refresh', machine: 'test-b' })
  await appendJsonl(P.jobRequests, { id: 'jr_old01', type: 'models.refresh' })
  const state = { processedRequests: ['jr_submit01', 'jr_approve01'], processedJobs: [] }
  await runJobRequests(state)
  assert.ok(!state.processedRequests.includes('jr_other01'), 'another machine\'s request is left to that machine')
  assert.ok(state.processedRequests.includes('jr_old01'), 'an untagged one is settled, once')
  const results = fs.readFileSync(P.jobRequestResults, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.match(results.find((e) => e.reqId === 'jr_old01')?.reason ?? '', /older version of the panel/)
  assert.equal(results.some((e) => e.reqId === 'jr_other01'), false)
})

test('a job queued by a worker carries its machine', async () => {
  const { P, appendJsonl } = lib.project
  await appendJsonl(P.queue, { jobId: 'J-M1', target: 'x' })
  const last = fs.readFileSync(P.queue, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1)
  assert.equal(last.machine, 'test-a')
})

test('a machine\'s first state starts from the legacy state.json, and is its own file', async () => {
  const { P, readState, writeState, stateStartProblem } = lib.project
  assert.match(path.basename(P.state), /^state\.test-a\.json$/)
  fs.writeFileSync(P.legacyState, JSON.stringify({ processedJobs: ['J-OLD'], processedDecisions: [], spentCredits: 5 }))
  assert.equal(await stateStartProblem(), null)
  const s = await readState()
  assert.deepEqual(s.processedJobs, ['J-OLD'])
  s.processedJobs.push('J-NEW')
  await writeState(s)
  assert.deepEqual(JSON.parse(fs.readFileSync(P.state, 'utf8')).processedJobs, ['J-OLD', 'J-NEW'])
  assert.deepEqual(JSON.parse(fs.readFileSync(P.legacyState, 'utf8')).processedJobs, ['J-OLD'], 'the legacy file is never written')
})

test('the spend ceiling counts this machine\'s rows and legacy ones, not another machine\'s', () => {
  const now = Date.parse('2026-09-26T12:00:00Z')
  const at = '2026-09-26T11:00:00Z'
  const rows = [
    { state: 'GENERATED', cost: '10', ingested: at, machine: 'test-a' },
    { state: 'GENERATED', cost: '20', ingested: at, machine: 'test-b' },
    { state: 'GENERATED', cost: '40', ingested: at },
  ]
  assert.equal(lib.spend.spentInWindow(rows, 24, now, 'test-a'), 50)
})
test('a request is acted on by the machine its batch or studio session belongs to', async () => {
  const { requestOwners } = await import('./lib/machine.mjs')
  const reqs = [
    { id: 's', type: 'batch.submit', batchId: 'B-X', machine: 'test-b' },
    { id: 'p', type: 'studio.price', sessionId: 'ss_x', machine: 'test-b' },
    { id: 'old', type: 'studio.price', sessionId: 'ss_old' },
  ]
  const owner = requestOwners(reqs)
  assert.equal(owner({ type: 'batch.approve', batchId: 'B-X', machine: 'test-a' }), 'other', 'approving B\'s batch on A is B\'s to do')
  assert.equal(owner({ type: 'studio.approve', sessionId: 'ss_x', machine: 'test-a' }), 'other')
  assert.equal(owner({ type: 'studio.close', sessionId: 'ss_old', machine: 'test-a' }), 'mine', 'an old session can be ended by whoever asks')
  assert.equal(owner({ type: 'studio.price', sessionId: 'ss_old', machine: 'test-a' }), 'old')
})
test('a discarded take is set aside in _discarded, never in _rejected where /learn reads', async () => {
  const cand = '09_OUTPUT/_staging/job-disc/T01.mp4'
  fs.mkdirSync(path.join(ROOT, path.dirname(cand)), { recursive: true })
  fs.writeFileSync(path.join(ROOT, cand), 'video')
  const to = await lib.promote.discard({ id: 'rev_d1', candidate: cand, hfJobId: 'hf-disc', verdict: 'discarded' })
  assert.equal(to, '09_OUTPUT/_discarded/hf-disc/T01.mp4')
  assert.equal(fs.readFileSync(path.join(ROOT, to), 'utf8'), 'video')
  assert.ok(!fs.existsSync(path.join(ROOT, cand)), 'out of staging')
  assert.ok(!fs.existsSync(path.join(ROOT, '09_OUTPUT/_rejected/index.jsonl')), 'not a denial')
})

test('a failed generation is retried once, as queued, on the machine that asked; Remove settles with nothing queued', async () => {
  const { P, appendJsonl } = lib.project
  const { runJobRequests } = lib.requests
  await appendJsonl(P.queue, { jobId: 'J-FAIL', parentJobId: null, attempt: 1, stage: 'draft', target: 'TST-PRP-001-FLAG', variant: 'V01', model: 'm', prompt: 'p', basePrompt: 'p', params: { resolution: '480p' }, refs: ['@PRP-001'], machine: 'other-mac' })
  await appendJsonl(P.queue, { jobId: 'J-OK', parentJobId: null, attempt: 1, stage: null, target: 'TST-PRP-001-FLAG', variant: 'V01', model: 'm', prompt: 'p', params: {}, refs: [], machine: 'test-a' })
  await appendJsonl(P.jobRequests, { id: 'jr_retry1', type: 'job.retry', jobId: 'J-FAIL', machine: 'test-a' })
  await appendJsonl(P.jobRequests, { id: 'jr_retry2', type: 'job.retry', jobId: 'J-FAIL', machine: 'test-a' })
  await appendJsonl(P.jobRequests, { id: 'jr_retry3', type: 'job.retry', jobId: 'J-OK', machine: 'test-a' })
  await appendJsonl(P.jobRequests, { id: 'jr_dismiss1', type: 'job.dismiss', jobId: 'J-FAIL', machine: 'test-a' })
  const state = { processedRequests: [], processedJobs: ['J-FAIL', 'J-OK'], failedJobs: { 'J-FAIL': { reason: 'no response', at: '2026-09-27T20:00:00Z' } } }
  await runJobRequests(state)

  const queue = fs.readFileSync(P.queue, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const again = queue.filter((q) => q.retryOf === 'J-FAIL')
  assert.equal(again.length, 1, 'queued once')
  assert.equal(again[0].parentJobId, 'J-FAIL')
  assert.equal(again[0].attempt, 1, 'the same attempt: the failed one made nothing')
  assert.deepEqual([again[0].prompt, again[0].stage, again[0].params.resolution, again[0].refs[0]], ['p', 'draft', '480p', '@PRP-001'])
  assert.equal(again[0].machine, 'test-a', 'generated by the machine that asked')
  assert.ok(!queue.some((q) => q.retryOf === 'J-OK'), 'a job that did not fail is not retried')

  const results = fs.readFileSync(P.jobRequestResults, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.match(results.find((e) => e.reqId === 'jr_retry2' && e.event === 'rejected').reason, /already retried/)
  assert.match(results.find((e) => e.reqId === 'jr_retry3' && e.event === 'rejected').reason, /did not fail/)
  assert.ok(state.processedRequests.includes('jr_dismiss1'), 'Remove is settled, not retried as unknown')
})

test('a take Higgsfield made for a failed job is adopted only for a failure, a real id, and never twice', async () => {
  const { P, appendJsonl } = lib.project
  const { runJobRequests } = lib.requests
  await appendJsonl(P.jobRequests, { id: 'jr_adopt_ok_job', type: 'job.adopt', jobId: 'J-OK', hfJobId: '91b20c35-b0dd-4935-95b4-6bc6f137dece', machine: 'test-a' })
  await appendJsonl(P.jobRequests, { id: 'jr_adopt_bad_id', type: 'job.adopt', jobId: 'J-FAIL', hfJobId: 'not an id', machine: 'test-a' })
  await appendJsonl(P.jobRequests, { id: 'jr_adopt_unknown', type: 'job.adopt', jobId: 'J-FAIL', hfJobId: '91b20c35-b0dd-4935-95b4-6bc6f137dece', machine: 'test-a' })
  const state = { processedRequests: [], processedJobs: ['J-FAIL', 'J-OK'], failedJobs: { 'J-FAIL': { reason: '503', at: '2026-09-28T12:00:03Z' } } }
  await runJobRequests(state)
  const results = fs.readFileSync(P.jobRequestResults, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const why = (id) => results.find((e) => e.reqId === id && e.event === 'rejected')?.reason ?? ''
  assert.match(why('jr_adopt_ok_job'), /did not fail/)
  assert.match(why('jr_adopt_bad_id'), /not a Higgsfield job id/)
  // The fake CLI knows no jobs: refused, and nothing queued.
  assert.match(why('jr_adopt_unknown'), /does not know job/)
  const queue = fs.readFileSync(P.queue, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.ok(!queue.some((q) => q.adoptHfJobId), 'nothing adopted')
})

test('a voice (VOX) takes a recording and nothing else takes one', async () => {
  const { P } = lib.project
  const { checkUploads, FilingError } = lib.promote
  const dir = path.join(P.uploads, 'op_vox')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'u1.mp3'), 'ID3')
  fs.writeFileSync(path.join(dir, 'u2.png'), 'png')
  const up = (id, ext, extra) => ({ id, file: `09_OUTPUT/_uploads/op_vox/${id}.${ext}`, role: 'HERO', descriptor: 'two beyt', ...extra })
  const plan = await checkUploads([up('u1', 'mp3', { mode: 'new', kind: 'VOX', name: 'Singer Voice', description: 'A voice' })])
  assert.match(plan[0], /new VOX 'SINGER-VOICE'/)
  await assert.rejects(() => checkUploads([up('u2', 'png', { mode: 'new', kind: 'VOX', name: 'Other Voice', description: 'x' })]), FilingError)
  await assert.rejects(() => checkUploads([up('u1', 'mp3', { mode: 'new', kind: 'CHR', name: 'Singer', description: 'x' })]), /only be filed under a voice/)
})
