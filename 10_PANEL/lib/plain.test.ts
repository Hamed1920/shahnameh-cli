import assert from 'node:assert/strict'
import { test } from 'node:test'
import { plainReason } from './plain.ts'

test('the worker\'s ceiling reasons lose their config keys', () => {
  assert.equal(
    plainReason('320 credits is more than perJobCostCeilingCredits 250'),
    'Costs 320 credits, more than the 250 one job may cost. Change the settings, or raise the limit.',
  )
  const window = plainReason('90 credits would pass costCeilingCredits 3000 for the last 24 h (2950 spent across all projects); it runs once older spend leaves the window')
  assert.match(window, /^Costs 90 credits, and 2,950 of the 3,000 allowed in 24 hours are spent\./)
  assert.doesNotMatch(window, /costCeilingCredits/)
})

test('CLI problems say what is wrong, not which command to type', () => {
  assert.equal(plainReason('the Higgsfield CLI is not signed in: run higgsfield auth login'), 'Higgsfield is not signed in on this computer.')
  assert.equal(
    plainReason('could not be priced, so it will not generate: no Higgsfield workspace is selected: run higgsfield workspace list, then higgsfield workspace set <id>'),
    'Higgsfield could not price it, so it will not run: Higgsfield needs a workspace chosen on this computer before it can run anything.',
  )
})

test('a reason nothing recognises is shown as the worker wrote it', () => {
  assert.equal(plainReason('archive entry X not found or already restored'), 'Archive entry X not found or already restored')
  assert.equal(plainReason(''), '')
  assert.equal(plainReason(null), '')
})
