import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/**
 * A slug reaches the server from a URL or a form field, so it is never trusted:
 * it is checked before it is joined onto a path, and the folder must really be
 * a project of this panel.
 */

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fmfd-projects-'))
process.env.SHM_PROJECTS = dir
const { getProject, listProjects, requireProject, UnknownProject } = await import('./projects.ts')

async function makeProject(slug: string, json: Record<string, unknown>) {
  await fs.mkdir(path.join(dir, slug), { recursive: true })
  await fs.writeFile(path.join(dir, slug, 'project.json'), JSON.stringify(json), 'utf8')
}

await makeProject('shahnameh-cli', { schema: 1, name: 'Shahnameh', slug: 'shahnameh-cli', code: 'SHM' })
await makeProject('second-film', { schema: 1, name: 'Second', slug: 'second-film', code: 'SEC' })
// Not projects: no project.json, a slug that disagrees with the folder, a bad code.
await fs.mkdir(path.join(dir, '10_PANEL'), { recursive: true })
await makeProject('mismatched', { schema: 1, name: 'Wrong', slug: 'something-else', code: 'WRG' })
await makeProject('bad-code', { schema: 1, name: 'Bad', slug: 'bad-code', code: 'CHR' })
await makeProject('.new-half-built', { schema: 1, name: 'Half', slug: '.new-half-built', code: 'HLF' })

test('lists only real projects', async () => {
  assert.deepEqual((await listProjects()).map((p) => p.slug), ['second-film', 'shahnameh-cli'])
})

test('a project carries its code and its own paths', async () => {
  const pr = await requireProject('shahnameh-cli')
  assert.equal(pr.code, 'SHM')
  assert.equal(pr.name, 'Shahnameh')
  assert.equal(pr.mark, 'S') // no mark in project.json: the name's first letter
  assert.equal(pr.P.entities, path.join(dir, 'shahnameh-cli', '00_PROJECT', 'registry', 'ENTITIES.csv'))
  assert.equal(pr.P.staging, path.join(dir, 'shahnameh-cli', '09_OUTPUT', '_staging'))
})

test('nothing but a real project resolves', async () => {
  for (const slug of [
    '..', '../..', '..%2f..', 'shahnameh-cli/../10_PANEL', 'SHAHNAMEH-CLI', 'Shahnameh-Cli',
    '10_PANEL', 'mismatched', 'bad-code', '.new-half-built', 'nope', '', '.', '/etc/passwd',
    'C:\\Windows', 'shahnameh-cli\0', 'api', 'tools', 'docs',
  ]) {
    assert.equal(await getProject(slug), null, `${JSON.stringify(slug)} must not resolve`)
  }
  for (const notAString of [null, undefined, 42, {}, ['shahnameh-cli']]) {
    assert.equal(await getProject(notAString), null)
  }
})

test('requireProject throws for an unknown project', async () => {
  await assert.rejects(() => requireProject('nope'), UnknownProject)
  await assert.rejects(() => requireProject('..'), UnknownProject)
})

test.after(() => fs.rm(dir, { recursive: true, force: true }))
