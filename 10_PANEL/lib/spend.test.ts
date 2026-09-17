import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spentInWindow } from '../worker/lib/spend.mjs'

/**
 * The ceiling is the Higgsfield account's, so the window covers every project's
 * ledger rows at once. Only rows that actually generated count.
 */

const NOW = Date.parse('2026-09-17T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString()

const rows = [
  // Shahnameh's ledger.
  { state: 'GENERATED', cost: '120', ingested: hoursAgo(1) },
  { state: 'GENERATED', cost: '80', ingested: hoursAgo(23.5) },
  { state: 'GENERATED', cost: '500', ingested: hoursAgo(25) }, // outside the window
  { state: 'FAILED', cost: '250', ingested: hoursAgo(2) }, // never charged
  // Another project's ledger, same account.
  { state: 'GENERATED', cost: '40', ingested: hoursAgo(3) },
  { state: 'GENERATED', cost: '', ingested: hoursAgo(4) }, // unpriced
  { state: 'GENERATED', cost: '10', ingested: 'not a date' },
]

test('adds up generated credits inside the window, across projects', () => {
  assert.equal(spentInWindow(rows, 24, NOW), 240)
})

test('a longer window reaches further back', () => {
  assert.equal(spentInWindow(rows, 48, NOW), 740)
})

test('no rows, no spend', () => {
  assert.equal(spentInWindow([], 24, NOW), 0)
})
