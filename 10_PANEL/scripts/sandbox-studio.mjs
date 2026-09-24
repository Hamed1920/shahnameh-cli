// End-to-end checks for the model catalogue, Prompts-page uploads and the reference studio,
// against a sandbox worker running on the stub CLI (see README "Sandbox testing").
// Appends what the panel would append and asserts what the worker does.
//   node scripts/sandbox-studio.mjs <sandbox project folder> <stub log file>
import fs from 'node:fs'
import path from 'node:path'

const [ROOT, STUB_LOG] = process.argv.slice(2)
if (!ROOT || !STUB_LOG) { console.error('Usage: node scripts/sandbox-studio.mjs <project folder> <stub log>'); process.exit(2) }
const CODE = JSON.parse(fs.readFileSync(path.join(ROOT, 'project.json'), 'utf8')).code
const P = {
  req: path.join(ROOT, '00_PROJECT/review/JOB_REQUESTS.jsonl'),
  res: path.join(ROOT, '00_PROJECT/queue/JOB_REQUEST_RESULTS.jsonl'),
  queue: path.join(ROOT, '00_PROJECT/queue/QUEUE.jsonl'),
  state: path.join(ROOT, '00_PROJECT/queue/state.json'),
  entities: path.join(ROOT, '00_PROJECT/registry/ENTITIES.csv'),
  manifest: path.join(ROOT, '00_PROJECT/registry/ASSET_MANIFEST.csv'),
  filings: path.join(ROOT, '00_PROJECT/queue/FILINGS.jsonl'),
  staging: path.join(ROOT, '09_OUTPUT/_staging'),
  uploads: path.join(ROOT, '09_OUTPUT/_uploads'),
  rejected: path.join(ROOT, '09_OUTPUT/_rejected'),
  log: path.join(ROOT, '00_PROJECT/queue/worker.log'),
  catalog: path.join(path.dirname(ROOT), '.model-catalog.json'),
}
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
const append = (f, o) => fs.appendFileSync(f, JSON.stringify(o) + '\n')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const state = () => JSON.parse(fs.readFileSync(P.state, 'utf8'))
let n = 0
const id = () => `jr_st${Date.now().toString(36)}${++n}`
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exit(1) } console.log('ok  ', msg) }
async function until(pred, what, ms = 90000) {
  const t = Date.now() + ms
  while (Date.now() < t) { const v = pred(); if (v) return v; await sleep(500) }
  console.error('TIMEOUT waiting for', what); console.error(fs.readFileSync(P.log, 'utf8').split('\n').slice(-20).join('\n')); process.exit(1)
}
const stubCalls = () => jsonl(STUB_LOG).map((c) => c.args)
const csvRows = (f) => {
  const lines = fs.readFileSync(f, 'utf8').trim().split(/\r?\n/)
  const head = lines[0].split(',')
  return lines.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [head[i], v])))
}
const LOOK = csvRows(P.entities).find((r) => r.short_id === 'CHR-001')?.canonical_variant
if (!LOOK) { console.error('FAIL: CHR-001 has no look'); process.exit(1) }
const REF = `@CHR-001/${LOOK}`
const RUN = Date.now().toString(36).toUpperCase().slice(-4)

// ------------------------------------------------ 0. the worker fetched the (stub) model list
const cat = await until(() => fs.existsSync(P.catalog) && JSON.parse(fs.readFileSync(P.catalog, 'utf8')), 'sandbox model catalogue')
ok(cat.models.kling3_0?.refs?.param === 'start_image' && cat.models.image_background_remover?.usable === false, 'catalogue: Kling takes a start frame; a background remover is not usable from a prompt')
ok(!fs.readFileSync(path.resolve(import.meta.dirname, '../worker/MODEL_CATALOG.json'), 'utf8').includes('"fetchedAt": "' + cat.fetchedAt), 'the real catalogue was not touched by the sandbox')

// ------------------------------------------------ 1. a Kling row: first reference -> --start-image, sound -> --sound on
const B1 = `B-ST-${RUN}-1`
append(P.req, {
  id: id(), ts: new Date().toISOString(), reviewer: 'test', type: 'batch.submit', batchId: B1, name: 'kling', source: { kind: 'paste', files: [] },
  defaults: { model: 'kling3_0', aspect_ratio: '16:9', duration: 5, stage: 'draft', generate_audio: true },
  jobs: [
    { key: 'k1', label: 'K1', target: `${CODE}-EP001-SC097-SH0010`, variant: null, model: 'kling3_0', stage: null, refs: [REF], params: { aspect_ratio: '16:9', duration: 5, generate_audio: true }, prompt: `${REF} walks forward` },
    { key: 'k2', label: 'K2', target: `${CODE}-EP001-SC096-SH0010`, variant: null, model: 'kling3_0', stage: null, refs: [REF, REF.replace(LOOK, 'V01'), '@LOC-009'], params: {}, prompt: 'three refs is too many for Kling' },
    { key: 'k3', label: 'K3', target: 'CHR-001', variant: null, model: 'image_background_remover', refs: [REF], params: {}, prompt: 'a tool is refused' },
  ],
})
const v1 = await until(() => jsonl(P.res).find((e) => e.batchId === B1 && e.event === 'validated'), 'kling validated')
ok(v1.jobs.find((j) => j.key === 'k2' && !j.ok && /at most 2/.test(j.reason)), 'three references for Kling are refused before pricing')
ok(v1.jobs.find((j) => j.key === 'k3' && !j.ok && /cannot be used from a prompt/.test(j.reason)), 'a tool model is refused')
const p1 = await until(() => jsonl(P.res).find((e) => e.batchId === B1 && e.event === 'priced'), 'kling priced')
append(P.req, { id: id(), ts: new Date().toISOString(), reviewer: 'test', type: 'batch.approve', batchId: B1, expectedTotal: p1.total })
const kJob = (await until(() => jsonl(P.res).find((e) => e.batchId === B1 && e.event === 'queued'), 'kling queued')).jobIds.k1
await until(() => state().processedJobs.includes(kJob), 'kling generated')
const kCreate = stubCalls().filter((a) => a[0] === 'generate' && a[1] === 'create' && a[2] === 'kling3_0').at(-1)
ok(kCreate && kCreate.includes('--start-image') && !kCreate.includes('--image-references'), 'Kling got its reference as --start-image')
ok(kCreate[kCreate.indexOf('--sound') + 1] === 'on' && !kCreate.includes('--generate-audio'), 'Kling got --sound on, not --generate-audio')
ok(!kCreate.includes('--resolution'), 'Kling has no draft resolution to send')

// ------------------------------------------------ 2. a Prompts batch carrying a file from the computer
const B2 = `B-ST-${RUN}-2`
const R2 = id()
const img = fs.readdirSync(path.join(ROOT, '01_CHARACTERS')).find((f) => /\.(png|jpe?g|webp)$/i.test(f))
fs.mkdirSync(path.join(P.uploads, R2), { recursive: true })
const ext = path.extname(img).toLowerCase() === '.jpeg' ? '.jpg' : path.extname(img).toLowerCase()
fs.copyFileSync(path.join(ROOT, '01_CHARACTERS', img), path.join(P.uploads, R2, `u1${ext}`))
append(P.req, {
  id: R2, ts: new Date().toISOString(), reviewer: 'test', type: 'batch.submit', batchId: B2, name: 'upload', source: { kind: 'paste', files: [] },
  defaults: { model: 'nano_banana_pro', aspect_ratio: '1:1', duration: 5, stage: 'draft', generate_audio: true },
  uploads: [{ id: 'u1', file: `09_OUTPUT/_uploads/${R2}/u1${ext}`, originalName: img, mode: 'variant', entity: csvRows(P.entities).find((r) => r.short_id === 'CHR-001').id, role: 'PLATE', descriptor: `sandbox upload ${RUN.toLowerCase()}` }],
  jobs: [{ key: 'u', label: 'U1', target: 'CHR-001', variant: null, model: 'nano_banana_pro', refs: [REF, 'upload:u1'], params: { aspect_ratio: '1:1' }, prompt: 'Zahhak with the new picture' }],
})
await until(() => jsonl(P.res).find((e) => e.batchId === B2 && e.event === 'validated'), 'upload batch validated')
const filed = jsonl(P.filings).find((f) => f.requestId === R2 && f.uploadId === 'u1')
ok(filed?.token?.startsWith('@CHR-001/V'), `the file was filed at validation as ${filed?.token}`)
const p2 = await until(() => jsonl(P.res).find((e) => e.batchId === B2 && e.event === 'priced'), 'upload batch priced')
append(P.req, { id: id(), ts: new Date().toISOString(), reviewer: 'test', type: 'batch.approve', batchId: B2, expectedTotal: p2.total })
const uJob = (await until(() => jsonl(P.res).find((e) => e.batchId === B2 && e.event === 'queued'), 'upload batch queued')).jobIds.u
ok(JSON.stringify(jsonl(P.queue).find((q) => q.jobId === uJob).refs) === JSON.stringify([REF, filed.token]), 'the queued job names the filed look, not upload:u1')

// ------------------------------------------------ 3. the reference studio
const S = `ss_t${RUN.toLowerCase()}`
const NAME = `Studio Test ${RUN}`
const before = csvRows(P.entities).filter((r) => r.kind === 'CHR').length
// 3a. an input picture dropped into the studio
fs.mkdirSync(path.join(P.uploads, S), { recursive: true })
fs.copyFileSync(path.join(ROOT, '01_CHARACTERS', img), path.join(P.uploads, S, `u1${ext}`))
const price = (genId, extra = {}) => {
  const r = { id: id(), ts: new Date().toISOString(), reviewer: 'test', type: 'studio.price', sessionId: S, genId, proposal: { kind: 'CHR', name: NAME, description: 'made in the sandbox' }, model: 'nano_banana_pro', prompt: 'full body sheet', refs: [REF, `studio:${S}/u1`], params: { aspect_ratio: '1:1' }, count: 3, ...extra }
  append(P.req, r)
  return r
}
const pr1 = price('gaaa1')
const pr2 = price('gaaa2')
await until(() => jsonl(P.res).find((e) => e.reqId === pr1.id && e.event === 'studio.error' && /replaced/.test(e.reason)), 'an edited-away try is not priced')
const priced = await until(() => jsonl(P.res).find((e) => e.reqId === pr2.id && e.event === 'studio.priced'), 'studio priced')
ok(priced.total === priced.credits * 3, `priced ${priced.credits} x 3 = ${priced.total}`)
ok(csvRows(P.entities).filter((r) => r.kind === 'CHR').length === before, 'no number is reserved while trying')
// 3b. a stale total is refused, the right one runs, ahead of anything else
append(P.req, { id: id(), ts: new Date().toISOString(), reviewer: 'test', type: 'studio.approve', sessionId: S, genId: 'gaaa2', expectedTotal: priced.total + 5 })
await until(() => jsonl(P.res).find((e) => e.event === 'rejected' && /price is/.test(e.reason ?? '')), 'stale studio total refused')
append(P.req, { id: id(), ts: new Date().toISOString(), reviewer: 'test', type: 'studio.approve', sessionId: S, genId: 'gaaa2', expectedTotal: priced.total })
const q = await until(() => jsonl(P.res).find((e) => e.sessionId === S && e.event === 'studio.queued'), 'studio queued')
ok(q.jobIds.length === 3 && jsonl(P.queue).filter((j) => q.jobIds.includes(j.jobId)).every((j) => j.priority && j.target === null && j.studio.proposal.name === NAME), 'three priority jobs, no target, the proposal carried')
await until(() => q.jobIds.every((j) => state().processedJobs.includes(j)), 'studio tries generated')
const create = stubCalls().filter((a) => a[0] === 'generate' && a[1] === 'create' && a[2] === 'nano_banana_pro').at(-1)
ok(create.filter((x) => x === '--image-references').length === 2, 'the index look and the dropped-in picture both went as image references')
const staged = fs.readdirSync(P.staging).map((d) => ({ d, s: JSON.parse(fs.readFileSync(path.join(P.staging, d, 'job.json'), 'utf8')) })).filter((x) => x.s.studio?.sessionId === S)
ok(staged.length === 3, 'three results in staging, tagged with the session')
// 3c. a try that uses an earlier result as its reference prices fine
const pr3 = price('gaaa3', { refs: [`staged:${staged[0].d}/T01`], count: 1 })
await until(() => jsonl(P.res).find((e) => e.reqId === pr3.id && e.event === 'studio.priced'), 'a staged: reference resolves')
// 3d. pick one as the new entity: numbered now
const pick = (hf, fileAs) => { const r = { id: id(), ts: new Date().toISOString(), reviewer: 'test', type: 'studio.pick', sessionId: S, hfJobId: hf, take: 'T01', fileAs, role: 'HERO', descriptor: 'studio pick' }; append(P.req, r); return r }
pick(staged[0].d, { mode: 'new', kind: 'CHR', name: NAME, description: 'made in the sandbox' })
const picked = await until(() => jsonl(P.res).find((e) => e.sessionId === S && e.event === 'studio.picked'), 'first pick filed')
const ent = csvRows(P.entities).find((r) => r.id === picked.entity)
ok(ent && ent.status === 'CONCEPT' && picked.token === `@${ent.short_id}/V01`, `the new entity was numbered at the pick: ${ent?.short_id}`)
const row = csvRows(P.manifest).find((r) => r.entity_id === ent.id)
ok(row.source === 'higgsfield' && row.role === 'HERO' && row.take === 'T01', 'manifest: source higgsfield, role HERO')
// 3e. a second pick from the same try is another take of that look
pick(staged[1].d, { mode: 'new', kind: 'CHR', name: NAME })
const second = await until(() => jsonl(P.res).filter((e) => e.sessionId === S && e.event === 'studio.picked')[1], 'second pick filed')
ok(second.token === `@${ent.short_id}/V01/T02`, `second pick is a take of the same look: ${second.token}`)
// 3f. close: the unpicked result and the dropped-in picture go to _rejected
append(P.req, { id: id(), ts: new Date().toISOString(), reviewer: 'test', type: 'studio.close', sessionId: S })
// The staged: try priced above was never approved, so nothing is pending.
await until(() => jsonl(P.res).find((e) => e.sessionId === S && e.event === 'studio.closed'), 'studio closed')
ok(!fs.existsSync(path.join(P.staging, staged[2].d)) && fs.existsSync(path.join(P.rejected, staged[2].d)), 'the unpicked result went to _rejected with its sidecar')
ok(!fs.existsSync(path.join(P.uploads, S)) && fs.existsSync(path.join(P.rejected, `studio-${S}-inputs`)), 'the dropped-in picture went beside it')
console.log('\nall studio flows passed')
