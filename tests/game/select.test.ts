import { describe, expect, it } from 'vitest'
import type { Bundle, Combo } from '../../src/game/bundle'
import { mulberry32 } from '../../src/game/rng'
import {
  buildRound,
  eligibleCombos,
  nextRound,
  pickCombo,
  pickDistractor,
  replaceFace,
} from '../../src/game/select'

const combo = (
  season: number,
  team: string,
  answer: string,
  distractors: string[],
  alumni: string[] = [],
): Combo => ({
  season,
  team,
  role: 'QB',
  answer,
  distractors,
  alumni,
})

function bundle(combos: Combo[]): Bundle {
  const people: Bundle['people'] = {}
  for (const c of combos)
    for (const id of [c.answer, ...c.distractors]) people[id] = { name: id, photo: null }
  return {
    buildHash: 'test',
    generatedAt: '',
    firstSeason: 2000,
    lastSeason: 2001,
    liveSeason: null,
    roles: ['QB'],
    teams: [],
    people,
    combos,
  }
}

const B = bundle([
  combo(2000, 'A', 'brady', ['ryan', 'flacco', 'cassel'], ['cassel']),
  combo(2000, 'B', 'cassel', ['brady', 'ryan', 'flacco'], ['flacco']),
  combo(2001, 'A', 'brady', ['ryan', 'flacco', 'cassel'], ['cassel', 'flacco']),
  combo(2001, 'B', 'flacco', ['brady', 'ryan']),
])

describe('roll selection', () => {
  it('excludes combos whose answer was already correct this streak', () => {
    expect(eligibleCombos(B, new Set()).length).toBe(4)
    expect(eligibleCombos(B, new Set(['brady'])).map((c) => `${c.season}:${c.team}`)).toEqual([
      '2000:B',
      '2001:B',
    ])
  })
  it('returns null once every answer has been used', () => {
    expect(pickCombo(B, new Set(['brady', 'cassel', 'flacco']), mulberry32(1))).toBeNull()
    expect(
      nextRound(B, new Set(['brady', 'cassel', 'flacco']), mulberry32(1), { alumniProb: 0.3 }),
    ).toBeNull()
  })
  it('is uniform over eligible combos, not over teams or seasons', () => {
    const rng = mulberry32(42)
    const counts = new Map<string, number>()
    for (let i = 0; i < 20000; i++) {
      const c = pickCombo(B, new Set(), rng)!
      const k = `${c.season}:${c.team}`
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    for (const n of counts.values()) expect(n / 20000).toBeGreaterThan(0.23)
    expect(counts.size).toBe(4)
  })
})

describe('face selection', () => {
  const opts = { alumniProb: 0.3 }

  it('shows exactly one correct face and two distinct distractors from the pool', () => {
    const rng = mulberry32(7)
    for (let i = 0; i < 500; i++) {
      const r = nextRound(B, new Set(), rng, opts)!
      expect(r.faces).toHaveLength(3)
      expect(new Set(r.faces).size).toBe(3)
      expect(r.faces.filter((f) => f === r.combo.answer)).toHaveLength(1)
      expect(r.faces[r.answerSlot]).toBe(r.combo.answer)
      for (const f of r.faces) if (f !== r.combo.answer) expect(r.combo.distractors).toContain(f)
    }
  })

  it('places the correct face in each slot about a third of the time', () => {
    const rng = mulberry32(99)
    const slots = [0, 0, 0]
    const N = 30000
    for (let i = 0; i < N; i++) {
      const slot = buildRound(B.combos[0]!, rng, opts).answerSlot
      slots[slot] = (slots[slot] ?? 0) + 1
    }
    for (const n of slots) {
      expect(n / N).toBeGreaterThan(0.3)
      expect(n / N).toBeLessThan(0.37)
    }
  })

  it('never draws alumni on purpose when alumniProb is 0, always when it is 1', () => {
    const c = combo(
      2001,
      'A',
      'brady',
      ['ryan', 'flacco', 'cassel', 'manning', 'rivers'],
      ['cassel'],
    )
    let rng = mulberry32(3)
    let alumniPicks = 0
    for (let i = 0; i < 2000; i++)
      if (pickDistractor(c, rng, { alumniProb: 0 }, new Set(['brady'])).alumni) alumniPicks++
    // With prob 0 the alumni pool is never chosen deliberately; cassel still shows up at the uniform rate (1 in 5).
    expect(alumniPicks / 2000).toBeGreaterThan(0.15)
    expect(alumniPicks / 2000).toBeLessThan(0.25)
    rng = mulberry32(4)
    for (let i = 0; i < 200; i++)
      expect(pickDistractor(c, rng, { alumniProb: 1 }, new Set(['brady'])).id).toBe('cassel')
  })

  it('draws each slot independently, so rounds show 0, 1 or 2 alumni faces', () => {
    const c = combo(
      2001,
      'A',
      'brady',
      ['ryan', 'flacco', 'cassel', 'manning', 'rivers', 'bledsoe'],
      ['cassel', 'bledsoe'],
    )
    const rng = mulberry32(11)
    const hist = [0, 0, 0]
    const N = 20000
    for (let i = 0; i < N; i++) {
      const n = buildRound(c, rng, { alumniProb: 0.3 }).alumniCount
      hist[n] = (hist[n] ?? 0) + 1
    }
    // Per slot: P(alumni) = 0.3 + 0.7 * (alumni share of the remaining pool) ≈ 0.3 + 0.7 * 2/6 ≈ 0.53 for slot 1.
    // Just check the mix is real: every count occurs and two-alumni rounds are neither dominant nor absent.
    expect(hist[0]).toBeGreaterThan(N * 0.1)
    expect(hist[1]).toBeGreaterThan(N * 0.3)
    expect(hist[2]).toBeGreaterThan(N * 0.1)
    expect(hist[2]).toBeLessThan(N * 0.5)
  })

  it('falls back to the full pool when the alumni are already on screen', () => {
    const c = combo(2001, 'A', 'brady', ['ryan', 'flacco', 'cassel'], ['cassel'])
    const rng = mulberry32(5)
    for (let i = 0; i < 100; i++) {
      const d = pickDistractor(c, rng, { alumniProb: 1 }, new Set(['brady', 'cassel']))
      expect(['ryan', 'flacco']).toContain(d.id)
      expect(d.alumni).toBe(false)
    }
  })

  it('refuses a combo with fewer than two distractors', () => {
    expect(() => buildRound(combo(2000, 'Z', 'x', ['y']), mulberry32(1), opts)).toThrow(
      /fewer than two/,
    )
  })
})

describe('replaceFace (broken image swap)', () => {
  const opts = { alumniProb: 0.3 }
  it('swaps a wrong face for an unused distractor and keeps the answer where it was', () => {
    const c = combo(2001, 'A', 'brady', ['ryan', 'flacco', 'cassel'], ['cassel'])
    const rng = mulberry32(8)
    const r = buildRound(c, rng, opts)
    const wrongSlot = ([0, 1, 2] as const).find((s) => s !== r.answerSlot)!
    const swapped = replaceFace(r, wrongSlot, rng, opts)!
    expect(swapped.answerSlot).toBe(r.answerSlot)
    expect(swapped.faces[wrongSlot]).not.toBe(r.faces[wrongSlot])
    expect(r.faces).not.toContain(swapped.faces[wrongSlot])
    expect(new Set(swapped.faces).size).toBe(3)
  })
  it('returns null for the answer slot or when no spare distractor exists', () => {
    const c = combo(2001, 'B', 'flacco', ['brady', 'ryan'])
    const rng = mulberry32(9)
    const r = buildRound(c, rng, opts)
    expect(replaceFace(r, r.answerSlot, rng, opts)).toBeNull()
    const wrongSlot = ([0, 1, 2] as const).find((s) => s !== r.answerSlot)!
    expect(replaceFace(r, wrongSlot, rng, opts)).toBeNull()
  })
})
