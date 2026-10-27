import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildTree, creatorsOf, projectCounts, viewGenerations, viewOf, type TreeBlock, type TreeGeneration, type TreeSequence } from './decided-tree.ts'

const gen = (n: number, over: Partial<TreeGeneration> = {}): TreeGeneration => ({
  id: `g${n}`, gNumber: n, gLabel: `G0${n}`, createdAt: `2026-10-0${n}T10:00:00Z`, createdBy: 'Agent', verdict: 'pending', rounds: [], isFinal: false, ...over,
})
const blk = (seq: number, n: number, over: Partial<TreeBlock> = {}): TreeBlock => ({
  id: `PD-S0${seq}-B00${n}`, key: `p:PD-S0${seq}-B00${n}`, sequenceId: `PD-S0${seq}`, title: `Block ${n}`, number: n, displayOrder: n, status: 'not_started', generations: [], ...over,
})
const seqs: TreeSequence[] = [
  { id: 'PD-S02', title: 'Second', number: 2, displayOrder: 1 },
  { id: 'PD-S01', title: 'First', number: 1, displayOrder: 2 },
]

test('sequences follow display order, blocks their own, and counts come from the blocks', () => {
  const tree = buildTree(seqs, [
    blk(1, 2, { status: 'final_ready' }), blk(1, 1, { status: 'ready_for_review' }), blk(2, 1, { status: 'revision_required' }),
  ])
  assert.deepEqual(tree.map((n) => n.seq.id), ['PD-S02', 'PD-S01'])
  assert.deepEqual(tree[1].blocks.map((b) => b.number), [1, 2])
  assert.deepEqual(tree[1].counts, { total: 2, ready: 1, revision: 0, final: 1 })
  assert.deepEqual(projectCounts(tree), { total: 3, ready: 1, revision: 1, final: 1 })
})

test('search by block id or title, status, and sequences with no match disappear', () => {
  const blocks = [blk(1, 1, { title: 'Dawn chase', status: 'final_ready' }), blk(2, 1, { title: 'Harbour' })]
  assert.deepEqual(buildTree(seqs, blocks, { q: 'dawn' }).map((n) => n.seq.id), ['PD-S01'])
  assert.deepEqual(buildTree(seqs, blocks, { q: 'pd-s02-b001' }).map((n) => n.seq.id), ['PD-S02'])
  assert.deepEqual(buildTree(seqs, blocks, { status: 'final_ready' }).map((n) => n.seq.id), ['PD-S01'])
  assert.equal(buildTree(seqs, blocks, { q: 'nothing' }).length, 0)
  assert.equal(buildTree(seqs, blocks).length, 2)
})

test('date and creator filters narrow generations and hide blocks left with none', () => {
  const blocks = [blk(1, 1, { generations: [gen(1), gen(5, { createdBy: 'Other' })] }), blk(1, 2, { generations: [gen(2)] }), blk(1, 3)]
  const t = buildTree(seqs, blocks, { from: '2026-10-02', to: '2026-10-05', creator: 'Other' })
  assert.deepEqual(t[0].blocks.map((b) => b.id), ['PD-S01-B001'])
  assert.deepEqual(t[0].blocks[0].generations.map((g) => g.gLabel), ['G05'])
  assert.deepEqual(creatorsOf(blocks), ['Agent', 'Other'])
})

test('the three views are filters over the same generations', () => {
  const all = [
    gen(1),
    gen(2, { rounds: [{ round: 1, status: 'revision_requested' }] }),
    gen(3, { rounds: [{ round: 2, status: 'approved' }] }),
    gen(4, { isFinal: true, rounds: [{ round: 3, status: 'approved' }] }),
  ]
  assert.equal(viewGenerations(all, 'all').length, 4)
  assert.deepEqual(viewGenerations(all, 'submitted').map((g) => g.gNumber), [2, 3, 4])
  assert.deepEqual(viewGenerations(all, 'final').map((g) => g.gNumber), [3, 4])
  assert.equal(viewGenerations(all, 'all')[0], all[0])
  assert.equal(viewOf('nonsense'), 'all')
})
