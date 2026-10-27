import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fieldsToForm, formToFields } from './form-payload.ts'

test('a form survives the round trip, repeated keys included', () => {
  const fd = new FormData()
  fd.set('project', 'p')
  fd.append('refs', 'a')
  fd.append('refs', 'b')
  const fields = formToFields(fd)!
  assert.deepEqual(fields, { project: ['p'], refs: ['a', 'b'] })
  const back = fieldsToForm(JSON.parse(JSON.stringify(fields)))
  assert.deepEqual(back.getAll('refs'), ['a', 'b'])
  assert.equal(back.get('project'), 'p')
})

test('a form with a file in it cannot wait for approval', () => {
  const fd = new FormData()
  fd.set('project', 'p')
  fd.append('files', new File(['x'], 'a.png'))
  assert.equal(formToFields(fd), null)
})
