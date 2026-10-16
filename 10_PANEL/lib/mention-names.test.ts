import assert from 'node:assert/strict'
import { test } from 'node:test'
import { displayOf, toDisplay, toToken, type NamedOption } from './mention-names.ts'

const options: NamedOption[] = [
  { token: '@CHR-007/V02', title: 'Armayel' },
  { token: '@LOC-026/V01', title: 'Slaughter Prep Room' },
  { token: '@LOC-026/V02', title: 'Slaughter Prep Room' },
  { token: '@GRP-009/V05', title: 'Townsfolk Masked' },
  { token: '@upload:u3', title: 'Upload 3' },
]
// What the app uses: the same entity, whichever look it is written with.
const sameRef = (m: string, o: NamedOption) => {
  if (m.startsWith('@upload:')) return m === o.token
  const [a] = m.replace(/^@/, '').split('/')
  const [b] = o.token.replace(/^@/, '').split('/')
  return a === b
}

test('an id reads as the name, with the look when it names one', () => {
  assert.equal(toDisplay('keep @CHR-007/V02 as is', options, sameRef), 'keep @Armayel (look 2) as is')
  assert.equal(toDisplay('keep @CHR-007 as is', options, sameRef), 'keep @Armayel as is')
  assert.equal(toDisplay('crowd @GRP-009/V05.', options, sameRef), 'crowd @Townsfolk Masked (look 5).')
  assert.equal(toDisplay('see @upload:u3', options, sameRef), 'see @Upload 3')
})

test('and a name goes back to the id the worker reads', () => {
  assert.equal(toToken('keep @Armayel (look 2) as is', options), 'keep @CHR-007/V02 as is')
  assert.equal(toToken('keep @Armayel as is', options), 'keep @CHR-007 as is')
  assert.equal(toToken('crowd @Townsfolk Masked (look 5).', options), 'crowd @GRP-009/V05.')
  assert.equal(toToken('see @Upload 3', options), 'see @upload:u3')
})

test('going there and back changes nothing', () => {
  const text = 'Use @CHR-007/V02 and @GRP-009/V05, never @CHR-007. And @upload:u3 too.'
  assert.equal(toToken(toDisplay(text, options, sameRef), options), text)
})

test('half a name is left alone while it is being typed', () => {
  assert.equal(toToken('@Arma', options), '@Arma')
  assert.equal(toToken('@Armayelx', options), '@Armayelx')
  assert.equal(toToken('@Armayel (look', options), '@CHR-007 (look')
})

test('two looks of one entity are told apart by look; two entities with one name stay as ids', () => {
  assert.equal(toDisplay('@LOC-026/V02', options, sameRef), '@Slaughter Prep Room (look 2)')
  assert.equal(toToken('@Slaughter Prep Room (look 2)', options), '@LOC-026/V02')
  const twins: NamedOption[] = [{ token: '@CHR-001/V01', title: 'Guard' }, { token: '@GRP-005/V01', title: 'Guard' }]
  assert.equal(toDisplay('@CHR-001/V01', twins, sameRef), '@CHR-001/V01')
  assert.equal(toToken('@Guard', twins), '@Guard')
})

test('a take and an unattached id stay as ids', () => {
  assert.equal(toDisplay('@CHR-007/V02/T03', options, sameRef), '@CHR-007/V02/T03')
  assert.equal(toDisplay('@PRP-099/V01', options, sameRef), '@PRP-099/V01')
})

test('how one reference is written on screen', () => {
  assert.equal(displayOf(options[0]), '@Armayel (look 2)')
  assert.equal(displayOf(options[4]), '@Upload 3')
})
