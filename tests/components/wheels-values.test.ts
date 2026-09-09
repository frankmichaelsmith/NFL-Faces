import { describe, expect, it } from 'vitest'
import { wheelValues } from '../../src/components/Wheels'
import type { Bundle } from '../../src/game/bundle'
import type { AnyRound } from '../../src/state/machine'

const bundle: Bundle = {
  buildHash: 't',
  generatedAt: '',
  firstSeason: 2000,
  lastSeason: 2002,
  liveSeason: null,
  roles: ['QB'],
  teams: [{ id: 'PIT', label: 'Steelers' }],
  people: {},
  combos: [],
  probowl: {
    seasons: [1995, 1996, 2001],
    rosters: { '1995': ['a'], '1996': ['a'], '2001': ['a'] },
    numbers: {},
    players: { a: { name: 'A B', pos: 'QB', jersey: null, college: null, draft: null } },
    colleges: {},
    teams: {},
    combos: [],
  },
}
const probowlRound: AnyRound = {
  kind: 'probowl',
  combo: {
    season: 1996,
    player: 'a',
    category: 'position',
    answer: 'QB',
    distractors: ['RB', 'WR'],
  },
  options: ['QB', 'RB', 'WR'],
  answerSlot: 0,
  usedKey: 'a',
}

describe('season wheel span', () => {
  it('uses the bundle span for Faces and the Pro Bowl span for Pro Bowl rounds', () => {
    expect(wheelValues(bundle, 'season')).toEqual(['2000', '2001', '2002'])
    expect(wheelValues(bundle, 'season', probowlRound)[0]).toBe('1995')
    expect(wheelValues(bundle, 'season', probowlRound).at(-1)).toBe('2001')
    expect(wheelValues(bundle, 'season', probowlRound)).toHaveLength(7)
  })
})
