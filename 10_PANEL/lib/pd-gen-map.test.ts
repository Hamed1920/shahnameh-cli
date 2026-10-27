import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blockJobLabel, creatorOf, isSystemName, mapOutputs, matchPromptVersion, numberNewOutputs, outputKey, shouldSaveVersion, splitByBlock,
  type RawDecision, type RawJob, type RawRequest, type RawSidecar,
} from './pd-gen-map.ts';
import { promptHash } from './pd/prompt-hash.ts';
import { gLabel } from './pd/numbering.ts';

const T = 'PD-EP001-SC003-SH0010';

const jobs: RawJob[] = [
  { jobId: 'J1', target: T, stage: 'draft', model: 'seedance_2_5', params: { resolution: '480p', duration: 15 }, basePrompt: 'A  fox\r\nruns', enqueuedAt: '2026-10-01T10:00:00Z', enqueuedBy: 'owner', label: 'PD-S01-B003 pv1' },
  { jobId: 'J2', parentJobId: 'J1', target: T, stage: 'final', attempt: 1, params: { resolution: '1080p', duration: 15 }, basePrompt: 'A fox runs ', enqueuedAt: '2026-10-01T11:00:00Z', enqueuedBy: 'reviewer' },
  { jobId: 'J3', parentJobId: 'J1', target: T, stage: 'draft', attempt: 2, params: { resolution: '480p' }, basePrompt: 'A fox runs fast', enqueuedAt: '2026-10-01T12:00:00Z', enqueuedBy: 'agent' },
];
const sidecars: RawSidecar[] = [
  { jobId: 'J1', hfJobId: 'hf1', stage: 'draft', createdAt: '2026-10-01T10:05:00Z', costCredits: 37.5, candidates: [{ file: 'T01.mp4', take: 'T01' }] },
  { jobId: 'J2', hfJobId: 'hf2', stage: 'final', createdAt: '2026-10-01T11:05:00Z', costCredits: 135, candidates: [{ file: 'T01.mp4', take: 'T01' }] },
  { jobId: 'J3', hfJobId: 'hf3', stage: 'draft', createdAt: '2026-10-01T12:05:00Z', costCredits: 37.5, candidates: [{ file: 'T01.mp4', take: 'T01' }, { file: 'T02.mp4', take: 'T02' }] },
];
const decisions: RawDecision[] = [
  { id: 'd1', ts: '2026-10-01T10:30:00Z', candidate: '09_OUTPUT/_staging/hf1/T01.mp4', hfJobId: 'hf1', verdict: 'accepted' },
];

test('outputs: one per candidate, with operation type, resolution, cost and verdict', () => {
  const o = mapOutputs(jobs, sidecars, decisions);
  assert.deepEqual(o.map((x) => x.key), ['hf1|T01', 'hf2|T01', 'hf3|T01', 'hf3|T02']);
  assert.deepEqual(o.map((x) => x.operationType), ['generate', 'final_of_draft', 'revision', 'revision']);
  assert.equal(o[0].resolution, '480p');
  assert.equal(o[1].resolution, '1080p');
  assert.equal(o[0].durationSeconds, 15);
  assert.equal(o[0].costCredits, 37.5);
  assert.equal(o[0].verdict, 'accepted');
  assert.equal(o[1].verdict, null);
  assert.equal(o[1].createdBy, 'reviewer');
});

test('a job with no sidecar makes no output; studio tries are skipped', () => {
  const o = mapOutputs([...jobs, { jobId: 'J9', target: T }], [...sidecars, { jobId: 'S1', hfJobId: 'hfs', studio: {}, target: 'x', candidates: [{ file: 'a.png', take: 'T01' }] }], []);
  assert.equal(o.length, 4);
});

test('a failed decision leaves the take waiting', () => {
  const o = mapOutputs(jobs, sidecars, decisions, new Set(['d1']));
  assert.equal(o[0].verdict, null);
});

test('the last decision about a take wins', () => {
  const later: RawDecision[] = [...decisions, { id: 'd2', ts: 'x', candidate: '09_OUTPUT/_staging/hf1/T01.mp4', hfJobId: 'hf1', verdict: 'denied' }];
  assert.equal(mapOutputs(jobs, sidecars, later)[0].verdict, 'denied');
});

test('G numbers are frozen across repeated syncs and new outputs are appended', () => {
  const outs = mapOutputs(jobs, sidecars, decisions);
  const first = numberNewOutputs([], outs);
  assert.deepEqual(first.map((x) => [x.key, x.g]), [['hf1|T01', 1], ['hf2|T01', 2], ['hf3|T01', 3], ['hf3|T02', 4]]);
  const stored = first.map((x) => ({ key: x.key, g: x.g }));
  assert.deepEqual(numberNewOutputs(stored, outs), []);
  // An output older than everything else shows up late: it still goes last, nothing is renumbered.
  const late = mapOutputs(
    [...jobs, { jobId: 'J0', target: T, stage: 'draft', enqueuedAt: '2026-09-01T00:00:00Z' }],
    [...sidecars, { jobId: 'J0', hfJobId: 'hf0', stage: 'draft', createdAt: '2026-09-01T00:05:00Z', candidates: [{ file: 'T01.mp4', take: 'T01' }] }],
    [],
  );
  const more = numberNewOutputs(stored, late);
  assert.deepEqual(more.map((x) => [x.key, x.g]), [['hf0|T01', 5]]);
  assert.equal(gLabel(more[0].g), 'G05');
});

test('split: known blocks, unassigned targets, hand-assigned outputs', () => {
  const outs = mapOutputs(
    [...jobs, { jobId: 'JX', target: 'PD-EP001-SC099-SH0010', stage: 'draft', enqueuedAt: '2026-10-02T00:00:00Z' }],
    [...sidecars, { jobId: 'JX', hfJobId: 'hfx', stage: 'draft', createdAt: '2026-10-02T00:05:00Z', candidates: [{ file: 'T01.mp4', take: 'T01' }] }],
    [],
  );
  const blocks = new Map([[T, 'PD-S01-B003']]);
  const a = splitByBlock(outs, blocks);
  assert.equal(a.byBlock.get('PD-S01-B003')!.length, 4);
  assert.deepEqual(a.unassigned.map((x) => x.key), [outputKey('hfx', 'T01')]);
  const b = splitByBlock(outs, blocks, new Set([outputKey('hfx', 'T01'), 'hf1|T01']));
  assert.equal(b.unassigned.length, 0);
  assert.equal(b.byBlock.get('PD-S01-B003')!.length, 3);
});

test('prompt version: matched by normalized hash, else by the pvN label', () => {
  const v = [
    { id: 'a', versionNumber: 1, promptHash: promptHash('A fox runs') },
    { id: 'b', versionNumber: 2, promptHash: promptHash('A fox runs fast') },
  ];
  const [g1, g2, g3] = mapOutputs(jobs, sidecars, []);
  assert.equal(matchPromptVersion(g1.promptHash, g1.label, 'PD-S01-B003', v)?.id, 'a');
  assert.equal(matchPromptVersion(g2.promptHash, g2.label, 'PD-S01-B003', v)?.id, 'a');
  assert.equal(matchPromptVersion(g3.promptHash, g3.label, 'PD-S01-B003', v)?.id, 'b');
  assert.equal(matchPromptVersion(promptHash('other'), 'PD-S01-B003 pv2', 'PD-S01-B003', v)?.id, 'b');
  assert.equal(matchPromptVersion(promptHash('other'), 'PD-S01-B004 pv2', 'PD-S01-B003', v), null);
  assert.equal(matchPromptVersion(null, null, 'PD-S01-B003', v), null);
});

test('prompt version is new only when the normalized text changed', () => {
  const h = promptHash('A fox runs');
  assert.equal(shouldSaveVersion(null, 'A fox runs').save, true);
  assert.equal(shouldSaveVersion(h, '  A  fox runs \r\n').save, false);
  assert.equal(shouldSaveVersion(h, 'A fox runs fast').save, true);
});

test('block job label', () => {
  assert.equal(blockJobLabel('PD-S01-B003', 2), 'PD-S01-B003 pv2');
});

test('creatorOf names the person, not the system part that queued the job', () => {
  const requests: RawRequest[] = [
    { ts: '2026-10-01T10:00:00Z', type: 'batch.submit', batchId: 'B1', reviewer: 'sub', actorId: 'u-sub' },
    { ts: '2026-10-01T10:01:00Z', type: 'batch.approve', batchId: 'B1', reviewer: 'appr', actorId: 'u-appr' },
    { ts: '2026-10-01T10:00:00Z', type: 'batch.submit', batchId: 'B2', reviewer: 'only-sub', actorId: 'u-only' },
    { ts: '2026-10-03T10:00:00Z', type: 'regenerate', jobId: 'J2', reviewer: 'regen', actorId: 'u-regen' },
  ];
  const decisions: RawDecision[] = [
    { ts: '2026-10-02T10:00:00Z', reviewer: 'acc', actorId: 'u-acc', jobId: 'J1', candidate: 'c', hfJobId: 'h', verdict: 'accepted' },
    { ts: '2026-10-02T11:00:00Z', reviewer: 'den', actorId: 'u-den', jobId: 'J2', candidate: 'c', hfJobId: 'h', verdict: 'denied', requeue: true },
  ];
  const J: RawJob[] = [
    { jobId: 'J1', batchId: 'B1', enqueuedBy: 'panel:batch', enqueuedAt: '2026-10-01T10:02:00Z' },
    { jobId: 'J2', batchId: 'B2', enqueuedBy: 'panel:batch', enqueuedAt: '2026-10-01T10:02:00Z' },
    { jobId: 'F1', parentJobId: 'J1', enqueuedBy: 'worker:final', enqueuedAt: '2026-10-02T10:01:00Z' },
    { jobId: 'R2', parentJobId: 'J2', enqueuedBy: 'worker:revision', enqueuedAt: '2026-10-02T11:01:00Z' },
    { jobId: 'G2', parentJobId: 'J2', enqueuedBy: 'panel:regenerate', enqueuedAt: '2026-10-03T10:01:00Z' },
    { jobId: 'Y', enqueuedBy: 'cli' },
  ];
  const of = (id: string, d = decisions, r = requests) => creatorOf(J.find((j) => j.jobId === id)!, J, d, r);
  assert.deepEqual(of('J1'), { name: 'appr', id: 'u-appr' }); // the approver, not the submitter
  assert.deepEqual(of('J2'), { name: 'only-sub', id: 'u-only' }); // never approved in the records: the submitter
  assert.deepEqual(of('F1'), { name: 'acc', id: 'u-acc' }); // whoever accepted the draft
  assert.deepEqual(of('R2'), { name: 'den', id: 'u-den' }); // whoever denied it with a requeue
  assert.deepEqual(of('G2'), { name: 'regen', id: 'u-regen' });
  assert.deepEqual(of('F1', [], requests), { name: 'appr', id: 'u-appr' }); // no decision: the parent's person
  assert.deepEqual(of('Y'), { name: 'cli', id: null });
  assert.deepEqual(of('G2', decisions, []), { name: 'panel:regenerate', id: null }); // nothing to read: unchanged
  assert.equal(isSystemName('worker:final'), true);
  assert.equal(isSystemName('Test Agent'), false);
});
