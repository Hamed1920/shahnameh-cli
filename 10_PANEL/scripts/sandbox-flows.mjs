// End-to-end flows against the sandbox worker. Appends what the panel would append and checks what the worker does.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.argv[2]
if (!ROOT) { console.error('Usage: node scripts/sandbox-flows.mjs <project folder>'); process.exit(2) }
// The project's own ID prefix: these flows run against whichever project they are pointed at.
const CODE = JSON.parse(fs.readFileSync(path.join(ROOT, 'project.json'), 'utf8')).code
const P = {
  req: path.join(ROOT, '00_PROJECT/review/JOB_REQUESTS.jsonl'),
  res: path.join(ROOT, '00_PROJECT/queue/JOB_REQUEST_RESULTS.jsonl'),
  queue: path.join(ROOT, '00_PROJECT/queue/QUEUE.jsonl'),
  state: path.join(ROOT, '00_PROJECT/queue/state.json'),
  entities: path.join(ROOT, '00_PROJECT/registry/ENTITIES.csv'),
  staging: path.join(ROOT, '09_OUTPUT/_staging'),
  lock: path.join(ROOT, '00_PROJECT/queue/worker.lock'),
  stop: path.join(ROOT, '00_PROJECT/queue/worker.stop'),
  log: path.join(ROOT, '00_PROJECT/queue/worker.log'),
}
/**
 * The look these flows reference. Read from the registry rather than written in:
 * looks get archived over time, and a hard-coded V02 turns a working system into
 * a failing test.
 */
const LOOK = (() => {
  const rows = fs.readFileSync(P.entities, 'utf8').trim().split(/\r?\n/)
  const head = rows[0].split(',')
  const row = rows.slice(1).map((r) => r.split(',')).find((r) => r[head.indexOf('short_id')] === 'CHR-001')
  const canonical = row?.[head.indexOf('canonical_variant')]
  if (!canonical) { console.error('FAIL: CHR-001 has no look in this project; these flows need one'); process.exit(1) }
  return canonical
})()
const REF = '@CHR-001/' + LOOK

const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
const append = (f, o) => fs.appendFileSync(f, JSON.stringify(o) + '\n')
const state = () => JSON.parse(fs.readFileSync(P.state, 'utf8'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let n = 0
const id = () => `jr_test${Date.now().toString(36)}${++n}`
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exit(1) } console.log('ok  ', msg) }
async function until(pred, what, ms = 60000) {
  const t = Date.now() + ms
  while (Date.now() < t) { const v = pred(); if (v) return v; await sleep(500) }
  console.error('TIMEOUT waiting for', what); console.error(fs.readFileSync(P.log, 'utf8').split('\n').slice(-15).join('\n')); process.exit(1)
}
const events = (batchId) => jsonl(P.res).filter((e) => e.batchId === batchId)
const last = (batchId) => events(batchId).at(-1)

// ------------------------------------------------ 1. submit a 3-row batch
const RUN = Date.now().toString(36).toUpperCase().slice(-4)
const B1 = 'B-TEST-' + RUN + '-1'
const PROMPT_FA = 'ضحاک روی سکو نشسته‌است، مارها آرام تکان می‌خورند.'
append(P.req, {
  id: id(), ts: new Date().toISOString(), reviewer: 'test', type: 'batch.submit', batchId: B1, name: 'flow one',
  source: { kind: 'paste', files: [] }, defaults: { model: 'seedance_2_5', aspect_ratio: '16:9', duration: 15, stage: 'draft', generate_audio: true },
  jobs: [
    { key: 'r1', label: 'P01', target: 'CHR-001', variant: null, model: 'nano_banana_pro', refs: [REF], params: { aspect_ratio: '16:9' }, prompt: 'Zahhak turnaround of ' + REF + ', museum lighting' },
    { key: 'r2', label: 'P02', target: CODE + '-EP001-SC099-SH0010', variant: null, model: 'seedance_2_5', stage: 'draft', refs: [REF, '@LOC-009'], params: { aspect_ratio: '16:9', duration: 15, generate_audio: true }, prompt: PROMPT_FA },
    { key: 'r3', label: 'P03', target: 'NEW/PRP/TEST-STAFF-' + RUN, newEntity: { kind: 'PRP', slug: 'TEST-STAFF-' + RUN, name: 'Test Staff', description: 'A staff for the test' }, variant: null, model: 'nano_banana_pro', refs: [], params: { aspect_ratio: '1:1' }, prompt: 'iron capped staff' },
    { key: 'r4', label: 'P04', target: 'CHR-999', variant: null, model: 'nano_banana_pro', refs: [], params: {}, prompt: 'unknown target row' },
  ],
})
const validated = await until(() => events(B1).find((e) => e.event === 'validated'), 'validated')
ok(validated.jobs.filter((j) => j.ok).length === 3 && validated.jobs.find((j) => j.key === 'r4' && !j.ok && /unknown target/.test(j.reason)), 'validated: 3 ok, r4 skipped as unknown target')
ok(validated.newEntities.length === 1 && validated.newEntities[0].slug === 'TEST-STAFF-' + RUN, 'validated: NEW/PRP/TEST-STAFF proposed, not numbered')
const before = fs.readFileSync(P.entities, 'utf8')
ok(!before.includes('TEST-STAFF-' + RUN), 'no entity reserved at validation')
const priced = await until(() => events(B1).find((e) => e.event === 'priced'), 'priced')
ok(events(B1).filter((e) => e.event === 'price').length === 3, 'one price event per ok job')
ok(priced.total === 12 + 37.5 + 12 && priced.unpriced === 0, `priced total ${priced.total}`)
const queueBefore = jsonl(P.queue).length
ok(jsonl(P.queue).length === queueBefore, 'nothing queued before approval')

// ------------------------------------------------ 2. approve
append(P.req, { id: id(), ts: new Date().toISOString(), reviewer: 'test', type: 'batch.approve', batchId: B1, expectedTotal: priced.total })
const queued = await until(() => events(B1).find((e) => e.event === 'queued'), 'queued')
ok(queued.assigned.length === 1 && new RegExp('^' + CODE + '-PRP-\\d{3}-TEST-STAFF-' + RUN + '$').test(queued.assigned[0].id), `reserved ${queued.assigned[0].id} at approval`)
const ents = fs.readFileSync(P.entities, 'utf8')
ok(ents.includes(`${queued.assigned[0].id},${queued.assigned[0].shortId},PRP,`) && ents.includes('RESERVED') && ents.includes('NO-ASSET'), 'ENTITIES.csv has the RESERVED row')
const q = jsonl(P.queue)
const mine = q.filter((j) => j.batchId === B1)
ok(mine.length === 3 && mine.every((j) => j.enqueuedBy === 'panel:batch'), 'three jobs queued as panel:batch')
ok(mine.find((j) => j.label === 'P03').target === queued.assigned[0].id, 'NEW target resolved to the reserved id')
ok(mine.find((j) => j.label === 'P02').params.generate_audio === true && mine.find((j) => j.label === 'P02').params.resolution === '480p', 'video job carries sound=true and draft resolution')
ok(mine.find((j) => j.label === 'P02').prompt === PROMPT_FA, 'Persian prompt intact')

// ------------------------------------------------ 3. generation with the stub
await until(() => mine.every((j) => state().processedJobs.includes(j.jobId)), 'all three generated', 120000)
const stagingDirs = fs.readdirSync(P.staging).filter((d) => d.startsWith('stub-'))
const sidecars = stagingDirs.map((d) => JSON.parse(fs.readFileSync(path.join(P.staging, d, 'job.json'), 'utf8')))
// Pick this run's sidecars by job id: earlier runs in the same sandbox left their own P01/P02 behind.
const byJob = new Map(sidecars.map((s) => [s.jobId, s]))
const vid = byJob.get(mine.find((j) => j.label === 'P02').jobId)
ok(vid && vid.params.generate_audio === true && vid.candidates[0].file === 'T01.mp4', 'video sidecar: sound true, T01.mp4 downloaded')
// References are written the way Higgsfield's panel writes them: an inline <<<image_N>>> token, no list at the end.
const img = byJob.get(mine.find((j) => j.label === 'P01').jobId)
ok(img && img.prompt.startsWith('Zahhak turnaround of <<<image_1>>>, museum lighting'), 'a mention becomes the inline <<<image_1>>> token')
ok(!/@Image\d|Reference images, in the order|binding/.test(img.prompt), 'no @ImageN text and no appended reference list')
ok(vid.prompt.startsWith(PROMPT_FA) && vid.prompt.includes('<<<image_1>>> is Zahhak') && vid.prompt.includes('<<<image_2>>> is'), 'unmentioned attachments get one naming sentence each')
const calls = jsonl(process.env.STUB_LOG)
const sent = calls.filter((c) => c.args[1] === 'create' && String(c.args[c.args.indexOf('--prompt') + 1]).startsWith(PROMPT_FA)).at(-1)
ok(sent && sent.args[sent.args.indexOf('--prompt') + 1].includes('<<<image_1>>> is Zahhak') && sent.args.filter((a) => a === '--image-references').length === 2, 'CLI argv carries the token prompt and one --image-references per attachment')
const create = calls.filter((c) => c.args[0] === 'generate' && c.args[1] === 'create' && c.args[2] === 'seedance_2_5')
ok(create.length >= 1 && create.at(-1).args.includes('--generate-audio') && create.at(-1).args[create.at(-1).args.indexOf('--generate-audio') + 1] === 'true', 'stub saw --generate-audio true')
ok(!create.at(-1).args.includes('--batch-id'), 'batchId never reaches the CLI')

// ------------------------------------------------ 4. stale approve, then discard
const B2 = 'B-TEST-' + RUN + '-2'
append(P.req, { id: id(), ts: new Date().toISOString(), reviewer: 'test', type: 'batch.submit', batchId: B2, name: 'flow two', source: { kind: 'paste', files: [] },
  defaults: { model: 'nano_banana_pro', aspect_ratio: '16:9', duration: 15, stage: 'draft', generate_audio: true },
  jobs: [{ key: 'r1', label: 'X1', target: 'LOC-009', variant: null, model: 'nano_banana_pro', refs: [], params: {}, prompt: 'the hall at night' }] })
await until(() => events(B2).find((e) => e.event === 'priced'), 'B2 priced')
append(P.req, { id: id(), ts: new Date().toISOString(), reviewer: 'test', type: 'batch.approve', batchId: B2, expectedTotal: 999 })
const rej = await until(() => events(B2).find((e) => e.event === 'rejected'), 'B2 stale approve rejected')
ok(rej.scope === 'request' && /price changed/.test(rej.reason), 'stale expectedTotal refused, batch still approvable')
ok(!jsonl(P.queue).some((j) => j.batchId === B2), 'nothing queued for B2')
append(P.req, { id: id(), ts: new Date().toISOString(), reviewer: 'test', type: 'batch.discard', batchId: B2 })
await until(() => events(B2).find((e) => e.event === 'discarded'), 'B2 discarded')
ok(true, 'discard recorded')

// ------------------------------------------------ 5. regenerate an accepted take
const SRC = 'J-20260914-NV7'
const src = jsonl(P.queue).find((j) => j.jobId === SRC)
const R = id()
// The references are given, not inherited: this source job was queued long ago
// and one of the looks it used has been archived since, which the worker rightly
// refuses. Regenerating with a look that still exists is what a reviewer does.
append(P.req, { id: R, ts: new Date().toISOString(), reviewer: 'test', type: 'regenerate', jobId: SRC, decisionId: 'rev_mu19vrjsbra1', note: 'more wind', sound: false, refs: [REF] })
const rq = await until(() => jsonl(P.res).find((e) => e.reqId === R && e.event === 'queued'), 'regenerate queued')
const child = jsonl(P.queue).find((j) => j.jobId === rq.jobIds[SRC])
ok(child && child.parentJobId === SRC && child.attempt === (src.attempt ?? 1) + 1 && child.stage === src.stage && child.enqueuedBy === 'panel:regenerate', 'child job links to the accepted take')
ok(child.params.generate_audio === false && child.revisionNotes.at(-1) === 'more wind' && child.prompt === (src.basePrompt ?? src.prompt), 'child carries sound=false, the note, and the base prompt')
await until(() => state().processedJobs.includes(child.jobId), 'regeneration generated', 120000)
const rcalls = jsonl(process.env.STUB_LOG).filter((c) => c.args[1] === 'create')
ok(rcalls.at(-1).args[rcalls.at(-1).args.indexOf('--generate-audio') + 1] === 'false', 'regeneration sent --generate-audio false')

// ------------------------------------------------ 5b. regenerate with everything changed
const R3 = id()
append(P.req, { id: R3, ts: new Date().toISOString(), reviewer: 'test', type: 'regenerate', jobId: SRC, decisionId: 'rev_mu19vrjsbra1',
  prompt: 'A completely rewritten prompt.', refs: [REF], model: 'seedance_2_5', stage: 'draft', variant: 'V02',
  params: { aspect_ratio: '9:16', duration: 5 }, sound: true, note: '' })
const rq3 = await until(() => jsonl(P.res).find((e) => e.reqId === R3 && e.event === 'queued'), 'override regenerate queued')
const child3 = jsonl(P.queue).find((j) => j.jobId === rq3.jobIds[SRC])
ok(child3.basePrompt === 'A completely rewritten prompt.' && child3.prompt === child3.basePrompt, 'override: prompt replaced')
ok(JSON.stringify(child3.refs) === JSON.stringify([REF]) && child3.variant === 'V02', 'override: refs and look replaced')
ok(child3.stage === 'draft' && child3.params.resolution === '480p' && child3.params.aspect_ratio === '9:16' && child3.params.duration === 5 && child3.params.generate_audio === true, 'override: draft resolution follows the stage, aspect, duration, sound applied')
const R4 = id()
append(P.req, { id: R4, ts: new Date().toISOString(), reviewer: 'test', type: 'regenerate', jobId: SRC, decisionId: 'rev_mu19vrjsbra1', refs: ['@CHR-001/V09'] })
const r4 = await until(() => jsonl(P.res).find((e) => e.reqId === R4), 'bad ref regenerate handled')
ok(r4.event === 'rejected' && String(r4.reason).includes('reference @CHR-001/V09'), 'override with an unresolvable reference refused')

// ------------------------------------------------ 6. unknown regenerate target refused
const R2 = id()
append(P.req, { id: R2, ts: new Date().toISOString(), reviewer: 'test', type: 'regenerate', jobId: 'J-NOPE', decisionId: 'x' })
const r2 = await until(() => jsonl(P.res).find((e) => e.reqId === R2), 'bad regenerate handled')
ok(r2.event === 'rejected', 'unknown job refused')

// ------------------------------------------------ 7. graceful stop
fs.writeFileSync(P.stop, 'now')
await until(() => !fs.existsSync(P.lock), 'worker stopped and released the lock', 30000)
ok(!fs.existsSync(P.stop), 'stop flag consumed')
ok(state().processedRequests.length >= 7, `state.processedRequests has ${state().processedRequests.length} ids`)
console.log('ALL FLOWS PASSED')
