#!/usr/bin/env node
// Stand-in for the Higgsfield CLI, used ONLY in the sandbox (SHM_HIGGSFIELD_JS).
// Spends nothing. Records every invocation to STUB_LOG so a test can check the argv.
const fs = require('fs')
const path = require('path')
const args = process.argv.slice(2)
const log = process.env.STUB_LOG || path.join(__dirname, 'stub-calls.jsonl')
fs.appendFileSync(log, JSON.stringify({ ts: new Date().toISOString(), args }) + '\n')

const out = (o) => { process.stdout.write(JSON.stringify(o)); process.exit(0) }
const [cmd, sub, model] = args

if (cmd === 'auth' && sub === 'token') { process.stdout.write('stub-token\n'); process.exit(0) }
// A handful of real model schemas, so the worker's model catalogue can be exercised offline.
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'stub-models.json'), 'utf8')).models
if (cmd === 'model' && sub === 'list') {
  out(Object.values(FIXTURE).map((m) => ({ display_name: m.display_name, job_type: m.job_type, type: m.type })))
}
if (cmd === 'model' && sub === 'get') {
  if (FIXTURE[model]) out(FIXTURE[model])
  process.stderr.write(`stub: no model ${model}\n`)
  process.exit(1)
}
if (cmd === 'generate' && sub === 'cost') {
  const video = /^(seedance|kling|veo|wan|minimax|gemini_omni|grok_video)/.test(model)
  const res = args[args.indexOf('--resolution') + 1]
  out({ credits: video ? (res === '1080p' ? 135 : 37.5) : 12 })
}
if (cmd === 'generate' && sub === 'create') {
  const video = /^(seedance|kling|veo|wan|minimax|gemini_omni|grok_video)/.test(model)
  const id = 'stub-' + Math.random().toString(36).slice(2, 10)
  const base = process.env.STUB_SERVE || 'http://localhost:3199'
  const file = video ? process.env.STUB_VIDEO : process.env.STUB_IMAGE
  // A small delay so "generating now" is observable.
  setTimeout(() => out([{ id, job_type: model, status: 'completed', result_url: `${base}/${file}`, params: {} }]), 1500)
} else {
  process.stderr.write(`stub: unhandled ${args.join(' ')}\n`)
  process.exit(1)
}
