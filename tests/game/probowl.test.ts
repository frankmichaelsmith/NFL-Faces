import { describe, expect, it } from 'vitest'
import type { ProBowlCombo, ProBowlSection } from '../../src/game/bundle'
import {
  buildProBowlRound,
  describeValue,
  eligibleProBowlCombos,
  nextProBowlRound,
  pickProBowlCombo,
} from '../../src/game/probowl'
import { mulberry32 } from '../../src/game/rng'

const combo = (
  season: number,
  player: string,
  category: ProBowlCombo['category'],
  answer: string,
  distractors: string[],
): ProBowlCombo => ({ season, player, category, answer, distractors })

const S: ProBowlSection = {
  seasons: [2010, 2011],
  rosters: { '2010': ['brady', 'brees'], '2011': ['brady', 'rodgers'] },
  numbers: { '2010': { brady: 12, brees: 9 }, '2011': { brady: 12, rodgers: 12 } },
  players: {
    brady: { name: 'Tom Brady', pos: 'QB', jersey: 12, college: 'mich', draft: 'NE' },
    brees: { name: 'Drew Brees', pos: 'QB', jersey: 9, college: 'pur', draft: 'SD' },
    rodgers: { name: 'Aaron Rodgers', pos: 'QB', jersey: 12, college: 'cal', draft: 'GB' },
  },
  colleges: {
    mich: { name: 'Michigan', logo: 'mich.png' },
    pur: { name: 'Purdue', logo: null },
    cal: { name: 'California', logo: null },
  },
  teams: {
    NE: { label: 'NE', name: 'New England Patriots', color: '002244', alt: 'c60c30' },
    SD: { label: 'SD', name: 'San Diego Chargers', color: '0080C6', alt: 'FFC20E' },
    GB: { label: 'GB', name: 'Green Bay Packers', color: '203731', alt: 'FFB612' },
  },
  combos: [
    combo(2010, 'brady', 'alma', 'mich', ['pur', 'cal']),
    combo(2010, 'brady', 'draft', 'NE', ['SD', 'GB', 'UDFA']),
    combo(2010, 'brees', 'number', '9', ['12', '4']),
    combo(2011, 'brady', 'position', 'QB', ['RB', 'WR', 'TE']),
    combo(2011, 'rodgers', 'draft', 'GB', ['NE', 'SD']),
  ],
}

describe('Pro Bowl roll selection', () => {
  it('excludes every combo of a player already rolled this streak, in any category', () => {
    expect(eligibleProBowlCombos(S, new Set()).length).toBe(5)
    const left = eligibleProBowlCombos(S, new Set(['brady']))
    expect(left.map((c) => c.player)).toEqual(['brees', 'rodgers'])
  })
  it('returns null once every player has been rolled', () => {
    expect(pickProBowlCombo(S, new Set(['brady', 'brees', 'rodgers']), mulberry32(1))).toBeNull()
    expect(nextProBowlRound(S, new Set(['brady', 'brees', 'rodgers']), mulberry32(1))).toBeNull()
  })
  it('picks the category by weight, then a combo uniformly within it', () => {
    const rng = mulberry32(3)
    const N = 40000
    const counts = new Map<string, number>()
    const byCat = new Map<string, number>()
    for (let i = 0; i < N; i++) {
      const c = pickProBowlCombo(S, new Set(), rng)!
      const k = `${c.player}:${c.category}`
      counts.set(k, (counts.get(k) ?? 0) + 1)
      byCat.set(c.category, (byCat.get(c.category) ?? 0) + 1)
    }
    expect(counts.size).toBe(5)
    // default weights: alma 1, draft 1, number 1, position 0.3 → position ≈ 9.1%, others ≈ 30.3%
    expect(byCat.get('position')! / N).toBeGreaterThan(0.075)
    expect(byCat.get('position')! / N).toBeLessThan(0.105)
    for (const cat of ['alma', 'draft', 'number'])
      expect(byCat.get(cat)! / N).toBeCloseTo(1 / 3.3, 1)
    // draft has two combos; each gets half of the category's share
    expect(counts.get('brady:draft')! / counts.get('rodgers:draft')!).toBeCloseTo(1, 0)
  })
  it('honours explicit weights and skips a category weighted to zero', () => {
    const rng = mulberry32(4)
    for (let i = 0; i < 500; i++) {
      const c = pickProBowlCombo(S, new Set(), rng, {
        categories: { alma: 0, draft: 0, number: 0, position: 1 },
      })!
      expect(c.category).toBe('position')
    }
    // once position's only player is used, the remaining categories share evenly
    const seen = new Set<string>()
    for (let i = 0; i < 500; i++)
      seen.add(
        pickProBowlCombo(S, new Set(['brady']), rng, { categories: { position: 1 } })!.category,
      )
    expect([...seen].sort()).toEqual(['draft', 'number'])
    // every remaining category at zero falls back to a plain uniform roll
    expect(
      pickProBowlCombo(S, new Set(), rng, {
        categories: { alma: 0, draft: 0, number: 0, position: 0 },
      }),
    ).not.toBeNull()
  })
  it('weights seasons inside a category (1995–1999 land less often)', () => {
    const rng = mulberry32(9)
    const N = 40000
    let brady = 0
    let rodgers = 0
    for (let i = 0; i < N; i++) {
      const c = pickProBowlCombo(S, new Set(), rng, {
        categories: { alma: 0, number: 0, position: 0, draft: 1 },
        seasons: { 2010: 0.1 },
      })!
      expect(c.category).toBe('draft')
      if (c.player === 'brady') brady++
      else rodgers++
    }
    // draft has one 2010 combo (weight 0.1) and one 2011 combo (weight 1)
    expect(rodgers / brady).toBeGreaterThan(7)
    expect(rodgers / brady).toBeLessThan(13)
    // a category whose every season weighs 0 still rolls (uniform fallback)
    expect(
      pickProBowlCombo(S, new Set(), rng, {
        categories: { alma: 1, draft: 0, number: 0, position: 0 },
        seasons: { 2010: 0 },
      })!.category,
    ).toBe('alma')
  })
})

describe('Pro Bowl round building', () => {
  it('shows the answer once and two distinct distractors from the pool, keyed by player', () => {
    const rng = mulberry32(7)
    for (let i = 0; i < 300; i++) {
      const r = nextProBowlRound(S, new Set(), rng)!
      expect(r.kind).toBe('probowl')
      expect(new Set(r.options).size).toBe(3)
      expect(r.options.filter((o) => o === r.combo.answer)).toHaveLength(1)
      expect(r.options[r.answerSlot]).toBe(r.combo.answer)
      for (const o of r.options) if (o !== r.combo.answer) expect(r.combo.distractors).toContain(o)
      expect(r.usedKey).toBe(r.combo.player)
    }
  })
  it('places the answer in each slot about a third of the time', () => {
    const rng = mulberry32(11)
    const slots = [0, 0, 0]
    const N = 30000
    for (let i = 0; i < N; i++) {
      const s = buildProBowlRound(S.combos[1]!, rng).answerSlot
      slots[s] = (slots[s] ?? 0) + 1
    }
    for (const n of slots) {
      expect(n / N).toBeGreaterThan(0.3)
      expect(n / N).toBeLessThan(0.37)
    }
  })
  it('can show UNDRAFTED as a wrong card for a drafted player', () => {
    const rng = mulberry32(5)
    let seen = false
    for (let i = 0; i < 200 && !seen; i++)
      seen = buildProBowlRound(S.combos[1]!, rng).options.includes('UDFA')
    expect(seen).toBe(true)
  })
  it('refuses a combo with fewer than two distractors', () => {
    expect(() => buildProBowlRound(combo(2010, 'x', 'number', '1', ['2']), mulberry32(1))).toThrow(
      /fewer than two/,
    )
  })
})

describe('describeValue', () => {
  it('turns raw values into readable labels', () => {
    expect(describeValue(S, 'alma', 'mich')).toBe('Michigan')
    expect(describeValue(S, 'draft', 'SD')).toBe('San Diego Chargers')
    expect(describeValue(S, 'draft', 'UDFA')).toBe('Undrafted')
    expect(describeValue(S, 'number', '12')).toBe('#12')
    expect(describeValue(S, 'position', 'QB')).toBe('QB')
  })
})

describe('NBA config', () => {
  it('plays the NBA pool with Birthplace instead of Position and even category weights', async () => {
    const { NBA_CONFIG, configFor } = await import('../../src/game/config')
    expect(configFor('nba')).toBe(NBA_CONFIG)
    expect(NBA_CONFIG.poolKey).toBe('nba')
    expect(NBA_CONFIG.roles).toEqual(['G', 'F', 'C'])
    expect(NBA_CONFIG.categoryWeights).toEqual({ alma: 1, draft: 1, number: 1, country: 1 })
    expect(NBA_CONFIG.seasonWeights?.['1999']).toBe(0.3)
    expect(NBA_CONFIG.wheels.map((w) => w.kind)).toEqual(['season', 'player', 'category'])
  })
})
