import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  blockNumber, episodeFolderName, episodeLabel, episodeOf, episodesIn, episodeTitleSlug, foldEpisodeShots,
  groupByEpisode, longEpisode, nextEpisodeId, parseEpisodeDir, parseEpisodeQuery, promptHandle, searchEpisodes,
  shortEpisode,
} from './episodes.ts'

test('the episode of a target, and nothing from another project', () => {
  assert.equal(episodeOf('SHM-EP001-SC004-SH0010', 'SHM'), 'EP001')
  assert.equal(episodeOf('SHM-EP012-SC004-SH0010', 'SHM'), 'EP012')
  assert.equal(episodeOf('SHM-CHR-001-ZAHHAK', 'SHM'), null)
  assert.equal(episodeOf('', 'SHM'), null)
  assert.equal(episodeOf(null, 'SHM'), null)
  assert.equal(episodeOf('SHM-EP001-SC004-SH0010', 'TST'), null)
})

test('EP001 and EP1 are the same episode, written two ways', () => {
  assert.equal(shortEpisode('EP001'), 'EP1')
  assert.equal(shortEpisode('EP012'), 'EP12')
  assert.equal(longEpisode('ep1'), 'EP001')
  assert.equal(longEpisode('EP 12'), 'EP012')
  assert.equal(longEpisode('2'), 'EP002')
  assert.equal(longEpisode('SC001'), null)
})

test('the block number out of a document heading, in either language', () => {
  assert.equal(blockNumber('P01'), 'P01')
  assert.equal(blockNumber('P1'), 'P01')
  assert.equal(blockNumber('PROMPT 3'), 'P03')
  assert.equal(blockNumber('P02 — the hall'), 'P02')
  assert.equal(blockNumber('پرامپت ۴'), 'P04')
  assert.equal(blockNumber('SHOT 2'), null)
  assert.equal(blockNumber('the wide one'), null)
  assert.equal(blockNumber(null), null)
})

test('EP1 P01 is the handle; without a block number the scene stands in', () => {
  assert.equal(promptHandle('EP001', 'P01'), 'EP1 P01')
  assert.equal(promptHandle('EP002', 'PROMPT 12'), 'EP2 P12')
  assert.equal(promptHandle('EP001', null, 'SC004'), 'EP1 SC004')
  // A heading that is not a block number: the scene says more than the words do.
  assert.equal(promptHandle('EP001', 'the wide one', 'SC004'), 'EP1 SC004')
  assert.equal(promptHandle('EP001', 'the wide one', null), 'EP1 the wide one')
  assert.equal(promptHandle(null, 'P01'), 'P01')
})

test('an episode reads with its folder title when it has one', () => {
  assert.equal(episodeLabel('EP001', { EP001: 'Zahhak Entry' }), 'EP1 · Zahhak Entry')
  assert.equal(episodeLabel('EP002', { EP001: 'Zahhak Entry' }), 'EP2')
  assert.equal(episodeLabel(null), 'Not in an episode')
})

test('the folder name carries the id and the title', () => {
  assert.deepEqual(parseEpisodeDir('SHM-EP001-ZAHHAK-ENTRY', 'SHM'), { id: 'EP001', title: 'Zahhak Entry' })
  assert.deepEqual(parseEpisodeDir('SHM-EP002', 'SHM'), { id: 'EP002', title: '' })
  assert.equal(parseEpisodeDir('_TEMPLATE', 'SHM'), null)
  assert.equal(parseEpisodeDir('SHM-EP001-ZAHHAK-ENTRY', 'TST'), null)
})

test('numbers are never reused, so the next episode is past every one that exists', () => {
  assert.equal(nextEpisodeId([]), 'EP001')
  assert.equal(nextEpisodeId(['EP001']), 'EP002')
  // A gap stays a gap: EP002 was used and is gone, the next one is still EP004.
  assert.equal(nextEpisodeId(['EP001', 'EP003']), 'EP004')
})

test('grouping keeps episode order and puts what is not footage last', () => {
  const takes = [
    { id: 'a', target: 'SHM-EP002-SC001-SH0010' },
    { id: 'b', target: 'SHM-CHR-001-ZAHHAK' },
    { id: 'c', target: 'SHM-EP001-SC004-SH0010' },
    { id: 'd', target: 'SHM-EP001-SC001-SH0010' },
  ]
  assert.deepEqual(
    groupByEpisode(takes, (t) => episodeOf(t.target, 'SHM')).map((g) => [g.episode, g.items.map((i) => i.id)]),
    [['EP001', ['c', 'd']], ['EP002', ['a']], [null, ['b']]],
  )
})

test('every episode in play: the ones on disk and the ones only a take points at', () => {
  assert.deepEqual(episodesIn(['EP001'], ['EP002', null, 'EP001', 'nonsense']), ['EP001', 'EP002'])
})

test('an episode folder is named from its title, and only from ASCII', () => {
  assert.equal(episodeTitleSlug('Zahhak Entry'), 'ZAHHAK-ENTRY')
  assert.equal(episodeTitleSlug('The Fall of Jamshid!'), 'THE-FALL-OF-JAMSHID')
  // PowerShell reads a BOM-less .ps1 as ANSI, so the tools are ASCII on purpose
  // and so are the folder names they walk. A Persian title just has no slug.
  assert.equal(episodeTitleSlug('ورود ضحاک'), '')
  assert.equal(episodeFolderName('SHM', 'EP002', 'Zahhak Entry'), 'SHM-EP002-ZAHHAK-ENTRY')
  assert.equal(episodeFolderName('SHM', 'EP002', ''), 'SHM-EP002')
  assert.equal(episodeFolderName('SHM', 'EP003', 'ورود ضحاک'), 'SHM-EP003')
  // And it reads back out the way the panel shows it.
  assert.deepEqual(parseEpisodeDir(episodeFolderName('SHM', 'EP002', 'Zahhak Entry'), 'SHM'), {
    id: 'EP002', title: 'Zahhak Entry',
  })
})

const EPISODES = [
  { id: 'EP001', title: 'Zahhak Entry', shots: 14 },
  { id: 'EP002', title: '', shots: 0 },
  { id: 'EP003', title: 'The Fall of Jamshid', shots: 2 },
]

test('an empty line offers every episode and a new one', () => {
  const r = searchEpisodes('', EPISODES, 'EP004')
  assert.deepEqual(r.matches.map((e) => e.id), ['EP001', 'EP002', 'EP003'])
  assert.deepEqual(r.create, [{ id: 'EP004', title: '', isNew: true }])
})

test('a typed line splits into the number it asks for and the name it gives', () => {
  assert.deepEqual(parseEpisodeQuery('9'), { id: 'EP009', title: '' })
  assert.deepEqual(parseEpisodeQuery('EP9'), { id: 'EP009', title: '' })
  assert.deepEqual(parseEpisodeQuery('ep 12'), { id: 'EP012', title: '' })
  assert.deepEqual(parseEpisodeQuery('9 Rostam and Sohrab'), { id: 'EP009', title: 'Rostam and Sohrab' })
  assert.deepEqual(parseEpisodeQuery('EP9 - Rostam'), { id: 'EP009', title: 'Rostam' })
  assert.deepEqual(parseEpisodeQuery('Rostam'), { id: null, title: 'Rostam' })
})

test('the episode this footage is already in is not a destination', () => {
  const r = searchEpisodes('', EPISODES, 'EP004', ['EP001'])
  assert.deepEqual(r.matches.map((e) => e.id), ['EP002', 'EP003'])
})

test('a number finds that episode; an existing number is that episode, not a new one', () => {
  assert.deepEqual(searchEpisodes('3', EPISODES, 'EP004').matches.map((e) => e.id), ['EP003'])
  assert.deepEqual(searchEpisodes('EP3', EPISODES, 'EP004').matches.map((e) => e.id), ['EP003'])
  // Never a way to reuse a number: EP003 exists, so it is offered as a match.
  assert.deepEqual(searchEpisodes('3', EPISODES, 'EP004').create, [])
  // The one it is already in is offered as neither a match nor a new episode.
  const own = searchEpisodes('1', EPISODES, 'EP004', ['EP001'])
  assert.deepEqual(own.matches, [])
  assert.deepEqual(own.create, [])
  assert.match(own.note ?? '', /already is/)
})

test('any number can be started: the next one is suggested, not imposed', () => {
  const nine = searchEpisodes('9', EPISODES, 'EP004')
  // What was asked for comes first; the next in order is offered beside it.
  assert.deepEqual(nine.create, [
    { id: 'EP009', title: '', isNew: true },
    { id: 'EP004', title: '', isNew: true },
  ])
  assert.match(nine.note ?? '', /EP4 is the next one in order/)
  assert.match(nine.note ?? '', /gap, which is fine/)
  // Asking for the next one is just the one row.
  assert.deepEqual(searchEpisodes('4', EPISODES, 'EP004').create, [{ id: 'EP004', title: '', isNew: true }])
  assert.equal(searchEpisodes('4', EPISODES, 'EP004').note, null)
})

test('a number and a name on one line start that number, called that', () => {
  const r = searchEpisodes('9 Rostam and Sohrab', EPISODES, 'EP004')
  assert.deepEqual(r.create, [
    { id: 'EP009', title: 'Rostam and Sohrab', isNew: true },
    { id: 'EP004', title: 'Rostam and Sohrab', isNew: true },
  ])
})

test('a name searches, and starts an episode called that when nothing matches', () => {
  assert.deepEqual(searchEpisodes('jamshid', EPISODES, 'EP004').matches.map((e) => e.id), ['EP003'])
  // An exact title is that episode, not an invitation to make a second one.
  assert.deepEqual(searchEpisodes('Zahhak Entry', EPISODES, 'EP004').create, [])
  const fresh = searchEpisodes('Rostam and Sohrab', EPISODES, 'EP004')
  assert.deepEqual(fresh.matches, [])
  assert.deepEqual(fresh.create, [{ id: 'EP004', title: 'Rostam and Sohrab', isNew: true }])
})

test('a name with no Latin letters is kept, and the folder is just the number', () => {
  const r = searchEpisodes('ورود ضحاک', EPISODES, 'EP004')
  assert.deepEqual(r.create, [{ id: 'EP004', title: 'ورود ضحاک', isNew: true }])
  assert.match(r.note ?? '', /Latin/)
})

test('footage counts where it is now, and an episode it has left keeps its number', () => {
  // Every shot id ever targeted: QUEUE.jsonl keeps the old one for ever, and the
  // moved file on disk is the new one, so a moved shot appears as both.
  const shots = [
    'SHM-EP001-SC001-SH0010',
    'SHM-EP001-SC002-SH0010',
    'SHM-EP001-SC003-SH0010',
    'SHM-EP002-SC001-SH0010',
  ]
  const moved = { 'SHM-EP001-SC003-SH0010': 'SHM-EP002-SC001-SH0010' }

  const raw = foldEpisodeShots(shots, 'SHM')
  assert.deepEqual([...raw.counts], [['EP001', 3], ['EP002', 1]])

  // SC003 left EP001 for EP002. It is one piece of footage, counted once.
  const now = foldEpisodeShots(shots, 'SHM', moved)
  assert.deepEqual([...now.counts], [['EP001', 2], ['EP002', 1]])
  assert.deepEqual(now.episodes, ['EP001', 'EP002'])
})

test('an episode everything has left still exists, and its number is never reissued', () => {
  const shots = ['SHM-EP001-SC001-SH0010', 'SHM-EP002-SC001-SH0010']
  const { episodes, counts } = foldEpisodeShots(shots, 'SHM', {
    'SHM-EP001-SC001-SH0010': 'SHM-EP002-SC002-SH0010',
  })
  assert.deepEqual(episodes, ['EP001', 'EP002'])
  assert.equal(counts.get('EP001'), undefined)
  assert.equal(counts.get('EP002'), 2)
  // The empty episode is still counted when the next number is handed out.
  assert.equal(nextEpisodeId(episodes), 'EP003')
})

test('a shot moved twice is counted once, at the end of the chain', () => {
  const shots = ['SHM-EP001-SC001-SH0010', 'SHM-EP002-SC001-SH0010', 'SHM-EP003-SC001-SH0010']
  // getShotMoves already chases the chain, so EP001 -> EP003 arrives folded.
  const { counts } = foldEpisodeShots(shots, 'SHM', {
    'SHM-EP001-SC001-SH0010': 'SHM-EP003-SC001-SH0010',
    'SHM-EP002-SC001-SH0010': 'SHM-EP003-SC001-SH0010',
  })
  assert.equal(counts.get('EP003'), 1)
  assert.equal(counts.get('EP001'), undefined)
})

test('entities are not footage and count towards no episode', () => {
  const { episodes, counts } = foldEpisodeShots(['SHM-CHR-001-ZAHHAK', 'SHM-EP001-SC001-SH0010'], 'SHM')
  assert.deepEqual(episodes, ['EP001'])
  assert.equal(counts.size, 1)
})
