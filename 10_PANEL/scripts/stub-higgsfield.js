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
if (cmd === 'model' && sub === 'get') out({ job_type: model, params: [{ name: 'generate_audio', type: 'boolean', default: true }] })
if (cmd === 'generate' && sub === 'cost') {
  const video = /^(seedance|kling|veo)/.test(model)
  const res = args[args.indexOf('--resolution') + 1]
  out({ credits: video ? (res === '1080p' ? 135 : 37.5) : 12 })
}
if (cmd === 'generate' && sub === 'create') {
  const video = /^(seedance|kling|veo)/.test(model)
  const id = 'stub-' + Math.random().toString(36).slice(2, 10)
  const base = process.env.STUB_SERVE || 'http://localhost:3199'
  const file = video ? process.env.STUB_VIDEO : process.env.STUB_IMAGE
  // A small delay so "generating now" is observable.
  setTimeout(() => out([{ id, job_type: model, status: 'completed', result_url: `${base}/${file}`, params: {} }]), 1500)
} else if (!(cmd === 'model' && sub === 'get')) {
  process.stderr.write(`stub: unhandled ${args.join(' ')}\n`)
  process.exit(1)
}
